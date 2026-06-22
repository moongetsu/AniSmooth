import cv2
import numpy as np
import subprocess
from pathlib import Path
from typing import Optional, Dict

from duplicate_frame_remover.core import AdvancedDuplicateRemover

def process_single_video(
    input_path: Path,
    output_path: Path,
    ffmpeg_path: Optional[str],
    similarity_threshold: float,
    use_optical_flow: bool,
    region_sensitivity: int,
    camera_motion_compensation: bool,
    remove_static_subject: bool,
    verbose: bool,
    use_gpu: bool = False,
    progress_callback = None,
) -> Dict:
    """
    Process one video file: detect duplicate frames, mute output, write to output_path.
    Returns a stats dict.
    Supports GPU acceleration and thread-safe progress reporting via progress_callback.
    """
    cap = cv2.VideoCapture(str(input_path))
    if not cap.isOpened():
        raise ValueError(f"Could not open video: {input_path}")

    fps = cap.get(cv2.CAP_PROP_FPS) or 0
    if not fps or fps <= 0 or not np.isfinite(fps):
        fps = 30.0
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    if width <= 0 or height <= 0:
        cap.release()
        raise ValueError(f"Could not determine dimensions: {input_path}")
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))

    remover = AdvancedDuplicateRemover(
        base_threshold=similarity_threshold,
        motion_threshold=1.5,
        region_grid=(4, 4),
        min_changed_regions=region_sensitivity,
        use_optical_flow=use_optical_flow,
        camera_motion_compensation=camera_motion_compensation,
        remove_static_subject_frames=remove_static_subject,
        temporal_window=5,
        edge_sensitivity=0.3,
        use_gpu=use_gpu,
    )

    use_ffmpeg = ffmpeg_path is not None
    ffmpeg_proc = None
    cv_out = None

    if use_ffmpeg:
        ffmpeg_cmd = [
            ffmpeg_path, "-y", "-hide_banner", "-loglevel", "error",
            "-f", "rawvideo", "-vcodec", "rawvideo",
            "-pix_fmt", "rgb24",
            "-s", f"{width}x{height}",
            "-r", str(fps),
            "-i", "-",
            "-an",
            "-c:v", "libx264",
            "-preset", "medium",
            "-crf", "18",
            "-tune", "animation",
            "-pix_fmt", "yuv420p",
            "-movflags", "+faststart",
            str(output_path),
        ]
        try:
            ffmpeg_proc = subprocess.Popen(
                ffmpeg_cmd,
                stdin=subprocess.PIPE,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.PIPE,
            )
        except Exception as e:
            if verbose:
                print(f"  [warn] FFmpeg failed to start ({e}), falling back to OpenCV")
            use_ffmpeg = False

    if not use_ffmpeg:
        fourcc = cv2.VideoWriter_fourcc(*'mp4v')
        cv_out = cv2.VideoWriter(str(output_path), fourcc, fps, (width, height))
        if not cv_out.isOpened():
            cap.release()
            raise ValueError(f"Could not create output: {output_path}")

    def write_frame(frame):
        if use_ffmpeg and ffmpeg_proc:
            try:
                ffmpeg_proc.stdin.write(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB).tobytes())
            except BrokenPipeError:
                pass
        elif cv_out:
            cv_out.write(frame)

    prev_frame = None
    unique_count = dup_count = cam_motion = local_motion = cam_only_removed = 0
    frame_index = 0

    while True:
        ret, frame = cap.read()
        if not ret:
            break
        frame_index += 1

        if prev_frame is None:
            write_frame(frame)
            unique_count += 1
            prev_frame = frame.copy()
            continue

        analysis = remover.analyze_frame_difference(prev_frame, frame)
        remover.frame_cadence_detector.add_frame_result(analysis['is_duplicate'])

        if not analysis['is_duplicate']:
            write_frame(frame)
            unique_count += 1
            prev_frame = frame.copy()
            if analysis['motion_type'] == 'camera':
                cam_motion += 1
            elif analysis['motion_type'] == 'local':
                local_motion += 1
        else:
            dup_count += 1
            if analysis.get('motion_type') == 'camera_only':
                cam_only_removed += 1

        
        if progress_callback:
            if frame_index % 10 == 0 or frame_index == total_frames:
                progress_callback(frame_index, total_frames, unique_count, dup_count)

        if verbose and frame_index % 200 == 0:
            pct = (frame_index / total_frames * 100) if total_frames > 0 else 0
            print(f"    [{pct:5.1f}%] unique={unique_count} dupes={dup_count}")

    cap.release()

    if use_ffmpeg and ffmpeg_proc:
        ffmpeg_proc.stdin.close()
        ffmpeg_proc.wait()
        stderr_out = ffmpeg_proc.stderr.read().decode(errors='replace') if ffmpeg_proc.stderr else ""
        if stderr_out.strip() and verbose:
            print(f"  [ffmpeg] {stderr_out.strip()}")
    elif cv_out:
        cv_out.release()

    if progress_callback:
        progress_callback(frame_index, total_frames, unique_count, dup_count)

    cadence = remover.frame_cadence_detector.detect_cadence()

    return {
        'total_frames': total_frames,
        'unique_frames': unique_count,
        'duplicate_frames': dup_count,
        'camera_only_removed': cam_only_removed,
        'camera_motion_frames': cam_motion,
        'local_motion_frames': local_motion,
        'fps': fps,
        'cadence_detected': cadence['detected'],
        'cadence_period': cadence.get('period'),
    }
