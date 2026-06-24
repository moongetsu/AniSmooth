import argparse
import sys
import os
import json
import gc
import traceback
import cv2
import torch
import torch.nn.functional as F
import numpy as np

os.environ.setdefault("PYTORCH_CUDA_ALLOC_CONF", "expandable_segments:True")

from utils import VideoProcessor, get_device, check_tensorrt, print_gpu_info
from utils.video import mux_audio, reencode_to_size, reencode_high_quality
from models.rife import RIFEModel
from models.upscale import ShuffleCUGANModel
from models.weight_loader import load_weights_if_available, download_weights, is_weight_downloaded
from models.tensorrt_engine import (
    is_tensorrt_available, build_rife_onnx, build_rife_tensorrt_engine,
    load_tensorrt_engine, TensorRTInferenceEngine, get_engine_path, ensure_engines_dir,
)

def log(msg_type, msg, **kw):
    out = {"type": msg_type, "msg": str(msg)}
    out.update(kw)
    print(json.dumps(out), flush=True)

# FlowFrames-style quality presets. Each tier bundles a CRF (visual quality),
# an x264 speed preset, and -tune animation (best for anime line-art). The UI
# sends one of these keys via --preset; quality is decoupled from encode speed.
QUALITY_PRESETS = {
    "archival": {"crf": 14, "x264": "slow",      "tune": "animation"},
    "high":     {"crf": 17, "x264": "slow",      "tune": "animation"},
    "balanced": {"crf": 20, "x264": "medium",    "tune": "animation"},
    "fast":     {"crf": 22, "x264": "veryfast",  "tune": "animation"},
    "draft":    {"crf": 26, "x264": "ultrafast", "tune": "animation"},
}

def resolve_quality(key):
    """Map a UI preset key (or a legacy x264 speed name) to a quality bundle."""
    return QUALITY_PRESETS.get(str(key or "high").lower(), QUALITY_PRESETS["high"])

def tensor_to_frame(tensor, device="cuda"):
    frame = tensor.squeeze(0).permute(1, 2, 0).detach()
    frame = torch.clamp(frame, 0, 1)
    frame = (frame * 255).contiguous().to(torch.uint8)
    if device == "cuda" or str(frame.device).startswith("cuda"):
        frame = frame.cpu()
    return cv2.cvtColor(frame.numpy(), cv2.COLOR_RGB2BGR)

def frame_to_tensor(frame, device):
    frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    tensor = torch.from_numpy(frame_rgb).float() / 255.0
    tensor = tensor.permute(2, 0, 1).unsqueeze(0)
    return tensor.to(device)

def pad_to_mod(tensor, mod=32):
    """Pad tensor height and width to be divisible by `mod`.
    Returns (padded_tensor, (pad_h, pad_w)) so the caller can crop back."""
    _, _, h, w = tensor.shape
    pad_h = (mod - h % mod) % mod
    pad_w = (mod - w % mod) % mod
    if pad_h == 0 and pad_w == 0:
        return tensor, (0, 0)
    
    padded = F.pad(tensor, (0, pad_w, 0, pad_h), mode="replicate")
    return padded, (pad_h, pad_w)

def unpad(tensor, pad_hw):
    """Remove padding added by pad_to_mod."""
    pad_h, pad_w = pad_hw
    if pad_h == 0 and pad_w == 0:
        return tensor
    h = tensor.shape[2] - pad_h
    w = tensor.shape[3] - pad_w
    return tensor[:, :, :h, :w]

def detect_scene_change(frame_a, frame_b, threshold=0.40):
    """Detect if two frames are from different scenes by comparing
    mean absolute difference of downscaled grayscale versions.
    Returns True if a scene change is detected."""
    small_size = (64, 64)
    gray_a = cv2.cvtColor(frame_a, cv2.COLOR_BGR2GRAY)
    gray_b = cv2.cvtColor(frame_b, cv2.COLOR_BGR2GRAY)
    gray_a = cv2.resize(gray_a, small_size).astype(np.float32) / 255.0
    gray_b = cv2.resize(gray_b, small_size).astype(np.float32) / 255.0
    diff = np.mean(np.abs(gray_a - gray_b))
    return diff > threshold

def load_interpolation_model(model_name, device):
    log("info", f"Loading RIFE model: {model_name}")
    model = RIFEModel(model_name).to(device)
    model.eval()

    base_key = model_name.replace("-tensorrt", "")
    if is_weight_downloaded(base_key):
        if not load_weights_if_available(model, base_key, device):
            raise RuntimeError(f"Failed to load weights for {base_key}")
    else:
        log("info", f"No cached weights for {base_key}. Attempting download...")
        success = download_weights(base_key)
        if success:
            if not load_weights_if_available(model, base_key, device):
                raise RuntimeError(f"Failed to load weights for {base_key}")
        else:
            raise RuntimeError(f"Weights download failed for {model_name}")

    return model

def load_upscale_model(model_name, scale, device):
    log("info", f"Loading upscale model: {model_name}, scale: {scale}x")

    if not is_weight_downloaded(model_name):
        log("info", f"No cached weights for {model_name}. Attempting download...")
        success = download_weights(model_name)
        if not success:
            log("error", f"Failed to download weights for {model_name}. Cannot proceed.")
            raise RuntimeError(f"Weights not available for {model_name}")

    weight_path = None
    try:
        from models.weight_loader import get_weight_path, verify_weight_hash
        weight_path = get_weight_path(model_name)
        if weight_path and os.path.exists(weight_path):
            if not verify_weight_hash(model_name, weight_path):
                raise RuntimeError(f"Model integrity verification failed for {model_name}")
    except ValueError:
        pass

    
    try:
        log("info", f"Loading {model_name} via built-in ShuffleCUGAN architecture...")
        model = ShuffleCUGANModel(model_name, scale).to(device)
        model.eval()
        if weight_path and os.path.exists(weight_path):
            if load_weights_if_available(model, model_name, device):
                log("info", f"Built-in ShuffleCUGAN loaded successfully for {model_name}")
                return model
        log("warn", f"Built-in ShuffleCUGAN failed to load weights for {model_name}. Trying spandrel...")
    except Exception as e:
        log("warn", f"Built-in ShuffleCUGAN failed ({e}). Trying spandrel...")

    
    try:
        import spandrel
        if weight_path and os.path.exists(weight_path):
            log("info", f"Loading model via spandrel (auto-detect architecture)...")
            model_descriptor = spandrel.ModelLoader(device=device).load_from_file(weight_path)
            log("info", f"Spandrel loaded model: {model_descriptor.architecture}")
            return model_descriptor
    except ImportError:
        log("error", "spandrel not installed and built-in architecture failed.")
        log("error", "")
        log("error", "Fix: Go to Settings > Tools > Maintenance >")
        log("error", "\"Repair / Install Python Packages\"")
        log("error", "Or run manually: pip install spandrel==0.3.4")
        raise RuntimeError(f"Cannot load upscale model {model_name}: spandrel required but not installed")
    except Exception as e:
        log("error", f"spandrel loading failed ({e}).")
        raise RuntimeError(f"Failed to load upscale model {model_name}: {e}")

    raise RuntimeError(f"Weights not available for {model_name}")

def finalize_output(output_path, input_path, target_size_mb=None, quality=None):
    """Mux source audio, optionally re-encode to a target size.

    The FFmpeg pipe already encodes at the chosen CRF + faststart, so no
    separate re-encode is needed unless target_size_mb is set.
    """
    q = quality or QUALITY_PRESETS["high"]
    mux_audio(output_path, input_path)
    if target_size_mb and target_size_mb > 0:
        log("info", f"Re-encoding to target size: {target_size_mb} MB")
        if not reencode_to_size(output_path, input_path, target_size_mb,
                                x264_preset=q["x264"], tune=q["tune"]):
            log("warn", "Two-pass encoding failed, falling back to high-quality re-encode")
            reencode_high_quality(output_path, x264_preset=q["x264"], crf=q["crf"], tune=q["tune"])

def run_interpolation(input_path, output_path, model_name, factor, target_size_mb=None, preset="high", scene_threshold=0.40):
    q = resolve_quality(preset)
    log("info", f"Starting RIFE Interpolation. Model: {model_name}, Factor: {factor}x")

    print_gpu_info()
    device = get_device()
    log("info", f"Using device: {device}")

    use_tensorrt = "tensorrt" in model_name and is_tensorrt_available()
    if "tensorrt" in model_name and not is_tensorrt_available():
        log("warn", "TensorRT requested but not available. Falling back to PyTorch CUDA.")
        use_tensorrt = False

    with VideoProcessor(input_path, output_path) as video:
        w, h, fps, total_frames = video.get_info()
        video.setup_writer(fps * factor, x264_preset=q["x264"], crf=q["crf"], tune=q["tune"])
        log("info", f"Input: {w}x{h}, {fps:.2f} FPS, ~{total_frames} frames")

        
        pad_h = (32 - h % 32) % 32
        pad_w = (32 - w % 32) % 32
        if pad_h > 0 or pad_w > 0:
            log("info", f"Padding frames from {w}x{h} to {w + pad_w}x{h + pad_h} (mod-32 alignment)")

        trt_engine = None
        model = None

        if use_tensorrt:
            log("info", "Initializing TensorRT engine...")
            base_key = model_name.replace("-tensorrt", "")
            ensure_engines_dir()
            
            engine_h = h + pad_h
            engine_w = w + pad_w
            engine_path = get_engine_path(base_key, (engine_h, engine_w), "fp16")

            if not os.path.exists(engine_path):
                log("info", "Building TensorRT engine from PyTorch model...")
                pt_model = load_interpolation_model(base_key, device)
                onnx_path = build_rife_onnx(pt_model, base_key, (engine_h, engine_w), device)
                engine_path = build_rife_tensorrt_engine(onnx_path, engine_path, "fp16")
                del pt_model
                torch.cuda.empty_cache()

            if engine_path and os.path.exists(engine_path):
                engine = load_tensorrt_engine(engine_path)
                if engine is not None:
                    trt_engine = TensorRTInferenceEngine(engine)
                    trt_engine.allocate_buffers({
                        "img0": (1, 3, engine_h, engine_w),
                        "img1": (1, 3, engine_h, engine_w),
                    })
                    log("info", "TensorRT engine ready for inference")
                else:
                    log("error", "Failed to load TensorRT engine. Falling back to PyTorch.")
                    use_tensorrt = False

        if not use_tensorrt:
            model = load_interpolation_model(model_name.replace("-tensorrt", ""), device)

        log("info", "Starting frame interpolation...")
        frame_idx = 0
        prev_frame = None
        scene_changes = 0

        for frame in video.read_frames():
            if prev_frame is not None:
                
                is_scene_change = detect_scene_change(prev_frame, frame, scene_threshold)
                if is_scene_change:
                    scene_changes += 1
                    
                    
                    for _ in range(1, factor):
                        video.write_frame(prev_frame)
                elif use_tensorrt and trt_engine is not None:
                    
                    t0 = frame_to_tensor(prev_frame, device).half()
                    t1 = frame_to_tensor(frame, device).half()
                    t0, pad_info = pad_to_mod(t0, 32)
                    t1, _ = pad_to_mod(t1, 32)
                    for f in range(1, factor):
                        alpha = f / factor
                        with torch.no_grad():
                            
                            timestep_tensor = torch.full(
                                (1, 1, t0.shape[2], t0.shape[3]),
                                alpha, dtype=t0.dtype, device=device
                            )
                            result = trt_engine.infer({
                                "img0": t0, "img1": t1, "timestep": timestep_tensor
                            })
                            mid = unpad(result["output"].float(), pad_info)
                        interp = tensor_to_frame(mid, str(device))
                        video.write_frame(interp)
                else:
                    # PyTorch path — channels_last keeps CuDNN on the same
                    # kernel path as when the model was tuned; without it
                    # non-deterministic CuDNN kernel selection can shift
                    # intermediate activations enough to produce wrong flow.
                    t0 = frame_to_tensor(prev_frame, device).to(memory_format=torch.channels_last)
                    t1 = frame_to_tensor(frame, device).to(memory_format=torch.channels_last)
                    t0_padded, pad_info = pad_to_mod(t0, 32)
                    t1_padded, _ = pad_to_mod(t1, 32)
                    with torch.no_grad(), torch.amp.autocast("cuda", enabled=device.type == "cuda"):
                        model.cachePair(t0_padded, t1_padded)
                        # Save encoded features: IFNet.forward mutates f0←f1
                        # after each call, so multi-step (factor≥3) would use
                        # f1 for both on 2nd+ iterations — wrong flow.
                        saved_f0 = model.flownet.f0
                        saved_f1 = model.flownet.f1
                        for f in range(1, factor):
                            model.flownet.f0 = saved_f0
                            model.flownet.f1 = saved_f1
                            alpha = f / factor
                            mid = model(t0_padded, t1_padded, alpha)
                            mid = unpad(mid, pad_info)
                            interp_frame = tensor_to_frame(mid.float(), str(device))
                            video.write_frame(interp_frame)
                            del mid, interp_frame
                        del saved_f0, saved_f1
                    del t0, t1, t0_padded, t1_padded

                video.write_frame(frame)
            else:
                video.write_frame(frame)

            prev_frame = frame
            frame_idx += 1
            if frame_idx % 10 == 0:
                gc.collect()
            if device.type == "cuda" and frame_idx % 20 == 0:
                torch.cuda.empty_cache()
            denom = max(total_frames, 1)
            pct = min(100, int((frame_idx / denom) * 100))
            log("progress", f"Interpolating frames... {frame_idx}/{denom}", pct=pct)

    if scene_changes > 0:
        log("info", f"Scene changes detected and skipped: {scene_changes}")

    if model is not None:
        del model
    if trt_engine is not None:
        del trt_engine
    if device.type == "cuda":
        torch.cuda.empty_cache()
    finalize_output(output_path, input_path, target_size_mb, q)
    log("success", "Interpolation process completed successfully.")

def run_upscaling(input_path, output_path, model_name, scale, target_size_mb=None, preset="high"):
    q = resolve_quality(preset)
    log("info", f"Starting Video Upscaling. Model: {model_name}, Multiplier: {scale}x")

    print_gpu_info()
    device = get_device()
    log("info", f"Using device: {device}")
    cpu_threads = max(2, min(os.cpu_count() or 4, 8))
    cv2.setNumThreads(cpu_threads)

    model = load_upscale_model(model_name, scale, device)

    with VideoProcessor(input_path, output_path) as video:
        w, h, fps, total_frames = video.get_info()
        video.setup_writer(fps, scale=scale, x264_preset=q["x264"], crf=q["crf"], tune=q["tune"])
        log("info", f"Input: {w}x{h}, {fps:.2f} FPS, ~{total_frames} frames")

        log("info", "Starting frame upscaling...")
        frame_idx = 0
        black_warned = False

        for frame in video.read_frames():
            tensor = frame_to_tensor(frame, device)

            with torch.no_grad():
                upscaled = model(tensor)

            del tensor

            if frame_idx == 0:
                out_min = upscaled.min().item()
                out_max = upscaled.max().item()
                out_mean = upscaled.mean().item()
                log("info", f"Upscale output stats — min: {out_min:.4f}, max: {out_max:.4f}, mean: {out_mean:.4f}")
                if out_max < 0.01:
                    log("error", "Model output is nearly all-black! Model weights may not be loaded correctly.")
                    log("error", "Try removing the weight file and letting it re-download, or check console for weight-loading warnings.")
                    black_warned = True

            result = tensor_to_frame(upscaled, str(device))
            del upscaled
            video.write_frame(result)
            del result

            frame_idx += 1
            if frame_idx % 5 == 0:
                gc.collect()
            if device.type == "cuda" and frame_idx % 10 == 0:
                torch.cuda.empty_cache()
            denom = max(total_frames, 1)
            pct = min(100, int((frame_idx / denom) * 100))
            log("progress", f"Upscaling frames... {frame_idx}/{denom}", pct=pct)

    del model
    if device.type == "cuda":
        torch.cuda.empty_cache()
    finalize_output(output_path, input_path, target_size_mb, q)
    log("success", "Upscaling process completed successfully.")

def run_gpu_info():
    import torch
    import platform
    from utils import get_gpu_info, check_tensorrt

    info = get_gpu_info()
    info["tensorrt_available"] = check_tensorrt()
    info["torch_version"] = torch.__version__
    info["python_version"] = sys.version

    
    info["sys_os"] = f"{platform.system()} {platform.release()}"
    info["sys_arch"] = platform.machine()
    info["sys_hostname"] = platform.node()

    
    cpu = ""
    try:
        if platform.system() == "Windows":
            cpu = platform.processor()
        elif platform.system() == "Darwin":
            import subprocess
            cpu = subprocess.check_output(["sysctl", "-n", "machdep.cpu.brand_string"]).decode().strip()
        else:
            import subprocess
            cpu = subprocess.check_output("grep -m 1 'model name' /proc/cpuinfo | cut -d: -f2", shell=True).decode().strip()
    except Exception:
        cpu = platform.processor() or "Unknown"
        log("warn", "CPU detection failed, using fallback", trace=traceback.format_exc())
    info["sys_cpu"] = cpu

    
    ram = 0
    try:
        if platform.system() == "Windows":
            import ctypes
            class MEMORYSTATUSEX(ctypes.Structure):
                _fields_ = [
                    ("dwLength", ctypes.c_ulong),
                    ("dwMemoryLoad", ctypes.c_ulong),
                    ("ullTotalPhys", ctypes.c_ulonglong),
                    ("ullAvailPhys", ctypes.c_ulonglong),
                    ("ullTotalPageFile", ctypes.c_ulonglong),
                    ("ullAvailPageFile", ctypes.c_ulonglong),
                    ("ullTotalVirtual", ctypes.c_ulonglong),
                    ("ullAvailVirtual", ctypes.c_ulonglong),
                    ("ullAvailExtendedVirtual", ctypes.c_ulonglong)
                ]
            stat = MEMORYSTATUSEX()
            stat.dwLength = ctypes.sizeof(MEMORYSTATUSEX)
            ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(stat))
            ram = stat.ullTotalPhys
        elif platform.system() == "Darwin":
            import subprocess
            ram = int(subprocess.check_output(["sysctl", "-n", "hw.memsize"]).decode().strip())
        else:
            with open("/proc/meminfo", "r") as f:
                for line in f:
                    if line.startswith("MemTotal:"):
                        ram = int(line.split()[1]) * 1024
                        break
    except Exception:
        log("warn", "RAM detection failed", trace=traceback.format_exc())
    info["sys_ram_bytes"] = ram

    log("gpu_info", json.dumps(info))

def run_sys_metrics():
    import platform
    import subprocess
    import json

    metrics = {
        "cpu_percent": 0.0,
        "ram_total_gb": 0.0,
        "ram_used_gb": 0.0,
        "ram_percent": 0.0,
        "gpu_name": "N/A",
        "gpu_util": 0.0,
        "gpu_temp": 0.0,
        "gpu_mem_used_mb": 0.0,
        "gpu_mem_total_mb": 0.0,
        "gpu_mem_percent": 0.0
    }

    
    try:
        import psutil
        metrics["cpu_percent"] = psutil.cpu_percent(interval=0.1)
    except ImportError:
        
        if platform.system() == "Windows":
            try:
                out = subprocess.check_output("wmic cpu get loadpercentage", shell=True).decode().split()
                if len(out) >= 2:
                    metrics["cpu_percent"] = float(out[1])
            except Exception:
                pass

    
    try:
        import psutil
        mem = psutil.virtual_memory()
        metrics["ram_total_gb"] = mem.total / (1024**3)
        metrics["ram_used_gb"] = mem.used / (1024**3)
        metrics["ram_percent"] = mem.percent
    except ImportError:
        if platform.system() == "Windows":
            try:
                import ctypes
                class MEMORYSTATUSEX(ctypes.Structure):
                    _fields_ = [
                        ("dwLength", ctypes.c_ulong),
                        ("dwMemoryLoad", ctypes.c_ulong),
                        ("ullTotalPhys", ctypes.c_ulonglong),
                        ("ullAvailPhys", ctypes.c_ulonglong),
                        ("ullTotalPageFile", ctypes.c_ulonglong),
                        ("ullAvailPageFile", ctypes.c_ulonglong),
                        ("ullTotalVirtual", ctypes.c_ulonglong),
                        ("ullAvailVirtual", ctypes.c_ulonglong),
                        ("ullAvailExtendedVirtual", ctypes.c_ulonglong)
                    ]
                stat = MEMORYSTATUSEX()
                stat.dwLength = ctypes.sizeof(MEMORYSTATUSEX)
                ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(stat))
                total = stat.ullTotalPhys
                avail = stat.ullAvailPhys
                used = total - avail
                metrics["ram_total_gb"] = total / (1024**3)
                metrics["ram_used_gb"] = used / (1024**3)
                metrics["ram_percent"] = float(stat.dwMemoryLoad)
            except Exception:
                log("warn", "RAM metrics polling failed", trace=traceback.format_exc())

    
    try:
        import shutil
        smi_path = shutil.which("nvidia-smi")
        if not smi_path:
            
            common_paths = [
                r"C:\Program Files\NVIDIA Corporation\NVSMI\nvidia-smi.exe",
                r"C:\Program Files (x86)\NVIDIA Corporation\NVSMI\nvidia-smi.exe",
                r"C:\Windows\System32\nvidia-smi.exe",
            ]
            for p in common_paths:
                if os.path.exists(p):
                    smi_path = p
                    break
        
        if smi_path:
            result = subprocess.run(
                [smi_path, "--query-gpu=name,utilization.gpu,utilization.memory,temperature.gpu,memory.used,memory.total",
                 "--format=csv,noheader,nounits"],
                capture_output=True, text=True, timeout=5
            )
            if result.returncode == 0 and result.stdout.strip():
                parts = result.stdout.strip().split(",")
                if len(parts) >= 6:
                    metrics["gpu_name"] = parts[0].strip()
                    metrics["gpu_util"] = float(parts[1].strip())
                    metrics["gpu_mem_percent"] = float(parts[2].strip())
                    metrics["gpu_temp"] = float(parts[3].strip())
                    metrics["gpu_mem_used_mb"] = float(parts[4].strip())
                    metrics["gpu_mem_total_mb"] = float(parts[5].strip())
    except Exception:
        log("warn", "GPU metrics polling failed", trace=traceback.format_exc())

    log("sys_metrics", json.dumps(metrics))

def run_dedupe(
    input_path,
    output_path,
    threshold,
    region_sensitivity=1,
    use_optical_flow=True,
    camera_compensation=True,
    remove_static_subject=True
):
    log("info", f"Starting Duplicate Frame Removal. Input: {input_path}")

    from duplicate_frame_remover.processor import process_single_video
    from utils import get_gpu_info
    import sys
    from pathlib import Path

    
    ffmpeg_exe = None
    script_dir = Path(__file__).parent
    local_ffmpeg = script_dir / "ffmpeg.exe"
    if local_ffmpeg.exists():
        ffmpeg_exe = str(local_ffmpeg)
    else:
        import shutil
        ffmpeg_exe = shutil.which("ffmpeg")

    gpu_info = get_gpu_info()
    use_gpu = gpu_info.get("cuda_available", False)

    
    similarity_threshold = 1.0 - threshold

    def progress_cb(current, total, unique, dupes):
        pct = min(100, int((current / max(total, 1)) * 100))
        log("progress", f"Processed frames... {current}/{total} (Unique: {unique}, Duplicate: {dupes})", pct=pct)

    try:
        stats = process_single_video(
            input_path=Path(input_path),
            output_path=Path(output_path),
            ffmpeg_path=ffmpeg_exe,
            similarity_threshold=similarity_threshold,
            use_optical_flow=use_optical_flow,
            region_sensitivity=region_sensitivity,
            camera_motion_compensation=camera_compensation,
            remove_static_subject=remove_static_subject,
            verbose=False,
            use_gpu=use_gpu,
            progress_callback=progress_cb
        )
        log("info", f"Deduplication report: Total={stats['total_frames']}, Unique={stats['unique_frames']}, Duplicate={stats['duplicate_frames']}")
        # Removing frames shortens the video, so the original full-length audio would
        # drift out of sync if muxed back on. Only re-attach audio when nothing was
        # removed; otherwise the user lays the soundtrack over the cut clip in AE.
        if stats.get('duplicate_frames', 0) > 0:
            log("warn", "Frames removed — skipping audio mux to avoid A/V desync "
                        "(add your soundtrack in After Effects).")
        else:
            mux_audio(str(output_path), str(input_path))
        log("success", "Duplicate frame removal completed successfully.")
    except Exception as e:
        log("error", f"Deduplication failed: {e}")
        sys.exit(1)

def main():
    parser = argparse.ArgumentParser(description="AniSmooth PyTorch Pipeline")
    parser.add_argument("--mode", type=str, required=True,
                        choices=["interpolate", "upscale", "gpu-info", "sys-metrics", "dedupe"], help="Execution mode")
    parser.add_argument("--input", type=str, default="", help="Input video file path")
    parser.add_argument("--output", type=str, default="", help="Output video file path")
    parser.add_argument("--model", type=str, default="", help="Model name selection")
    parser.add_argument("--factor", type=int, default=2,
                        help="Scale or interpolation multiplier factor")
    parser.add_argument("--threshold", type=float, default=0.05,
                        help="Deduplication threshold (difference amount, e.g. 0.05)")
    parser.add_argument("--region-sensitivity", type=int, default=1,
                        help="Minimum changed regions to consider unique motion")
    parser.add_argument("--no-optical-flow", action="store_true",
                        help="Disable optical flow comparison")
    parser.add_argument("--no-camera-comp", action="store_true",
                        help="Disable camera motion compensation")
    parser.add_argument("--no-static-subject", action="store_true",
                        help="Disable static subject detection")
    parser.add_argument("--target-size-mb", type=float, default=0,
                        help="Target output file size in MB (re-encodes with FFmpeg)")
    parser.add_argument("--preset", type=str, default="high",
                        help="Quality preset key: archival | high | balanced | fast | draft "
                             "(maps to CRF + x264 speed + -tune animation; legacy x264 "
                             "speed names fall back to 'high')")
    parser.add_argument("--scene-threshold", type=float, default=0.40,
                        help="Scene change detection threshold (0.0-1.0, higher = less sensitive)")

    args = parser.parse_args()

    if args.mode == "gpu-info":
        try:
            run_gpu_info()
        except Exception as e:
            log("error", f"GPU info failed: {e}")
            sys.exit(1)
        return

    if args.mode == "sys-metrics":
        try:
            run_sys_metrics()
        except Exception as e:
            log("error", f"System metrics failed: {e}")
            sys.exit(1)
        return

    if args.mode == "dedupe":
        try:
            run_dedupe(
                args.input,
                args.output,
                args.threshold,
                region_sensitivity=args.region_sensitivity,
                use_optical_flow=not args.no_optical_flow,
                camera_compensation=not args.no_camera_comp,
                remove_static_subject=not args.no_static_subject
            )
        except Exception as e:
            log("error", f"Deduplication failed: {e}")
            sys.exit(1)
        return

    if not os.path.exists(args.input):
        log("error", f"Input video path not found: {args.input}")
        sys.exit(1)

    try:
        if args.mode == "interpolate":
            run_interpolation(args.input, args.output, args.model, args.factor, args.target_size_mb, args.preset, args.scene_threshold)
        elif args.mode == "upscale":
            run_upscaling(args.input, args.output, args.model, args.factor, args.target_size_mb, args.preset)
    except Exception as e:
        log("error", f"Processing failed: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

if __name__ == "__main__":
    main()
