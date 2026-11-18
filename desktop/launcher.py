"""Windows desktop entry point. Keep the processor on the owner's computer."""
import os
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
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
    os.environ["PEAKCUT_ACCOUNTS"] = "1"
    os.environ["ENDROX_DESKTOP"] = "1"
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
    import json
    import http.cookiejar
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
                    client = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
                    base = f"http://127.0.0.1:{port}"
                    payload = json.dumps({"email":"desktop@example.com","password":"Endrox-check-023!"}).encode()
                    req = urllib.request.Request(base + "/api/auth/signup", data=payload,
                                                 headers={"Content-Type":"application/json", "Origin":base})
                    with client.open(req, timeout=10) as signed:
                        if not json.load(signed)["user"]["is_admin"]:
                            raise RuntimeError("Owner cannot configure the API key")
                    with client.open(base + "/api/ai", timeout=5):
                        pass
                    with client.open(base + "/app/media", timeout=5) as response:
                        if response.status != 200 or b"Channel library" not in response.read():
                            raise RuntimeError("The bundled studio page did not load")
                    window = _open_window(base + "/login", Path(data) / "window-check")
                    try:
                        time.sleep(4)
                        if window.poll() is not None:
                            raise RuntimeError("The studio window closed during startup")
                    finally:
                        window.terminate()
                        window.wait(timeout=15)
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


def _open_window(url, profile):
    for folder in ("ProgramFiles(x86)", "ProgramFiles", "LOCALAPPDATA"):
        base = os.environ.get(folder)
        if base:
            edge = Path(base) / "Microsoft/Edge/Application/msedge.exe"
            if edge.is_file():
                return subprocess.Popen([str(edge), "--app=" + url, "--user-data-dir=" + str(profile),
                                         "--no-first-run", "--disable-background-mode"])
    raise RuntimeError("Endrox needs Microsoft Edge to display the studio on this PC.")


def _desktop():
    port = _free_port()
    url = f"http://127.0.0.1:{port}/app/media"
    with (_home() / "desktop.log").open("a", encoding="utf-8") as log:
        process = subprocess.Popen([sys.executable, "--server", str(port)], stdout=log,
                                   stderr=log, creationflags=subprocess.CREATE_NO_WINDOW)
        try:
            for _ in range(120):
                if _ready(port):
                    with tempfile.TemporaryDirectory(prefix="endrox-window-", ignore_cleanup_errors=True) as profile:
                        _open_window(url, profile).wait()
                    break
                if process.poll() is not None:
                    raise RuntimeError("Endrox could not start. See the desktop.log file in your Endrox data folder.")
                time.sleep(.5)
            else:
                raise RuntimeError("Endrox timed out while opening the studio.")
        finally:
            process.terminate()
            process.wait()


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
