(function () {
  var App = {
    settings: {
      outputPath: "",
      pythonPath: "python",
      outputPrefix: "AniSmooth",
      outputTimestamp: true,
      outputAutoImport: true,
      outputKeepPrerender: true,
      outputCleanupFailed: true
    },

    _activePreset: null,
    _previewFiles: [],

    _presetsDir: (function () {
      var appdata = "";
      try { appdata = process.env.APPDATA || ""; } catch (e) {}
      if (!appdata && window.FileSystem && window.FileSystem.os && window.FileSystem.path) {
        appdata = window.FileSystem.path.join(window.FileSystem.os.homedir(), "AppData", "Roaming");
      }
      return window.FileSystem.path.join(appdata, "com.moongetsu.extensions", "AniSmooth", "presets");
    })(),

    anismoothToolsFolder: (function () {
      var appdata = "";
      try { appdata = process.env.APPDATA || ""; } catch (e) {}
      if (!appdata && window.FileSystem && window.FileSystem.os && window.FileSystem.path) {
        appdata = window.FileSystem.path.join(window.FileSystem.os.homedir(), "AppData", "Roaming");
      }
      var base = appdata ? window.FileSystem.path.join(appdata, "com.moongetsu.extensions", "AniSmooth") : "";
      return base ? window.FileSystem.path.join(base, "backend") : "C:\\AniSmoothTools";
    })(),

    anismoothPythonEnvFolder: (function () {
      var appdata = "";
      try { appdata = process.env.APPDATA || ""; } catch (e) {}
      if (!appdata && window.FileSystem && window.FileSystem.os && window.FileSystem.path) {
        appdata = window.FileSystem.path.join(window.FileSystem.os.homedir(), "AppData", "Roaming");
      }
      return appdata ? window.FileSystem.path.join(appdata, "com.moongetsu.extensions", "AniSmooth") : "";
    })(),

    init: function () {
      dbg('info', 'App', 'Initializing AniSmooth...');

      var path = window.FileSystem.path;
      var os = window.FileSystem.os;

      this.defaultDownloadFolder = path ? path.join(os.homedir(), "Downloads", "AniSmooth") : "";
      this.settings.outputPath = window.StorageManager.getItem("anismooth_output_path") || this.defaultDownloadFolder;
      this.settings.pythonPath = window.StorageManager.getItem("anismooth_python_path") || "python";
      this.settings.outputPrefix = window.StorageManager.getItem("anismooth_output_prefix") || "AniSmooth";
      this.settings.outputTimestamp = window.StorageManager.getItem("anismooth_output_timestamp", "1") === "1";
      this.settings.outputAutoImport = window.StorageManager.getItem("anismooth_output_autoimport", "1") === "1";
      this.settings.outputKeepPrerender = window.StorageManager.getItem("anismooth_output_keepprerender", "1") === "1";
      this.settings.outputCleanupFailed = window.StorageManager.getItem("anismooth_output_cleanupfailed", "1") === "1";

      if (path && window.FileSystem.fs) {
        window.FileSystem.createFolder(this.settings.outputPath);
        window.FileSystem.createFolder(this.anismoothToolsFolder);
        window.FileSystem.createFolder(this.anismoothPythonEnvFolder);
      }

      window.DeadframesPanel.init(this);
      window.InterpolationPanel.init(this);
      window.UpscalePanel.init(this);
      window.ConsolePanel.init(this);
      window.QueuePanel.init(this);
      window.SysmonPanel.init(this);
      this.initSettingsPanel();

      this.bindGlobalEvents();
      this.switchTab("deadframes");

      dbg('info', 'App', 'AniSmooth initialized successfully.');

      if (window.ToolsSetup && typeof window.ToolsSetup.checkAndShowIfNeeded === 'function') {
        setTimeout(function () {
          window.ToolsSetup.checkAndShowIfNeeded();
        }, 300);
      }

      
      var self = this;
      setTimeout(function () {
        self.refreshGpuInfo();
      }, 800);
    },

    _resolvePythonCmd: function () {
      var venvPython = window.FileSystem.path.join(this.anismoothToolsFolder, ".venv", "Scripts", "python.exe");
      if (window.FileSystem.fs && window.FileSystem.fs.existsSync(venvPython)) {
        return venvPython;
      }
      return this.settings.pythonPath || "python";
    },

    bindGlobalEvents: function () {
      var self = this;

      document.getElementById("deadframesTabBtn").addEventListener("click", function () {
        self.switchTab("deadframes");
      });
      document.getElementById("interpolationTabBtn").addEventListener("click", function () {
        self.switchTab("interpolation");
      });
      document.getElementById("upscaleTabBtn").addEventListener("click", function () {
        self.switchTab("upscale");
      });
      document.getElementById("consoleTabBtn").addEventListener("click", function () {
        self.switchTab("console");
      });
      document.getElementById("queueTabBtn").addEventListener("click", function () {
        self.switchTab("queue");
      });
      document.getElementById("stopwatchTabBtn").addEventListener("click", function () {
        self.switchTab("stopwatch");
      });
      document.getElementById("sysmonTabBtn").addEventListener("click", function () {
        self.switchTab("sysmon");
      });
      document.getElementById("settingsTabBtn").addEventListener("click", function () {
        self.switchTab("settings");
      });

      var chooseOutputBtn = document.getElementById("chooseOutputFolderBtn");
      if (chooseOutputBtn) {
        chooseOutputBtn.addEventListener("click", function () {
          var selected = window.FileSystem.chooseFolderWithSystemExplorer("Select Output Folder", self.settings.outputPath);
          if (selected) {
            self.settings.outputPath = selected;
            window.StorageManager.setItem("anismooth_output_path", selected);
            document.getElementById("outputFolderText").textContent = selected;
            dbg('info', 'Settings', 'Output path updated: ' + selected);
          }
        });
      }

      var rerunSetupBtn = document.getElementById("rerunSetupBtn");
      if (rerunSetupBtn) {
        rerunSetupBtn.addEventListener("click", function () {
          showConfirm("Rerun the environment setup wizard? This will re-scan for Python, FFmpeg, and PyTorch.", function () {
            window.StorageManager.removeItem("anismooth_setup_complete");
            window.StorageManager.removeItem("anismooth_setup_skipped");
            if (window.ToolsSetup && typeof window.ToolsSetup.showToolsSetup === "function") {
              window.ToolsSetup.showToolsSetup();
            }
          });
        });
      }

      var repairBtn = document.getElementById("repairPackagesBtn");
      if (repairBtn) {
        repairBtn.addEventListener("click", function () {
          self.repairPackages();
        });
      }

      var refreshGpuBtn = document.getElementById("refreshGpuBtn");
      if (refreshGpuBtn) {
        refreshGpuBtn.addEventListener("click", function () {
          self.refreshGpuInfo();
        });
      }
    },

    switchTab: function (tab) {
      var tabs = ["deadframes", "interpolation", "upscale", "console", "queue", "stopwatch", "sysmon", "settings"];
      dbg('info', 'Nav', 'Switched to tab: ' + tab);

      for (var i = 0; i < tabs.length; i++) {
        var t = tabs[i];
        var btn = document.getElementById(t + "TabBtn");
        var view = document.getElementById(t + "View");
        if (btn) btn.classList.remove("active");
        if (view) {
          view.classList.add("hidden");
          view.style.animation = "none";
        }
      }

      var activeBtn = document.getElementById(tab + "TabBtn");
      var activeView = document.getElementById(tab + "View");
      if (activeBtn) activeBtn.classList.add("active");
      if (activeView) {
        activeView.classList.remove("hidden");
        void activeView.offsetWidth;
        activeView.style.animation = "fadeIn 0.25s var(--ease-out)";
      }

      if (tab === "console") {
        window.ConsolePanel.active = true;
        window.ConsolePanel.renderLogContent();
      } else {
        window.ConsolePanel.active = false;
      }

      if (tab === "sysmon") {
        window.SysmonPanel.startPolling();
      } else {
        window.SysmonPanel.stopPolling();
      }

      
      if (this._layerPollTimer) {
        clearInterval(this._layerPollTimer);
        this._layerPollTimer = null;
      }

      
      if (tab === "interpolation" || tab === "upscale" || tab === "deadframes") {
        var self = this;
        var panelMap = { interpolation: window.InterpolationPanel, upscale: window.UpscalePanel, deadframes: window.DeadframesPanel };
        var panel = panelMap[tab];
        if (panel && panel.refreshLayerInfo) {
          panel.refreshLayerInfo();
          this._layerPollTimer = setInterval(function () {
            if (panel && panel.refreshLayerInfo && !panel._fetching) {
              panel.refreshLayerInfo();
            }
          }, 2000);
        }
      }

      if (tab === "settings" && this._buildGpuModeSelector) {
        this._buildGpuModeSelector();
      }
    },

    initSettingsPanel: function () {
      var self = this;
      var outputText = document.getElementById("outputFolderText");
      if (outputText) {
        outputText.textContent = this.settings.outputPath;
      }

      this._buildInterfaceToggles();
      this._applyTabVisibility();
      this._buildModelToggles();
      this._applyModelVisibility();
      this._buildEnvInfo();
      this._buildFolderActions();
      this._buildModelManager();
      this._initPresets();
      this._buildGpuModeSelector();

      
      var self = this;
      var autoSaveInputs = [
        "interpolationModel", "upscaleModel", "upscaleScale",
        "deadframeThreshold", "pythonPathInput", "interpolationFactor"
      ];
      for (var ai = 0; ai < autoSaveInputs.length; ai++) {
        var el = document.getElementById(autoSaveInputs[ai]);
        if (el) {
          el.addEventListener("change", function () { self._autoSavePreset(); });
          el.addEventListener("input", function () { self._autoSavePreset(); });
        }
      }

      var pythonInput = document.getElementById("pythonPathInput");
      if (pythonInput) {
        pythonInput.value = this.settings.pythonPath;
        pythonInput.addEventListener("change", function () {
          var val = pythonInput.value.trim();
          if (self._validatePythonPath(val)) {
            self.settings.pythonPath = val;
            window.StorageManager.setItem("anismooth_python_path", val);
          } else {
            window.showToast("Invalid/untrusted Python path. Restored previous.", "error");
            pythonInput.value = self.settings.pythonPath;
          }
        });
      }

      
      var prefixInput = document.getElementById("outputPrefix");
      if (prefixInput) {
        prefixInput.value = this.settings.outputPrefix;
        prefixInput.addEventListener("change", function () {
          self.settings.outputPrefix = prefixInput.value || "AniSmooth";
          window.StorageManager.setItem("anismooth_output_prefix", self.settings.outputPrefix);
          self._autoSavePreset();
        });
      }

      
      var tsCheck = document.getElementById("outputTimestamp");
      if (tsCheck) {
        tsCheck.checked = this.settings.outputTimestamp;
        tsCheck.addEventListener("change", function () {
          self.settings.outputTimestamp = tsCheck.checked;
          window.StorageManager.setItem("anismooth_output_timestamp", tsCheck.checked ? "1" : "0");
          self._autoSavePreset();
        });
      }

      var aiCheck = document.getElementById("outputAutoImport");
      if (aiCheck) {
        aiCheck.checked = this.settings.outputAutoImport;
        aiCheck.addEventListener("change", function () {
          self.settings.outputAutoImport = aiCheck.checked;
          window.StorageManager.setItem("anismooth_output_autoimport", aiCheck.checked ? "1" : "0");
          self._autoSavePreset();
        });
      }

      var kpCheck = document.getElementById("outputKeepPrerender");
      if (kpCheck) {
        kpCheck.checked = this.settings.outputKeepPrerender;
        kpCheck.addEventListener("change", function () {
          self.settings.outputKeepPrerender = kpCheck.checked;
          window.StorageManager.setItem("anismooth_output_keepprerender", kpCheck.checked ? "1" : "0");
          self._autoSavePreset();
        });
      }

      var cfCheck = document.getElementById("outputCleanupFailed");
      if (cfCheck) {
        cfCheck.checked = this.settings.outputCleanupFailed;
        cfCheck.addEventListener("change", function () {
          self.settings.outputCleanupFailed = cfCheck.checked;
          window.StorageManager.setItem("anismooth_output_cleanupfailed", cfCheck.checked ? "1" : "0");
          self._autoSavePreset();
        });
      }

      var subNav = document.getElementById("settingsSubNav");
      if (subNav) {
        var subTabs = subNav.querySelectorAll(".sub-tab");
        for (var si = 0; si < subTabs.length; si++) {
          (function (tab) {
            tab.addEventListener("click", function () {
              var cat = tab.getAttribute("data-cat");
              if (!cat) return;

              for (var j = 0; j < subTabs.length; j++) {
                subTabs[j].className = subTabs[j].className.replace(/\bactive\b/g, "").trim();
              }
              tab.className += " active";

              var ids = { system: "settingsCatSystem", output: "settingsCatOutput", python: "settingsCatPython", tools: "settingsCatTools", interface: "settingsCatInterface", presets: "settingsCatPresets" };
              dbg('info', 'Settings', 'Switching settings category to: ' + cat);
              for (var k in ids) {
                if (!ids.hasOwnProperty(k)) continue;
                var catEl = document.getElementById(ids[k]);
                if (catEl) {
                  if (k === cat) {
                    catEl.classList.remove("hidden");
                    dbg('info', 'Settings', 'Showing category element: ' + ids[k]);
                  } else {
                    catEl.classList.add("hidden");
                  }
                } else {
                  dbg('warn', 'Settings', 'Category element not found: ' + ids[k]);
                }
              }
            });
          })(subTabs[si]);
        }
      }
    },

    refreshGpuInfo: function () {
      var pythonCmd = this._resolvePythonCmd();

      var extPath = "";
      try {
        var cs = new CSInterface();
        extPath = cs.getSystemPath(SystemPath.EXTENSION);
      } catch (e) {}

      var scriptPath = (window.FileSystem.path && extPath)
        ? window.FileSystem.path.join(extPath, "python", "main.py")
        : "main.py";

      var self = this;
      var indicator = document.getElementById("gpuIndicator");
      if (indicator) {
        indicator.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i>';
      }

      try {
        var proc = window.FileSystem.childProcess.spawn(pythonCmd, [
          scriptPath, "--mode", "gpu-info"
        ]);

        var stdout = "";
        proc.stdout.on("data", function (data) {
          stdout += data.toString();
        });

        proc.on("close", function (code) {
          if (code === 0) {
            var lines = stdout.split("\n");
            for (var i = 0; i < lines.length; i++) {
              var line = lines[i].trim();
              if (!line) continue;
              try {
                var entry = JSON.parse(line);
                if (entry.type === "gpu_info") {
                  var raw = entry.msg;
                  
                  try {
                    raw = JSON.parse(raw);
                  } catch (_) {}
                  self.renderGpuInfo(raw);
                }
              } catch (_) {}
            }
          } else {
            self.renderGpuError("Python exited with code " + code);
          }
        });

        proc.on("error", function (err) {
          self.renderGpuError(err.message);
        });
      } catch (e) {
        self.renderGpuError(e.message);
      }
    },

    renderGpuInfo: function (info) {
      if (!info) return;
      this._gpuInfoCache = info;

      var cuda = info.cuda_available;
      var nvidiaGpu = info.nvidia_gpu_detected;
      var gpuCount = info.gpu_count || (nvidiaGpu ? 1 : 0);
      var gpuName = info.gpu_name || info.nvidia_name || "Unknown";
      var cudaVer = info.cuda_version || "";
      var torchVer = info.torch_version || "";
      var totalMb = info.gpu_memory_total_mb || info.nvidia_vram_mb || 0;
      var freeMb = info.gpu_memory_free_mb || 0;
      var usedMb = totalMb > 0 ? Math.max(0, totalMb - freeMb) : 0;
      var trt = info.tensorrt_available;
      var ptVariant = info.pytorch_variant || "cpu";
      var driverVer = info.nvidia_driver || "";
      var spandrelVersion = info.spandrel_version || "";
      var spandrelAvailable = info.spandrel_available;

      
      var indicator = document.getElementById("gpuIndicator");
      if (indicator) {
        if (cuda) {
          indicator.innerHTML = '<i class="fa-solid fa-circle-check"></i>';
          indicator.className = "gpu-indicator gpu-ok";
        } else if (nvidiaGpu) {
          indicator.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i>';
          indicator.className = "gpu-indicator gpu-warn";
        } else {
          indicator.innerHTML = '<i class="fa-solid fa-circle-exclamation"></i>';
          indicator.className = "gpu-indicator gpu-err";
        }
      }

      
      var nameEl = document.getElementById("gpuName");
      if (nameEl) {
        if (cuda) {
          nameEl.textContent = gpuName;
        } else if (nvidiaGpu) {
          nameEl.textContent = gpuName + " (not usable)";
        } else {
          nameEl.textContent = "No NVIDIA GPU detected";
        }
      }

      
      var metaEl = document.getElementById("gpuMeta");
      if (metaEl) {
        var parts = [];
        if (driverVer) parts.push("Driver " + driverVer);
        if (cudaVer) parts.push("CUDA " + cudaVer);
        if (torchVer) parts.push("Torch " + torchVer);
        if (nvidiaGpu && !cuda) {
          parts.push("PyTorch is CPU-only");
        } else if (!cuda) {
          parts.push("CPU mode only");
        }
        metaEl.textContent = parts.join("  |  ");
      }

      
      var fill = document.getElementById("gpuVramFill");
      var text = document.getElementById("gpuVramText");
      if (fill && text && totalMb > 0) {
        if (cuda && freeMb > 0) {
          var pct = Math.round((usedMb / totalMb) * 100);
          fill.style.width = pct + "%";
          text.textContent = formatMb(usedMb) + " / " + formatMb(totalMb);
        } else if (nvidiaGpu) {
          fill.style.width = "0%";
          text.textContent = formatMb(totalMb) + " (unavailable to PyTorch)";
        }
      } else if (text) {
        fill.style.width = "0%";
        text.textContent = cuda ? "VRAM: N/A" : (nvidiaGpu ? "VRAM: N/A" : "N/A");
      }

      
      var badgesEl = document.getElementById("gpuBadges");
      if (badgesEl) {
        badgesEl.innerHTML = "";

        var nvBadge = document.createElement("span");
        nvBadge.className = "gpu-badge " + (nvidiaGpu ? "badge-ok" : "badge-err");
        nvBadge.innerHTML = '<i class="fa-brands fa-nvidia"></i> NVIDIA';
        badgesEl.appendChild(nvBadge);

        var cudaBadge = document.createElement("span");
        cudaBadge.className = "gpu-badge " + (cuda ? "badge-ok" : (nvidiaGpu ? "badge-warn" : "badge-err"));
        cudaBadge.innerHTML = '<i class="fa-solid fa-' + (cuda ? 'check' : (nvidiaGpu ? 'exclamation' : 'xmark')) + '"></i> CUDA';
        badgesEl.appendChild(cudaBadge);

        var trtBadge = document.createElement("span");
        trtBadge.className = "gpu-badge " + (trt ? "badge-ok" : "badge-err");
        trtBadge.innerHTML = '<i class="fa-solid fa-' + (trt ? 'check' : 'xmark') + '"></i> TensorRT';
        badgesEl.appendChild(trtBadge);

        var ptBadge = document.createElement("span");
        ptBadge.className = "gpu-badge " + (ptVariant === "cuda" ? "badge-ok" : "badge-warn");
        ptBadge.innerHTML = '<i class="fa-solid fa-' + (ptVariant === "cuda" ? 'check' : 'exclamation') + '"></i> PyTorch ' + ptVariant.toUpperCase();
        badgesEl.appendChild(ptBadge);

        var srBadge = document.createElement("span");
        srBadge.className = "gpu-badge " + (spandrelAvailable ? "badge-ok" : "badge-err");
        srBadge.innerHTML = '<i class="fa-solid fa-' + (spandrelAvailable ? 'check' : 'xmark') + '"></i> Spandrel';
        badgesEl.appendChild(srBadge);
      }

      var details = document.getElementById("gpuDetails");
      if (details) {
        details.style.display = "";
      }

      
      this._buildCudaInfo(cuda, nvidiaGpu, cudaVer, torchVer, ptVariant, info.nvidia_cuda_ver, info.nvidia_driver);

      
      this._buildSysInfo(info);

      
      var actionsEl = document.getElementById("gpuActions");
      if (actionsEl) {
        if (nvidiaGpu && !cuda) {
          actionsEl.style.display = "";
          actionsEl.innerHTML =
            '<button class="btn-sm" onclick="window.App.installCudaPytorch()" style="width:100%;">' +
              '<i class="fa-solid fa-download"></i> Install CUDA PyTorch' +
            '</button>' +
            '<span class="form-hint" style="margin-top:3px;">Reinstalls PyTorch with GPU acceleration. Takes a few minutes.</span>';
        } else if (cuda) {
          actionsEl.style.display = "";
          actionsEl.innerHTML = '<span class="form-hint" style="color:#6ee7b7;"><i class="fa-solid fa-check"></i> GPU acceleration active</span>';
        } else {
          actionsEl.style.display = "none";
        }
      }
    },

    renderGpuError: function (msg) {
      var indicator = document.getElementById("gpuIndicator");
      if (indicator) {
        indicator.innerHTML = '<i class="fa-solid fa-circle-exclamation"></i>';
        indicator.className = "gpu-indicator gpu-warn";
      }

      var nameEl = document.getElementById("gpuName");
      if (nameEl) {
        nameEl.textContent = "GPU detection unavailable";
      }

      var metaEl = document.getElementById("gpuMeta");
      if (metaEl) {
        metaEl.textContent = msg || "Could not run Python";
      }

      var text = document.getElementById("gpuVramText");
      if (text) text.textContent = "--";

      var badgesEl = document.getElementById("gpuBadges");
      if (badgesEl) {
        badgesEl.innerHTML = '<span class="gpu-badge badge-err"><i class="fa-solid fa-xmark"></i> Offline</span>';
      }

      var details = document.getElementById("gpuDetails");
      if (details) details.style.display = "";

      var actionsEl = document.getElementById("gpuActions");
      if (actionsEl) actionsEl.style.display = "none";
    },

    installCudaPytorch: function () {
      var self = this;
      window.showConfirm(
        "Reinstall PyTorch with CUDA support? The panel will be unresponsive for a few minutes while pip downloads GPU packages (~2.5 GB).",
        function () {
          
          var actionsEl = document.getElementById("gpuActions");
          var logEl = document.getElementById("gpuInstallLog");

          if (actionsEl) {
            actionsEl.style.display = "";
            actionsEl.innerHTML =
              '<div class="gpu-install-status"><i class="fa-solid fa-spinner fa-spin"></i> Installing CUDA PyTorch...</div>' +
              '<div class="progress-track" style="margin-top:6px;">' +
                '<div id="gpuInstallBar" class="progress-fill" style="width:0%"></div>' +
              '</div>';
          }
          if (logEl) {
            logEl.style.display = "";
            logEl.innerHTML = '<div class="gpu-install-log" id="gpuInstallLogInner">Starting pip install...</div>';
          }

          var pythonCmd = self._resolvePythonCmd();
          var extPath = "";
          try { var cs = new CSInterface(); extPath = cs.getSystemPath(SystemPath.EXTENSION); } catch (e) {}
          var scriptPath = (window.FileSystem.path && extPath)
            ? window.FileSystem.path.join(extPath, "python", "setup.py")
            : "setup.py";

          try {
            var proc = window.FileSystem.childProcess.spawn(pythonCmd, [scriptPath, "--force-gpu"]);
            var buf = "";
            var lineCount = 0;

            proc.stdout.on("data", function (d) {
              buf += d.toString();
              var lines = buf.split("\n");
              buf = lines.pop();
              for (var i = 0; i < lines.length; i++) {
                var line = lines[i].trim();
                if (!line) continue;
                lineCount++;
                dbg("info", "GPU-install", line);
                self._gpuInstallLog(line, lineCount);
              }
            });
            proc.stderr.on("data", function (d) {
              var err = d.toString().trim();
              if (err) { dbg("warn", "GPU-install", err); self._gpuInstallLog("[WARN] " + err, -1); }
            });
            proc.on("close", function (code) {
              var ok = code === 0;
              self._gpuInstallDone(ok, ok ? "CUDA PyTorch installed! Restart the panel." : "Install failed (code " + code + ").");
              dbg(ok ? "success" : "error", "GPU", "CUDA PyTorch install " + (ok ? "succeeded" : "failed"));
              setTimeout(function () { self.refreshGpuInfo(); }, 2500);
            });
            proc.on("error", function (e) {
              self._gpuInstallDone(false, "Error: " + e.message);
              dbg("error", "GPU", "Install error: " + e.message);
            });
          } catch (e) {
            self._gpuInstallDone(false, "Error: " + e.message);
          }
        }
      );
    },

    _gpuInstallLog: function (line, count) {
      var el = document.getElementById("gpuInstallLogInner");
      if (!el) return;
      var clean = String(line).replace(/[<>]/g, "");
      el.innerHTML += '\n' + clean;
      if (count > 0 && count <= 50) el.scrollTop = el.scrollHeight;
      
      var bar = document.getElementById("gpuInstallBar");
      if (bar && count > 0) {
        var fake = Math.min(95, 5 + count * 3);
        bar.style.width = fake + "%";
      }
    },

    _gpuInstallDone: function (ok, msg) {
      var bar = document.getElementById("gpuInstallBar");
      if (bar) bar.style.width = ok ? "100%" : "0%";

      var statusEl = document.querySelector(".gpu-install-status");
      if (statusEl) {
        statusEl.innerHTML = ok
          ? '<i class="fa-solid fa-circle-check" style="color:#10b981;"></i> <b style="color:#6ee7b7;">' + msg + '</b>'
          : '<i class="fa-solid fa-circle-xmark" style="color:#ef4444;"></i> <b style="color:#fca5a5;">' + msg + '</b>';
      }
    },

    repairPackages: function () {
      var self = this;
      var btn = document.getElementById("repairPackagesBtn");
      var logEl = document.getElementById("repairLog");

      if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Installing packages...'; }
      if (logEl) {
        logEl.style.display = "";
        logEl.innerHTML = '<div class="gpu-install-log" id="repairLogInner" style="max-height:180px;">Starting pip install...</div>';
      }

      var pythonCmd = this._resolvePythonCmd();
      var extPath = "";
      try { var cs = new CSInterface(); extPath = cs.getSystemPath(SystemPath.EXTENSION); } catch (e) {}
      var sourceSetup = (window.FileSystem.path && extPath)
        ? window.FileSystem.path.join(extPath, "python", "setup.py")
        : "setup.py";
      var destSetup = window.FileSystem.path.join(this.anismoothToolsFolder, "setup.py");

      try {
        window.FileSystem.createFolder(this.anismoothToolsFolder);
        var content = window.FileSystem.fs.readFileSync(sourceSetup, "utf8");
        window.FileSystem.fs.writeFileSync(destSetup, content, "utf8");
      } catch (e) {
        self._repairLog("Failed to copy setup script: " + e.message);
        self._repairDone(false);
        return;
      }

      try {
        var proc = window.FileSystem.childProcess.spawn(pythonCmd, ["setup.py"], { cwd: this.anismoothToolsFolder, windowsHide: true });
        var buf = "";

        proc.stdout.on("data", function (d) {
          buf += d.toString();
          var lines = buf.split("\n");
          buf = lines.pop();
          for (var i = 0; i < lines.length; i++) {
            var line = lines[i].trim();
            if (!line) continue;
            self._repairLog(line);
          }
        });
        proc.stderr.on("data", function (d) {
          self._repairLog("[WARN] " + d.toString().trim());
        });
        proc.on("close", function (code) {
          var ok = code === 0;
          self._repairLog(ok ? "[OK] All packages installed." : "[ERR] Setup exited with code " + code);
          self._repairDone(ok);
        });
        proc.on("error", function (e) {
          self._repairLog("[ERR] " + e.message);
          self._repairDone(false);
        });
      } catch (e) {
        self._repairLog("[ERR] " + e.message);
        self._repairDone(false);
      }
    },

    _repairLog: function (msg) {
      var el = document.getElementById("repairLogInner");
      if (!el) return;
      el.innerHTML += "\n" + String(msg).replace(/[<>]/g, "");
      el.scrollTop = el.scrollHeight;
    },

    _repairDone: function (ok) {
      var btn = document.getElementById("repairPackagesBtn");
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-cubes"></i> Repair / Install Python Packages';
      }
      if (ok) {
        var self = this;
        setTimeout(function () { self.refreshGpuInfo(); }, 1500);
      }
    },

    importFileToAfterEffects: function (filePath) {
      if (!window.__adobe_cep__ || !window.__adobe_cep__.evalScript) {
        dbg('warn', 'App', 'CEP evalScript not available to import file.');
        return;
      }
      var escapedPath = String(filePath || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
      window.__adobe_cep__.evalScript('importFileToAE("' + escapedPath + '")', function (result) {
        try {
          var res = JSON.parse(result || "{}");
          if (res.ok) {
            dbg('success', 'App', 'Imported successfully: ' + res.message);
          } else {
            dbg('error', 'App', 'Import failed: ' + res.message);
          }
        } catch (e) {
          dbg('error', 'App', 'Import exception: ' + result);
        }
      });
    },

    _tabConfig: [
      { id: "deadframes", icon: "fa-scissors", label: "Deadframes" },
      { id: "interpolation", icon: "fa-forward", label: "Interpolation" },
      { id: "upscale", icon: "fa-expand", label: "Upscale" },
      { id: "console", icon: "fa-terminal", label: "Console" },
      { id: "queue", icon: "fa-list-check", label: "Queue" },
      { id: "stopwatch", icon: "fa-stopwatch", label: "Stopwatch" },
      { id: "sysmon", icon: "fa-chart-line", label: "System Monitor" }
    ],

    _buildInterfaceToggles: function () {
      var container = document.getElementById("interfaceToggles");
      if (!container) return;
      var self = this;
      var html = "";
      for (var i = 0; i < this._tabConfig.length; i++) {
        var tab = this._tabConfig[i];
        var key = "anismooth_tab_" + tab.id;
        var visible = window.StorageManager.getItem(key, "1") !== "0";
        html +=
          '<label class="toggle-row">' +
            '<i class="fa-solid ' + tab.icon + ' toggle-icon"></i>' +
            '<span class="toggle-label">' + tab.label + '</span>' +
            '<input type="checkbox" class="toggle-input" data-tab="' + tab.id + '"' + (visible ? " checked" : "") + '>' +
            '<span class="toggle-switch"></span>' +
          '</label>';
      }
      container.innerHTML = html;

      var inputs = container.querySelectorAll(".toggle-input");
      for (var j = 0; j < inputs.length; j++) {
        inputs[j].addEventListener("change", function () {
          var tabId = this.getAttribute("data-tab");
          var checked = this.checked;
          window.StorageManager.setItem("anismooth_tab_" + tabId, checked ? "1" : "0");
          self._applyTabVisibility();
        });
      }
    },

    _applyTabVisibility: function () {
      for (var i = 0; i < this._tabConfig.length; i++) {
        var tab = this._tabConfig[i];
        var key = "anismooth_tab_" + tab.id;
        var visible = window.StorageManager.getItem(key, "1") !== "0";
        var btn = document.getElementById(tab.id + "TabBtn");
        if (btn) {
          btn.style.display = visible ? "" : "none";
        }
      }
      
      var activeBtn = document.querySelector(".topbar-nav .nav-icon.active");
      if (activeBtn && activeBtn.style.display === "none") {
        for (var j = 0; j < this._tabConfig.length; j++) {
          var t = this._tabConfig[j];
          var b = document.getElementById(t.id + "TabBtn");
          if (b && b.style.display !== "none") {
            this.switchTab(t.id);
            break;
          }
        }
      }
    },

    _buildGpuModeSelector: function () {
      var currentMode = window.StorageManager.getItem("anismooth_gpu_choice", null);
      var gpuOption = document.getElementById("settingsGpuOptionGpu");
      var cpuOption = document.getElementById("settingsGpuOptionCpu");
      var gpuCheck = document.getElementById("settingsGpuCheckGpu");
      var cpuCheck = document.getElementById("settingsGpuCheckCpu");
      var statusEl = document.getElementById("settingsGpuStatus");

      if (!gpuOption || !cpuOption) return;

      if (currentMode === "gpu") {
        gpuOption.classList.add("ts-gpu-selected");
        gpuCheck.innerHTML = '<i class="fa-solid fa-circle-check"></i>';
      } else if (currentMode === "cpu") {
        cpuOption.classList.add("ts-gpu-selected");
        cpuCheck.innerHTML = '<i class="fa-solid fa-circle-check"></i>';
      }

      if (statusEl) {
        if (currentMode === "gpu") {
          statusEl.innerHTML = '<span class="form-hint" style="color:#6ee7b7;"><i class="fa-solid fa-check"></i> GPU mode active</span>';
        } else if (currentMode === "cpu") {
          statusEl.innerHTML = '<span class="form-hint" style="color:#fcd34d;"><i class="fa-solid fa-computer"></i> CPU mode active</span>';
        } else {
          statusEl.innerHTML = '<span class="form-hint">No mode selected. Run setup wizard to configure.</span>';
        }
      }
    },

    _buildModelToggles: function () {
      var interpEl = document.getElementById("interpModelToggles");
      var upscaleEl = document.getElementById("upscaleModelToggles");
      var self = this;

      var interpModels = [
        { value: "rife4.25-heavy", label: "RIFE 4.25 HEAVY Cuda", icon: "fa-microchip" },
        { value: "rife4.25", label: "RIFE 4.25 Cuda", icon: "fa-microchip" },
        { value: "rife4.25-heavy-tensorrt", label: "RIFE 4.25 HEAVY TensorRT", icon: "fa-bolt" },
        { value: "rife4.25-tensorrt", label: "RIFE 4.25 TensorRT", icon: "fa-bolt" }
      ];
      var upscaleModels = [
        { value: "adore", label: "Adore Cuda", icon: "fa-microchip" },
        { value: "fallin_soft", label: "Fallin Soft Cuda", icon: "fa-microchip" }
      ];

      if (interpEl) interpEl.innerHTML = this._buildToggleGroup(interpModels, "anismooth_model_interp_");
      if (upscaleEl) upscaleEl.innerHTML = this._buildToggleGroup(upscaleModels, "anismooth_model_upscale_");

      var allToggles = document.querySelectorAll(".model-vis-toggle");
      for (var i = 0; i < allToggles.length; i++) {
        allToggles[i].addEventListener("change", function () {
          var val = this.getAttribute("data-value");
          var prefix = this.getAttribute("data-prefix");
          window.StorageManager.setItem(prefix + val, this.checked ? "1" : "0");
          self._applyModelVisibility();
        });
      }
    },

    _buildToggleGroup: function (models, prefix) {
      var html = "";
      for (var i = 0; i < models.length; i++) {
        var m = models[i];
        var key = prefix + m.value;
        var visible = window.StorageManager.getItem(key, "1") !== "0";
        html +=
          '<label class="toggle-row" style="padding:0;margin-bottom:3px;">' +
            '<i class="fa-solid ' + m.icon + ' toggle-icon"></i>' +
            '<span class="toggle-label">' + escTxt(m.label) + '</span>' +
            '<input type="checkbox" class="toggle-input model-vis-toggle" data-value="' + escTxt(m.value) + '" data-prefix="' + escTxt(prefix) + '"' + (visible ? " checked" : "") + '>' +
            '<span class="toggle-switch"></span>' +
          '</label>';
      }
      return html;
    },

    _applyModelVisibility: function () {
      var interpSelect = document.getElementById("interpolationModel");
      var upscaleSelect = document.getElementById("upscaleModel");
      if (interpSelect) filterSelect(interpSelect, "anismooth_model_interp_");
      if (upscaleSelect) filterSelect(upscaleSelect, "anismooth_model_upscale_");

      function filterSelect(select, prefix) {
        var children = select.querySelectorAll(".select-options")[0].children;
        var anyVisible = false;
        var firstVisible = null;
        var activeFound = false;

        
        for (var i = 0; i < children.length; i++) {
          var child = children[i];
          if (child.classList.contains("select-sep")) continue;
          var val = child.getAttribute("data-value");
          if (!val) continue;
          var visible = window.StorageManager.getItem(prefix + val, "1") !== "0";
          child._visible = visible;
          if (visible) {
            if (!firstVisible) firstVisible = child;
            if (child.classList.contains("active")) activeFound = true;
            anyVisible = true;
          }
        }

        
        var sectionHasVisible = false;
        for (var i = 0; i < children.length; i++) {
          var child = children[i];
          if (child.classList.contains("select-sep")) {
            child.style.display = sectionHasVisible ? "" : "none";
            sectionHasVisible = false;
          } else if (child.getAttribute("data-value")) {
            child.style.display = child._visible ? "" : "none";
            if (child._visible) sectionHasVisible = true;
          }
        }

        if (!activeFound && firstVisible) {
          select.value = firstVisible.getAttribute("data-value");
        }
      }
    },

    _buildEnvInfo: function () {
      var el = document.getElementById("envInfoList");
      if (!el) return;

      var rows = [];

      
      (function () {
        var pyPath = this.settings.pythonPath || "python";
        rows.push({ icon: "fa-brands fa-python", label: "Python", value: pyPath, ok: pyPath !== "python" });
      }).call(this);

      
      (function () {
        var ffmpeg = this.anismoothToolsFolder ? window.FileSystem.path.join(this.anismoothToolsFolder, "ffmpeg.exe") : "";
        var found = ffmpeg && window.FileSystem.fs.existsSync(ffmpeg);
        rows.push({ icon: "fa-solid fa-film", label: "FFmpeg", value: found ? ffmpeg : "Not found", ok: found });
      }).call(this);

      
      (function () {
        var ffprobe = this.anismoothToolsFolder ? window.FileSystem.path.join(this.anismoothToolsFolder, "ffprobe.exe") : "";
        var found = ffprobe && window.FileSystem.fs.existsSync(ffprobe);
        rows.push({ icon: "fa-solid fa-magnifying-glass", label: "FFprobe", value: found ? ffprobe : "Not found", ok: found });
      }).call(this);

      
      rows.push({ icon: "fa-solid fa-cubes", label: "PyTorch", value: "Check GPU tab", ok: null });

      
      rows.push({ icon: "fa-solid fa-image", label: "OpenCV", value: "Check GPU tab", ok: null });

      
      (function () {
        var spVer = "";
        var spOk = null;
        if (this._gpuInfoCache) {
          spOk = this._gpuInfoCache.spandrel_available;
          spVer = this._gpuInfoCache.spandrel_version || "";
        }
        rows.push({ icon: "fa-solid fa-puzzle-piece", label: "Spandrel", value: spOk ? ("v" + spVer) : (spOk === false ? "Not installed" : "Check GPU tab"), ok: spOk });
      }).call(this);

      
      (function () {
        var wd = this.anismoothToolsFolder ? window.FileSystem.path.join(this.anismoothToolsFolder, "weights") : "";
        var exists = wd && window.FileSystem.fs.existsSync(wd);
        var size = "";
        if (exists) {
          try {
            var files = window.FileSystem.fs.readdirSync(wd);
            var totalModels = 0;
            for (var i = 0; i < files.length; i++) {
              var sub = window.FileSystem.path.join(wd, files[i]);
              try {
                var stat = window.FileSystem.fs.statSync(sub);
                if (stat.isDirectory()) {
                  var subs = window.FileSystem.fs.readdirSync(sub);
                  totalModels += subs.length;
                }
              } catch (e) {}
            }
            size = totalModels + " model files";
          } catch (e) { size = ""; }
        }
        rows.push({ icon: "fa-solid fa-database", label: "Models", value: exists ? (wd + (size ? " (" + size + ")" : "")) : "No weights folder", ok: exists });
      }).call(this);

      var html = "";
      for (var i = 0; i < rows.length; i++) {
        var r = rows[i];
        var statusIcon = r.ok === true ? '<i class="fa-solid fa-circle-check env-ok"></i>'
          : r.ok === false ? '<i class="fa-solid fa-circle-xmark env-err"></i>'
          : '<i class="fa-solid fa-circle env-dim"></i>';
        html +=
          '<div class="env-row">' +
            statusIcon +
            '<i class="' + r.icon + ' env-icon"></i>' +
            '<span class="env-label">' + r.label + '</span>' +
            '<span class="env-value">' + escapeEnv(r.value) + '</span>' +
          '</div>';
      }
      el.innerHTML = html;

      function escapeEnv(s) {
        return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      }
    },

    _buildCudaInfo: function (cuda, nvidiaGpu, cudaVer, torchVer, ptVariant, driverCUDA, driverVer) {
      var el = document.getElementById("cudaInfo");
      if (!el) return;

      var rows = [
        { label: "NVIDIA GPU", value: nvidiaGpu ? "Detected" : "Not found", ok: nvidiaGpu },
        { label: "CUDA Ready", value: cuda ? "Yes (" + (cudaVer || "") + ")" : (nvidiaGpu ? "CPU PyTorch" : "N/A"), ok: cuda },
        { label: "Driver CUDA", value: driverCUDA || (nvidiaGpu ? "Unknown" : "N/A"), ok: !!driverCUDA },
        { label: "Driver Ver", value: driverVer || (nvidiaGpu ? "Unknown" : "N/A"), ok: !!driverVer },
        { label: "PyTorch", value: torchVer || "Not installed", ok: !!torchVer },
        { label: "Variant", value: ptVariant === "cuda" ? "CUDA" : "CPU-only", ok: ptVariant === "cuda" }
      ];

      var html = "";
      for (var i = 0; i < rows.length; i++) {
        var r = rows[i];
        var icon = r.ok === true ? 'fa-circle-check env-ok' : r.ok === false ? 'fa-circle-xmark env-err' : 'fa-circle env-dim';
        html +=
          '<div class="env-row">' +
            '<i class="fa-solid ' + icon + '"></i>' +
            '<span class="env-label">' + r.label + '</span>' +
            '<span class="env-value">' + envEsc(r.value) + '</span>' +
          '</div>';
      }
      el.innerHTML = html;
    },

    _buildSysInfo: function (info) {
      var el = document.getElementById("sysInfo");
      if (!el) return;

      var rows = [];

      
      if (info && info.sys_os) {
        rows.push({ label: "OS", value: info.sys_os });
        rows.push({ label: "Arch", value: info.sys_arch || "N/A" });
        rows.push({ label: "Hostname", value: info.sys_hostname || "N/A" });
        if (info.sys_cpu) {
          rows.push({ label: "CPU", value: info.sys_cpu });
        }
        if (info.sys_ram_bytes) {
          rows.push({ label: "RAM", value: (info.sys_ram_bytes / (1024 * 1024 * 1024)).toFixed(1) + " GB" });
        }
      } else {
        try {
          var os = window.FileSystem.os;
          rows.push({ label: "OS", value: os.type() + " " + os.release() });
          rows.push({ label: "Arch", value: os.arch() });
          rows.push({ label: "Hostname", value: os.hostname() });
          var cpus = os.cpus();
          if (cpus && cpus.length > 0) {
            rows.push({ label: "CPU", value: cpus[0].model + " (" + cpus.length + " cores)" });
          }
          var totalMem = os.totalmem();
          if (totalMem) {
            rows.push({ label: "RAM", value: (totalMem / (1024 * 1024 * 1024)).toFixed(1) + " GB" });
          }
        } catch (e) {}
      }

      
      rows.push({ label: "Python", value: this.settings.pythonPath || "python" });

      
      rows.push({ label: "AppData", value: this.anismoothToolsFolder || "N/A" });

      var html = "";
      for (var i = 0; i < rows.length; i++) {
        var r = rows[i];
        html +=
          '<div class="env-row">' +
            '<i class="fa-solid fa-circle env-dim"></i>' +
            '<span class="env-label">' + r.label + '</span>' +
            '<span class="env-value">' + envEsc(r.value) + '</span>' +
          '</div>';
      }
      el.innerHTML = html;
    },

    _buildFolderActions: function () {
      var el = document.getElementById("envFolderActions");
      if (!el) return;
      var self = this;

      var buttons = [
        { label: "Open Tools Folder", path: this.anismoothToolsFolder, icon: "fa-folder-open" },
        { label: "Open Output Folder", path: this.settings.outputPath, icon: "fa-folder" },
        { label: "Open Weights Folder", path: this.anismoothToolsFolder ? window.FileSystem.path.join(this.anismoothToolsFolder, "weights") : "", icon: "fa-database" }
      ];

      var html = "";
      for (var i = 0; i < buttons.length; i++) {
        var b = buttons[i];
        var exists = b.path && window.FileSystem.fs.existsSync(b.path);
        html +=
          '<div class="env-folder-row">' +
            '<i class="fa-solid ' + (exists ? "fa-circle-check env-ok" : "fa-circle env-dim") + '"></i>' +
            '<span class="env-folder-path">' + escapeEnv2(b.path || "N/A") + '</span>' +
            '<button class="btn-sm env-folder-btn" data-path="' + escapeEnv2(b.path || "") + '"><i class="fa-solid ' + b.icon + '"></i></button>' +
          '</div>';
      }
      el.innerHTML = html;

      var btns = el.querySelectorAll(".env-folder-btn");
      for (var j = 0; j < btns.length; j++) {
        btns[j].addEventListener("click", function () {
          var p = this.getAttribute("data-path");
          if (p && window.FileSystem.fs.existsSync(p)) {
            try {
              window.FileSystem.childProcess.execFile('explorer.exe', [p]);
            } catch (e) {}
          }
        });
      }

      function escapeEnv2(s) {
        return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
      }
    },

    _buildModelManager: function () {
      var el = document.getElementById("modelManagerList");
      if (!el) return;
      var self = this;

      function scan() {
        var items = [];
        try {
          var weightsDir = window.FileSystem.path.join(self.anismoothToolsFolder, "weights");
          if (!window.FileSystem.fs.existsSync(weightsDir)) {
            el.innerHTML = '<div class="model-empty">No weights folder found</div>';
            return;
          }
          var subdirs = window.FileSystem.fs.readdirSync(weightsDir);
          for (var i = 0; i < subdirs.length; i++) {
            var sub = subdirs[i];
            var subPath = window.FileSystem.path.join(weightsDir, sub);
            try {
              var stat = window.FileSystem.fs.statSync(subPath);
              if (stat.isDirectory()) {
                var files = window.FileSystem.fs.readdirSync(subPath);
                for (var j = 0; j < files.length; j++) {
                  var f = files[j];
                  if (f.endsWith(".pth") || f.endsWith(".pkl") || f.endsWith(".engine") || f.endsWith(".onnx")) {
                    var fp = window.FileSystem.path.join(subPath, f);
                    var fstat = window.FileSystem.fs.statSync(fp);
                    items.push({ name: sub + "/" + f, path: fp, size: fstat.size, dir: sub, file: f });
                  }
                }
              }
            } catch (e) {}
          }
        } catch (e) {}

        if (items.length === 0) {
          el.innerHTML = '<div class="model-empty"><i class="fa-solid fa-database"></i> No model files yet</div>';
          return;
        }

        var totalSize = 0;
        for (var i = 0; i < items.length; i++) totalSize += items[i].size;

        var html = '<div class="model-summary">' + items.length + ' file' + (items.length !== 1 ? "s" : "") + ' · ' + fmtSz(totalSize) + '</div>';
        for (var i = 0; i < items.length; i++) {
          var item = items[i];
          var icon = item.file.endsWith(".engine") ? "fa-bolt" : item.file.endsWith(".onnx") ? "fa-file-code" : "fa-file";
          html +=
            '<div class="model-row">' +
              '<i class="fa-solid ' + icon + ' model-file-icon"></i>' +
              '<div class="model-file-info">' +
                '<div class="model-file-name">' + escM(item.file) + '</div>' +
                '<div class="model-file-meta">' + escM(item.dir) + ' · ' + fmtSz(item.size) + '</div>' +
              '</div>' +
              '<button class="btn-sm model-delete" data-path="' + escMA(item.path) + '" title="Delete"><i class="fa-solid fa-trash"></i></button>' +
            '</div>';
        }
        el.innerHTML = html;

        var deletes = el.querySelectorAll(".model-delete");
        for (var k = 0; k < deletes.length; k++) {
          deletes[k].addEventListener("click", function () {
            var p = this.getAttribute("data-path");
            if (p && window.FileSystem.fs.existsSync(p)) {
              window.showConfirm("Delete " + p.split("\\").pop() + "?", function () {
                try { window.FileSystem.fs.unlinkSync(p); scan(); } catch (e) {}
              });
            }
          });
        }
      }

      scan();

      function escM(s) { return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
      function escMA(s) { return String(s || "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
      function fmtSz(bytes) {
        if (bytes < 1024) return bytes + " B";
        if (bytes < 1048576) return (bytes / 1024).toFixed(1) + " KB";
        return (bytes / 1048576).toFixed(1) + " MB";
      }
    },

    _initPresets: function () {
      var self = this;
      var saveBtn = document.getElementById("presetSaveBtn");
      var importBtn = document.getElementById("presetImportBtn");

      if (saveBtn) {
        saveBtn.addEventListener("click", function () {
          window.showPrompt("Save Preset", "Preset name...", "Description (optional)", function (name, desc) {
            if (!name) return;
            self._showSectionPicker(name, desc || "");
          });
        });
      }
      if (importBtn) {
        importBtn.addEventListener("click", function () {
          self._importPreset();
        });
      }
      this._renderPresetList();
    },

    _captureState: function () {
      var modelInt = document.getElementById("interpolationModel");
      var modelUps = document.getElementById("upscaleModel");
      var scaleUps = document.getElementById("upscaleScale");
      var dedupThreshold = document.getElementById("deadframeThreshold");
      var factorBtns = document.getElementById("interpolationFactor");
      var factorCustom = document.getElementById("interpFactorCustom");
      var factor = 2;
      if (factorCustom && factorCustom.value) {
        factor = parseInt(factorCustom.value, 10) || 2;
      } else if (factorBtns) {
        var active = factorBtns.querySelector(".factor-btn.active");
        if (active) factor = parseInt(active.getAttribute("data-value"), 10) || 2;
      }

      return {
        interpolation: {
          model: modelInt ? modelInt.value : "rife4.25-heavy",
          factor: factor
        },
        upscale: {
          model: modelUps ? modelUps.value : "adore",
          scale: parseInt(scaleUps ? scaleUps.value : "2", 10)
        },
        deadframes: {
          threshold: dedupThreshold ? parseFloat(dedupThreshold.value) : 0.05
        },
        output: {
          prefix: this.settings.outputPrefix,
          timestamp: this.settings.outputTimestamp,
          autoImport: this.settings.outputAutoImport,
          keepPrerender: this.settings.outputKeepPrerender
        },
        python: { path: this.settings.pythonPath }
      };
    },

    _applyState: function (preset) {
      if (!this._validatePreset(preset)) {
        dbg("error", "Presets", "Rejected invalid/unsafe preset");
        window.showToast("Unsafe/invalid preset settings rejected.", "error");
        return;
      }
      var state = preset.settings || preset;
      if (state.interpolation) {
        var modelInt = document.getElementById("interpolationModel");
        if (modelInt) modelInt.value = state.interpolation.model;
        if (state.interpolation.factor) {
          var fc = document.getElementById("interpFactorCustom");
          var fb = document.getElementById("interpolationFactor");
          if (fc) fc.value = state.interpolation.factor;
          if (fb) {
            var btns = fb.querySelectorAll(".factor-btn");
            for (var i = 0; i < btns.length; i++) {
              var v = parseInt(btns[i].getAttribute("data-value"), 10);
              if (v === state.interpolation.factor) btns[i].classList.add("active");
              else btns[i].classList.remove("active");
            }
          }
        }
        if (window.InterpolationPanel) window.InterpolationPanel._renderSafe("modelInfo");
      }
      if (state.upscale) {
        var modelUps = document.getElementById("upscaleModel");
        if (modelUps) modelUps.value = state.upscale.model;
        var scaleUps = document.getElementById("upscaleScale");
        if (scaleUps) scaleUps.value = String(state.upscale.scale || 2);
        if (window.UpscalePanel) window.UpscalePanel._renderSafe("modelInfo");
      }
      if (state.deadframes) {
        var dt = document.getElementById("deadframeThreshold");
        if (dt) dt.value = state.deadframes.threshold || 0.05;
      }
      if (state.output) {
        this.settings.outputPrefix = state.output.prefix || "AniSmooth";
        this.settings.outputTimestamp = state.output.timestamp !== false;
        this.settings.outputAutoImport = state.output.autoImport !== false;
        this.settings.outputKeepPrerender = state.output.keepPrerender !== false;
        window.StorageManager.setItem("anismooth_output_prefix", this.settings.outputPrefix);
        window.StorageManager.setItem("anismooth_output_timestamp", this.settings.outputTimestamp ? "1" : "0");
        window.StorageManager.setItem("anismooth_output_autoimport", this.settings.outputAutoImport ? "1" : "0");
        window.StorageManager.setItem("anismooth_output_keepprerender", this.settings.outputKeepPrerender ? "1" : "0");
        var pf = document.getElementById("outputPrefix");
        if (pf) pf.value = this.settings.outputPrefix;
        var ts = document.getElementById("outputTimestamp");
        if (ts) ts.checked = this.settings.outputTimestamp;
        var ai = document.getElementById("outputAutoImport");
        if (ai) ai.checked = this.settings.outputAutoImport;
        var kp = document.getElementById("outputKeepPrerender");
        if (kp) kp.checked = this.settings.outputKeepPrerender;
      }
      if (state.python) {
        this.settings.pythonPath = state.python.path || "python";
        window.StorageManager.setItem("anismooth_python_path", this.settings.pythonPath);
        var pi = document.getElementById("pythonPathInput");
        if (pi) pi.value = this.settings.pythonPath;
      }
    },

    _validatePreset: function (preset) {
      if (!preset) return false;
      var state = preset.settings || preset;
      if (!state) return false;
      var validInterp = ["rife4.25-heavy", "rife4.25", "rife4.25-heavy-tensorrt", "rife4.25-tensorrt"];
      var validUpscale = ["adore", "fallin_soft"];
      
      if (state.interpolation && state.interpolation.model) {
        if (validInterp.indexOf(state.interpolation.model) === -1) return false;
      }
      if (state.upscale && state.upscale.model) {
        if (validUpscale.indexOf(state.upscale.model) === -1) return false;
      }
      if (state.python && state.python.path) {
        if (!this._validatePythonPath(state.python.path)) return false;
      }
      return true;
    },

    _validatePythonPath: function (pPath) {
      if (!pPath) return false;
      if (pPath === "python" || pPath === "python3") return true;
      
      if (pPath.indexOf("\\\\") === 0 || pPath.indexOf("//") === 0) {
        return false;
      }
      
      var lower = pPath.toLowerCase();
      var exeName = lower.split(/[\\\/]/).pop();
      if (exeName === "python.exe" || exeName === "python3.exe") {
        return true;
      }
      return false;
    },

    _showSectionPicker: function (name, description) {
      var self = this;
      var overlay = document.getElementById("sectionModal");
      var togglesEl = document.getElementById("sectionToggles");
      var okBtn = document.getElementById("sectionOk");
      var allBtn = document.getElementById("sectionSelectAll");
      var noneBtn = document.getElementById("sectionSelectNone");

      if (!overlay || !togglesEl) {
        
        self._savePreset(name, description);
        return;
      }

      var sections = [
        { key: "interpolation", icon: "fa-forward", label: "Interpolation" },
        { key: "upscale", icon: "fa-expand", label: "Upscale" },
        { key: "deadframes", icon: "fa-scissors", label: "Deadframes" },
        { key: "output", icon: "fa-folder", label: "Output" },
        { key: "python", icon: "fa-python", label: "Python" }
      ];

      var html = "";
      for (var i = 0; i < sections.length; i++) {
        var s = sections[i];
        html +=
          '<label class="section-toggle-row">' +
            '<i class="fa-solid ' + s.icon + '"></i>' +
            '<span class="section-toggle-label">' + s.label + '</span>' +
            '<input type="checkbox" class="toggle-input section-check" data-key="' + s.key + '" checked>' +
            '<span class="toggle-switch"></span>' +
          '</label>';
      }
      togglesEl.innerHTML = html;
      overlay.style.display = "flex";

      function getSelected() {
        var checks = togglesEl.querySelectorAll(".section-check:checked");
        var keys = [];
        for (var j = 0; j < checks.length; j++) {
          keys.push(checks[j].getAttribute("data-key"));
        }
        return keys;
      }

      function close() {
        overlay.style.display = "none";
        okBtn.removeEventListener("click", onSave);
        allBtn.removeEventListener("click", onAll);
        noneBtn.removeEventListener("click", onNone);
        overlay.removeEventListener("click", onClickOutside);
        document.removeEventListener("keydown", onKey);
      }

      function onSave() {
        var keys = getSelected();
        close();
        if (keys.length > 0) self._savePreset(name, description, keys);
      }

      function onAll() {
        var checks = togglesEl.querySelectorAll(".section-check");
        for (var j = 0; j < checks.length; j++) checks[j].checked = true;
      }

      function onNone() {
        var checks = togglesEl.querySelectorAll(".section-check");
        for (var j = 0; j < checks.length; j++) checks[j].checked = false;
      }

      function onClickOutside(e) { if (e.target === overlay) close(); }

      function onKey(e) {
        if (e.key === "Escape") close();
      }

      okBtn.addEventListener("click", onSave);
      allBtn.addEventListener("click", onAll);
      noneBtn.addEventListener("click", onNone);
      overlay.addEventListener("click", onClickOutside);
      document.addEventListener("keydown", onKey);
    },

    _savePreset: function (name, description, sections) {
      var fullState = this._captureState();
      var state = {};
      var keys = sections || Object.keys(fullState);
      for (var i = 0; i < keys.length; i++) {
        var k = keys[i];
        if (fullState[k] !== undefined) state[k] = fullState[k];
      }
      var data = {
        _meta: {
          version: "1.0", name: name, description: description || "",
          author: "", created: new Date().toISOString(), application: "AniSmooth"
        },
        settings: state
      };
      if (this._savePresetFile(name, data)) {
        this._activePreset = name;
        this._renderPresetList();
        dbg("info", "Presets", "Saved & active: " + name);
      }
    },

    _loadPresets: function () {
      var presets = {};
      try {
        var dir = this._presetsDir;
        if (!window.FileSystem.fs.existsSync(dir)) return presets;
        var files = window.FileSystem.fs.readdirSync(dir);
        for (var i = 0; i < files.length; i++) {
          var f = files[i];
          if (!f.endsWith(".json")) continue;
          try {
            var raw = window.FileSystem.fs.readFileSync(window.FileSystem.path.join(dir, f), "utf8");
            var name = f.replace(".json", "");
            presets[name] = JSON.parse(raw);
          } catch (e) {}
        }
      } catch (e) {}
      return presets;
    },

    _savePresetFile: function (name, data) {
      try {
        var dir = this._presetsDir;
        window.FileSystem.createFolder(dir);
        var filePath = window.FileSystem.path.join(dir, name.replace(/[^a-zA-Z0-9_-]/g, "_") + ".json");
        window.FileSystem.fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
        return true;
      } catch (e) {
        dbg("error", "Presets", "Save failed: " + (e.message || e));
        return false;
      }
    },

    _deletePresetFile: function (name) {
      try {
        var filePath = window.FileSystem.path.join(this._presetsDir, name.replace(/[^a-zA-Z0-9_-]/g, "_") + ".json");
        if (window.FileSystem.fs.existsSync(filePath)) {
          window.FileSystem.fs.unlinkSync(filePath);
        }
        return true;
      } catch (e) { return false; }
    },

    _autoSavePreset: function () {
      if (!this._activePreset) return;
      try {
        var data = this._captureState();
        
        var existing = this._loadPresets()[this._activePreset] || {};
        var meta = existing._meta || {};
        existing.settings = data;
        existing._meta = meta;
        existing._meta.modified = new Date().toISOString();
        this._savePresetFile(this._activePreset, existing);
      } catch (e) {}
    },

    _deletePreset: function (name) {
      if (this._activePreset === name) this._activePreset = null;
      this._deletePresetFile(name);
      this._renderPresetList();
      dbg("info", "Presets", "Deleted: " + name);
    },

    _exportPreset: function (name) {
      var presets = this._loadPresets();
      var preset = presets[name];
      if (!preset) return;
      var json = JSON.stringify(preset, null, 2);
      var ts = new Date().toISOString().replace(/[:.]/g, "-").substring(0, 19);
      var safeName = name.replace(/[^a-zA-Z0-9_-]/g, "_");
      var filename = "AniSmooth_" + safeName + "_" + ts + ".preset.json";
      try {
        var outDir = this.settings.outputPath || (window.FileSystem.os ? window.FileSystem.os.homedir() : "");
        var filePath = window.FileSystem.path.join(outDir, filename);
        window.FileSystem.fs.writeFileSync(filePath, json, "utf8");
        window.FileSystem.childProcess.execFile('explorer.exe', ['/select,' + filePath]);
        dbg("info", "Presets", "Exported: " + filePath);
      } catch (e) {
        dbg("error", "Presets", "Export failed: " + (e.message || e));
      }
    },

    _importPreset: function () {
      var self = this;
      try {
        var extPath = "";
        try { var csi = new CSInterface(); extPath = csi.getSystemPath(SystemPath.EXTENSION); } catch (e) {}
        var psCmd = 'Add-Type -AssemblyName System.Windows.Forms; $f = New-Object System.Windows.Forms.OpenFileDialog; $f.Filter = "JSON Files (*.json)|*.json|All Files (*.*)|*.*"; $f.Title = "Import AniSmooth Preset"; if ($f.ShowDialog() -eq "OK") { $f.FileName }';
        var proc = window.FileSystem.childProcess.exec('powershell -Command "' + psCmd + '"', function (err, stdout) {
          if (err) { dbg("error", "Presets", "Import dialog error: " + (err.message || err)); return; }
          var filePath = (stdout || "").trim();
          if (!filePath || !window.FileSystem.fs.existsSync(filePath)) return;
          try {
            var raw = window.FileSystem.fs.readFileSync(filePath, "utf8");
            var preset = JSON.parse(raw);
            if (!self._validatePreset(preset)) {
              dbg("error", "Presets", "Rejected invalid/unsafe preset file during import");
              window.showToast("Import failed: Preset contains invalid or unsafe values.", "error");
              return;
            }
            var defName = filePath.split("\\").pop().replace(/\.(preset\.)?json$/i, "").replace(/^AniSmooth_/, "");
            window.showPrompt("Import Preset", "Preset name...", "", function (name) {
              if (!name) return;
              self._savePresetFile(name, preset);
              self._renderPresetList();
              dbg("info", "Presets", "Imported: " + name);
            }, defName);
          } catch (e) {
            dbg("error", "Presets", "Import failed: " + (e.message || e));
          }
        });
      } catch (e) {
        dbg("error", "Presets", "Import failed: " + (e.message || e));
      }
    },

    _renderPresetList: function () {
      var el = document.getElementById("presetList");
      if (!el) return;
      var presets = this._loadPresets();
      var names = [];
      for (var k in presets) { if (presets.hasOwnProperty(k)) names.push(k); }
      names.sort();

      if (names.length === 0) {
        el.innerHTML = '<div class="preset-empty"><i class="fa-solid fa-bookmark"></i><span>No saved presets yet</span></div>';
        return;
      }

      var self = this;
      var html = "";
      for (var i = 0; i < names.length; i++) {
        var name = names[i];
        var p = presets[name];
        
        var meta = p._meta || {};
        var state = p.settings || p;
        var displayName = meta.name || name;
        var desc = meta.description || "";

        var tags = "";
        if (state.interpolation) tags += '<span class="preset-dot preset-dot-i" title="Interpolation"></span>';
        if (state.upscale) tags += '<span class="preset-dot preset-dot-u" title="Upscale"></span>';
        if (state.deadframes) tags += '<span class="preset-dot preset-dot-d" title="Deadframes"></span>';
        if (state.output) tags += '<span class="preset-dot preset-dot-o" title="Output"></span>';
        if (state.python) tags += '<span class="preset-dot preset-dot-p" title="Python"></span>';

        var date = meta.created ? new Date(meta.created).toLocaleDateString() : "";

        html +=
            '<div class="preset-row' + (name === self._activePreset ? ' preset-active' : '') + '">' +
            '<i class="fa-solid fa-bookmark preset-row-icon"></i>' +
            '<div class="preset-row-body">' +
              '<span class="preset-row-name' + (name === self._activePreset ? ' active-preset' : '') + '">' + esc(displayName) + '</span>' +
              (desc ? '<span class="preset-row-desc">' + esc(desc) + '</span>' : '') +
              '<span class="preset-row-tags">' + tags + '</span>' +
            '</div>' +
            (date ? '<span class="preset-row-date">' + date + '</span>' : '') +
            '<div class="preset-row-actions">' +
              '<button class="btn-sm preset-load" data-name="' + escAttr(name) + '" title="Load"><i class="fa-solid fa-play"></i></button>' +
              '<button class="btn-sm preset-export" data-name="' + escAttr(name) + '" title="Export"><i class="fa-solid fa-file-export"></i></button>' +
              '<button class="btn-sm preset-delete" data-name="' + escAttr(name) + '" title="Delete"><i class="fa-solid fa-trash"></i></button>' +
            '</div>' +
          '</div>';
      }
      el.innerHTML = html;

      var cards = el.querySelectorAll(".preset-row");
      for (var j = 0; j < cards.length; j++) {
        (function (card) {
          var loadBtn = card.querySelector(".preset-load");
          var exportBtn = card.querySelector(".preset-export");
          var deleteBtn = card.querySelector(".preset-delete");
          if (loadBtn) loadBtn.addEventListener("click", function () {
            var n = this.getAttribute("data-name");
            var p = self._loadPresets()[n];
            if (p) { self._applyState(p); self._activePreset = n; dbg("info", "Presets", "Loaded: " + n); }
          });
          if (exportBtn) exportBtn.addEventListener("click", function () {
            self._exportPreset(this.getAttribute("data-name"));
          });
          if (deleteBtn) deleteBtn.addEventListener("click", function () {
            var n = this.getAttribute("data-name");
            if (n) self._deletePreset(n);
          });
        })(cards[j]);
      }

      function esc(s) { return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
      function escAttr(s) { return String(s || "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
    }
  };

  function formatMb(bytes) {
    if (bytes < 1024) return bytes + " MB";
    return (bytes / 1024).toFixed(1) + " GB";
  }

  function envEsc(s) {
    return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function escTxt(s) { return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }

  window.showConfirm = function (message, onConfirm) {
    var overlay = document.getElementById("confirmModal");
    var msgEl = document.getElementById("confirmMsg");
    var cancelBtn = document.getElementById("confirmCancel");
    var okBtn = document.getElementById("confirmOk");

    if (!overlay || !msgEl) return;

    msgEl.textContent = message;
    overlay.style.display = "flex";

    function close() {
      overlay.style.display = "none";
      cancelBtn.removeEventListener("click", onCancel);
      okBtn.removeEventListener("click", onAccept);
      overlay.removeEventListener("click", onClickOutside);
      document.removeEventListener("keydown", onKey);
    }

    function onAccept() {
      close();
      if (onConfirm) onConfirm();
    }

    function onCancel() {
      close();
    }

    function onClickOutside(e) {
      if (e.target === overlay) close();
    }

    function onKey(e) {
      if (e.key === "Escape") close();
      if (e.key === "Enter") onAccept();
    }

    cancelBtn.addEventListener("click", onCancel);
    okBtn.addEventListener("click", onAccept);
    overlay.addEventListener("click", onClickOutside);
    document.addEventListener("keydown", onKey);
    okBtn.focus();
  };

  window.showPrompt = function (title, placeholder, descPlaceholder, onSave, defaultValue) {
    var overlay = document.getElementById("promptModal");
    var titleEl = document.getElementById("promptTitle");
    var inputEl = document.getElementById("promptInput");
    var descEl = document.getElementById("promptDesc");
    var cancelBtn = document.getElementById("promptCancel");
    var okBtn = document.getElementById("promptOk");

    if (!overlay || !inputEl) return;

    titleEl.textContent = title || "Enter name";
    inputEl.value = defaultValue || "";
    inputEl.placeholder = placeholder || "Name...";
    descEl.placeholder = descPlaceholder || "Description (optional)";
    descEl.value = "";
    overlay.style.display = "flex";
    inputEl.focus();
    inputEl.select();

    function close() {
      overlay.style.display = "none";
      cancelBtn.removeEventListener("click", onCancel);
      okBtn.removeEventListener("click", onAccept);
      overlay.removeEventListener("click", onClickOutside);
      document.removeEventListener("keydown", onKey);
    }

    function onAccept() {
      var name = inputEl.value.trim();
      if (!name) return;
      close();
      if (onSave) onSave(name, descEl.value.trim());
    }

    function onCancel() { close(); }

    function onClickOutside(e) { if (e.target === overlay) close(); }

    function onKey(e) {
      if (e.key === "Escape") close();
      if (e.key === "Enter") onAccept();
    }

    cancelBtn.addEventListener("click", onCancel);
    okBtn.addEventListener("click", onAccept);
    overlay.addEventListener("click", onClickOutside);
    document.addEventListener("keydown", onKey);
  };

  window.showToast = function (msg, type) {
    var toast = document.getElementById("toast");
    var icon = document.getElementById("toastIcon");
    var text = document.getElementById("toastMsg");
    var close = document.getElementById("toastClose");
    if (!toast || !text) return;

    
    if (toast._timer) clearTimeout(toast._timer);

    text.textContent = msg;
    toast.className = "toast " + (type === "error" ? "toast-err" : type === "ok" ? "toast-ok" : "");
    if (icon) { icon.className = "fa-solid " + (type === "error" ? "fa-circle-xmark" : type === "ok" ? "fa-circle-check" : "fa-circle-info"); }
    toast.style.display = "flex";

    if (close) {
      close.onclick = function () { toast.style.display = "none"; };
    }

    toast._timer = setTimeout(function () { toast.style.display = "none"; }, 4000);
  };

  window.changeGpuMode = function (mode) {
    var currentMode = window.StorageManager.getItem("anismooth_gpu_choice", null);
    if (mode === currentMode) return;

    if (mode === "gpu") {
      window.showConfirm(
        "Switch to GPU mode? This will install PyTorch CUDA (~2.5GB download). The panel may be unresponsive during installation.",
        function () {
          window.StorageManager.setItem("anismooth_gpu_choice", "gpu");
          if (window.ToolsSetup && window.ToolsSetup.showToolsSetupForGpuInstall) {
            window.ToolsSetup.showToolsSetupForGpuInstall();
          }
        }
      );
    } else {
      window.StorageManager.setItem("anismooth_gpu_choice", "cpu");
      window.showToast("Switched to CPU mode. GPU acceleration disabled.", "ok");
      if (window.App && window.App._buildGpuModeSelector) {
        window.App._buildGpuModeSelector();
      }
    }
  };

  var Stopwatch = {
    elapsed: 0,
    running: false,
    _startTs: 0,
    _timer: null,

    init: function () {
      this.elapsed = parseFloat(window.StorageManager.getItem("anismooth_stopwatch_elapsed", "0")) || 0;
      var autoStart = window.StorageManager.getItem("anismooth_stopwatch_autostart", "0") === "1";
      this.render();
      if (autoStart) this.start();
      this.bindEvents();
    },

    bindEvents: function () {
      var self = this;
      var toggle = document.getElementById("stopwatchToggle");
      var reset = document.getElementById("stopwatchReset");
      var autostart = document.getElementById("stopwatchAutostart");
      if (toggle) toggle.addEventListener("click", function () { self.toggle(); });
      if (reset) reset.addEventListener("click", function () { self.reset(); });
      if (autostart) {
        autostart.checked = window.StorageManager.getItem("anismooth_stopwatch_autostart", "0") === "1";
        autostart.addEventListener("change", function () {
          window.StorageManager.setItem("anismooth_stopwatch_autostart", this.checked ? "1" : "0");
        });
      }
    },

    toggle: function () {
      if (this.running) this.stop();
      else this.start();
    },

    start: function () {
      if (this.running) return;
      this.running = true;
      this._startTs = Date.now() - this.elapsed;
      var self = this;
      var view = document.getElementById("stopwatchView");
      var btn = document.getElementById("stopwatchToggle");
      if (view) view.classList.add("stopwatch-view", "running");
      if (btn) btn.innerHTML = '<i class="fa-solid fa-pause"></i> Pause';
      this._timer = setInterval(function () { self.tick(); }, 100);
    },

    stop: function () {
      if (!this.running) return;
      this.running = false;
      if (this._timer) { clearInterval(this._timer); this._timer = null; }
      this.elapsed = Date.now() - this._startTs;
      this.save();
      var view = document.getElementById("stopwatchView");
      var btn = document.getElementById("stopwatchToggle");
      if (view) view.classList.remove("running");
      if (btn) btn.innerHTML = '<i class="fa-solid fa-play"></i> Start';
      this.render();
    },

    reset: function () {
      this.elapsed = 0;
      if (this.running) this._startTs = Date.now();
      this.save();
      this.render();
    },

    tick: function () {
      if (!this.running) return;
      this.elapsed = Date.now() - this._startTs;
      this.render();
    },

    render: function () {
      var el = document.getElementById("stopwatchTime");
      if (!el) return;
      var ms = Math.max(0, this.elapsed);
      var h = Math.floor(ms / 3600000);
      var m = Math.floor((ms % 3600000) / 60000);
      var s = Math.floor((ms % 60000) / 1000);
      el.textContent = pad2(h) + ":" + pad2(m) + ":" + pad2(s);
    },

    save: function () {
      window.StorageManager.setItem("anismooth_stopwatch_elapsed", String(this.elapsed));
    }
  };

  function pad2(n) { return n < 10 ? "0" + n : "" + n; }

  window.Stopwatch = Stopwatch;

  window.addEventListener("DOMContentLoaded", function () {
    App.init();
    window.App = App;
    if (window.Stopwatch) window.Stopwatch.init();
  });
})();
