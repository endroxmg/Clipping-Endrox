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
    import webview
    from webview.platforms import edgechromium
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
    import webview

    port = _free_port()
    url = f"http://127.0.0.1:{port}/app/media"
    with (_home() / "desktop.log").open("a", encoding="utf-8") as log:
        process = subprocess.Popen([sys.executable, "--server", str(port)], stdout=log,
                                   stderr=log, creationflags=subprocess.CREATE_NO_WINDOW)
        try:
            window = webview.create_window("Endrox Studio", html="<body style='background:#141118;color:white;font:20px Segoe UI;padding:48px'>Opening Endrox Studio…</body>", width=1200, height=820)
            def connect():
                for _ in range(120):
                    if _ready(port):
                        window.load_url(url)
                        return
                    if process.poll() is not None:
                        break
                    time.sleep(.5)
                window.load_html("<h2>Endrox could not start</h2><p>Open %LOCALAPPDATA%&#92;Endrox&#92;desktop.log for details.</p>")
            webview.start(connect, gui="edgechromium", private_mode=True)
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
