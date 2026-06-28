(function () {
  var FlowframesPanel = {
    init: function (app) {
      this.app = app;
      this.view = document.getElementById('flowframesView');
      this.aiSelect = document.getElementById('flowframesAi');
      this.modelSelect = document.getElementById('flowframesModel');
      this.encoderSelect = document.getElementById('flowframesEncoder');
      this.factorContainer = document.getElementById('flowframesFactor');
      this.factorCustom = document.getElementById('ffFactorCustom');
      this.startBtn = document.getElementById('startFlowframesBtn');
      this._sourceInfo = null;
      this.bindEvents();
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
        encoder: this.encoderSelect ? this.encoderSelect.value : 'X264',
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
