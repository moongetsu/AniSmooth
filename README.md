<h1 align="center">
  <img src="AniSmooth/AniSmooth-Logo.png" height="48" alt="AniSmooth"/>
</h1>
<p align="center">
  <b>Frame Interpolation & Video Upscaling directly in After Effects.</b><br>
  <i>Remove duplicates, smooth motion, and enlarge clips — locally, on your GPU.</i>
</p>

<p align="center">
  <a href="#-features">Features</a> ·
  <a href="#-supported-models">Models</a> ·
  <a href="#-installation">Install</a> ·
  <a href="#%EF%B8%8F-building-from-source">Build</a>
</p>

<hr>

**AniSmooth** is a free, local After Effects extension: remove duplicate frames, smooth video with RIFE/Flowframes, and upscale clips on your own GPU via a Python backend.

Unlike other large and heavy extensions, AniSmooth is built with a **small, clean, and highly compact codebase**. The code is split into simple, organized files to ensure the extension loads instantly and runs smoothly alongside other tools without slowing down After Effects.

> [!NOTE]
> **Compatibility:** After Effects CC 2018 → CC 2026+ (v15.0+). Windows primary support.

---

## 🚀 Features

| Tab | What it does |
| :-- | :-- |
| **Deadframes** | Remove duplicate frames — threshold slider, motion tracking, frozen-character detection. |
| **Interpolation** | RIFE 4.25 (CUDA / TensorRT). Multipliers 2×–10× or custom up to 64×. |
| **Upscale** | 2× / 4× with ShuffleCUGAN models tuned for anime. |
| **Flowframes** | Drives your local Flowframes app — RIFE NCNN / NCNN-VS / DAIN, up to 16×, h264/h265/AV1. |
| **Queue** | One serial queue for all jobs; pre-renders on add; pause/cancel/retry; persists across restarts. |
| **System & Settings** | GPU/VRAM diagnostics, setup wizard, output prefs, interface toggles, collapsible panels, presets. |

> [!NOTE]
> **Flowframes:** only **1.42.0 (Patreon)** is supported now — **1.36.0 (free)** support coming soon. Set the `Flowframes.exe` path in Settings (auto-detected in the default location).

<details>
<summary>📸 Screenshots</summary>

#### Duplicate Frame Removal
![Duplicate Frame Removal](previews/AniSmooth_DeadframesRemover.png)

#### Frame Interpolation
![Frame Interpolation](previews/AniSmooth_Interpolation.png)

#### Video Upscaling
![Video Upscaling](previews/AniSmooth_Upscaling.png)

#### System Monitor & Console
![System Monitor](previews/AniSmooth_SystemMonitor.png)
![Console Log](previews/AniSmooth_Console.png)

#### Settings
![Settings](previews/AniSmooth_Settings.png)
![Settings 2](previews/AniSmooth_Settings2.png)

</details>

---

## 🧠 Supported Models

> [!NOTE]
> **Beta:** only the selected best-performing models are included for now; more will be added once the extension is fully stable.

<details>
<summary>Frame Interpolation (RIFE 4.25)</summary>

| Model Key | Name | Params | VRAM | Engine | Use Case |
| :-- | :-- | :-- | :-- | :-- | :-- |
| `rife4.25` | RIFE 4.25 Cuda | 1.3M | ~2GB | PyTorch CUDA | Fast, lightweight; older GPUs. |
| `rife4.25-heavy` | RIFE 4.25 HEAVY Cuda | 5.1M | ~6GB | PyTorch CUDA | Best motion; needs a stronger GPU. |
| `rife4.25-tensorrt` | RIFE 4.25 TensorRT | 1.3M | ~2GB | NVIDIA TensorRT | Up to 1.8× faster on NVIDIA. |
| `rife4.25-heavy-tensorrt` | RIFE 4.25 HEAVY TensorRT | 5.1M | ~6GB | NVIDIA TensorRT | High quality, much faster on NVIDIA. |

</details>

<details>
<summary>Video Upscaling</summary>

| Model Key | Name | Params | VRAM | Engine | Use Case |
| :-- | :-- | :-- | :-- | :-- | :-- |
| `adore` | Adore Cuda | 4M | ~3GB | PyTorch CUDA | Sharp lines, retained detail. |
| `fallin_soft` | Fallin Soft Cuda | 3.9M | ~4GB | PyTorch CUDA | Anime: smooth colors, clean backgrounds. |

</details>

> Flowframes uses its own model set (RIFE NCNN up to 4.26, DAIN) from your Flowframes install — not the table above.

---

## 📦 Installation

<details>
<summary>Method 1 — ZXP Installer (easiest)</summary>

1. Pick your AE version folder (AE2018 / AE2020 / AE2022).
2. Get [ZXP Installer](https://aescripts.com/learn/post/zxp-installer).
3. Drag `AniSmooth_AE2020.zxp` (or your version) onto it.
4. Restart AE → `Window > Extensions > AniSmooth`.

</details>

<details>
<summary>Method 2 — Windows Setup Wizard (.exe)</summary>

1. Run `AniSmoothSetup_AE2020.exe` from your version folder.
2. The wizard handles file placement and registry keys.

</details>

<details>
<summary>Method 3 — Manual folder install</summary>

1. Copy the `AniSmooth` folder to `C:\Program Files (x86)\Common Files\Adobe\CEP\extensions\`.
2. Enable PlayerDebugMode: run `Add-Keys.reg` / `Add-Keys.bat` (as admin).
3. Restart After Effects.

</details>

---

## 🛠️ Building from Source

```bash
cd tools && npm install
cd .. && npm run build:all
```

---

> [!WARNING]
> Runs local Python and AI models. Needs an NVIDIA GPU for CUDA acceleration and enough VRAM (2GB+ basic, 6GB+ heavy models).
