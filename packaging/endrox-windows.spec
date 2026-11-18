"""Build with: pyinstaller --noconfirm packaging/endrox-windows.spec"""
from pathlib import Path
from PyInstaller.utils.hooks import collect_all, collect_submodules

root = Path(SPECPATH).parent
datas = [(str(root / "web"), "web"),
         (str(root / "studio" / "fonts"), "studio/fonts"),
         (str(root / "packaging" / "bin"), "bin"),
         (str(root / "packaging" / "WINDOWS-README.txt"), ".")]
binaries = []
hidden = collect_submodules("studio")
for package in ("sherpa_onnx", "faster_whisper", "ctranslate2", "av", "yt_dlp", "cv2", "psycopg", "webview", "clr_loader"):
    package_datas, package_binaries, package_hidden = collect_all(package)
    datas += package_datas
    binaries += package_binaries
    hidden += package_hidden

a = Analysis([str(root / "desktop" / "launcher.py")],
             pathex=[str(root)], binaries=binaries, datas=datas,
             hiddenimports=hidden, hookspath=[], hooksconfig={},
             runtime_hooks=[], excludes=[], noarchive=False)
pyz = PYZ(a.pure)
exe = EXE(pyz, a.scripts, [], exclude_binaries=True, name="Endrox",
          debug=False, bootloader_ignore_signals=False, strip=False, upx=False,
          console=False, disable_windowed_traceback=False)
coll = COLLECT(exe, a.binaries, a.datas, strip=False, upx=False, name="Endrox")
