"""Windows desktop entry point. Keep the processor on the owner's computer."""
import os
import socket
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
import webbrowser
from pathlib import Path


def _home():
    return Path(os.environ.get("LOCALAPPDATA") or Path.home() / "AppData" / "Local") / "Endrox"


def _prepare():
    # PyInstaller puts bundled programs beside the bundled web and font files.
    root = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent.parent))
    tools = root / "bin"
    if tools.is_dir():
        os.environ["PATH"] = str(tools) + os.pathsep + os.environ.get("PATH", "")
    os.environ["PEAKCUT_HOST"] = "127.0.0.1"
    os.environ["PEAKCUT_ACCOUNTS"] = "0"
    os.environ["PEAKCUT_UPDATE_CHECK"] = "0"
    _home().mkdir(parents=True, exist_ok=True)


def _free_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def _ready(port):
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/healthz", timeout=1) as response:
            return response.status == 200 and b'"ok":true' in response.read()
    except (OSError, urllib.error.URLError):
        return False


def _server(port):
    os.environ["PEAKCUT_PORT"] = str(port)
    from studio.server import main
    main()


def _self_test():
    """Exercise the packaged executable on the Windows build runner."""
    import shutil
    for binary in ("ffmpeg", "ffprobe", "deno"):
        if not shutil.which(binary):
            raise RuntimeError(f"{binary} is missing from the desktop package")
    with tempfile.TemporaryDirectory(prefix="endrox-check-") as data:
        port = _free_port()
        env = os.environ.copy()
        env.update(PEAKCUT_DATA=data, PEAKCUT_FETCH_MODEL="0")
        process = subprocess.Popen([sys.executable, "--server", str(port)], env=env,
                                   stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT,
                                   creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        try:
            for _ in range(90):
                if _ready(port):
                    with urllib.request.urlopen(f"http://127.0.0.1:{port}/app/media", timeout=5) as response:
                        if response.status != 200 or b"Endrox" not in response.read():
                            raise RuntimeError("The bundled studio page did not load")
                    print("Desktop package: server, web page, FFmpeg, and Deno are ready.")
                    return
                if process.poll() is not None:
                    raise RuntimeError(f"The bundled server exited with code {process.returncode}")
                time.sleep(1)
            raise RuntimeError("The bundled server did not become ready")
        finally:
            process.terminate()
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()


def _desktop():
    import tkinter as tk

    port = _free_port()
    url = f"http://127.0.0.1:{port}/app/media"
    log_path = _home() / "desktop.log"
    log = log_path.open("a", encoding="utf-8")
    env = os.environ.copy()
    env["PEAKCUT_PORT"] = str(port)
    process = subprocess.Popen([sys.executable, "--server", str(port)], env=env,
                               stdout=log, stderr=subprocess.STDOUT,
                               creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    log.close()

    window = tk.Tk()
    window.title("Endrox Studio")
    window.geometry("420x310")
    window.resizable(False, False)
    window.configure(bg="#100d19")
    tk.Label(window, text="ENDROX", fg="#c9a7ff", bg="#100d19",
             font=("Segoe UI", 13, "bold")).pack(anchor="w", padx=28, pady=(24, 4))
    tk.Label(window, text="Your clipping studio", fg="#ffffff", bg="#100d19",
             font=("Segoe UI", 21, "bold")).pack(anchor="w", padx=28)
    status = tk.StringVar(value="Starting your studio…")
    tk.Label(window, textvariable=status, fg="#b8aacb", bg="#100d19",
             font=("Segoe UI", 10)).pack(anchor="w", padx=28, pady=(10, 20))

    def open_studio():
        webbrowser.open(url)

    launch = tk.Button(window, text="Open studio", command=open_studio, state="disabled",
                       bg="#a772ee", fg="#130c1e", activebackground="#c49af7",
                       relief="flat", font=("Segoe UI", 11, "bold"), padx=20, pady=9)
    launch.pack(anchor="w", padx=28)
    tk.Button(window, text="Open clips folder", command=lambda: os.startfile(_home() / "data"),
              bg="#100d19", fg="#c9a7ff", activebackground="#20152e",
              activeforeground="#ffffff", relief="flat", font=("Segoe UI", 10)).pack(anchor="w", padx=24, pady=(14, 0))
    tk.Label(window, text="Close this window to stop Endrox.", fg="#82748f", bg="#100d19",
             font=("Segoe UI", 9)).pack(anchor="w", padx=28, pady=(16, 0))

    def stop():
        if process.poll() is None:
            process.terminate()
        window.destroy()

    window.protocol("WM_DELETE_WINDOW", stop)

    def watch():
        if process.poll() is not None:
            window.after(0, lambda: status.set(f"Could not start. See {log_path}"))
            return
        if _ready(port):
            window.after(0, lambda: (status.set("Ready on this computer"), launch.configure(state="normal"), open_studio()))
            return
        window.after(500, watch)

    window.after(500, watch)
    window.mainloop()


def main():
    _prepare()
    if len(sys.argv) == 3 and sys.argv[1] == "--server":
        _server(int(sys.argv[2]))
    elif len(sys.argv) == 2 and sys.argv[1] == "--self-test":
        _self_test()
    else:
        _desktop()


if __name__ == "__main__":
    main()
