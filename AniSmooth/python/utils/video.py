import cv2
import sys
import json
import subprocess
import os
import shutil
from pathlib import Path

def log(msg_type, msg, **kw):
    out = {"type": msg_type, "msg": str(msg)}
    out.update(kw)
    print(json.dumps(out), flush=True)

def _find_ffmpeg():
    script_dir = Path(__file__).parent.parent
    local = script_dir / "ffmpeg.exe"
    if local.exists():
        return str(local)
    which = shutil.which("ffmpeg")
    if which:
        return which
    return None

def mux_audio(video_path, audio_source_path):
    """
    Copy the audio stream from audio_source_path into video_path.
    If no audio exists in the source, does nothing. Overwrites video_path in-place.
    """
    ffmpeg = _find_ffmpeg()
    if not ffmpeg:
        log("warn", "FFmpeg not found, cannot mux audio")
        return False

    probe_cmd = [
        ffmpeg, "-i", str(audio_source_path),
        "-f", "null", "-"
    ]
    has_audio = False
    try:
        r = subprocess.run(probe_cmd, capture_output=True, text=True, timeout=30)
        if "Audio:" in r.stderr:
            has_audio = True
    except Exception:
        pass

    if not has_audio:
        log("info", "No audio stream in source, skipping audio mux")
        return False

    tmp = str(video_path) + ".tmp.mp4"
    cmd = [
        ffmpeg, "-y", "-hide_banner", "-loglevel", "error",
        "-i", str(video_path),
        "-i", str(audio_source_path),
        "-c:v", "copy",
        "-c:a", "aac", "-b:a", "192k",
        "-map", "0:v:0",
        "-map", "1:a:0?",
        "-movflags", "+faststart",
        tmp
    ]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
        if result.returncode != 0:
            log("warn", f"Audio mux failed: {result.stderr.strip()}")
            if os.path.exists(tmp):
                os.unlink(tmp)
            return False
        os.replace(tmp, str(video_path))
        log("info", "Audio stream copied from source")
        return True
    except Exception as e:
        log("warn", f"Audio mux error: {e}")
        if os.path.exists(tmp):
            try:
                os.unlink(tmp)
            except Exception:
                pass
        return False

def fix_faststart(video_path):
    """Remux video to move moov atom to beginning for web playback (Discord, etc.)."""
    ffmpeg = _find_ffmpeg()
    if not ffmpeg:
        return False
    tmp = str(video_path) + ".fs.mp4"
    cmd = [
        ffmpeg, "-y", "-hide_banner", "-loglevel", "error",
        "-i", str(video_path),
        "-c", "copy",
        "-movflags", "+faststart",
        tmp
    ]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
        if result.returncode == 0 and os.path.exists(tmp) and os.path.getsize(tmp) > 1024:
            os.replace(tmp, str(video_path))
            return True
        if os.path.exists(tmp):
            os.unlink(tmp)
    except Exception as e:
        log("warn", f"Faststart remux error: {e}")
        if os.path.exists(tmp):
            try: os.unlink(tmp)
            except: pass
    return False

def reencode_high_quality(video_path):
    """Re-encode video with x264 CRF 18 for high quality output."""
    ffmpeg = _find_ffmpeg()
    if not ffmpeg:
        log("warn", "FFmpeg not found, cannot re-encode")
        return False
    
    tmp = str(video_path) + ".hq.mp4"
    cmd = [
        ffmpeg, "-y", "-hide_banner", "-loglevel", "error",
        "-i", str(video_path),
        "-c:v", "libx264", "-crf", "18", "-preset", "medium",
        "-c:a", "copy",
        "-movflags", "+faststart",
        tmp
    ]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
        if result.returncode == 0 and os.path.exists(tmp) and os.path.getsize(tmp) > 1024:
            os.replace(tmp, str(video_path))
            log("info", "Re-encoded with x264 CRF 18 for high quality")
            return True
        log("warn", "High quality re-encode failed or produced invalid output")
        if os.path.exists(tmp):
            os.unlink(tmp)
    except Exception as e:
        log("warn", f"High quality re-encode error: {e}")
        if os.path.exists(tmp):
            try: os.unlink(tmp)
            except: pass
    return False

def reencode_to_size(video_path, audio_source_path, target_mb):
    """Re-encode video to target file size using FFmpeg two-pass encoding.
    Returns True on success. Overwrites video_path in-place."""
    ffmpeg = _find_ffmpeg()
    if not ffmpeg:
        log("error", "FFmpeg not found, cannot re-encode")
        return False

    # Get video duration from the processed video (not the source)
    duration = None
    try:
        probe_cmd = [ffmpeg, "-i", str(video_path), "-f", "null", "-"]
        r = subprocess.run(probe_cmd, capture_output=True, text=True, timeout=30)
        for line in r.stderr.split("\n"):
            if "Duration:" in line:
                raw = line.strip().split("Duration:")[-1].strip().split(",")[0].strip()
                parts = raw.split(":")
                duration = float(parts[0]) * 3600 + float(parts[1]) * 60 + float(parts[2])
                break
    except Exception:
        pass

    if not duration or duration <= 0:
        log("error", "Could not determine video duration for bitrate calculation")
        return False

    # Audio bitrate: detect from the processed video, default 192k
    audio_bitrate_kbps = 192
    try:
        r = subprocess.run(probe_cmd, capture_output=True, text=True, timeout=30)
        for line in r.stderr.split("\n"):
            if "Audio:" in line and "kb/s" in line:
                import re
                m = re.search(r'(\d+)\s*kb/s', line)
                if m:
                    audio_bitrate_kbps = int(m.group(1))
                    break
    except Exception:
        pass

    # Calculate video bitrate with safety caps
    total_bits = target_mb * 8 * 1000 * 1000
    audio_bits = audio_bitrate_kbps * 1000 * duration
    video_bits = total_bits - audio_bits
    video_bitrate_kbps = max(500, int(video_bits / 1000 / duration))

    # Cap at x264 level 5.1 max (100 Mbps), scale by resolution
    max_bitrate = 100000
    if video_bitrate_kbps > max_bitrate:
        log("warn", f"Requested bitrate {video_bitrate_kbps}kbps exceeds x264 limit. Capping at {max_bitrate}kbps.")
        video_bitrate_kbps = max_bitrate

    log("info", f"Target: {target_mb}MB, Duration: {duration:.1f}s, Video bitrate: {video_bitrate_kbps}kbps")

    tmp = str(video_path) + ".tmp.mp4"
    null_path = "NUL" if os.name == "nt" else "/dev/null"

    # Pass 1: analysis (skip audio)
    cmd1 = [
        ffmpeg, "-y", "-hide_banner", "-loglevel", "error",
        "-i", str(video_path),
        "-c:v", "libx264", "-b:v", f"{video_bitrate_kbps}k",
        "-maxrate", f"{video_bitrate_kbps * 2}k",
        "-bufsize", f"{video_bitrate_kbps * 4}k",
        "-preset", "medium",
        "-an", "-pass", "1", "-f", "null", null_path
    ]
    try:
        r1 = subprocess.run(cmd1, capture_output=True, text=True, timeout=600)
        if r1.returncode != 0:
            log("error", f"Pass 1 failed: {r1.stderr.strip()[-200:]}")
            log("error", "Re-encode failed. Original quality file preserved.")
            return False
    except Exception as e:
        log("error", f"Pass 1 error: {e}")
        return False

    # Pass 2: encode
    cmd2 = [
        ffmpeg, "-y", "-hide_banner", "-loglevel", "error",
        "-i", str(video_path),
        "-c:v", "libx264", "-b:v", f"{video_bitrate_kbps}k",
        "-maxrate", f"{video_bitrate_kbps * 2}k",
        "-bufsize", f"{video_bitrate_kbps * 4}k",
        "-preset", "medium",
        "-pass", "2",
        "-c:a", "aac", "-b:a", f"{audio_bitrate_kbps}k",
        "-movflags", "+faststart",
        tmp
    ]
    try:
        r2 = subprocess.run(cmd2, capture_output=True, text=True, timeout=600)
        if r2.returncode != 0:
            log("error", f"Pass 2 failed: {r2.stderr.strip()[-200:]}")
            log("error", "Re-encode failed. Original quality file preserved.")
            if os.path.exists(tmp):
                os.unlink(tmp)
            return False
        # Check that the output is valid
        if os.path.exists(tmp) and os.path.getsize(tmp) > 1024:
            os.replace(tmp, str(video_path))
            # Clean up ffmpeg pass logs
            for fname in ["ffmpeg2pass-0.log", "ffmpeg2pass-0.log.mbtree"]:
                if os.path.exists(fname):
                    os.unlink(fname)
            log("info", f"Re-encoded to ~{target_mb}MB at {video_bitrate_kbps}kbps")
            return True
        else:
            log("error", "Re-encoded file is empty or too small. Original preserved.")
            if os.path.exists(tmp):
                os.unlink(tmp)
            return False
    except Exception as e:
        log("error", f"Pass 2 error: {e}")
        if os.path.exists(tmp):
            try: os.unlink(tmp)
            except: pass
        return False

class VideoProcessor:
    def __init__(self, input_path, output_path):
        self.input_path = input_path
        self.output_path = output_path
        self.cap = cv2.VideoCapture(input_path)
        if not self.cap.isOpened():
            log("error", f"Failed to open input video: {input_path}")
            sys.exit(1)
            
        self.width = int(self.cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        self.height = int(self.cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        self.fps = self.cap.get(cv2.CAP_PROP_FPS)
        
        
        total = int(self.cap.get(cv2.CAP_PROP_FRAME_COUNT))
        self.total_frames = total if total > 0 else 1
        self.writer = None

    def get_info(self):
        return self.width, self.height, self.fps, self.total_frames

    def setup_writer(self, output_fps, scale=1):
        out_w = self.width * scale
        out_h = self.height * scale
        
        
        ext = self.output_path.split('.')[-1].lower()
        if ext == 'avi':
            fourcc = cv2.VideoWriter_fourcc(*'XVID')
        elif ext in ['mov', 'm4v']:
            fourcc = cv2.VideoWriter_fourcc(*'mp4v')
        else:
            fourcc = cv2.VideoWriter_fourcc(*'mp4v')

        self.writer = cv2.VideoWriter(self.output_path, fourcc, output_fps, (out_w, out_h))
        return self.writer

    def read_frames(self):
        while True:
            ret, frame = self.cap.read()
            if not ret:
                break
            yield frame

    def close(self):
        self.cap.release()
        if self.writer:
            self.writer.release()
