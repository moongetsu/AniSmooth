(function () {
  var QueueManager = {
    _queue: [],
    _running: false,
    _currentProc: null,
    _listeners: [],

    add: function (item) {
      item.id = Date.now() + "_" + Math.random().toString(36).substr(2, 5);
      item.status = "queued";
      this._queue.push(item);
      dbg("info", "Queue", "Added: " + item.name + " (" + item.task + ", " + (item.factor || item.scale) + "x)");
      this._notify();
      if (!this._running) this._processNext();
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

    remove: function (id) {
      for (var i = 0; i < this._queue.length; i++) {
        if (this._queue[i].id === id && this._queue[i].status === "queued") {
          this._queue.splice(i, 1);
          this._notify();
          return true;
        }
      }
      return false;
    },

    cancelAll: function () {
      if (this._currentProc) {
        window.ModelHandler.cancelActiveProcess();
        this._currentProc = null;
      }
      for (var i = 0; i < this._queue.length; i++) {
        if (this._queue[i].status === "queued") {
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

    onUpdate: function (fn) {
      this._listeners.push(fn);
    },

    _notify: function () {
      for (var i = 0; i < this._listeners.length; i++) {
        try { this._listeners[i](this._queue); } catch (e) {}
      }
    },

    _processNext: function () {
      var self = this;
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

      this._render(pending);
    },

    _render: function (item) {
      var self = this;
      var renderDir = (window.App && window.App.settings.outputPath) || (window.FileSystem && window.FileSystem.os ? window.FileSystem.os.homedir() : "");
      var escapedDir = String(renderDir || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
      var escapedName = String(item.name || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"');

      var layerIdx = item.layerIndex || 0;
      window.__adobe_cep__.evalScript('renderSelectedLayer("' + escapedDir + '", "' + escapedName + '", ' + layerIdx + ')', function (renderResult) {
        var res = {};
        try { res = JSON.parse(renderResult || "{}"); } catch (e) {}
        if (!res.ok) {
          var renderError = res.message || "Unknown rendering error";
          window.__adobe_cep__.evalScript("getSelectedLayerFile()", function (fb) {
            var fbRes = {};
            try { fbRes = JSON.parse(fb || "{}"); } catch (e) {}
            if (!fbRes.ok || !fbRes.filePath) {
              item.status = "error";
              item.error = "Render failed: " + renderError;
              self._notify();
              self._processNext();
              return;
            }
            self._runModel(item, fbRes);
          });
        } else { self._runModel(item, res); }
      });
    },

    _runModel: function (item, res) {
      var self = this;
      var inputPath = res.filePath;
      if (window.FileSystem && window.FileSystem.fs && !window.FileSystem.fs.existsSync(inputPath)) {
        item.status = "error";
        item.error = "File not found";
        self._notify();
        self._processNext();
        return;
      }

      var ext = window.FileSystem.getExtension(inputPath);
      var nameWithoutExt = window.FileSystem.getFileNameWithoutExtension(inputPath);
      var outputName = res.isTemp ? nameWithoutExt.replace(/^AniSmooth_Render_\d+_?/, "") : nameWithoutExt;
      var outDir = (window.App && window.App.settings.outputPath) || window.FileSystem.os.homedir();
      var modeFolder = item.mode === "upscale" ? "Upscaled" : (item.mode === "dedupe" ? "Deduped" : "Interpolated");
      var modeDir = window.FileSystem.path.join(outDir, modeFolder);
      var prerenderDir = window.FileSystem.path.join(outDir, "PreRenders");
      window.FileSystem.createFolder(modeDir);
      window.FileSystem.createFolder(prerenderDir);
      var suffix = item.mode === "upscale" ? "_upscaled_" : (item.mode === "dedupe" ? "_deduped" : "_interpolated_");
      var scaleKey = item.mode === "upscale" ? item.scale : item.factor;
      var settings = (window.App && window.App.settings) || {};
      var prefix = (settings.outputPrefix || "AniSmooth") + "_";
      var ts = settings.outputTimestamp !== false
        ? "_" + new Date().toISOString().replace(/[:.]/g, "-").substring(0, 19)
        : "";
      var baseName = prefix + outputName + suffix + (item.mode === "dedupe" ? "" : scaleKey + "x") + ts;
      var outputPath = window.FileSystem.path.join(modeDir, baseName + "." + ext);

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
          self._currentProc = window.ModelHandler.activeProcess;
          item.startedAt = Date.now();
          item.elapsed = 0;
        },
        onProgress: function (p) {
          item.progress = p;
          if (item.startedAt) item.elapsed = Date.now() - item.startedAt;
          self._notify();
        },
        onLog: function (l) {
          dbg("debug", "Queue-Engine", l);
        },
        onComplete: function () {
          self._currentProc = null;
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
          self._processNext();
        },
        onError: function (err) {
          self._currentProc = null;
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
          self._processNext();
        }
      };

      if (item.mode === "upscale") {
        window.ModelHandler.upscaleClip(inputPath, outputPath, item.model, { scale: String(item.scale), targetSizeMb: item.targetSizeMb || 0, preset: item.preset || "high" }, callbacks);
      } else if (item.mode === "dedupe") {
        window.ModelHandler.dedupeClip(inputPath, outputPath, item.threshold || 0.05, item.options || {}, callbacks);
      } else {
        window.ModelHandler.interpolateClip(inputPath, outputPath, item.model, { fpsFactor: String(item.factor), targetSizeMb: item.targetSizeMb || 0, preset: item.preset || "high" }, callbacks);
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
