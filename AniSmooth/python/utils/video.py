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

def _probe_duration(ffmpeg, path):
    """Return media duration in seconds via FFmpeg, or None if undeterminable."""
    try:
        r = subprocess.run([ffmpeg, "-i", str(path), "-f", "null", "-"],
                           capture_output=True, text=True, timeout=30)
        for line in r.stderr.split("\n"):
            if "Duration:" in line:
                raw = line.split("Duration:")[-1].strip().split(",")[0].strip()
                if not raw or raw.upper().startswith("N/A"):
                    return None
                hh, mm, ss = raw.split(":")
                return float(hh) * 3600 + float(mm) * 60 + float(ss)
    except Exception:
        return None
    return None


def reencode_to_size(video_path, audio_source_path, target_mb):
    """Re-encode ``video_path`` to a target file size using FFmpeg two-pass encoding.

    Audio is taken directly from ``audio_source_path`` (the original clip) so the
    correct soundtrack survives even if an earlier in-place mux did not. Returns
    True on success. Overwrites ``video_path`` in-place.
    """
    ffmpeg = _find_ffmpeg()
    if not ffmpeg:
        log("error", "FFmpeg not found, cannot re-encode")
        return False

    # Duration of the file we are actually encoding; fall back to the source clip.
    duration = _probe_duration(ffmpeg, video_path) or _probe_duration(ffmpeg, audio_source_path)
    if not duration or duration <= 0:
        log("error", "Could not determine video duration for bitrate calculation")
        return False

    # Detect whether the source has audio and at what bitrate (default 192k).
    # Only audio that actually exists should consume part of the size budget.
    has_audio = False
    audio_bitrate_kbps = 192
    try:
        import re
        r = subprocess.run([ffmpeg, "-i", str(audio_source_path), "-f", "null", "-"],
                           capture_output=True, text=True, timeout=30)
        for line in r.stderr.split("\n"):
            if "Audio:" in line:
                has_audio = True
                m = re.search(r'(\d+)\s*kb/s', line)
                if m:
                    audio_bitrate_kbps = int(m.group(1))
                break
    except Exception:
        pass

    # Bitrate budget. A safety margin keeps container/muxing overhead from pushing
    # the final file over hard upload limits (Discord 8/25 MB, etc.). target_mb is
    # interpreted as decimal MB (1 MB = 1,000,000 bytes).
    SAFETY = 0.95
    total_bits = target_mb * 8 * 1000 * 1000 * SAFETY
    audio_bits = (audio_bitrate_kbps * 1000 * duration) if has_audio else 0
    video_bits = total_bits - audio_bits
    if video_bits <= 0:
        log("error", f"Target {target_mb}MB is too small to fit {audio_bitrate_kbps}kbps audio "
                     f"over {duration:.1f}s. Choose a larger target size.")
        return False
    video_bitrate_kbps = int(video_bits / 1000 / duration)
    if video_bitrate_kbps < 100:
        log("error", f"Target {target_mb}MB yields an unusable video bitrate "
                     f"({video_bitrate_kbps}kbps) for {duration:.1f}s. Choose a larger target.")
        return False

    # Cap at x264 level 5.1 (~100 Mbps).
    max_bitrate = 100000
    if video_bitrate_kbps > max_bitrate:
        log("warn", f"Requested bitrate {video_bitrate_kbps}kbps exceeds x264 limit. Capping at {max_bitrate}kbps.")
        video_bitrate_kbps = max_bitrate

    log("info", f"Target: {target_mb}MB, Duration: {duration:.1f}s, Video bitrate: {video_bitrate_kbps}kbps")

    tmp = str(video_path) + ".tmp.mp4"
    null_path = "NUL" if os.name == "nt" else "/dev/null"
    # The two-pass stats log MUST live in a writable directory. FFmpeg's default
    # (ffmpeg2pass-0.log) is written to the process CWD, which for a CEP extension
    # is usually a read-only Program Files folder — pass 1 then fails and size
    # targeting silently breaks. Anchor it next to the (writable) output file.
    passlog = str(video_path) + ".ffpass"
    maxrate = int(min(video_bitrate_kbps * 1.45, 120000))
    bufsize = int(min(video_bitrate_kbps * 2, 200000))

    def _cleanup_passlog():
        for p in (passlog, passlog + "-0.log", passlog + "-0.log.mbtree"):
            if os.path.exists(p):
                try:
                    os.unlink(p)
                except Exception:
                    pass

    # Pass 1: analysis only (no audio, discard output).
    cmd1 = [
        ffmpeg, "-y", "-hide_banner", "-loglevel", "error",
        "-i", str(video_path),
        "-c:v", "libx264", "-b:v", f"{video_bitrate_kbps}k",
        "-maxrate", f"{maxrate}k", "-bufsize", f"{bufsize}k",
        "-preset", "medium", "-pix_fmt", "yuv420p",
        "-an", "-pass", "1", "-passlogfile", passlog,
        "-f", "null", null_path
    ]
    try:
        r1 = subprocess.run(cmd1, capture_output=True, text=True, timeout=600)
        if r1.returncode != 0:
            log("error", f"Pass 1 failed: {r1.stderr.strip()[-200:]}")
            log("error", "Re-encode failed. Original quality file preserved.")
            _cleanup_passlog()
            return False
    except Exception as e:
        log("error", f"Pass 1 error: {e}")
        _cleanup_passlog()
        return False

    # Pass 2: encode video to target bitrate, taking audio (if any) from the
    # original source so the correct track survives even if a prior mux did not.
    cmd2 = [
        ffmpeg, "-y", "-hide_banner", "-loglevel", "error",
        "-i", str(video_path),
    ]
    if has_audio:
        cmd2 += ["-i", str(audio_source_path), "-map", "0:v:0", "-map", "1:a:0?"]
    cmd2 += [
        "-c:v", "libx264", "-b:v", f"{video_bitrate_kbps}k",
        "-maxrate", f"{maxrate}k", "-bufsize", f"{bufsize}k",
        "-preset", "medium", "-pix_fmt", "yuv420p",
        "-pass", "2", "-passlogfile", passlog,
    ]
    cmd2 += (["-c:a", "aac", "-b:a", f"{audio_bitrate_kbps}k"] if has_audio else ["-an"])
    cmd2 += ["-movflags", "+faststart", tmp]
    try:
        r2 = subprocess.run(cmd2, capture_output=True, text=True, timeout=600)
        if r2.returncode != 0:
            log("error", f"Pass 2 failed: {r2.stderr.strip()[-200:]}")
            log("error", "Re-encode failed. Original quality file preserved.")
            if os.path.exists(tmp):
                os.unlink(tmp)
            _cleanup_passlog()
            return False
        if os.path.exists(tmp) and os.path.getsize(tmp) > 1024:
            os.replace(tmp, str(video_path))
            _cleanup_passlog()
            final_mb = os.path.getsize(str(video_path)) / (1000 * 1000)
            log("info", f"Re-encoded to {final_mb:.1f}MB (target {target_mb}MB) at {video_bitrate_kbps}kbps")
            return True
        log("error", "Re-encoded file is empty or too small. Original preserved.")
        if os.path.exists(tmp):
            os.unlink(tmp)
        _cleanup_passlog()
        return False
    except Exception as e:
        log("error", f"Pass 2 error: {e}")
        if os.path.exists(tmp):
            try:
                os.unlink(tmp)
            except Exception:
                pass
        _cleanup_passlog()
        return False

class VideoProcessor:
    def __init__(self, input_path, output_path):
        self.input_path = input_path
        self.output_path = output_path
        self.use_ffmpeg = _find_ffmpeg() is not None
        self.cap = cv2.VideoCapture(input_path)
        if not self.cap.isOpened():
            raise RuntimeError(f"Failed to open input video: {input_path}")
            
        self.width = int(self.cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        self.height = int(self.cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        self.fps = self.cap.get(cv2.CAP_PROP_FPS)
        
        total = int(self.cap.get(cv2.CAP_PROP_FRAME_COUNT))
        self.total_frames = total if total > 0 else 1
        self._ffmpeg_proc = None

    def get_info(self):
        return self.width, self.height, self.fps, self.total_frames

    def setup_writer(self, output_fps, scale=1):
        out_w = self.width * scale
        out_h = self.height * scale
        
        if self.use_ffmpeg:
            ffmpeg = _find_ffmpeg()
            cmd = [
                ffmpeg, "-y", "-hide_banner", "-loglevel", "error",
                "-f", "rawvideo", "-vcodec", "rawvideo",
                "-s", f"{out_w}x{out_h}", "-pix_fmt", "bgr24",
                "-r", str(output_fps), "-i", "-",
                "-c:v", "libx264", "-crf", "18", "-preset", "medium",
                "-pix_fmt", "yuv420p",
                "-movflags", "+faststart",
                str(self.output_path)
            ]
            self._ffmpeg_proc = subprocess.Popen(cmd, stdin=subprocess.PIPE)
        else:
            ext = self.output_path.split('.')[-1].lower()
            if ext == 'avi':
                fourcc = cv2.VideoWriter_fourcc(*'XVID')
            elif ext in ['mov', 'm4v']:
                fourcc = cv2.VideoWriter_fourcc(*'mp4v')
            else:
                fourcc = cv2.VideoWriter_fourcc(*'mp4v')
            self.writer = cv2.VideoWriter(self.output_path, fourcc, output_fps, (out_w, out_h))
        return self

    def write_frame(self, frame):
        if self._ffmpeg_proc:
            try:
                self._ffmpeg_proc.stdin.write(frame.tobytes())
            except BrokenPipeError:
                pass
        elif self.writer:
            self.writer.write(frame)

    def read_frames(self):
        while True:
            ret, frame = self.cap.read()
            if not ret:
                break
            yield frame

    def close(self):
        self.cap.release()
        if self._ffmpeg_proc:
            try:
                self._ffmpeg_proc.stdin.close()
            except Exception:
                pass
            self._ffmpeg_proc.wait()
        if self.writer:
            self.writer.release()
