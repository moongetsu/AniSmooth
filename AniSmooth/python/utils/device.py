import json
import subprocess
import shutil
import os
import torch

def log(msg_type, msg, **kw):
    out = {"type": msg_type, "msg": str(msg)}
    out.update(kw)
    print(json.dumps(out), flush=True)

def get_device():
    if torch.cuda.is_available():
        return torch.device("cuda")
    return torch.device("cpu")

def _find_nvidia_smi():
    """Find nvidia-smi executable. Prefers NVIDIA's install dir over System32 stub."""
    
    nvidia_dirs = [
        r"C:\Program Files\NVIDIA Corporation\NVSMI\nvidia-smi.exe",
        r"C:\Program Files (x86)\NVIDIA Corporation\NVSMI\nvidia-smi.exe",
    ]
    for path in nvidia_dirs:
        if os.path.exists(path):
            return path
    
    
    smi = shutil.which("nvidia-smi")
    if smi:
        return smi
    
    
    if os.path.exists(r"C:\Windows\System32\nvidia-smi.exe"):
        return r"C:\Windows\System32\nvidia-smi.exe"
    
    return None

def _run_nvidia_smi():
    smi_path = _find_nvidia_smi()
    if not smi_path:
        return None

    gpu_name = None
    memory_total_mb = 0
    driver_version = None
    cuda_driver_version = None

    
    try:
        result = subprocess.run(
            [smi_path, "--query-gpu=name,memory.total,driver_version",
             "--format=csv,noheader,nounits"],
            capture_output=True, text=True, timeout=10
        )
        if result.returncode == 0 and result.stdout.strip():
            parts = [p.strip() for p in result.stdout.strip().split(",")]
            if len(parts) >= 2:
                gpu_name = parts[0]
                if parts[1].isdigit():
                    memory_total_mb = int(parts[1])
                if len(parts) > 2 and parts[2].lower() != "n/a":
                    driver_version = parts[2]
    except Exception:
        pass

    
    if not gpu_name or not driver_version:
        try:
            result = subprocess.run(
                [smi_path], capture_output=True, text=True, timeout=10
            )
            if result.returncode == 0:
                for line in result.stdout.split("\n"):
                    if not gpu_name and "NVIDIA" in line.upper() and "GeForce" in line:
                        gpu_name = line.strip()
                    if "CUDA Version:" in line:
                        raw = line.strip().split("CUDA Version:")[-1].strip()
                        cuda_driver_version = raw.split(" ")[0]
                    if "Driver Version:" in line:
                        raw = line.strip().split("Driver Version:")[-1].strip()
                        driver_version = raw.split(" ")[0]
        except Exception:
            pass

    if not gpu_name:
        return None

    return {
        "name": gpu_name,
        "memory_total_mb": memory_total_mb,
        "driver_version": driver_version,
        "cuda_driver_version": cuda_driver_version,
    }

def _pytorch_has_cuda():
    ver = torch.__version__
    return "+cu" in ver or "+cuda" in ver

def get_gpu_info():
    nvidia = _run_nvidia_smi()
    torch_cuda = torch.cuda.is_available()
    torch_has_cuda_build = _pytorch_has_cuda()

    info = {
        "cuda_available": torch_cuda,
        "device": "cuda" if torch_cuda else "cpu",
        "gpu_name": None,
        "gpu_memory_total_mb": 0,
        "gpu_memory_free_mb": 0,
        "cuda_version": None,
        "gpu_count": 0,
        "pytorch_variant": "cuda" if torch_has_cuda_build else "cpu",
        "nvidia_gpu_detected": nvidia is not None or torch_cuda,
        "nvidia_name": nvidia["name"] if nvidia else None,
        "nvidia_driver": nvidia["driver_version"] if nvidia else None,
        "nvidia_cuda_ver": nvidia["cuda_driver_version"] if nvidia else None,
        "nvidia_vram_mb": nvidia["memory_total_mb"] if nvidia else 0,
        "spandrel_available": False,
        "spandrel_version": None,
    }

    try:
        import spandrel
        info["spandrel_available"] = True
        info["spandrel_version"] = spandrel.__version__
    except ImportError:
        pass

    if torch_cuda:
        info["gpu_count"] = torch.cuda.device_count()
        info["cuda_version"] = torch.version.cuda
        try:
            props = torch.cuda.get_device_properties(0)
            info["gpu_name"] = props.name
            info["gpu_memory_total_mb"] = props.total_memory // (1024 * 1024)
        except Exception as e:
            log("warn", "Could not read GPU properties: " + str(e))
        try:
            free_bytes, total_bytes = torch.cuda.mem_get_info(0)
            info["gpu_memory_free_mb"] = free_bytes // (1024 * 1024)
        except Exception:
            pass
    elif nvidia:
        info["gpu_name"] = nvidia["name"]
        info["gpu_memory_total_mb"] = nvidia["memory_total_mb"]
        info["gpu_count"] = 1

    return info

def check_tensorrt():
    try:
        import tensorrt
        return True
    except ImportError:
        return False

def print_gpu_info():
    info = get_gpu_info()
    log("info", "=== GPU Detection Report ===")
    log("info", "PyTorch variant: " + info["pytorch_variant"])
    log("info", "CUDA available to PyTorch: " + str(info["cuda_available"]))
    log("info", "NVIDIA GPU via nvidia-smi: " + str(info["nvidia_gpu_detected"]))

    if info["cuda_available"]:
        log("info", "GPU: " + str(info["gpu_name"]))
        log("info", "CUDA version: " + str(info["cuda_version"]))
        log("info", "VRAM: " + str(info["gpu_memory_free_mb"]) + "/" + str(info["gpu_memory_total_mb"]) + " MB")
        log("info", "TensorRT: " + str(check_tensorrt()))
    elif info["nvidia_gpu_detected"]:
        log("warn", "NVIDIA GPU found (" + str(info["nvidia_name"]) + ") but NOT usable.")
        if not info["pytorch_variant"] == "cuda":
            log("warn", "PyTorch is CPU-only. Reinstall with: pip install torch --index-url https://download.pytorch.org/whl/cu121")
        else:
            log("warn", "PyTorch has CUDA but cannot see the GPU. Check NVIDIA drivers.")
    else:
        log("warn", "No NVIDIA GPU detected. Models run on CPU (slow).")

    log("info", "==============================")
    return info
