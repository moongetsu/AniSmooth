(function () {
  var QueueManager = {
    _queue: [],
    _running: false,
    _paused: false,
    _currentProc: null,
    _renderBusy: false,
    _listeners: [],

    init: function () {
      if (this._loaded) return;
      this._loaded = true;
      var saved = window.StorageManager.loadProcessingQueue();
      for (var i = 0; i < saved.length; i++) {
        var item = saved[i];
        // Restart anything that was mid-flight. A pre-rendered temp input may no
        // longer exist after a restart, so drop it and let the item re-render
        // from the AE selection/layer index when it reaches the front.
        if (item.status === "processing" || item.status === "rendering") {
          item.status = "queued";
          delete item.progress;
          delete item.startedAt;
          delete item.elapsed;
        }
        if (item.isTemp) {
          delete item.inputPath;
          delete item.isTemp;
          delete item.renderName;
        }
        this._queue.push(item);
      }
      if (this._queue.length > 0) {
        dbg("info", "Queue", "Restored " + this._queue.length + " queued item(s)");
      }
      this._notify();
      if (!this._paused) this._processNext();
    },

    _autoSave: function () {
      var clean = [];
      for (var i = 0; i < this._queue.length; i++) {
        var item = this._queue[i];
        var copy = {};
        for (var k in item) {
          if (item.hasOwnProperty(k) && typeof item[k] !== "function") {
            copy[k] = item[k];
          }
        }
        clean.push(copy);
      }
      window.StorageManager.saveProcessingQueue(clean);
    },

    add: function (item) {
      var validModes = { upscale: true, interpolate: true, dedupe: true, flowframes: true };
      if (!item.mode || !validModes[item.mode]) {
        dbg("error", "Queue", "Rejected: unknown mode '" + (item.mode || "undefined") + "'");
        if (window.showToast) window.showToast("Invalid queue mode: " + (item.mode || "undefined"), "error");
        return;
      }
      if (!item.name) {
        dbg("error", "Queue", "Rejected: missing name");
        if (window.showToast) window.showToast("Queue item missing name", "error");
        return;
      }
      item.id = Date.now() + "_" + Math.random().toString(36).substr(2, 5);
      // Pre-render the AE clip immediately at enqueue time so the correct layer/
      // clip is captured NOW (the AE selection may change before this job's turn,
      // especially when added while another job is still running). The model runs
      // later from this stored render when the item reaches the front of the queue.
      item.status = "rendering";
      this._queue.push(item);
      dbg("info", "Queue", "Added: " + item.name + " (" + item.task + ", " + (item.factor || item.scale) + "x) - pre-rendering");
      this._notify();
      this._pumpRender();
    },

    getAll: function () {
      return this._queue;
    },

    getProcessing: function () {
      for (var i = 0; i < this._queue.length; i++) {
        if (this._queue[i].status === "processing") return this._queue[i];
      }
      return null;
    },

    isRunning: function () {
      return this._running;
    },

    isPaused: function () {
      return this._paused;
    },

    togglePause: function () {
      this._paused = !this._paused;
      if (this._paused) {
        for (var i = 0; i < this._queue.length; i++) {
          if (this._queue[i].status === "processing") {
            this._queue[i].status = "queued";
            this._queue[i].progress = 0;
          }
        }
        if (this._currentProc) {
          window.ModelHandler.cancelActiveProcess();
          this._currentProc = null;
        }
        this._running = false;
        dbg("info", "Queue", "Processing paused");
      } else {
        dbg("info", "Queue", "Processing resumed");
        this._processNext();
      }
      this._notify();
    },

    remove: function (id) {
      for (var i = 0; i < this._queue.length; i++) {
        if (this._queue[i].id === id && (this._queue[i].status === "queued" || this._queue[i].status === "rendering")) {
          // If a render is in flight for this item it can't be aborted mid-render;
          // splicing detaches it so the pump's callback becomes a harmless no-op.
          this._queue.splice(i, 1);
          this._notify();
          return true;
        }
      }
      return false;
    },

    cancelItem: function () {
      var item = this.getProcessing();
      if (!item) return false;
      if (this._currentProc) {
        this._cancelActive();
        this._currentProc = null;
      }
      item.status = "cancelled";
      this._running = false;
      dbg("warn", "Queue", "Cancelled: " + item.name);
      this._notify();
      this._processNext();
      return true;
    },

    cancelAll: function () {
      if (this._currentProc) {
        this._cancelActive();
        this._currentProc = null;
      }
      this._paused = false;
      for (var i = 0; i < this._queue.length; i++) {
        if (this._queue[i].status === "queued" || this._queue[i].status === "rendering") {
          this._queue[i].status = "cancelled";
        }
      }
      this._running = false;
      this._notify();
      dbg("warn", "Queue", "All jobs cancelled");
    },

    clearDone: function () {
      this._queue = this._queue.filter(function (item) {
        return item.status === "queued" || item.status === "processing";
      });
      this._notify();
    },

    _cancelActive: function () {
      if (this._currentMode === "flowframes") {
        if (window.FlowframesHandler) window.FlowframesHandler.cancel();
      } else if (window.ModelHandler) {
        window.ModelHandler.cancelActiveProcess();
      }
    },

    onUpdate: function (fn) {
      this._listeners.push(fn);
    },

    _notify: function () {
      this._autoSave();
      for (var i = 0; i < this._listeners.length; i++) {
        try { this._listeners[i](this._queue); } catch (e) {}
      }
    },

    _processNext: function () {
      var self = this;
      if (this._running) return;
      if (this._paused) {
        this._running = false;
        this._notify();
        return;
      }
      if (this._queue.length === 0) {
        this._running = false;
        this._notify();
        return;
      }

      var pending = null;
      for (var i = 0; i < this._queue.length; i++) {
        if (this._queue[i].status === "queued") {
          pending = this._queue[i];
          break;
        }
      }
      if (!pending) {
        this._running = false;
        this._notify();
        return;
      }

      this._running = true;
      pending.status = "processing";
      this._notify();

      this._beginModel(pending);
    },

    // Render pump - serialises AE renders so an enqueue-time pre-render never
    // overlaps another (AE's render queue is single-threaded). Runs independently
    // of the model worker, so a clip can pre-render while a previous job's model
    // is still processing.
    _pumpRender: function () {
      var self = this;
      if (this._renderBusy) return;
      var target = null;
      for (var i = 0; i < this._queue.length; i++) {
        if (this._queue[i].status === "rendering") { target = this._queue[i]; break; }
      }
      if (!target) return;

      this._renderBusy = true;
      this._doAERender(target, function (res) {
        self._renderBusy = false;
        // Item may have been removed or cancelled while rendering - only apply
        // the result if it is still present and awaiting this render.
        var stillRendering = false;
        for (var j = 0; j < self._queue.length; j++) {
          if (self._queue[j] === target && target.status === "rendering") { stillRendering = true; break; }
        }
        if (stillRendering) {
          if (!res.ok) {
            target.status = "error";
            target.error = "Render failed: " + (res.message || "Unknown rendering error");
          } else {
            target.inputPath = res.filePath;
            target.isTemp = res.isTemp;
            target.renderName = res.name || target.name;
            target.status = "queued";
            dbg("success", "Queue", "Pre-rendered: " + target.name);
          }
          self._notify();
        }
        self._pumpRender();
        if (!self._running && !self._paused) self._processNext();
      });
    },

    // Runs the AE render for an item and returns a normalised result to cb.
    // Falls back to the currently-selected layer's file if the render fails.
    _doAERender: function (item, cb) {
      var renderDir = (window.App && window.App.settings.outputPath) || (window.FileSystem && window.FileSystem.os ? window.FileSystem.os.homedir() : "");
      var escapedDir = String(renderDir || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
      var escapedName = String(item.name || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
      var layerIdx = item.layerIndex || 0;

      window.__adobe_cep__.evalScript('renderSelectedLayer("' + escapedDir + '", "' + escapedName + '", ' + layerIdx + ')', function (renderResult) {
        var res = {};
        try { res = JSON.parse(renderResult || "{}"); } catch (e) {}
        if (res.ok) { cb(res); return; }
        var renderError = res.message || "Unknown rendering error";
        window.__adobe_cep__.evalScript("getSelectedLayerFile()", function (fb) {
          var fbRes = {};
          try { fbRes = JSON.parse(fb || "{}"); } catch (e) {}
          if (fbRes.ok && fbRes.filePath) { cb(fbRes); return; }
          cb({ ok: false, message: renderError });
        });
      });
    },

    // Start the model for an item that should already hold a pre-rendered input.
    // If the input is missing (e.g. restored from storage), render on demand.
    _beginModel: function (item) {
      var self = this;
      var haveInput = item.inputPath &&
        (!window.FileSystem || !window.FileSystem.fs || window.FileSystem.fs.existsSync(item.inputPath));
      if (haveInput) {
        self._runModel(item, { ok: true, filePath: item.inputPath, isTemp: item.isTemp, name: item.renderName || item.name });
        return;
      }
      this._doAERender(item, function (res) {
        if (!res.ok) {
          item.status = "error";
          item.error = "Render failed: " + (res.message || "Unknown rendering error");
          self._notify();
          self._running = false;
          self._processNext();
          return;
        }
        self._runModel(item, res);
      });
    },

    _runModel: function (item, res) {
      var self = this;
      var inputPath = res.filePath;
      if (window.FileSystem && window.FileSystem.fs && !window.FileSystem.fs.existsSync(inputPath)) {
        item.status = "error";
        item.error = "File not found";
        self._notify();
        self._running = false;
        self._processNext();
        return;
      }

      var ext = window.FileSystem.getExtension(inputPath);
      if (item.mode === "flowframes") ext = "mp4";
      var nameWithoutExt = window.FileSystem.getFileNameWithoutExtension(inputPath);
      var outputName = res.isTemp ? nameWithoutExt.replace(/^AniSmooth_Render_\d+_?/, "") : nameWithoutExt;
      var outDir = (window.App && window.App.settings.outputPath) || window.FileSystem.os.homedir();
      var modeFolder = item.mode === "upscale" ? "Upscaled" : (item.mode === "dedupe" ? "Deduped" : (item.mode === "flowframes" ? "Flowframes" : "Interpolated"));
      var modeDir = window.FileSystem.path.join(outDir, modeFolder);
      var prerenderDir = window.FileSystem.path.join(outDir, "PreRenders");
      window.FileSystem.createFolder(modeDir);
      window.FileSystem.createFolder(prerenderDir);
      var suffix = item.mode === "upscale" ? "_upscaled_" : (item.mode === "dedupe" ? "_deduped" : (item.mode === "flowframes" ? "_flowframes_" : "_interpolated_"));
      var scaleKey = item.mode === "upscale" ? item.scale : item.factor;
      var settings = (window.App && window.App.settings) || {};
      var prefix = (settings.outputPrefix || "AniSmooth") + "_";
      var ts = settings.outputTimestamp !== false
        ? "_" + new Date().toISOString().replace(/[:.]/g, "-").substring(0, 19)
        : "";
      var baseName = prefix + outputName + suffix + (item.mode === "dedupe" ? "" : scaleKey + "x") + ts;
      var outputPath = window.FileSystem.path.join(modeDir, baseName + "." + ext);

      
      (function () {
        try {
          var inputSize = window.FileSystem.fs.statSync(inputPath).size || 0;
          if (!inputSize) return;
          var mult = item.mode === "upscale" ? (item.scale * item.scale) : (item.mode === "dedupe" ? 0.7 : (item.factor || 2));
          var estimated = inputSize * mult * 1.6;
          var driveLetter = outputPath[0] || "C";
          var freeBytes = 0;
          if (window.FileSystem && window.FileSystem.childProcess) {
            try {
              var ps = window.FileSystem.childProcess.execFileSync("powershell.exe", [
                "-NoProfile", "-Command",
                "(Get-PSDrive -Name '" + driveLetter + "').Free"
              ], { encoding: "utf8", windowsHide: true });
              freeBytes = parseInt(ps, 10) || 0;
            } catch (e2) {}
          }
          if (freeBytes && freeBytes < estimated) {
            var freeGB = (freeBytes / (1024 * 1024 * 1024)).toFixed(1);
            var estGB = (estimated / (1024 * 1024 * 1024)).toFixed(1);
            dbg("warn", "Queue", "Low disk space on " + driveLetter + ": " + freeGB + " GB free, ~" + estGB + " GB estimated");
            if (window.showToast) window.showToast("Low disk space: " + freeGB + " GB free, ~" + estGB + " GB needed on " + driveLetter + ":", "error");
          }
        } catch (e) {}
      })();

      var preRenderPath = null;
      if (res.isTemp && window.FileSystem && window.FileSystem.fs && window.FileSystem.path && settings.outputKeepPrerender !== false) {
        preRenderPath = window.FileSystem.path.join(prerenderDir, prefix + outputName + "_prerender" + ts + "." + ext);
        try {
          window.FileSystem.fs.copyFileSync(inputPath, preRenderPath);
          dbg("info", "Queue", "Pre-render saved: " + preRenderPath);
        } catch (e) {
          dbg("warn", "Queue", "Could not save pre-render: " + e.message);
          preRenderPath = null;
        }
      }

      var callbacks = {
        onStart: function () {
          self._currentMode = item.mode;
          self._currentProc = item.mode === "flowframes" ? window.FlowframesHandler.activeProcess : window.ModelHandler.activeProcess;
          item.startedAt = Date.now();
          item.elapsed = 0;
        },
        onProgress: function (p) {
          item.progress = p;
          if (item.startedAt) item.elapsed = Date.now() - item.startedAt;
          self._notify();
        },
        onLog: function (l) {
          try {
            var parsed = JSON.parse(l);
            var level = parsed.type === 'error' ? 'error' : (parsed.type === 'warn' ? 'warn' : (parsed.type === 'success' ? 'success' : 'debug'));
            dbg(level, "Queue-Engine", parsed.msg || l, item.mode);
          } catch (e) {
            dbg("debug", "Queue-Engine", l, item.mode);
          }
        },
        onComplete: function (producedPath) {
          self._currentProc = null;
          if (producedPath && producedPath !== outputPath && window.FileSystem && window.FileSystem.fs) {
            try {
              window.FileSystem.fs.renameSync(producedPath, outputPath);
            } catch (e) {
              try {
                window.FileSystem.fs.copyFileSync(producedPath, outputPath);
                window.FileSystem.fs.unlinkSync(producedPath);
              } catch (e2) {
                outputPath = producedPath;
              }
            }
          }
          item.status = "done";
          item.progress = 100;
          if (item.startedAt) item.elapsed = Date.now() - item.startedAt;
          dbg("success", "Queue", "Done: " + outputPath + " (" + formatDuration(item.elapsed) + ")");
          
          if (res.isTemp && window.FileSystem && window.FileSystem.fs) {
            try { window.FileSystem.fs.unlinkSync(inputPath); } catch (e) {}
          }
          
          if (settings.outputAutoImport !== false) {
            window.App.importFileToAfterEffects(outputPath);
          }
          
          
          item.outputPath = outputPath;
          item.preRenderPath = preRenderPath;
          self._notify();
          self._running = false;
          self._processNext();
        },
        onError: function (err) {
          self._currentProc = null;
          if (item.status === "cancelled" || item.status === "done") {
            self._notify();
            return;
          }
          if (self._paused && item.status === "queued") {
            dbg("info", "Queue", "Paused - item queued for retry");
            self._notify();
            return;
          }
          item.status = "error";
          item.error = err;
          if (item.startedAt) item.elapsed = Date.now() - item.startedAt;
          dbg("error", "Queue", "Error: " + err);
          if (res.isTemp && window.FileSystem && window.FileSystem.fs) {
            try { window.FileSystem.fs.unlinkSync(inputPath); } catch (e) {}
          }
          if (window.App && window.App.settings.outputCleanupFailed !== false && outputPath && window.FileSystem && window.FileSystem.fs) {
            try { window.FileSystem.fs.unlinkSync(outputPath); } catch (e) {}
          }
          self._notify();
          self._running = false;
          self._processNext();
        }
      };

      if (item.mode === "upscale") {
        window.ModelHandler.upscaleClip(inputPath, outputPath, item.model, { scale: String(item.scale), targetSizeMb: item.targetSizeMb || 0, preset: item.preset || "high", fitW: item.fitW || 0, fitH: item.fitH || 0 }, callbacks);
      } else if (item.mode === "dedupe") {
        window.ModelHandler.dedupeClip(inputPath, outputPath, item.threshold || 0.05, item.options || {}, callbacks);
      } else if (item.mode === "interpolate") {
        window.ModelHandler.interpolateClip(inputPath, outputPath, item.model, { fpsFactor: String(item.factor), targetSizeMb: item.targetSizeMb || 0, preset: item.preset || "high" }, callbacks);
      } else if (item.mode === "flowframes") {
        var jobOutDir = window.FileSystem.path.join(modeDir, ".ff_" + item.id);
        window.FileSystem.createFolder(jobOutDir);
        window.FlowframesHandler.run(inputPath, jobOutDir, {
          factor: item.factor,
          ai: item.ai,
          model: item.model,
          format: item.format,
          encoder: item.encoder,
          pixFmt: item.pixFmt
        }, callbacks);
      } else {
        item.status = "error";
        item.error = "Unknown queue mode: " + (item.mode || "undefined");
        self._notify();
        self._running = false;
        self._processNext();
      }
    }
  };

  function formatDuration(ms) {
    if (!ms || ms < 0) return "0s";
    var s = Math.floor(ms / 1000);
    if (s < 60) return s + "s";
    var m = Math.floor(s / 60);
    s = s % 60;
    if (m < 60) return m + "m " + s + "s";
    var h = Math.floor(m / 60);
    m = m % 60;
    return h + "h " + m + "m";
  }

  window.QueueManager = QueueManager;
})();
