(function () {
  var ModelHandler = {
    
    activeProcess: null,

    
    executeModel: function (command, args, callbacks) {
      var self = this;
      if (this.activeProcess) {
        if (callbacks.onError) {
          callbacks.onError("A model execution process is already running.");
        }
        return;
      }

      
      var lowerCmd = command.toLowerCase();
      if (lowerCmd !== "python" && lowerCmd !== "python3") {
        if (command.indexOf("\\\\") === 0 || command.indexOf("//") === 0 || lowerCmd.indexOf("python") === -1) {
          if (callbacks.onError) {
            callbacks.onError("Untrusted or invalid Python executable path rejected: " + command);
          }
          return;
        }
      }

      dbg('info', 'ModelHandler', 'Spawning: ' + command + ' ' + args.join(' '));
      
      try {
        var appdata = "";
        try { appdata = process.env.APPDATA || ""; } catch (e) {}
        if (!appdata && window.FileSystem && window.FileSystem.os && window.FileSystem.path) {
          appdata = window.FileSystem.path.join(window.FileSystem.os.homedir(), "AppData", "Roaming");
        }
        var toolsFolder = appdata ? window.FileSystem.path.join(appdata, "com.moongetsu.extensions", "AniSmooth", "backend") : "C:\\AniSmoothTools";

        var env = {};
        for (var key in process.env) {
          if (process.env.hasOwnProperty(key)) {
            env[key] = process.env[key];
          }
        }
        
        
        if (process.platform === 'win32') {
          if (!env.SystemRoot) env.SystemRoot = process.env.SystemRoot || "C:\\Windows";
          if (!env.windir) env.windir = process.env.windir || "C:\\Windows";
          var pathKey = 'PATH';
          if ('Path' in env) pathKey = 'Path';
          else if ('PATH' in env) pathKey = 'PATH';
          
          if (env[pathKey]) {
            env[pathKey] = env[pathKey] + ";" + toolsFolder;
          } else {
            env[pathKey] = toolsFolder;
          }
        } else {
          if (env.PATH) {
            env.PATH = env.PATH + ":" + toolsFolder;
          } else {
            env.PATH = toolsFolder;
          }
        }

        var proc = window.FileSystem.childProcess.spawn(command, args, { env: env });
        this.activeProcess = proc;

        if (callbacks.onStart) {
          callbacks.onStart();
        }

        proc.stdout.on('data', function (data) {
          var text = data.toString();
          if (callbacks.onLog) callbacks.onLog(text);
          self.parseProgress(text, callbacks.onProgress);
        });

        proc.stderr.on('data', function (data) {
          var text = data.toString();
          if (callbacks.onLog) callbacks.onLog('[stderr] ' + text);
          self.parseProgress(text, callbacks.onProgress);
        });

        proc.on('close', function (code) {
          self.activeProcess = null;
          if (code === 0) {
            dbg('success', 'ModelHandler', 'Process completed successfully.');
            if (callbacks.onComplete) callbacks.onComplete();
          } else {
            dbg('error', 'ModelHandler', 'Process exited with code ' + code);
            if (callbacks.onError) callbacks.onError('Process exited with code ' + code);
          }
        });

        proc.on('error', function (err) {
          if (err.code === 'ENOENT' && command === 'python') {
            dbg('warn', 'ModelHandler', 'python not found in PATH. Attempting automatic local lookup...');
            var localPython = self.findLocalPython();
            if (localPython) {
              dbg('info', 'ModelHandler', 'Found Python at: ' + localPython + '. Updating config and retrying...');
              if (window.App && window.App.settings) {
                window.App.settings.pythonPath = localPython;
                window.StorageManager.setItem("anismooth_python_path", localPython);
                var pythonInput = document.getElementById("pythonPathInput");
                if (pythonInput) pythonInput.value = localPython;
              }
              self.activeProcess = null;
              self.executeModel(localPython, args, callbacks);
              return;
            }
          }
          self.activeProcess = null;
          dbg('error', 'ModelHandler', 'Process error: ' + err.message);
          if (callbacks.onError) callbacks.onError(err.message);
        });

      } catch (err) {
        if (err.code === 'ENOENT' && command === 'python') {
          dbg('warn', 'ModelHandler', 'python spawn throw. Attempting lookup...');
          var localPython = self.findLocalPython();
          if (localPython) {
            if (window.App && window.App.settings) {
              window.App.settings.pythonPath = localPython;
              window.StorageManager.setItem("anismooth_python_path", localPython);
            }
            this.activeProcess = null;
            this.executeModel(localPython, args, callbacks);
            return;
          }
        }
        this.activeProcess = null;
        dbg('error', 'ModelHandler', 'Failed to start process: ' + err.message);
        if (callbacks.onError) callbacks.onError(err.message);
      }
    },

    findLocalPython: function() {
      try {
        var localappdata = (process.env && process.env.LOCALAPPDATA) || "";
        var userprofile = (process.env && process.env.USERPROFILE) || "";
        var programfiles = (process.env && process.env.ProgramFiles) || "C:\\Program Files";
        var fs = window.FileSystem.fs;
        var path = window.FileSystem.path;
        
        if (fs && path) {
          var searchDirs = [];
          if (localappdata) searchDirs.push(path.join(localappdata, "Programs", "Python"));
          if (userprofile) searchDirs.push(path.join(userprofile, "AppData", "Local", "Programs", "Python"));
          if (programfiles) searchDirs.push(path.join(programfiles, "Python"));
          
          for (var i = 0; i < searchDirs.length; i++) {
            var dir = searchDirs[i];
            if (fs.existsSync(dir)) {
              var subdirs = fs.readdirSync(dir);
              for (var j = 0; j < subdirs.length; j++) {
                var sub = subdirs[j];
                if (sub.toLowerCase().indexOf("python3") === 0 || sub.toLowerCase().indexOf("python") === 0) {
                  var fullPath = path.join(dir, sub, "python.exe");
                  if (fs.existsSync(fullPath)) {
                    return fullPath;
                  }
                }
              }
            }
          }
          
          
          if (fs.existsSync("C:\\")) {
            var rootDirs = fs.readdirSync("C:\\");
            for (var k = 0; k < rootDirs.length; k++) {
              var rdir = rootDirs[k];
              if (rdir.toLowerCase().indexOf("python3") === 0) {
                var rpath = path.join("C:\\", rdir, "python.exe");
                if (fs.existsSync(rpath)) {
                  return rpath;
                }
              }
            }
          }

          
          if (localappdata) {
            var storePath = path.join(localappdata, "Microsoft", "WindowsApps", "python.exe");
            if (fs.existsSync(storePath)) {
              return storePath;
            }
          }
        }
      } catch (e) {}
      return null;
    },

    
    parseProgress: function (text, onProgress) {
      if (!onProgress) return;
      
      
      var match = text.match(/(\d+(?:\.\d+)?)\s*%/);
      if (match) {
        onProgress(parseFloat(match[1]));
        return;
      }

      match = text.match(/(\d+)\/(\d+)/);
      if (match) {
        var current = parseInt(match[1], 10);
        var total = parseInt(match[2], 10);
        if (total > 0) {
          onProgress(Math.round((current / total) * 100));
        }
      }
    },

    
    cancelActiveProcess: function () {
      if (this.activeProcess) {
        dbg('info', 'ModelHandler', 'Killing active process...');
        this.activeProcess.kill('SIGINT');
        this.activeProcess = null;
        return true;
      }
      return false;
    },

    
    interpolateClip: function (inputPath, outputPath, modelKey, options, callbacks) {
      var pythonCmd = window.App && window.App.settings.pythonPath ? window.App.settings.pythonPath : 'python';
      
      var extPath = "";
      try {
        var cs = new CSInterface();
        extPath = cs.getSystemPath(SystemPath.EXTENSION);
      } catch (e) {}

      var scriptPath = (window.FileSystem.path && extPath) ? window.FileSystem.path.join(extPath, 'python', 'main.py') : 'main.py';

      var args = [
        scriptPath,
        "--mode", "interpolate",
        "--input", inputPath,
        "--output", outputPath,
        "--model", modelKey,
        "--factor", options.fpsFactor || "2"
      ];
      if (options.targetSizeMb && parseFloat(options.targetSizeMb) > 0) {
        args.push("--target-size-mb", String(parseFloat(options.targetSizeMb)));
      }

      this.executeModel(pythonCmd, args, callbacks);
    },

    
    upscaleClip: function (inputPath, outputPath, modelKey, options, callbacks) {
      var pythonCmd = window.App && window.App.settings.pythonPath ? window.App.settings.pythonPath : 'python';
      
      var extPath = "";
      try {
        var cs = new CSInterface();
        extPath = cs.getSystemPath(SystemPath.EXTENSION);
      } catch (e) {}

      var scriptPath = (window.FileSystem.path && extPath) ? window.FileSystem.path.join(extPath, 'python', 'main.py') : 'main.py';
      
      var args = [
        scriptPath,
        "--mode", "upscale",
        "--input", inputPath,
        "--output", outputPath,
        "--model", modelKey,
        "--factor", options.scale || "2"
      ];
      if (options.targetSizeMb && parseFloat(options.targetSizeMb) > 0) {
        args.push("--target-size-mb", String(parseFloat(options.targetSizeMb)));
      }

      this.executeModel(pythonCmd, args, callbacks);
    },

    
    dedupeClip: function (inputPath, outputPath, threshold, options, callbacks) {
      var pythonCmd = window.App && window.App.settings.pythonPath ? window.App.settings.pythonPath : 'python';

      var extPath = "";
      try {
        var cs = new CSInterface();
        extPath = cs.getSystemPath(SystemPath.EXTENSION);
      } catch (e) {}

      var scriptPath = (window.FileSystem.path && extPath) ? window.FileSystem.path.join(extPath, 'python', 'main.py') : 'main.py';

      var args = [
        scriptPath,
        "--mode", "dedupe",
        "--input", inputPath,
        "--output", outputPath,
        "--threshold", String(threshold)
      ];

      if (options) {
        if (options.regionSensitivity !== undefined) {
          args.push("--region-sensitivity", String(options.regionSensitivity));
        }
        if (options.useOpticalFlow === false) {
          args.push("--no-optical-flow");
        }
        if (options.cameraCompensation === false) {
          args.push("--no-camera-comp");
        }
        if (options.removeStaticSubject === false) {
          args.push("--no-static-subject");
        }
      }

      this.executeModel(pythonCmd, args, callbacks);
    }
  };

  window.ModelHandler = ModelHandler;
})();
