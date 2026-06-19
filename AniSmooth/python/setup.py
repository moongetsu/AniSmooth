import sys, os, json, shutil, tempfile, zipfile, io, subprocess

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))

FFMPEG_URL = "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip"

PIP_PACKAGES = [
    "torch==2.2.2",
    "torchvision==0.17.2",
    "opencv-python==4.9.0.80",
    "numpy==1.26.4",
    "Pillow==10.2.0",
    "onnx==1.15.0",
    "onnxruntime==1.17.1",
    "spandrel==0.3.4"
]

def log(msg_type, msg, **kw):
    out = {"type": msg_type, "msg": str(msg)}
    out.update(kw)
    print(json.dumps(out), flush=True)

def download_file(url, dest_path, label):
    """Download a file with progress reporting. Returns True on success."""
    import urllib.request

    log("info", f"Downloading {label}...", pct=0)

    try:
        req = urllib.request.Request(url, headers={"User-Agent": "AniSmooth/1.0"})
        resp = urllib.request.urlopen(req, timeout=30)
    except Exception as e:
        log("error", f"Could not connect to download server: {e}")
        return False

    total = int(resp.headers.get("Content-Length", 0))
    downloaded = 0
    chunk_size = 65536

    try:
        with open(dest_path, "wb") as f:
            while True:
                chunk = resp.read(chunk_size)
                if not chunk:
                    break
                f.write(chunk)
                downloaded += len(chunk)
                if total > 0:
                    pct = min(99, int(downloaded * 100 / total))
                    if downloaded % (chunk_size * 8) < chunk_size:
                        log("progress", f"Downloading {label}: {pct}%", pct=pct, done=downloaded, total=total)
    except Exception as e:
        log("error", f"Download interrupted: {e}")
        try:
            os.unlink(dest_path)
        except Exception:
            pass
        return False

    log("progress", f"Downloading {label}: 100%", pct=100, done=downloaded, total=total)
    return True

def find_in_zip(zip_path, exe_name, dest_dir):
    """Extract a single .exe from a zip, searching recursively."""
    import fnmatch
    result = None
    try:
        with zipfile.ZipFile(zip_path, "r") as zf:
            for member in zf.namelist():
                base = os.path.basename(member)
                if base.lower() == exe_name.lower():
                    dest = os.path.join(dest_dir, base)
                    zf.extract(member, dest_dir)
                    extracted = os.path.join(dest_dir, member)
                    if extracted != dest:
                        shutil.move(extracted, dest)
                    result = dest
        return result
    except Exception as e:
        log("warn", f"Zip extraction error: {e}")
        return None

def install_ffmpeg():
    """Download and install ffmpeg.exe and ffprobe.exe with SHA-256 integrity verification."""
    ffmpeg_exe = os.path.join(SCRIPT_DIR, "ffmpeg.exe")
    ffprobe_exe = os.path.join(SCRIPT_DIR, "ffprobe.exe")

    if os.path.exists(ffmpeg_exe) and os.path.exists(ffprobe_exe):
        log("info", "FFmpeg already installed")
        log("done", "ffmpeg", path=ffmpeg_exe)
        log("done", "ffprobe", path=ffprobe_exe)
        return True

    zip_path = os.path.join(SCRIPT_DIR, "_ffmpeg_download.zip")
    if not download_file(FFMPEG_URL, zip_path, "FFmpeg"):
        return False

    
    sha_path = zip_path + ".sha256"
    if download_file(FFMPEG_URL + ".sha256", sha_path, "FFmpeg checksum"):
        try:
            with open(sha_path, "r", encoding="utf-8") as sf:
                expected_sha = sf.read().strip().split()[0].lower()
            import hashlib
            sha256 = hashlib.sha256()
            with open(zip_path, "rb") as f:
                while True:
                    data = f.read(65536)
                    if not data:
                        break
                    sha256.update(data)
            calculated_sha = sha256.hexdigest().lower()
            try:
                os.unlink(sha_path)
            except Exception:
                pass
            if calculated_sha != expected_sha:
                log("error", f"FFmpeg checksum verification failed! Expected: {expected_sha}, Got: {calculated_sha}")
                try:
                    os.unlink(zip_path)
                except Exception:
                    pass
                return False
            log("info", "FFmpeg checksum verified successfully.")
        except Exception as e:
            log("error", f"Failed to verify FFmpeg checksum: {e}")
            try:
                os.unlink(zip_path); os.unlink(sha_path)
            except Exception:
                pass
            return False
    else:
        log("error", "Failed to download FFmpeg checksum file.")
        try:
            os.unlink(zip_path)
        except Exception:
            pass
        return False

    log("info", "Extracting FFmpeg...")
    ffmpeg_found = find_in_zip(zip_path, "ffmpeg.exe", SCRIPT_DIR)
    ffprobe_found = find_in_zip(zip_path, "ffprobe.exe", SCRIPT_DIR)

    try:
        os.unlink(zip_path)
    except Exception:
        pass

    if ffmpeg_found and ffprobe_found:
        log("info", "FFmpeg installed successfully")
        log("done", "ffmpeg", path=ffmpeg_found)
        log("done", "ffprobe", path=ffprobe_found)
        return True
    else:
        log("error", "Could not extract FFmpeg from the downloaded archive")
        return False

def _find_nvidia_smi():
    """Find nvidia-smi executable. Prefers NVIDIA's install dir over System32 stub."""
    import shutil
    
    # Prefer NVIDIA's own directory (real smi with full output)
    nvidia_dirs = [
        r"C:\Program Files\NVIDIA Corporation\NVSMI\nvidia-smi.exe",
        r"C:\Program Files (x86)\NVIDIA Corporation\NVSMI\nvidia-smi.exe",
    ]
    for path in nvidia_dirs:
        if os.path.exists(path):
            return path
    
    # Fallback: PATH or System32
    smi = shutil.which("nvidia-smi")
    if smi and "NVIDIA Corporation" not in smi:
        # It might be the System32 stub — check NVIDIA dirs via PATH parent
        pass
    if smi:
        return smi
    
    if os.path.exists(r"C:\Windows\System32\nvidia-smi.exe"):
        return r"C:\Windows\System32\nvidia-smi.exe"
    
    return None

def _get_cuda_version_from_smi(smi_path):
    """Run nvidia-smi and extract CUDA version. Returns version string or None."""
    try:
        result = subprocess.run(
            [smi_path], capture_output=True, text=True, timeout=10
        )
        if result.returncode != 0:
            return None
        
        for line in result.stdout.split("\n"):
            if "CUDA Version:" in line:
                raw = line.strip().split("CUDA Version:")[-1].strip()
                return raw.split(" ")[0]
        
        # Alternative: query driver_version which implies CUDA compat
        result2 = subprocess.run(
            [smi_path, "--query-gpu=driver_version", "--format=csv,noheader,nounits"],
            capture_output=True, text=True, timeout=10
        )
        if result2.returncode == 0:
            driver = result2.stdout.strip().split(".")[0]
            driver_int = int(driver) if driver.isdigit() else 0
            if driver_int >= 570: return "12.6"
            if driver_int >= 550: return "12.4"
            if driver_int >= 525: return "12.0"
            if driver_int >= 470: return "11.4"
    except Exception:
        pass
    return None

def _detect_cuda_pytorch_index():
    """Detect CUDA version and return appropriate PyTorch index URL."""
    import shutil
    
    # Try multiple paths: NVIDIA dir first, then PATH/System32
    nvidia_paths = [
        r"C:\Program Files\NVIDIA Corporation\NVSMI\nvidia-smi.exe",
        r"C:\Program Files (x86)\NVIDIA Corporation\NVSMI\nvidia-smi.exe",
    ]
    for p in nvidia_paths:
        if not os.path.exists(p):
            continue
        ver = _get_cuda_version_from_smi(p)
        if ver:
            log("info", f"nvidia-smi: {p} → CUDA {ver}")
            major = int(ver.split(".")[0])
            return "https://download.pytorch.org/whl/cu124" if major >= 12 else "https://download.pytorch.org/whl/cu118"
    
    smi = shutil.which("nvidia-smi")
    if smi:
        ver = _get_cuda_version_from_smi(smi)
        if ver:
            log("info", f"nvidia-smi: {smi} → CUDA {ver}")
            major = int(ver.split(".")[0])
            return "https://download.pytorch.org/whl/cu124" if major >= 12 else "https://download.pytorch.org/whl/cu118"
    
    if os.path.exists(r"C:\Windows\System32\nvidia-smi.exe"):
        ver = _get_cuda_version_from_smi(r"C:\Windows\System32\nvidia-smi.exe")
        if ver:
            log("info", f"nvidia-smi: System32 → CUDA {ver}")
            major = int(ver.split(".")[0])
            return "https://download.pytorch.org/whl/cu124" if major >= 12 else "https://download.pytorch.org/whl/cu118"
    
    return None

def install_pip_packages():
    """Install required pip packages for custom PyTorch workflows."""
    missing = []
    for pkg in PIP_PACKAGES:
        try:
            subprocess.check_output(
                [sys.executable, "-m", "pip", "show", pkg],
                stderr=subprocess.DEVNULL,
                timeout=15
            )
        except Exception:
            missing.append(pkg)

    if not missing:
        log("info", "All essential pip packages are already installed")
        return True

    log("info", f"Installing pip packages: {', '.join(missing)}...")
    try:
        cmd = [sys.executable, "-m", "pip", "install"]
        if "torch" in missing or "torchvision" in missing:
            cuda_index = _detect_cuda_pytorch_index()
            if cuda_index:
                log("info", "NVIDIA GPU detected. Installing CUDA PyTorch...")
                log("info", "Using index: " + cuda_index)
                cmd += ["torch", "torchvision", "--index-url", cuda_index]
            else:
                log("info", "No NVIDIA GPU found. Installing CPU PyTorch...")
                cmd += ["torch", "torchvision"]
            if "torch" in missing: missing.remove("torch")
            if "torchvision" in missing: missing.remove("torchvision")

        if missing:
            cmd += missing

        proc = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True
        )
        for line in proc.stdout:
            log("pip", line.strip())

        proc.wait()
        return proc.returncode == 0
    except Exception as e:
        log("error", f"pip installation failed: {e}")
        return False

def force_gpu_pytorch():
    log("section", "GPU PyTorch Installer", step=1, total=1)
    
    smi_path = _find_nvidia_smi()
    if not smi_path:
        log("error", "nvidia-smi not found. Cannot detect NVIDIA GPU.")
        log("error", "Please install NVIDIA drivers from https://www.nvidia.com/drivers")
        return False
    
    log("info", f"Found nvidia-smi at: {smi_path}")
    
    cuda_index = _detect_cuda_pytorch_index()
    if not cuda_index:
        log("error", "Could not detect CUDA version. Drivers may be outdated or corrupted.")
        log("error", "Try updating NVIDIA drivers from https://www.nvidia.com/drivers")
        return False

    log("info", "Reinstalling PyTorch + torchvision with CUDA...")
    log("info", "Index: " + cuda_index)
    cmd = [
        sys.executable, "-m", "pip", "install", "--force-reinstall",
        "torch", "torchvision", "--index-url", cuda_index
    ]
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    for line in proc.stdout:
        log("pip", line.strip())
    proc.wait()
    ok = proc.returncode == 0
    if ok:
        log("success", "CUDA PyTorch installed. Restart the panel to detect GPU.")
    else:
        log("error", "CUDA PyTorch install failed with code " + str(proc.returncode))
    return ok

def main():
    import argparse
    parser = argparse.ArgumentParser(description="AniSmooth Setup")
    parser.add_argument("--force-gpu", action="store_true", help="Reinstall PyTorch with CUDA support")
    args = parser.parse_args()

    if args.force_gpu:
        try:
            ok = force_gpu_pytorch()
            sys.exit(0 if ok else 1)
        except Exception as e:
            log("fatal", str(e))
            sys.exit(1)
        return

    log("info", "AniSmooth Python Setup")
    log("info", f"Target directory: {SCRIPT_DIR}")
    log("info", f"Python version: {sys.version}")

    results = {"ffmpeg": False, "ffprobe": False, "pip": False}

    log("section", "FFmpeg Installer", step=1, total=2)
    results["ffmpeg"] = install_ffmpeg()
    if results["ffmpeg"]:
        results["ffprobe"] = True

    log("section", "Pip Packages Installer", step=2, total=2)
    results["pip"] = install_pip_packages()

    all_ok = results["ffmpeg"] and results["pip"]
    log("summary", "installation_summary", results=results, all_ok=all_ok)

    if all_ok:
        log("success", "AniSmooth environment configuration complete!")
    else:
        log("warn", "Setup completed with warnings. Check logs for missing files/dependencies.")

if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        log("fatal", str(e))
        sys.exit(1)
