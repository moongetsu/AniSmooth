(function () {
  var _step = 'welcome';
  var _toolsFolder = '';
  var _pythonCmd = '';
  var _pythonOk = false;
  var _pythonChecked = false;
  var _gpuChoice = null;
  var _gpuInfo = null;
  var _gpuChecked = false;
  var _pytorchOk = false;
  var _pytorchChecked = false;
  var _installRunning = false;
  var _installProc = null;
  var _installLines = [];
  var _installSubstep = '';
  var _installedCount = 0;
  var _totalSteps = 0;

  function _resolveDefaultFolder() {
    var appdata = "";
    try { appdata = process.env.APPDATA || ""; } catch (e) {}
    if (!appdata && window.FileSystem && window.FileSystem.os && window.FileSystem.path) {
      appdata = window.FileSystem.path.join(window.FileSystem.os.homedir(), "AppData", "Roaming");
    }
    var base = appdata ? window.FileSystem.path.join(appdata, "com.moongetsu.extensions", "AniSmooth") : "";
    return base ? window.FileSystem.path.join(base, "backend") : "C:\\AniSmoothTools";
  }

  function _resolvePythonCmd() {
    var venvPython = window.FileSystem.path.join(_toolsFolder, ".venv", "Scripts", "python.exe");
    if (window.FileSystem.fs && window.FileSystem.fs.existsSync(venvPython)) {
      return venvPython;
    }
    return _pythonCmd || "python";
  }

  function showToolsSetup() {
    var gate = document.getElementById('tools-setup-gate');
    if (!gate) {
      gate = document.createElement('div');
      gate.id = 'tools-setup-gate';
      gate.className = 'setup-gate';
      document.body.appendChild(gate);
    }
    gate.style.display = 'flex';
    _step = 'welcome';
    _pythonChecked = false;
    _gpuChoice = window.StorageManager.getItem('anismooth_gpu_choice', null);
    _gpuChecked = false;
    _pytorchChecked = false;
    _installRunning = false;
    _installLines = [];
    _toolsFolder = (window.App && window.App.anismoothToolsFolder) || _resolveDefaultFolder();
    renderSetupStep();
  }

  function hideToolsSetup() {
    var gate = document.getElementById('tools-setup-gate');
    if (gate) gate.style.display = 'none';
  }

  function renderSetupStep() {
    var gate = document.getElementById('tools-setup-gate');
    if (!gate) return;
    var steps = ['welcome', 'gpuchoice', 'check', 'autoinstall', 'complete'];
    var stepIdx = steps.indexOf(_step);
    var pct = (stepIdx / 4) * 100;
    var html = renderStepIndicator(pct);
    switch (_step) {
      case 'welcome': html += renderWelcomeStep(); break;
      case 'gpuchoice': html += renderGpuChoiceStep(); break;
      case 'check': html += renderCheckStep(); break;
      case 'autoinstall': html += renderAutoInstallStep(); break;
      case 'complete': html += renderCompleteStep(); break;
    }
    gate.innerHTML = html;
    if (_step === 'autoinstall' && !_installRunning) {
      setTimeout(function () { startAutoInstall(); }, 400);
    }
  }

  function renderStepIndicator(progress) {
    var stepClasses = ['', '', '', ''];
    var idx = ['welcome', 'gpuchoice', 'check', 'autoinstall', 'complete'].indexOf(_step);
    for (var i = 0; i < 4; i++) {
      if (i < idx) stepClasses[i] = 'done';
      else if (i === idx) stepClasses[i] = 'active';
    }
    var stepsHtml = '';
    for (var i = 0; i < 4; i++) {
      stepsHtml += '<div class="setup-step ' + stepClasses[i] + '">' +
        (stepClasses[i] === 'done' ? '<i class="fa-solid fa-check"></i>' : '<span>' + (i + 1) + '</span>') +
        '</div>';
    }
    return '<div class="setup-container">' +
      '<div class="setup-step-bar">' +
        '<div class="setup-step-progress" style="width:' + progress + '%"></div>' +
        '<div class="setup-steps">' + stepsHtml + '</div>' +
      '</div>' +
      '<div class="setup-step-labels"><span>Welcome</span><span>Hardware</span><span>Check</span><span>Install</span></div>';
  }

  
  function renderWelcomeStep() {
    return '<div class="setup-card">' +
      '<div class="setup-logo" style="text-align: center; margin-bottom: 12px;"><img src="' + ((window.AniSmoothTheme && window.AniSmoothTheme.getLogo("iconOnly")) || "./images/AniSmooth-Logo-Only.png") + '" alt="AniSmooth Logo" style="height: 72px; width: auto; object-fit: contain; display: inline-block;"></div>' +
      '<h1>AniSmooth Setup</h1>' +
      '<p class="setup-desc">This wizard detects your hardware and installs everything needed to run local AI models for frame interpolation and upscaling.</p>' +
      '<div class="setup-info-box">' +
        '<p><strong>What will be checked:</strong></p>' +
        '<ul>' +
          '<li><i class="fa-brands fa-python"></i> Python 3 &mdash; runtime engine</li>' +
          '<li><i class="fa-solid fa-microchip"></i> GPU &amp; CUDA &mdash; hardware acceleration</li>' +
          '<li><i class="fa-solid fa-film"></i> FFmpeg &mdash; video processing</li>' +
          '<li><i class="fa-solid fa-cubes"></i> PyTorch &amp; OpenCV &mdash; AI inference</li>' +
        '</ul>' +
        '<p style="margin-top:6px;">Everything installs to: <code>' + _toolsFolder + '</code></p>' +
      '</div>' +
      '<div class="setup-nav">' +
        '<button class="btn btn-ghost" onclick="skipToolsSetup()">Skip</button>' +
        '<button class="btn btn-primary" onclick="goToSetupStep(\'gpuchoice\')"><i class="fa-solid fa-arrow-right"></i> Next</button>' +
      '</div>' +
    '</div></div>';
  }

  
  function renderGpuChoiceStep() {
    var html = '<div class="setup-card">' +
      '<h2>Choose Hardware Mode</h2>' +
      '<p class="setup-desc">Select how you want to run AniSmooth. GPU mode provides much faster processing but requires an NVIDIA GPU with CUDA support.</p>' +
      '<div class="ts-gpu-choice">' +
        '<div class="ts-gpu-option' + (_gpuChoice === 'gpu' ? ' ts-gpu-selected' : '') + '" onclick="selectGpuChoice(\'gpu\')">' +
          '<div class="ts-gpu-option-icon"><i class="fa-solid fa-microchip"></i></div>' +
          '<div class="ts-gpu-option-info">' +
            '<div class="ts-gpu-option-title">GPU Acceleration</div>' +
            '<div class="ts-gpu-option-desc">NVIDIA GPU with CUDA. Requires ~2.5GB download for PyTorch CUDA.</div>' +
          '</div>' +
          '<div class="ts-gpu-option-check">' + (_gpuChoice === 'gpu' ? '<i class="fa-solid fa-circle-check"></i>' : '') + '</div>' +
        '</div>' +
        '<div class="ts-gpu-option' + (_gpuChoice === 'cpu' ? ' ts-gpu-selected' : '') + '" onclick="selectGpuChoice(\'cpu\')">' +
          '<div class="ts-gpu-option-icon"><i class="fa-solid fa-computer"></i></div>' +
          '<div class="ts-gpu-option-info">' +
            '<div class="ts-gpu-option-title">CPU Only</div>' +
            '<div class="ts-gpu-option-desc">Slower processing but works on any system. No GPU required.</div>' +
          '</div>' +
          '<div class="ts-gpu-option-check">' + (_gpuChoice === 'cpu' ? '<i class="fa-solid fa-circle-check"></i>' : '') + '</div>' +
        '</div>' +
      '</div>';

    if (_gpuChoice === 'gpu' && _gpuDownloadState) {
      html += '<div class="ts-gpu-download-status">' +
        '<div class="ts-gpu-download-progress">' +
          '<div class="setup-progress-track"><div id="ts-gpu-download-bar" class="setup-progress-fill" style="width:' + _gpuDownloadState.progress + '%"></div></div>' +
        '</div>' +
        '<div class="ts-gpu-download-msg">' + escapeHtml(_gpuDownloadState.message) + '</div>' +
        (_gpuDownloadState.log && _gpuDownloadState.log.length > 0 ? '<div class="ts-gpu-download-log">' + _gpuDownloadState.log.map(function(l) { return '<div>' + escapeHtml(l) + '</div>'; }).join('') + '</div>' : '') +
      '</div>';
    }

    html += '<div class="setup-nav">' +
      '<button class="btn btn-ghost" onclick="goToSetupStep(\'welcome\')">Back</button>' +
      '<button class="btn btn-primary" onclick="confirmGpuChoice()"' + (!_gpuChoice || (_gpuChoice === 'gpu' && _gpuDownloadState && _gpuDownloadState.running) ? ' disabled' : '') + '>' +
        (_gpuChoice === 'gpu' && _gpuDownloadState && _gpuDownloadState.running ? '<i class="fa-solid fa-spinner fa-spin"></i> Downloading...' : '<i class="fa-solid fa-arrow-right"></i> Continue') +
      '</button>' +
    '</div></div>';

    return html;
  }

  var _gpuDownloadState = null;

  function selectGpuChoice(choice) {
    _gpuChoice = choice;
    _gpuDownloadState = null;
    renderSetupStep();
  }

  function confirmGpuChoice() {
    if (!_gpuChoice) return;
    if (_gpuChoice === 'gpu') {
      if (_gpuDownloadState && _gpuDownloadState.running) return;
      if (!_gpuDownloadState || !_gpuDownloadState.done) {
        // The --force-gpu install needs a real interpreter. We are still on the
        // 'gpuchoice' step where Python has not been detected yet, so detect it
        // first and only then kick off the download.
        ensurePythonThen(startGpuDownload);
        return;
      }
    }
    goToSetupStep('check');
  }

  // Make sure a Python command is resolved, then invoke cb(). If Python is
  // already known (or a venv python exists) we proceed immediately; otherwise we
  // run the async detection and surface a clear error if nothing is found.
  function ensurePythonThen(cb) {
    if (_resolvePythonCmd && _resolvePythonCmd() && (_pythonOk || _pythonCmd ||
        (window.FileSystem.fs && window.FileSystem.fs.existsSync(
          window.FileSystem.path.join(_toolsFolder, ".venv", "Scripts", "python.exe"))))) {
      cb();
      return;
    }
    _gpuDownloadState = { running: true, done: false, progress: 0, message: 'Detecting Python...', log: ['Detecting Python interpreter...'] };
    renderSetupStep();
    _onPythonChecked = function () {
      _onPythonChecked = null;
      if (_pythonOk && _pythonCmd) {
        cb();
      } else {
        _gpuDownloadState = _gpuDownloadState || { log: [] };
        _gpuDownloadState.running = false;
        _gpuDownloadState.done = false;
        _gpuDownloadState.message = 'Python not found. Install Python 3 (or use "Install Python First" on the Check screen) and try again.';
        _gpuDownloadState.log.push('[ERR] No Python interpreter found on this system.');
        renderSetupStep();
      }
    };
    checkPythonAsync();
  }

  function startGpuDownload() {
    _gpuDownloadState = { running: true, done: false, progress: 0, message: 'Preparing to download PyTorch CUDA...', log: [] };
    renderSetupStep();

    var pythonCmd = _resolvePythonCmd();
    var extPath = "";
    try { var cs = new CSInterface(); extPath = cs.getSystemPath(SystemPath.EXTENSION); } catch (e) {}
    var sourceSetup = (window.FileSystem.path && extPath) ? window.FileSystem.path.join(extPath, 'python', 'setup.py') : 'setup.py';
    var destSetup = window.FileSystem.path.join(_toolsFolder, 'setup.py');

    try {
      window.FileSystem.createFolder(_toolsFolder);
      var content = window.FileSystem.fs.readFileSync(sourceSetup, 'utf8');
      window.FileSystem.fs.writeFileSync(destSetup, content, 'utf8');
      _gpuDownloadState.log.push('[OK] Setup script ready');
    } catch (e) {
      _gpuDownloadState.log.push('[ERR] Failed to copy setup script: ' + e.message);
      _gpuDownloadState.running = false;
      _gpuDownloadState.message = 'Failed to prepare installer';
      renderSetupStep();
      return;
    }

    _gpuDownloadState.message = 'Installing PyTorch CUDA (~2.5GB download)...';
    _gpuDownloadState.log.push('--- Installing PyTorch CUDA ---');
    renderSetupStep();

    try {
      _installProc = window.FileSystem.childProcess.spawn(pythonCmd, ['setup.py', '--force-gpu'], { cwd: _toolsFolder, windowsHide: true });
      var proc = _installProc;
      var buf = '';
      proc.stdout.on('data', function (d) {
        buf += d.toString();
        var lines = buf.split('\n');
        buf = lines.pop();
        for (var i = 0; i < lines.length; i++) {
          var line = lines[i].trim();
          if (!line) continue;
          _gpuDownloadState.log.push(line);
          if (_gpuDownloadState.log.length > 50) _gpuDownloadState.log.shift();
          try {
            var data = JSON.parse(line);
            if (data.type === 'progress' && data.pct !== undefined) {
              _gpuDownloadState.progress = Math.min(95, data.pct);
            } else if (data.type === 'success') {
              _gpuDownloadState.progress = Math.min(95, _gpuDownloadState.progress + 10);
            }
          } catch (_) {}
        }
        renderSetupStep();
      });
      proc.stderr.on('data', function (d) {
        var msg = '[WARN] ' + d.toString().trim();
        _gpuDownloadState.log.push(msg);
        if (_gpuDownloadState.log.length > 50) _gpuDownloadState.log.shift();
        renderSetupStep();
      });
      proc.on('close', function (code) {
        _installProc = null;
        _gpuDownloadState.running = false;
        if (code === 0) {
          _gpuDownloadState.progress = 100;
          _gpuDownloadState.done = true;
          _gpuDownloadState.message = 'PyTorch CUDA installed successfully!';
          _gpuDownloadState.log.push('[OK] PyTorch CUDA installation complete');
          // Do NOT assume PyTorch is OK from the exit code alone. Leave it
          // unchecked so the check step re-runs checkPytorchAsync(), which actually
          // imports torch/cv2 in the venv and shows the real version (or "Not
          // installed" if the import fails). Defense-in-depth against false success.
          _pytorchChecked = false;
          _pytorchOk = false;
        } else {
          _gpuDownloadState.message = 'Installation failed (code ' + code + '). You can try again or switch to CPU mode.';
          _gpuDownloadState.log.push('[ERR] Installation failed with code ' + code);
        }
        renderSetupStep();
      });
      proc.on('error', function (e) {
        _installProc = null;
        // If the bare 'python' command was not on PATH, fall back to detecting a
        // real interpreter (launcher / per-user install / venv) and retry once,
        // mirroring modelHandler.findLocalPython.
        if (e && e.code === 'ENOENT' && !_gpuDownloadState._retriedPython) {
          _gpuDownloadState._retriedPython = true;
          _gpuDownloadState.log.push('[WARN] "' + pythonCmd + '" not found. Detecting Python...');
          renderSetupStep();
          _pythonOk = false; _pythonCmd = '';
          ensurePythonThen(function () { startGpuDownload(); });
          return;
        }
        _gpuDownloadState.running = false;
        _gpuDownloadState.message = 'Error: ' + e.message;
        _gpuDownloadState.log.push('[ERR] ' + e.message);
        renderSetupStep();
      });
    } catch (e) {
      _gpuDownloadState.running = false;
      _gpuDownloadState.message = 'Error: ' + e.message;
      _gpuDownloadState.log.push('[ERR] ' + e.message);
      renderSetupStep();
    }
  }

  
  function renderCheckStep() {
    var ffmpegFound = false, ffprobeFound = false;
    if (window.FileSystem && window.FileSystem.fs) {
      ffmpegFound = window.FileSystem.fs.existsSync(window.FileSystem.path.join(_toolsFolder, "ffmpeg.exe"));
      ffprobeFound = window.FileSystem.fs.existsSync(window.FileSystem.path.join(_toolsFolder, "ffprobe.exe"));
    }
    var rows = '';
    rows += renderToolRow({ found: _pythonOk, checking: !_pythonChecked, extra: _pythonCmd }, 'Python 3', _pythonOk ? _pythonCmd : 'Not found', 'fa-brands fa-python');
    if (_gpuChoice === 'gpu') {
      if (_gpuChecked) {
        if (_gpuInfo && _gpuInfo.nvidia_gpu_detected) {
          var vram = _gpuInfo.nvidia_vram_mb ? ' (' + formatVram(_gpuInfo.nvidia_vram_mb) + ')' : '';
          var label = _gpuInfo.nvidia_name + vram;
          rows += renderToolRow({ found: _gpuInfo.cuda_available, extra: _gpuInfo.pytorch_variant },
            'GPU & CUDA', _gpuInfo.cuda_available ? label + ' — CUDA OK' : label + ' — CPU PyTorch', 'fa-solid fa-microchip');
        } else {
          rows += renderToolRow({ found: false }, 'GPU', 'No NVIDIA GPU detected', 'fa-solid fa-microchip');
        }
      } else {
        rows += renderToolRow({ checking: true }, 'GPU & CUDA', 'Detecting hardware...', 'fa-solid fa-microchip');
      }
    } else {
      rows += renderToolRow({ found: true, extra: 'cpu' }, 'Mode', 'CPU (no GPU acceleration)', 'fa-solid fa-computer');
    }
    rows += renderToolRow({ found: ffmpegFound }, 'FFmpeg', 'Video encoder', 'fa-solid fa-film');
    rows += renderToolRow({ found: ffprobeFound }, 'FFprobe', 'Metadata reader', 'fa-solid fa-magnifying-glass');
    if (_pytorchChecked) {
      rows += renderToolRow({ found: _pytorchOk, extra: _pytorchExtra }, 'PyTorch', _pytorchOk ? _pytorchExtra : 'Not installed', 'fa-solid fa-cubes');
    } else {
      rows += renderToolRow({ checking: true }, 'PyTorch + CV2', 'Checking packages...', 'fa-solid fa-cubes');
    }

    var canInstall = _pythonOk;
    var gpuMismatch = _gpuChoice === 'gpu' && _gpuInfo && _gpuInfo.nvidia_gpu_detected && !_gpuInfo.cuda_available;
    var allOk = _pythonOk && ffmpegFound && ffprobeFound && _pytorchOk && !gpuMismatch;
    if (_gpuChoice === 'cpu') {
      allOk = _pythonOk && ffmpegFound && ffprobeFound && _pytorchOk;
    }

    var actions = '<div class="setup-nav">' +
      '<button class="btn btn-ghost" onclick="goToSetupStep(\'gpuchoice\')">Back</button>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;">' +
        '<button class="btn btn-secondary" onclick="scanToolsAndRefresh()"><i class="fa-solid fa-arrows-rotate"></i> Re-scan</button>';
    if (allOk) {
      actions += '<button class="btn btn-primary" onclick="finishToolsSetup()"><i class="fa-solid fa-check"></i> All Good</button>';
    } else if (gpuMismatch) {
      actions += '<button class="btn btn-primary" onclick="installGpuFromSetup()"><i class="fa-solid fa-download"></i> Install CUDA PyTorch</button>';
    } else if (canInstall) {
      actions += '<button class="btn btn-primary" onclick="goToSetupStep(\'autoinstall\')"><i class="fa-solid fa-wrench"></i> Install Missing</button>';
    } else {
      actions += '<button class="btn btn-primary" onclick="downloadAndInstallPortablePython()"><i class="fa-solid fa-download"></i> Install Python First</button>';
    }
    actions += '</div></div>';

    var gpuDiagHtml = '';
    if (_gpuChoice === 'gpu' && _gpuChecked && (!_gpuInfo || !_gpuInfo.nvidia_gpu_detected) && _gpuDiag.length > 0) {
      gpuDiagHtml = '<div class="ts-gpu-download-log" id="gpuDiagLog" style="margin-top:8px;">' +
        _gpuDiag.map(function(l) { return '<div class="ts-log-err">' + escapeHtml(l) + '</div>'; }).join('') +
        '</div>' +
        '<button class="btn btn-sm" style="margin-top:4px;width:100%;" onclick="copyGpuDiag()"><i class="fa-solid fa-copy"></i> Copy Log</button>';
    }

    var html = '<div class="setup-card">' +
      '<h2>System Check</h2>' +
      '<p class="setup-desc">Scanning your system for required tools and hardware.</p>' +
      '<div class="ts-tool-list">' + rows + '</div>' +
      gpuDiagHtml +
      actions +
    '</div></div>';

    if (!_pythonChecked) { setTimeout(function () { checkPythonAsync(); }, 80); }
    if (_gpuChoice === 'gpu' && !_gpuChecked && _pythonOk) { setTimeout(function () { checkGpuAsync(); }, 400); }
    if (_gpuChoice === 'cpu' && !_gpuChecked) { _gpuChecked = true; _gpuInfo = null; }
    if (!_pytorchChecked && _pythonOk) { setTimeout(function () { checkPytorchAsync(); }, 600); }
    return html;
  }

  function renderToolRow(status, name, desc, iconClass) {
    var icon, statusClass;
    if (status.found) { statusClass = 'found'; }
    else if (status.checking) { statusClass = 'checking'; }
    else { statusClass = 'missing'; }
    return '<div class="ts-tool-row ' + statusClass + '">' +
      '<div class="ts-tool-icon"><i class="' + iconClass + '"></i></div>' +
      '<div class="ts-tool-info">' +
        '<div class="ts-tool-name">' + name + '</div>' +
        '<div class="ts-tool-desc">' + desc + '</div>' +
        (status.extra ? '<div class="ts-tool-extra">' + escapeHtml(status.extra) + '</div>' : '') +
      '</div>' +
    '</div>';
  }

  
  var _onPythonChecked = null;
  function _firePythonChecked() {
    if (typeof _onPythonChecked === 'function') {
      var cb = _onPythonChecked;
      try { cb(); } catch (e) {}
    }
  }
  function checkPythonAsync() {
    var commands = ['python', 'python3'];
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
                if (fs.existsSync(fullPath)) commands.push(fullPath);
              }
            }
          }
        }
        if (localappdata) {
          var storePath = path.join(localappdata, "Microsoft", "WindowsApps", "python.exe");
          if (fs.existsSync(storePath)) commands.push(storePath);
        }
      }
    } catch (e) {}
    var uniqueCommands = [];
    for (var m = 0; m < commands.length; m++) {
      if (uniqueCommands.indexOf(commands[m]) === -1) uniqueCommands.push(commands[m]);
    }
    commands = uniqueCommands;
    function tryCmd(idx) {
      if (idx >= commands.length) { _pythonOk = false; _pythonCmd = ''; _pythonChecked = true; renderSetupStep(); _firePythonChecked(); return; }
      try {
        var proc = window.FileSystem.childProcess.spawn(commands[idx], ['--version']);
        proc.on('close', function (code) {
          if (code === 0) { _pythonOk = true; _pythonCmd = commands[idx]; _pythonChecked = true; renderSetupStep(); _firePythonChecked(); }
          else { tryCmd(idx + 1); }
        });
        proc.on('error', function () { tryCmd(idx + 1); });
      } catch (e) { tryCmd(idx + 1); }
    }
    tryCmd(0);
  }

  var _gpuDiag = [];

  function checkGpuAsync() {
    var extPath = "";
    try { var cs = new CSInterface(); extPath = cs.getSystemPath(SystemPath.EXTENSION); } catch (e) {}
    var scriptPath = (window.FileSystem.path && extPath) ? window.FileSystem.path.join(extPath, 'python', 'main.py') : 'main.py';
    _gpuDiag = [];
    try {
      var       proc = window.FileSystem.childProcess.spawn(_resolvePythonCmd(), [scriptPath, '--mode', 'gpu-info']);
      var stdout = '';
      var stderr = '';
      proc.stdout.on('data', function (d) { stdout += d.toString(); });
      proc.stderr.on('data', function (d) { stderr += d.toString(); });
      proc.on('close', function (code) {
        var lines = stdout.split('\n');
        for (var i = 0; i < lines.length; i++) {
          try {
            var j = JSON.parse(lines[i]);
            if (j.type === 'gpu_info') {
              _gpuInfo = JSON.parse(j.msg);
            } else if (j.type === 'warn' || j.type === 'error') {
              _gpuDiag.push((j.type === 'error' ? '[ERR] ' : '[WARN] ') + j.msg);
            } else if (j.type === 'info') {
              _gpuDiag.push(j.msg);
            }
          } catch (_) {}
        }
        if (!_gpuInfo && stderr) {
          var stderrLines = stderr.split('\n');
          for (var k = 0; k < stderrLines.length; k++) {
            var s = stderrLines[k].trim();
            if (s) _gpuDiag.push('[STDERR] ' + s);
          }
        }
        if (!_gpuInfo && code !== 0) {
          _gpuDiag.push('[ERR] Python exited with code ' + code);
        }
        _gpuChecked = true;
        renderSetupStep();
      });
      proc.on('error', function () { _gpuDiag.push('[ERR] Failed to spawn Python process'); _gpuChecked = true; renderSetupStep(); });
    } catch (e) { _gpuDiag.push('[ERR] ' + e.message); _gpuChecked = true; renderSetupStep(); }
  }

  var _pytorchExtra = '';
  function checkPytorchAsync() {
    try {
      var proc = window.FileSystem.childProcess.spawn(_resolvePythonCmd(), ['-c', 'import torch; print(torch.__version__); import cv2; print("cv2-ok")']);
      var stdout = '';
      proc.stdout.on('data', function (d) { stdout += d.toString(); });
      proc.on('close', function (code) {
        if (code === 0) {
          _pytorchOk = true;
          var lines = stdout.trim().split('\n');
          _pytorchExtra = lines[0] || '';
          if (lines.length > 1) _pytorchExtra += ' + OpenCV';
        }
        _pytorchChecked = true;
        renderSetupStep();
      });
      proc.on('error', function () { _pytorchChecked = true; renderSetupStep(); });
    } catch (e) { _pytorchChecked = true; renderSetupStep(); }
  }

  
  function renderAutoInstallStep() {
    var needs = [];
    if (!_ffmpegFound()) needs.push('FFmpeg');
    if (!_pytorchOk) {
      if (_gpuChoice === 'gpu' && _gpuInfo && _gpuInfo.nvidia_gpu_detected) {
        needs.push('PyTorch CUDA (auto-detected for ' + (_gpuInfo.nvidia_name || 'GPU') + ')');
      } else {
        needs.push('PyTorch CPU');
      }
    }
    needs.push('OpenCV + NumPy + Spandrel');
    _totalSteps = needs.length;
    _installedCount = 0;

    return '<div class="setup-card">' +
      '<h2>Installing</h2>' +
      '<p class="setup-desc" id="ts-install-substep">Preparing...</p>' +
      '<div class="ts-install-progress-wrap">' +
        '<div class="setup-progress-track">' +
          '<div id="ts-install-progress-fill" class="setup-progress-fill"></div>' +
        '</div>' +
        '<div id="ts-install-progress-label" class="ts-install-progress-label">0 / ' + _totalSteps + ' components</div>' +
      '</div>' +
      '<div id="ts-install-log" class="ts-install-log">Starting installation...</div>' +
      '<div class="setup-nav">' +
        '<button class="btn btn-secondary" onclick="cancelAutoInstall()" id="ts-install-cancel-btn"><i class="fa-solid fa-xmark"></i> Cancel</button>' +
        '<button class="btn btn-primary" onclick="goToSetupStep(\'check\')" id="ts-install-done-btn" style="display:none;"><i class="fa-solid fa-check"></i> Done</button>' +
      '</div>' +
    '</div></div>';
  }

  function _ffmpegFound() {
    if (!window.FileSystem || !window.FileSystem.fs) return false;
    return window.FileSystem.fs.existsSync(window.FileSystem.path.join(_toolsFolder, "ffmpeg.exe"));
  }

  function addInstallLog(msg) {
    _installLines.push(msg);
    if (_installLines.length > 200) _installLines.shift();
    var logEl = document.getElementById('ts-install-log');
    if (logEl) {
      logEl.innerHTML = _installLines.map(function (l) {
        var c = 'ts-log-line';
        if (l.indexOf('[OK]') === 0) c += ' ts-log-ok';
        else if (l.indexOf('[ERR]') === 0) c += ' ts-log-err';
        else if (l.indexOf('[WARN]') === 0) c += ' ts-log-warn';
        else if (l.indexOf('---') === 0) c += ' ts-log-section';
        return '<div class="' + c + '">' + escapeHtml(l) + '</div>';
      }).join('');
      logEl.scrollTop = logEl.scrollHeight;
    }
  }

  function updateInstallProgress(msg) {
    _installSubstep = msg;
    var el = document.getElementById('ts-install-substep');
    if (el) el.textContent = msg;
  }

  function incrementInstallProgress() {
    _installedCount++;
    var fill = document.getElementById('ts-install-progress-fill');
    var label = document.getElementById('ts-install-progress-label');
    if (fill) fill.style.width = Math.round((_installedCount / _totalSteps) * 100) + '%';
    if (label) label.textContent = _installedCount + ' / ' + _totalSteps + ' components';
  }

  
  function downloadAndInstallPortablePython() {
    _step = 'autoinstall';
    _installRunning = true;
    _installLines = [];
    renderSetupStep();
    updateInstallProgress('Downloading Python 3.10...');
    addInstallLog('--- Portable Python ---');
    var https = require('https');
    var fs = require('fs');
    var path = require('path');
    var crypto = require('crypto');
    var zipUrl = 'https://www.python.org/ftp/python/3.10.11/python-3.10.11-embed-amd64.zip';
    var pipUrl = 'https://bootstrap.pypa.io/get-pip.py';
    var expectedPipSha = 'a341e1a43e38001c551a1508a73ff23636a11970b61d901d9a1cad2a18f57055';
    var expectedSha = 'bd68b33221b795b7c0b8c2eebf9b119d8a2972be1e34abc64c5eb6e04bf8e6da';
    var zipPath = path.join(_toolsFolder, 'python_temp.zip');
    var pythonDestFolder = path.join(_toolsFolder, 'python');
    window.FileSystem.createFolder(_toolsFolder);
    window.FileSystem.createFolder(pythonDestFolder);
    var file = fs.createWriteStream(zipPath);
    var request = https.get(zipUrl, function (response) {
      if (response.statusCode !== 200) { addInstallLog('[ERR] Download failed: HTTP ' + response.statusCode); finishAutoInstall(false); return; }
      var len = parseInt(response.headers['content-length'], 10) || 1;
      var downloaded = 0;
      response.on('data', function (chunk) {
        downloaded += chunk.length;
        var pct = Math.round((downloaded / len) * 100);
        var fill = document.getElementById('ts-install-progress-fill');
        if (fill) fill.style.width = pct + '%';
      });
      response.pipe(file);
      file.on('finish', function () {
        file.close(function () {
          
          var fileBuf = fs.readFileSync(zipPath);
          var hash = crypto.createHash('sha256').update(fileBuf).digest('hex');
          if (hash !== expectedSha) {
            addInstallLog('[ERR] Python download SHA-256 mismatch! Security check failed.');
            addInstallLog('[ERR] Expected: ' + expectedSha);
            addInstallLog('[ERR] Got:      ' + hash);
            try { fs.unlinkSync(zipPath); } catch (e) {}
            finishAutoInstall(false);
            return;
          }
          addInstallLog('[OK] SHA-256 verified');
          addInstallLog('Extracting portable Python...');
          try {
            window.FileSystem.extractZipPowerShell(zipPath, pythonDestFolder);
            
            var pthPath = path.join(pythonDestFolder, 'python310._pth');
            try {
              var pthContent = fs.readFileSync(pthPath, 'utf8');
              // Enable the site module so Lib\site-packages is added to sys.path.
              pthContent = pthContent.replace('#import site', 'import site');
              if (pthContent.indexOf('import site') === -1) {
                pthContent = pthContent.replace(/[\r\n]+$/, '') + '\r\nimport site\r\n';
              }
              // The shipped _pth has no site-packages entry; guarantee one exists
              // (match either slash style, commented or not) and add it otherwise.
              if (!/^\s*(?:#\s*)?Lib[\\\/]site-packages\s*$/m.test(pthContent)) {
                pthContent = pthContent.replace(/[\r\n]+$/, '') + '\r\nLib\\site-packages\r\n';
              } else {
                pthContent = pthContent.replace(/^\s*#\s*(Lib[\\\/]site-packages)\s*$/m, '$1');
              }
              fs.writeFileSync(pthPath, pthContent, 'utf8');
              // The 'import site' mechanism only adds Lib\site-packages to sys.path
              // if the directory actually exists on disk; create it up front.
              try { window.FileSystem.createFolder(path.join(pythonDestFolder, 'Lib', 'site-packages')); }
              catch (e2) { fs.mkdirSync(path.join(pythonDestFolder, 'Lib', 'site-packages'), { recursive: true }); }
              addInstallLog('[OK] Patched python310._pth for pip + site-packages support');
            } catch (e) {
              // A failed patch leaves site-packages unimportable, so torch would
              // fail at runtime even though setup.py reports success. Treat as fatal.
              addInstallLog('[ERR] Could not patch _pth file: ' + e.message);
              try { fs.unlinkSync(zipPath); } catch (e3) {}
              finishAutoInstall(false);
              return;
            }
            var exePath = path.join(pythonDestFolder, 'python.exe');
            if (!fs.existsSync(exePath)) {
              addInstallLog('[ERR] python.exe not found after extraction');
              try { fs.unlinkSync(zipPath); } catch (e) {}
              finishAutoInstall(false);
              return;
            }
            addInstallLog('[OK] Portable Python extracted');
            
            addInstallLog('Downloading get-pip.py...');
            var pipPath = path.join(pythonDestFolder, 'get-pip.py');
            var pipReq = https.get(pipUrl, function (pipRes) {
              if (pipRes.statusCode !== 200) {
                addInstallLog('[WARN] get-pip.py download failed (HTTP ' + pipRes.statusCode + '). Skipping pip install.');
                _pythonOk = true; _pythonCmd = exePath; _pythonChecked = true;
                try { fs.unlinkSync(zipPath); } catch (e) {}
                _installRunning = false;
                startAutoInstall();
                return;
              }
              var pipFile = fs.createWriteStream(pipPath);
              pipRes.pipe(pipFile);
              pipFile.on('finish', function () {
                pipFile.close(function () {
                  var pipBuf = fs.readFileSync(pipPath);
                  var pipHash = crypto.createHash('sha256').update(pipBuf).digest('hex');
                  if (pipHash !== expectedPipSha) {
                    addInstallLog('[ERR] get-pip.py SHA-256 mismatch! Security check failed.');
                    addInstallLog('[ERR] Expected: ' + expectedPipSha);
                    addInstallLog('[ERR] Got:      ' + pipHash);
                    try { fs.unlinkSync(pipPath); } catch (e) {}
                    _pythonOk = true; _pythonCmd = exePath; _pythonChecked = true;
                    try { fs.unlinkSync(zipPath); } catch (e) {}
                    _installRunning = false;
                    startAutoInstall();
                    return;
                  }
                  addInstallLog('[OK] get-pip.py SHA-256 verified');
                  addInstallLog('Installing pip into portable Python...');
                  try {
                    var pipProc = window.FileSystem.childProcess.spawn(exePath, [pipPath], { cwd: pythonDestFolder, windowsHide: true });
                    pipProc.on('close', function (code) {
                      addInstallLog(code === 0 ? '[OK] pip installed' : '[WARN] pip install exited with code ' + code);
                      _pythonOk = true; _pythonCmd = exePath; _pythonChecked = true;
                      try { fs.unlinkSync(zipPath); } catch (e) {}
                      try { fs.unlinkSync(pipPath); } catch (e) {}
                      _installRunning = false;
                      startAutoInstall();
                    });
                    pipProc.on('error', function () {
                      addInstallLog('[WARN] Failed to run get-pip.py. Skipping.');
                      _pythonOk = true; _pythonCmd = exePath; _pythonChecked = true;
                      try { fs.unlinkSync(zipPath); } catch (e) {}
                      try { fs.unlinkSync(pipPath); } catch (e) {}
                      _installRunning = false;
                      startAutoInstall();
                    });
                  } catch (e) {
                    addInstallLog('[WARN] pip install error: ' + e.message);
                    _pythonOk = true; _pythonCmd = exePath; _pythonChecked = true;
                    try { fs.unlinkSync(zipPath); } catch (e) {}
                    try { fs.unlinkSync(pipPath); } catch (e) {}
                    _installRunning = false;
                    startAutoInstall();
                  }
                });
              });
            });
            pipReq.on('error', function (e) {
              addInstallLog('[WARN] get-pip.py download error: ' + e.message);
              _pythonOk = true; _pythonCmd = exePath; _pythonChecked = true;
              try { fs.unlinkSync(zipPath); } catch (e) {}
              _installRunning = false;
              startAutoInstall();
            });
          } catch (err) {
            addInstallLog('[ERR] Extraction failed: ' + err.message);
            try { fs.unlinkSync(zipPath); } catch (e) {}
            finishAutoInstall(false);
          }
        });
      });
    });
    request.on('error', function (err) { addInstallLog('[ERR] Download error: ' + err.message); finishAutoInstall(false); });
  }

  
  function startAutoInstall() {
    if (_installRunning) return;
    _installRunning = true;
    _installLines = [];
    var cancelBtn = document.getElementById('ts-install-cancel-btn');
    var doneBtn = document.getElementById('ts-install-done-btn');
    if (cancelBtn) cancelBtn.style.display = '';
    if (doneBtn) doneBtn.style.display = 'none';

    updateInstallProgress('Preparing installer...');
    addInstallLog('--- AniSmooth Environment Setup ---');
    try {
      window.FileSystem.createFolder(_toolsFolder);
      var cs = new CSInterface();
      var extPath = cs.getSystemPath(SystemPath.EXTENSION);
      var sourceSetup = window.FileSystem.path.join(extPath, 'python', 'setup.py');
      var destSetup = window.FileSystem.path.join(_toolsFolder, 'setup.py');
      var content = window.FileSystem.fs.readFileSync(sourceSetup, 'utf8');
      window.FileSystem.fs.writeFileSync(destSetup, content, 'utf8');
      addInstallLog('[OK] Setup script written to AppData');
    } catch (e) { addInstallLog('[ERR] Failed to write setup script: ' + e.message); finishAutoInstall(false); return; }

    var pythonCmd = _pythonCmd || 'python';
    addInstallLog('Running: ' + pythonCmd + ' setup.py');
    try {
      _installProc = window.FileSystem.childProcess.spawn(pythonCmd, ['setup.py'], { cwd: _toolsFolder, windowsHide: true });
      var proc = _installProc;
      var buf = '';
      proc.stdout.on('data', function (d) {
        buf += d.toString();
        var lines = buf.split('\n');
        buf = lines.pop();
        for (var i = 0; i < lines.length; i++) handleSetupLine(lines[i]);
      });
      proc.stderr.on('data', function (d) { addInstallLog('[WARN] ' + d.toString().trim()); });
      proc.on('close', function (code) {
        addInstallLog(code === 0 ? '[OK] Environment setup complete' : '[ERR] Setup exited with code ' + code);
        var fill = document.getElementById('ts-install-progress-fill');
        if (fill) fill.style.width = '100%';
        incrementInstallProgress();
        finishAutoInstall(code === 0);
      });
      proc.on('error', function (e) { addInstallLog('[ERR] Process error: ' + e.message); finishAutoInstall(false); });
    } catch (e) { addInstallLog('[ERR] Failed to spawn: ' + e.message); finishAutoInstall(false); }
  }

  function handleSetupLine(line) {
    line = line.trim();
    if (!line) return;
    try {
      var data = JSON.parse(line);
      var msg = data.msg || '';
      if (data.type === 'section') { addInstallLog('--- ' + msg + ' ---'); updateInstallProgress(msg); }
      else if (data.type === 'progress') {
        var fill = document.getElementById('ts-install-progress-fill');
        if (fill && data.pct !== undefined) fill.style.width = data.pct + '%';
      }
      else if (data.type === 'success') { addInstallLog('[OK] ' + msg); incrementInstallProgress(); }
      else if (data.type === 'error') { addInstallLog('[ERR] ' + msg); }
      else if (data.type === 'warn') { addInstallLog('[WARN] ' + msg); }
      else if (data.type === 'info') { addInstallLog(msg); }
      else if (data.type === 'summary') { addInstallLog('--- Setup Complete ---'); }
      else { addInstallLog(msg); }
    } catch (e) { addInstallLog(line); }
  }

  function finishAutoInstall(success) {
    _installProc = null;
    _installRunning = false;
    _pytorchChecked = false;
    var cancelBtn = document.getElementById('ts-install-cancel-btn');
    var doneBtn = document.getElementById('ts-install-done-btn');
    if (cancelBtn) cancelBtn.style.display = 'none';
    if (doneBtn) {
      doneBtn.style.display = '';
      doneBtn.onclick = function () {
        if (success) { _step = 'complete'; renderSetupStep(); }
        else {
          _pythonChecked = false; _gpuChecked = false; _pytorchChecked = false;
          goToSetupStep('check');
        }
      };
      doneBtn.innerHTML = '<i class="fa-solid fa-' + (success ? 'check' : 'arrow-left') + '"></i> ' + (success ? 'Continue' : 'Re-check');
    }
    var fill = document.getElementById('ts-install-progress-fill');
    if (fill) fill.style.width = success ? '100%' : '0%';
  }

  function cancelAutoInstall() {
    addInstallLog('[WARN] Cancelled by user');
    if (_installProc) { _installProc.kill(); _installProc = null; }
    _installRunning = false;
    finishAutoInstall(false);
  }

  
  function renderCompleteStep() {
    var allOk = _pythonOk;
    var gpuOk = _gpuChoice === 'gpu' && _gpuInfo && _gpuInfo.cuda_available;
    var modeLabel = _gpuChoice === 'gpu' ? 'GPU' : 'CPU';
    var gpuName = _gpuChoice === 'gpu' ? (_gpuInfo ? (_gpuInfo.nvidia_name || 'None') : 'Unknown') : 'N/A';
    return '<div class="setup-card">' +
      '<div class="setup-icon success"><i class="fa-solid fa-circle-check"></i></div>' +
      '<h2>Setup Complete</h2>' +
      '<div class="ts-summary">' +
        '<div class="ts-summary-row ' + (_pythonOk ? 'ts-ok' : 'ts-err') + '">' +
          '<i class="fa-solid fa-' + (_pythonOk ? 'check' : 'xmark') + '"></i> Python 3' +
        '</div>' +
        '<div class="ts-summary-row ' + (gpuOk ? 'ts-ok' : (_gpuChoice === 'gpu' ? (_gpuInfo && _gpuInfo.nvidia_gpu_detected ? 'ts-warn' : 'ts-err') : 'ts-ok')) + '">' +
          '<i class="fa-solid fa-' + (gpuOk ? 'check' : (_gpuChoice === 'gpu' ? (_gpuInfo && _gpuInfo.nvidia_gpu_detected ? 'exclamation' : 'xmark') : 'check')) + '"></i>' +
          ' ' + modeLabel + ' Mode' + (gpuOk ? ' — ' + gpuName + ' (CUDA)' : (_gpuChoice === 'cpu' ? '' : (_gpuInfo && _gpuInfo.nvidia_gpu_detected ? ' — ' + gpuName + ' (CPU PyTorch)' : ' (CPU)'))) +
        '</div>' +
        '<div class="ts-summary-row ' + (_pytorchOk ? 'ts-ok' : 'ts-warn') + '">' +
          '<i class="fa-solid fa-' + (_pytorchOk ? 'check' : 'exclamation') + '"></i>' +
          ' PyTorch ' + (_pytorchOk ? (_pytorchExtra || 'installed') : 'may need re-check') +
        '</div>' +
      '</div>' +
      '<button class="btn btn-primary" style="width:100%;" onclick="finishToolsSetup()"><i class="fa-solid fa-rocket"></i> Launch AniSmooth</button>' +
      '</div></div>';
  }

  
  function escapeHtml(text) {
    return String(text || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
  }
  function formatVram(mb) {
    if (mb >= 1024) return (mb / 1024).toFixed(1) + ' GB';
    return mb + ' MB';
  }

  function skipToolsSetup() { window.StorageManager.setItem('anismooth_setup_skipped', '1'); hideToolsSetup(); }

  function finishToolsSetup() {
    var pythonPath = _resolvePythonCmd();
    if (pythonPath) {
      window.StorageManager.setItem('anismooth_python_path', pythonPath);
      if (window.App && window.App.settings) {
        window.App.settings.pythonPath = pythonPath;
        var pi = document.getElementById("pythonPathInput");
        if (pi) pi.value = pythonPath;
      }
    }
    if (_gpuChoice) {
      window.StorageManager.setItem('anismooth_gpu_choice', _gpuChoice);
    }
    window.StorageManager.setItem('anismooth_setup_complete', '1');
    if (window.App && window.App.refreshGpuInfo) {
      window.App.refreshGpuInfo();
    }
    if (window.App && window.App._buildGpuModeSelector) {
      window.App._buildGpuModeSelector();
    }
    hideToolsSetup();
  }

  function scanToolsAndRefresh() { _pythonChecked = false; _gpuChecked = false; _pytorchChecked = false; _gpuDiag = []; _gpuDownloadState = null; renderSetupStep(); }

  function goToSetupStep(step) {
    if (step === 'check') { _pythonChecked = false; _gpuChecked = false; _pytorchChecked = false; _gpuDiag = []; }
    if (step === 'welcome') { _gpuChoice = null; _gpuDownloadState = null; }
    _step = step;
    renderSetupStep();
  }

  function showToolsSetupForGpuInstall() {
    var gate = document.getElementById('tools-setup-gate');
    if (!gate) {
      gate = document.createElement('div');
      gate.id = 'tools-setup-gate';
      gate.className = 'setup-gate';
      document.body.appendChild(gate);
    }
    gate.style.display = 'flex';
    _step = 'gpuchoice';
    _gpuChoice = 'gpu';
    _gpuDownloadState = null;
    _gpuChecked = false;
    _pytorchChecked = false;
    _installRunning = false;
    _installLines = [];
    _toolsFolder = (window.App && window.App.anismoothToolsFolder) || _resolveDefaultFolder();
    renderSetupStep();
  }

  function checkAndShowIfNeeded() {
    var complete = window.StorageManager.getItem('anismooth_setup_complete', '0');
    var skipped = window.StorageManager.getItem('anismooth_setup_skipped', '0');
    if (complete !== '1' && skipped !== '1') { showToolsSetup(); return true; }
    return false;
  }

  window.ToolsSetup = { showToolsSetup: showToolsSetup, showToolsSetupForGpuInstall: showToolsSetupForGpuInstall, checkAndShowIfNeeded: checkAndShowIfNeeded, renderSetupStep: renderSetupStep };
  window.goToSetupStep = goToSetupStep;
  window.scanToolsAndRefresh = scanToolsAndRefresh;
  window.skipToolsSetup = skipToolsSetup;
  window.finishToolsSetup = finishToolsSetup;
  window.cancelAutoInstall = cancelAutoInstall;
  window.downloadAndInstallPortablePython = downloadAndInstallPortablePython;
  window.selectGpuChoice = selectGpuChoice;
  window.confirmGpuChoice = confirmGpuChoice;
  window.installGpuFromSetup = function () {
    hideToolsSetup();
    setTimeout(function () {
      if (window.App && window.App.installCudaPytorch) {
        window.App.installCudaPytorch();
      }
    }, 300);
  };
  window.copyGpuDiag = function () {
    var text = _gpuDiag.join('\n');
    if (!text) return;
    try {
      navigator.clipboard.writeText(text);
      window.showToast && window.showToast('Diagnostic log copied to clipboard.', 'ok');
    } catch (e) {
      try {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        window.showToast && window.showToast('Diagnostic log copied to clipboard.', 'ok');
      } catch (_) {}
    }
  };
})();
