import os
import json
import logging
import urllib.request
import urllib.error
from http.client import IncompleteRead

def _get_appdata_dir():
    appdata = os.environ.get("APPDATA", "")
    if appdata:
        return os.path.join(appdata, "com.moongetsu.extensions", "AniSmooth", "backend")
    home = os.path.expanduser("~")
    return os.path.join(home, "AppData", "Roaming", "com.moongetsu.extensions", "AniSmooth", "backend")

WEIGHTS_DIR = os.path.join(_get_appdata_dir(), "weights")

MODELS_URL = "https://github.com/moongetsu/AniSmooth-Models/releases/download/"

MODEL_FILES = {
    "rife4.25":          ("interpolation", "rife425.pth"),
    "rife4.25-heavy":    ("interpolation", "rife425_heavy.pth"),
    "shufflecugan":      ("upscale", "sudo_shuffle_cugan_9.584.969.pth"),
    "adore":             ("upscale", "adore.pth"),
    "fallin_soft":       ("upscale", "Fallin_soft.pth"),
    "fallin_strong":     ("upscale", "Fallin_strong.pth"),
}

def _model_filename(model_key):
    entry = MODEL_FILES.get(model_key)
    if entry is None:
        raise ValueError("Unknown model key: " + model_key)
    return entry[1]

def _model_url(model_key):
    entry = MODEL_FILES.get(model_key)
    if entry is None:
        raise ValueError("Unknown model key: " + model_key)
    category, filename = entry
    return MODELS_URL + category + "/" + filename

def log(msg_type, msg, **kw):
    out = {"type": msg_type, "msg": str(msg)}
    out.update(kw)
    print(json.dumps(out), flush=True)

def ensure_weights_dir():
    try:
        os.makedirs(WEIGHTS_DIR, exist_ok=True)
    except PermissionError:
        log("error", "Permission denied creating: " + WEIGHTS_DIR)
        raise
    return WEIGHTS_DIR

def get_weight_path(model_key):
    subdir = model_key
    filename = _model_filename(model_key)
    return os.path.join(WEIGHTS_DIR, subdir, filename)

def is_weight_downloaded(model_key):
    try:
        return os.path.exists(get_weight_path(model_key))
    except ValueError:
        return False

def download_weights(model_key, force=False, retries=3):
    filename = _model_filename(model_key)
    subdir = model_key
    folder_path = os.path.join(WEIGHTS_DIR, subdir)
    dest = os.path.join(folder_path, filename)

    if os.path.exists(dest) and not force:
        log("info", "Model weights already cached: " + filename)
        return True

    os.makedirs(folder_path, exist_ok=True)
    temp_folder = os.path.join(folder_path, "TEMP")
    os.makedirs(temp_folder, exist_ok=True)
    temp_path = os.path.join(temp_folder, filename)

    url = _model_url(model_key)
    log("info", "Downloading " + model_key + "...")
    log("info", "URL: " + url)

    for attempt in range(retries):
        try:
            existing = os.path.getsize(temp_path) if os.path.exists(temp_path) else 0

            headers = {"User-Agent": "AniSmooth/1.0"}
            if existing > 0 and attempt > 0:
                headers["Range"] = f"bytes={existing}-"
                log("info", f"Resuming {model_key} from byte {existing}")
            elif existing > 0:
                try:
                    os.remove(temp_path)
                except Exception:
                    pass
                existing = 0

            req = urllib.request.Request(url, headers=headers)
            resp = urllib.request.urlopen(req, timeout=120)

            code = resp.getcode()
            if code not in (200, 206):
                raise urllib.error.HTTPError(url, code, "", None, None)

            total = int(resp.headers.get("Content-Length", 0))
            file_mode = "ab" if code == 206 else "wb"
            if code == 206:
                downloaded = existing
                total = existing + total
            else:
                downloaded = 0
            chunk_size = 65536

            with open(temp_path, file_mode) as f:
                while True:
                    chunk = resp.read(chunk_size)
                    if not chunk:
                        break
                    f.write(chunk)
                    downloaded += len(chunk)
                    if total > 0 and downloaded % (chunk_size * 8) < chunk_size:
                        pct = min(99, int(downloaded * 100 / total))
                        log("progress", "Downloading " + filename + " " + str(pct) + "%",
                            pct=pct, done=downloaded, total=total)

            log("progress", "Downloading " + filename + " 100%", pct=100,
                done=downloaded, total=total)

            if total > 0 and downloaded != total:
                raise ConnectionError(
                    "Incomplete: received " + str(downloaded) + " of " + str(total) + " bytes"
                )

            os.rename(temp_path, dest)

            
            expected_hash = MODEL_HASHES.get(model_key)
            if expected_hash is None:
                log("warn", f"No verified hash registered for {model_key} — integrity check skipped for download.")
            elif expected_hash:
                actual = _compute_sha256(dest)
                if actual != expected_hash:
                    log("error", f"Download hash mismatch for {model_key}! Expected: {expected_hash[:12]}..., Got: {actual[:12]}...")
                    os.unlink(dest)
                    return False
                log("info", f"Download hash verified for {model_key}")
            else:
                log("info", f"No hash in registry for {model_key} — skipping integrity check")

            try:
                os.rmdir(temp_folder)
            except OSError:
                pass

            log("info", "Model downloaded to: " + dest)
            return True

        except (urllib.error.URLError, urllib.error.HTTPError, IncompleteRead,
                ConnectionError, TimeoutError) as e:
            log("warn", "Download attempt " + str(attempt + 1) + " failed: " + str(e))
            if attempt == retries - 1:
                log("error", "All " + str(retries) + " download attempts failed.")
                try:
                    os.remove(temp_path)
                except Exception:
                    pass
                return False

    return False

def _remap_state_dict_keys(state_dict, model):
    """Remap checkpoint keys to match model's expected key names.
    Handles common prefix mismatches: 'flownet.', 'module.', 'module.flownet.'
    """
    model_keys = set(model.state_dict().keys())
    ckpt_keys = set(state_dict.keys())

    
    if ckpt_keys & model_keys:
        overlap = len(ckpt_keys & model_keys)
        if overlap == len(model_keys) or overlap == len(ckpt_keys):
            return state_dict

    
    prefixes_to_strip = ["module.flownet.", "module.", "flownet."]
    prefixes_to_add = ["flownet.", "module.", "module.flownet."]

    
    for prefix in prefixes_to_strip:
        remapped = {}
        for k, v in state_dict.items():
            new_key = k[len(prefix):] if k.startswith(prefix) else k
            remapped[new_key] = v
        overlap = len(set(remapped.keys()) & model_keys)
        if overlap > len(ckpt_keys & model_keys):
            log("info", "Remapped weights: stripped '" + prefix + "' prefix (" + str(overlap) + " keys matched)")
            return remapped

    
    for prefix in prefixes_to_add:
        remapped = {}
        for k, v in state_dict.items():
            new_key = prefix + k
            remapped[new_key] = v
        overlap = len(set(remapped.keys()) & model_keys)
        if overlap > len(ckpt_keys & model_keys):
            log("info", "Remapped weights: added '" + prefix + "' prefix (" + str(overlap) + " keys matched)")
            return remapped

    
    return state_dict

MODEL_HASHES = {
    "rife4.25":          "040ed973997570f4f85489be3d8eb64be9c0cffdf0a9f049443b6a4838ed88f1",
    "rife4.25-heavy":    "49f7c82d3866860683992042ba8eb559b9c01fbe2600b80a53c56de05bb13b6f",
    "adore":             "443378bdc6db6cf4a75eea61ee7afc78b2c4b6a4d3b3981a40ff61f38bbc8f1a",
    "fallin_soft":       "910aa56a9a1187df97c3284177da1bc66836679350b2613191340734937e9960",
    "shufflecugan":      "88a6d89f04eaf27a9f7b60937857768a6bc04fb360670bd9951ef533acab0616",
    "fallin_strong":     "14b8415199aa66a6507725408a66758ba2bff9286736f19f7f07524efd821a56",
}

def _compute_sha256(file_path):
    import hashlib
    sha256 = hashlib.sha256()
    with open(file_path, "rb") as f:
        while True:
            data = f.read(65536)
            if not data:
                break
            sha256.update(data)
    return sha256.hexdigest().lower()

def verify_weight_hash(model_key, weight_path):
    expected_hash = MODEL_HASHES.get(model_key)
    if expected_hash is None:
        log("error", f"No verified hash registered for {model_key}. Integrity check cannot be performed — rejecting.")
        return False
    if not expected_hash:
        log("error", f"Model key not in hash registry: {model_key}")
        return False

    try:
        calculated_hash = _compute_sha256(weight_path)
        if calculated_hash != expected_hash:
            log("error", f"Weight hash mismatch for {model_key}! Expected: {expected_hash}, Got: {calculated_hash}")
            return False
        log("info", f"Model weight integrity verified for {model_key}.")
        return True
    except Exception as e:
        log("error", f"Failed to compute hash for {weight_path}: {e}")
        return False

def load_weights_if_available(model, model_key, device=None):
    import torch
    try:
        weight_path = get_weight_path(model_key)
    except ValueError:
        log("warn", "No weight source defined for: " + model_key)
        return False

    if not os.path.exists(weight_path):
        log("info", "Weight file not found: " + os.path.basename(weight_path))
        log("info", "Attempting download from AniSmooth-Models host...")
        if not download_weights(model_key):
            log("error", "Download failed. Place the model manually at:")
            log("error", "  " + weight_path)
            return False

    if not verify_weight_hash(model_key, weight_path):
        raise RuntimeError(f"Model integrity verification failed for {model_key}. File is corrupted or untrusted.")

    try:
        state_dict = torch.load(weight_path, map_location=device or "cpu",
                                weights_only=True)
        
        
        state_dict = _remap_state_dict_keys(state_dict, model)

        
        model_param_count = len(model.state_dict())
        try:
            result = model.load_state_dict(state_dict, strict=True)
            log("info", "All " + str(model_param_count) + " weight parameters loaded successfully for " + model_key)
            return True
        except RuntimeError as e:
            
            log("warn", "Strict weight load failed for " + model_key + ". Key mismatch: " + str(e)[:200])

        
        result = model.load_state_dict(state_dict, strict=False)
        loaded_count = model_param_count - len(result.missing_keys)

        if len(result.missing_keys) > 0:
            log("warn", "Missing keys in checkpoint (" + str(len(result.missing_keys)) + "/" + str(model_param_count) + "): "
                + ", ".join(result.missing_keys[:5])
                + ("..." if len(result.missing_keys) > 5 else ""))
        if len(result.unexpected_keys) > 0:
            log("warn", "Unexpected keys in checkpoint (" + str(len(result.unexpected_keys)) + "): "
                + ", ".join(result.unexpected_keys[:5])
                + ("..." if len(result.unexpected_keys) > 5 else ""))

        
        threshold = int(model_param_count * 0.5)
        if loaded_count < threshold:
            log("error", "CRITICAL: Only " + str(loaded_count) + "/" + str(model_param_count)
                + " weights loaded for " + model_key + " (threshold: " + str(threshold) + "). "
                + "Model will produce garbage output. Check architecture compatibility.")
            return False

        if loaded_count < model_param_count:
            log("warn", "Partial weight load for " + model_key + ": "
                + str(loaded_count) + "/" + str(model_param_count) + " parameters loaded")
        else:
            log("info", "All " + str(loaded_count) + " weight parameters loaded successfully for " + model_key)

        return True
    except Exception as e:
        log("error", "Failed to load weights for " + model_key + ": " + str(e))
        raise RuntimeError(f"Failed to load weights: {e}")
