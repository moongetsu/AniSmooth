(function () {
  var DeadframesPanel = {
    init: function (app) {
      this.app = app;
      this.view = document.getElementById("deadframesView");
      this.thresholdInput = document.getElementById("deadframeThreshold");
      this.removeBtn = document.getElementById("removeDeadframesBtn");
      this._sourceInfo = null;
      this.bindEvents();
    },

    bindEvents: function () {
      var self = this;
      if (this.removeBtn) {
        this.removeBtn.addEventListener("click", function () { self.addToQueue(); });
      }
    },

    refreshLayerInfo: function () {
      var self = this;
      if (!window.__adobe_cep__ || !window.__adobe_cep__.evalScript) return;
      if (this._fetching) return;
      this._fetching = true;
      window.__adobe_cep__.evalScript("getSelectedLayerInfo()", function (result) {
        self._fetching = false;
        try { self._sourceInfo = JSON.parse(result || "{}"); } catch (e) { self._sourceInfo = null; }
      });
    },

    addToQueue: function () {
      var s = this._sourceInfo;
      if (!s || !s.ok) {
        window.showToast("Select a footage layer in the timeline first.", "error");
        return;
      }
      var threshold = this.thresholdInput ? parseFloat(this.thresholdInput.value) : 0.05;
      // Read the advanced controls so they actually affect the run (previously
      // this passed {} and the four toggles/inputs were dead).
      var regionEl = document.getElementById("deadframeRegionSensitivity");
      var ofEl = document.getElementById("deadframeOpticalFlow");
      var camEl = document.getElementById("deadframeCameraComp");
      var staticEl = document.getElementById("deadframeStaticSubject");
      var options = {
        regionSensitivity: regionEl ? (parseInt(regionEl.value, 10) || 1) : 1,
        useOpticalFlow: ofEl ? !!ofEl.checked : true,
        cameraCompensation: camEl ? !!camEl.checked : true,
        removeStaticSubject: staticEl ? !!staticEl.checked : true
      };
      window.QueueManager.add({
        mode: "dedupe",
        task: "Dedupe",
        name: s.layerName || s.name || "Footage",
        layerIndex: s.layerIndex || 0,
        threshold: threshold,
        options: options,
        width: s.width || 0,
        height: s.height || 0
      });
    }
  };

  window.DeadframesPanel = DeadframesPanel;
})();
