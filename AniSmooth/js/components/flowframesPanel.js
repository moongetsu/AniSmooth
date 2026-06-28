(function () {
  var FlowframesPanel = {
    init: function (app) {
      this.app = app;
      this.view = document.getElementById('flowframesView');
      this.aiSelect = document.getElementById('flowframesAi');
      this.modelSelect = document.getElementById('flowframesModel');
      this.formatSelect = document.getElementById('flowframesFormat');
      this.encoderSelect = document.getElementById('flowframesEncoder');
      this.pixFmtSelect = document.getElementById('flowframesPixFmt');
      this.factorContainer = document.getElementById('flowframesFactor');
      this.factorCustom = document.getElementById('ffFactorCustom');
      this.startBtn = document.getElementById('startFlowframesBtn');
      this._sourceInfo = null;
      this.bindEvents();
      this.initVersionToggle();
      this.applyVersion();
      this.applyAiFilter();
      this.checkAvailability();
      this.renderFactorInfo();
    },

    getFactor: function () {
      if (this.factorCustom && this.factorCustom.value) {
        var v = parseInt(this.factorCustom.value, 10);
        if (v >= 2 && v <= 16) return v;
      }
      if (this.factorContainer) {
        var a = this.factorContainer.querySelector('.factor-btn.active');
        if (a) return parseInt(a.getAttribute('data-value'), 10);
      }
      return 2;
    },

    bindEvents: function () {
      var s = this;
      if (this.startBtn) this.startBtn.addEventListener('click', function () { s.addToQueue(); });
      if (this.factorContainer) {
        this.factorContainer.addEventListener('click', function (e) {
          var el = e.target;
          while (el && el !== s.factorContainer) {
            if (el.classList && el.classList.contains('factor-btn')) break;
            el = el.parentElement;
          }
          if (!el || el === s.factorContainer) return;
          var btns = s.factorContainer.querySelectorAll('.factor-btn');
          for (var i = 0; i < btns.length; i++) btns[i].classList.remove('active');
          el.classList.add('active');
          if (s.factorCustom) s.factorCustom.value = '';
          s.renderFactorInfo();
        });
      }
      if (this.factorCustom) {
        this.factorCustom.addEventListener('input', function () {
          var btns = s.factorContainer.querySelectorAll('.factor-btn');
          for (var i = 0; i < btns.length; i++) btns[i].classList.remove('active');
          s.renderFactorInfo();
        });
      }
      if (this.aiSelect) {
        this.aiSelect.addEventListener('change', function () { s.applyAiFilter(); });
      }
    },

    initVersionToggle: function () {
      var toggle = document.getElementById('ffVersionToggle');
      if (!toggle) return;
      var settingsVer = (window.App && window.App.settings && window.App.settings.flowframesVersion) || "1.36.0";
      if (settingsVer !== "both") {
        toggle.style.display = 'none';
        return;
      }
      if (!window.FlowframesHandler || !window.FlowframesHandler.availableVersions) {
        toggle.style.display = 'none';
        return;
      }
      var list = window.FlowframesHandler.availableVersions();
      var available = [];
      for (var i = 0; i < list.length; i++) {
        if (list[i].available) available.push(list[i].version);
      }
      if (available.length < 2) {
        toggle.style.display = 'none';
        return;
      }
      toggle.style.display = '';
      var verSelect = document.getElementById('flowframesVersionSelect');
      var currentVer = (window.App && window.App.settings && window.App.settings.flowframesVersionActive) || "1.36.0";
      if (verSelect) verSelect.value = currentVer;
      var s = this;
      if (verSelect) {
        verSelect.addEventListener('change', function () {
          var ver = verSelect.value;
          if (!ver) return;
          if (window.App && window.App.settings) {
            window.App.settings.flowframesVersionActive = ver;
            window.StorageManager.setItem("anismooth_flowframes_version_active", ver);
          }
          s.applyVersion();
          s.applyAiFilter();
          s.checkAvailability();
          dbg('info', 'Flowframes', 'Version switched to: ' + ver);
        });
      }
    },

    applyAiFilter: function () {
      var ai = this.aiSelect ? this.aiSelect.value : '';
      if (!this.modelSelect || !ai) return;
      var options = this.modelSelect.querySelectorAll('.select-option');
      var firstVisible = null;
      var currentVal = this.modelSelect.value;
      var currentVisible = false;
      var version = window.FlowframesHandler && window.FlowframesHandler.getEffectiveVersion ? window.FlowframesHandler.getEffectiveVersion() : "1.36.0";
      for (var j = 0; j < options.length; j++) {
        var optAi = options[j].getAttribute('data-ff-ai') || '';
        var optVer = options[j].getAttribute('data-ff-version') || '';
        var aiMatch = !optAi || optAi.split(/\s+/).indexOf(ai) !== -1;
        var versionMatch = !optVer || optVer.split(/\s+/).indexOf(version) !== -1;
        var show = aiMatch && versionMatch;
        options[j].style.display = show ? '' : 'none';
        if (show && !firstVisible) firstVisible = options[j];
        if (show && options[j].getAttribute('data-value') === currentVal) currentVisible = true;
      }
      if (!currentVisible && firstVisible) this.modelSelect.value = firstVisible.getAttribute('data-value');
    },

    checkAvailability: function () {
      var hint = document.getElementById('ffStatusHint');
      if (!hint) return;
      if (window.FlowframesHandler && window.FlowframesHandler.isAvailable()) {
        hint.style.display = 'none';
      } else {
        hint.style.display = '';
        hint.innerHTML = '<span class="meta-strip meta-strip-dim"><i class="fa-solid fa-triangle-exclamation"></i> Flowframes.exe not found — set its path in Settings → Python → Flowframes.</span>';
      }
      this.applyVersion();
    },

    applyVersion: function () {
      var version = window.FlowframesHandler && window.FlowframesHandler.getEffectiveVersion ? window.FlowframesHandler.getEffectiveVersion() : "1.36.0";
      var selects = this.view ? this.view.querySelectorAll('.custom-select') : null;
      if (selects) {
        for (var i = 0; i < selects.length; i++) {
          var options = selects[i].querySelectorAll('.select-option');
          var firstVisible = null;
          var currentVal = selects[i].value;
          var currentVisible = false;
          for (var j = 0; j < options.length; j++) {
            var optVer = options[j].getAttribute('data-ff-version') || '';
            var show = !optVer || optVer.split(/\s+/).indexOf(version) !== -1;
            options[j].style.display = show ? '' : 'none';
            if (show && !firstVisible) firstVisible = options[j];
            if (show && options[j].getAttribute('data-value') === currentVal) currentVisible = true;
          }
          if (!currentVisible && firstVisible) selects[i].value = firstVisible.getAttribute('data-value');
        }
      }
      var labels = this.view ? this.view.querySelectorAll('[data-ff-version-label]') : null;
      if (labels) {
        for (var k = 0; k < labels.length; k++) {
          var lv = labels[k].getAttribute('data-ff-version-label') || '';
          labels[k].style.display = (lv.split(/\s+/).indexOf(version) !== -1) ? '' : 'none';
        }
      }
      this.applyAiFilter();
      dbg('debug', 'Flowframes', 'Version filter applied: ' + version);
    },

    refreshLayerInfo: function () {
      var s = this;
      if (!window.__adobe_cep__ || !window.__adobe_cep__.evalScript) {
        if (s._sourceInfo !== null) { s._sourceInfo = null; s.renderLayerInfo(); }
        return;
      }
      if (this._fetching) return;
      this._fetching = true;
      window.__adobe_cep__.evalScript('getSelectedLayerInfo()', function (r) {
        s._fetching = false;
        var raw = r || '{}';
        if (raw === s._lastRaw) return;
        s._lastRaw = raw;
        try { s._sourceInfo = JSON.parse(raw); } catch (e) { s._sourceInfo = null; }
        s.renderLayerInfo();
        s.renderFactorInfo();
      });
    },

    renderFactorInfo: function () {
      var el = document.getElementById('ffFactorInfo');
      if (!el) return;
      var f = this.getFactor();
      var s = this._sourceInfo;
      var fps = (s && s.ok) ? (s.frameRate || s.compFrameRate || 0) : 0;
      var line = fps > 0
        ? '<i class="fa-solid fa-arrow-right"></i> ' + fps.toFixed(2) + ' fps → <b class="meta-hi">' + (fps * f).toFixed(2) + ' fps</b>'
        : '<i class="fa-solid fa-arrow-right"></i> ×<b>' + f + '</b> · ' + (f - 1) + ' new frames per pair';
      el.innerHTML = '<span class="meta-strip meta-strip-sm">' + line + '</span>';
    },

    renderLayerInfo: function () {
      var el = document.getElementById('ffLayerInfo');
      if (!el) return;
      var s = this._sourceInfo;
      if (!s || !s.ok) {
        el.innerHTML = '<span class="meta-strip meta-strip-dim"><i class="fa-solid fa-layer-group"></i> Select a footage layer</span>';
        return;
      }
      var w = s.width || 0, h = s.height || 0, fps = s.frameRate || s.compFrameRate || 0, dur = s.layerDuration || s.compDuration || s.duration || 0, frames = Math.round((dur || 0) * fps), parts = [];
      if (w > 0 && h > 0) parts.push('<span>' + w + '<b>×</b>' + h + '</span>');
      if (fps > 0) parts.push('<span>' + fps.toFixed(2) + ' fps</span>');
      if (frames > 0) parts.push('<span>' + frames + ' frames</span>');
      el.innerHTML = '<span class="meta-strip"><i class="fa-solid fa-film"></i> <b>' + esc(s.layerName || s.name || '') + '</b>' + (parts.length ? ' · ' + parts.join(' · ') : '') + '</span>';
    },

    addToQueue: function () {
      var s = this._sourceInfo;
      if (!s || !s.ok) {
        window.showToast('Select a footage layer first.', 'error');
        return;
      }
      if (!window.FlowframesHandler || !window.FlowframesHandler.isAvailable()) {
        window.showToast('Flowframes.exe not found. Set its path in Settings.', 'error');
        return;
      }
      window.QueueManager.add({
        mode: 'flowframes',
        task: 'Flowframes',
        name: s.layerName || s.name || 'Footage',
        layerIndex: s.layerIndex || 0,
        ai: this.aiSelect ? this.aiSelect.value : 'RifeNcnn',
        model: this.modelSelect ? this.modelSelect.value : 'RIFE 4.26',
        format: this.formatSelect ? this.formatSelect.value : 'Mp4',
        encoder: this.encoderSelect ? this.encoderSelect.value : 'X264',
        pixFmt: this.pixFmtSelect ? this.pixFmtSelect.value : 'Yuv420P',
        factor: this.getFactor(),
        width: s.width || 0,
        height: s.height || 0,
        fps: s.frameRate || s.compFrameRate || 0
      });
      this.app.switchTab('queue');
    }
  };

  function esc(t) {
    var d = document.createElement('div');
    d.appendChild(document.createTextNode(t || ''));
    return d.innerHTML;
  }

  window.FlowframesPanel = FlowframesPanel;
})();
