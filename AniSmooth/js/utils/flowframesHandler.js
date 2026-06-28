(function () {
  var FlowframesHandler = {
    activeProcess: null,
    _poll: null,
    _cancelled: false,

    findExe: function () {
      try {
        var fs = window.FileSystem.fs;
        var path = window.FileSystem.path;
        var settings = window.App && window.App.settings;
        var version = this.getEffectiveVersion();
        var versionPath = version === "1.36.0" ? (settings && settings.flowframesPath136) : (settings && settings.flowframesPath142);
        if (versionPath && fs.existsSync(versionPath)) return versionPath;
        var configured = settings && settings.flowframesPath;
        if (configured && fs.existsSync(configured)) return configured;
        var localappdata = (process.env && process.env.LOCALAPPDATA) || "";
        if (localappdata) {
          var guess = path.join(localappdata, "Flowframes", "Flowframes.exe");
          if (fs.existsSync(guess)) return guess;
        }
      } catch (e) {}
      return null;
    },

    isAvailable: function () {
      return !!this.findExe();
    },

    getEffectiveVersion: function () {
      var settings = window.App && window.App.settings;
      var ver = (settings && settings.flowframesVersion) || "1.36.0";
      if (ver === "both") return (settings && settings.flowframesVersionActive) || "1.36.0";
      return ver;
    },

    availableVersions: function () {
      var settings = window.App && window.App.settings;
      var ver = (settings && settings.flowframesVersion) || "1.36.0";
      var fs = window.FileSystem.fs;
      var path = window.FileSystem.path;
      var localappdata = (process.env && process.env.LOCALAPPDATA) || "";
      var results = [];
      var versions = ["1.36.0", "1.42.0"];
      for (var i = 0; i < versions.length; i++) {
        var v = versions[i];
        var exe = null;
        if (v === "1.36.0" && settings && settings.flowframesPath136 && fs.existsSync(settings.flowframesPath136))
          exe = settings.flowframesPath136;
        else if (v === "1.42.0" && settings && settings.flowframesPath142 && fs.existsSync(settings.flowframesPath142))
          exe = settings.flowframesPath142;
        else if (settings && settings.flowframesPath && fs.existsSync(settings.flowframesPath))
          exe = settings.flowframesPath;
        else if (localappdata) {
          var guess = path.join(localappdata, "Flowframes", "Flowframes.exe");
          if (fs.existsSync(guess)) exe = guess;
        }
        results.push({ version: v, available: !!exe, path: exe });
      }
      return results;
    },

    isBusy: function () {
      return !!this.activeProcess;
    },

    run: function (inputPath, jobOutDir, options, callbacks) {
      var self = this;
      callbacks = callbacks || {};
      if (this.activeProcess) {
        if (callbacks.onError) callbacks.onError("Flowframes is already running.");
        return;
      }

      var fs = window.FileSystem.fs;
      var path = window.FileSystem.path;
      var cp = window.FileSystem.childProcess;

      var exe = this.findExe();
      if (!exe) {
        if (callbacks.onError) callbacks.onError("Flowframes.exe not found. Set its path in Settings.");
        return;
      }

      var logsDir = path.join(path.dirname(exe), "FlowframesData", "logs");

      var version = this.getEffectiveVersion();
      var isLegacy = version === "1.36.0";

      var args = isLegacy
        ? [
            "-a", "-nc",
            "-f", String(options.factor || "2"),
            "-ai", options.ai || "RifeCuda",
            "-m", options.model || "RIFE 4.0",
            "-vf", options.format || "Mp4",
            "-ve", options.encoder || "X264",
            "-pf", options.pixFmt || "Yuv420P",
            "-o", jobOutDir,
            inputPath
          ]
        : [
            "-a", "-nc", "-mdc",
            "-f", String(options.factor || "2"),
            "-ai", options.ai || "RifeNcnn",
            "-m", options.model || "RIFE 4.26",
            "-vf", options.format || "Mp4",
            "-ve", options.encoder || "X264",
            "-pf", options.pixFmt || "Yuv420P",
            "-o", jobOutDir,
            inputPath
          ];
      if (options.quality) args.push("-q", String(options.quality));
      if (options.maxFps && parseFloat(options.maxFps) > 0) args.push("-fps", String(parseFloat(options.maxFps)));
      if (options.maxHeight && parseInt(options.maxHeight) > 0) args.push("-mh", String(parseInt(options.maxHeight)));
      if (options.sceneChange) {
        args.push("-scn");
        if (options.sceneSensitivity) args.push("-scnv", String(options.sceneSensitivity));
      }

      var existingSessions = {};
      try {
        var pre = fs.readdirSync(logsDir);
        for (var i = 0; i < pre.length; i++) existingSessions[pre[i]] = true;
      } catch (e) {}

      var startTime = Date.now();
      this._cancelled = false;

      dbg("info", "Flowframes", "Launching: " + exe + " " + args.join(" "));

      var spawnAndWatch = function () {
        var env = {};
        for (var key in process.env) {
          if (process.env.hasOwnProperty(key) && key.toLowerCase() !== "nodefaultcurrentdirectoryinexepath") {
            env[key] = process.env[key];
          }
        }

        var proc;
        try {
          proc = cp.spawn(exe, args, { env: env });
        } catch (e) {
          if (callbacks.onError) callbacks.onError("Failed to launch Flowframes: " + e.message);
          return;
        }
        self.activeProcess = proc;
        if (callbacks.onStart) callbacks.onStart();

        var sessionLog = null;
        var lastLineCount = 0;
        var lastOutSize = -1;
        var stableCount = 0;
        var finished = false;
        var aiComplete = false;

        var finalize = function (ok, message, producedPath) {
          if (finished) return;
          finished = true;
          if (self._poll) { clearInterval(self._poll); self._poll = null; }
          self.activeProcess = null;
          try { cp.exec('taskkill /F /T /IM Flowframes.exe', function () {}); } catch (e) {}
          if (self._cancelled) { self._cancelled = false; return; }
          if (ok) {
            dbg("success", "Flowframes", "Completed: " + producedPath);
            if (callbacks.onComplete) callbacks.onComplete(producedPath);
          } else {
            dbg("error", "Flowframes", message);
            if (callbacks.onError) callbacks.onError(message);
          }
        };

        var findNewestOutput = function () {
          try {
            var files = fs.readdirSync(jobOutDir);
            var best = null, bestM = 0;
            for (var i = 0; i < files.length; i++) {
              if (!/\.(mp4|mkv|webm|mov|avi)$/i.test(files[i])) continue;
              var fp = path.join(jobOutDir, files[i]);
              var st = fs.statSync(fp);
              if (st.isFile() && st.mtimeMs >= startTime - 2000 && st.mtimeMs >= bestM) {
                bestM = st.mtimeMs; best = fp;
              }
            }
            return best;
          } catch (e) { return null; }
        };

        self._poll = setInterval(function () {
          if (!sessionLog) {
            try {
              var dirs = fs.readdirSync(logsDir);
              for (var i = 0; i < dirs.length; i++) {
                if (!existingSessions[dirs[i]]) {
                  var cand = path.join(logsDir, dirs[i], "sessionlog.txt");
                  if (fs.existsSync(cand)) { sessionLog = cand; break; }
                }
              }
            } catch (e) {}
          }
          if (sessionLog) {
            try {
              var content = fs.readFileSync(sessionLog, "utf8");
              var lines = content.split(/\r?\n/);
              for (var j = lastLineCount; j < lines.length; j++) {
                var ln = lines[j];
                if (!ln) continue;
                if (callbacks.onLog) callbacks.onLog(ln.replace(/^\[[^\]]*\]\s*\[[^\]]*\]:\s*/, ""));
                if (/Failed to initialize MediaFile|No frames left|Interpolation failed|\bError occured\b/i.test(ln)) {
                  finalize(false, "Flowframes error: " + ln.replace(/^\[[^\]]*\]\s*\[[^\]]*\]:\s*/, ""));
                  return;
                }
                var fm = ln.match(/Interpolated\s+(\d+)\s*\/\s*(\d+)\s*Frames?/i);
                if (fm && parseInt(fm[2], 10) > 0) {
                  var done = parseInt(fm[1], 10), total = parseInt(fm[2], 10);
                  if (callbacks.onProgress) callbacks.onProgress(Math.round((done / total) * 100));
                  if (done >= total) aiComplete = true;
                } else {
                  var pm = ln.match(/(\d+(?:\.\d+)?)\s*%/);
                  if (pm && callbacks.onProgress) callbacks.onProgress(parseFloat(pm[1]));
                }
                if (/Done interpolating|Interpolation done|Frame interpolation (?:took|done)|Output video|Encoding finished|\[Done\]/i.test(ln)) {
                  aiComplete = true;
                }
              }
              lastLineCount = lines.length;
            } catch (e) {}
          }

          if (aiComplete) {
            var out = findNewestOutput();
            if (out) {
              try {
                var sz = fs.statSync(out).size;
                if (sz > 0 && sz === lastOutSize) {
                  stableCount++;
                  if (stableCount >= 2) { finalize(true, null, out); return; }
                } else { stableCount = 0; }
                lastOutSize = sz;
              } catch (e) {}
            }
          }
        }, 1500);

        proc.on('close', function () {
          setTimeout(function () {
            if (finished) return;
            var out = findNewestOutput();
            if (out) finalize(true, null, out);
            else finalize(false, "Flowframes exited without producing an output file.");
          }, 2500);
        });

        proc.on('error', function (err) {
          finalize(false, "Flowframes process error: " + err.message);
        });
      };

      var ensureKilledThenSpawn = function (attempt) {
        cp.exec('taskkill /F /T /IM Flowframes.exe', function () {
          cp.exec('tasklist /FI "IMAGENAME eq Flowframes.exe" /NH', function (err, stdout) {
            var stillAlive = stdout && /Flowframes\.exe/i.test(stdout);
            if (stillAlive && attempt < 12) {
              setTimeout(function () { ensureKilledThenSpawn(attempt + 1); }, 400);
            } else {
              setTimeout(spawnAndWatch, 500);
            }
          });
        });
      };
      try {
        ensureKilledThenSpawn(0);
      } catch (e) {
        spawnAndWatch();
      }
    },

    cancel: function () {
      if (!this.activeProcess) return false;
      this._cancelled = true;
      if (this._poll) { clearInterval(this._poll); this._poll = null; }
      var proc = this.activeProcess;
      try {
        if (process.platform === 'win32') {
          window.FileSystem.childProcess.exec('taskkill /F /T /IM Flowframes.exe', function () {});
          if (proc.pid) window.FileSystem.childProcess.exec('taskkill /F /T /PID ' + proc.pid, function () {});
        } else {
          proc.kill('SIGTERM');
        }
      } catch (e) {
        try { proc.kill('SIGKILL'); } catch (e2) {}
      }
      this.activeProcess = null;
      return true;
    }
  };

  window.FlowframesHandler = FlowframesHandler;
})();
