(function () {
  var QueuePanel = {
    init: function (app) {
      this.app = app;
      this.view = document.getElementById("queueView");

      window.QueueManager.init();

      var self = this;
      this.pauseBtn = document.getElementById("queuePauseBtn");
      this.cancelBtn = document.getElementById("queueCancelBtn");
      this.clearBtn = document.getElementById("queueClearBtn");

      if (this.pauseBtn) {
        this.pauseBtn.addEventListener("click", function () {
          window.QueueManager.togglePause();
        });
      }
      if (this.cancelBtn) {
        this.cancelBtn.addEventListener("click", function () {
          window.QueueManager.cancelAll();
        });
      }
      if (this.clearBtn) {
        this.clearBtn.addEventListener("click", function () {
          window.QueueManager.clearDone();
        });
      }

      window.QueueManager.onUpdate(function () {
        self.render();
      });
    },

    render: function () {
      var container = document.getElementById("queueEntries");
      if (!container) return;

      var queue = window.QueueManager.getAll();
      var running = window.QueueManager.isRunning();
      var paused = window.QueueManager.isPaused();

      var pauseBtn = document.getElementById("queuePauseBtn");
      var cancelBtn = document.getElementById("queueCancelBtn");
      var clearBtn = document.getElementById("queueClearBtn");
      if (pauseBtn) {
        pauseBtn.style.display = (running || paused) ? "" : "none";
        if (paused) {
          pauseBtn.innerHTML = '<i class="fa-solid fa-play"></i> Resume';
        } else {
          pauseBtn.innerHTML = '<i class="fa-solid fa-pause"></i> Pause';
        }
      }
      if (cancelBtn) cancelBtn.style.display = running ? "" : "none";
      if (clearBtn) {
        var hasDone = false;
        for (var i = 0; i < queue.length; i++) {
          if (queue[i].status === "done" || queue[i].status === "error" || queue[i].status === "cancelled") {
            hasDone = true; break;
          }
        }
        clearBtn.style.display = hasDone ? "" : "none";
      }

      if (queue.length === 0) {
        container.innerHTML =
          '<div class="queue-empty">' +
            '<img src="' + ((window.AniSmoothTheme && window.AniSmoothTheme.getLogo("iconOnly")) || "./images/AniSmooth-Logo-Only.png") + '" alt="AniSmooth Logo" style="height: 54px; width: auto; object-fit: contain; opacity: 0.15; margin-bottom: 6px;">' +
            '<p>Queue is empty</p>' +
            '<span>Add jobs from the Interpolation or Upscale tabs</span>' +
          '</div>';
        return;
      }

      var hasActive = running;
      var html = '';
      html += '<div class="queue-summary">' +
        queue.length + ' item' + (queue.length !== 1 ? 's' : '') +
        (paused ? ' · Paused' : (hasActive ? ' · Processing' : ' · Idle')) +
      '</div>';

      for (var i = 0; i < queue.length; i++) {
        var item = queue[i];
        var icon, rowCls;
        if (item.status === "processing") { icon = "fa-spinner fa-spin"; rowCls = "q-row-processing"; }
        else if (item.status === "done") { icon = "fa-circle-check"; rowCls = "q-row-done"; }
        else if (item.status === "error") { icon = "fa-circle-xmark"; rowCls = "q-row-error"; }
        else if (item.status === "cancelled") { icon = "fa-circle-stop"; rowCls = "q-row-cancelled"; }
        else { icon = "fa-circle"; rowCls = ""; }

        var taskIcon = item.mode === "upscale" ? "fa-maximize" : (item.mode === "dedupe" ? "fa-scissors" : "fa-forward");
        var taskLabel = item.mode === "upscale" ? "Upscale" : (item.mode === "dedupe" ? "Dedupe" : "Interpolation");
        var scaleLabel = item.mode === "upscale" ? (item.scale + "×") : (item.mode === "dedupe" ? ("t=" + (item.threshold || 0.05)) : (item.factor + "×"));

        var progressHtml = "";
        if (item.status === "processing" && typeof item.progress === "number") {
          var elapsedMs = item.elapsed || (item.startedAt ? Date.now() - item.startedAt : 0);
          var elapsedStr = formatDur(elapsedMs);
          var etaStr = "";
          if (item.progress > 0 && item.progress < 100) {
            var remainingMs = (elapsedMs / item.progress) * (100 - item.progress);
            etaStr = '<span class="q-eta">~' + formatDur(remainingMs) + ' left</span>';
          }
          progressHtml =
            '<div class="q-progress-wrap">' +
              '<div class="q-progress-track">' +
                '<div class="q-progress-fill" style="width:' + item.progress + '%"></div>' +
              '</div>' +
              '<div class="q-progress-info">' +
                '<span class="q-progress-pct">' + item.progress + '%</span>' +
                '<span class="q-elapsed">' + elapsedStr + '</span>' +
                etaStr +
              '</div>' +
            '</div>';
        } else if ((item.status === "done" || item.status === "error") && item.elapsed) {
          progressHtml = '<div class="q-took">Took ' + formatDur(item.elapsed) + '</div>';
        }

        html +=
          '<div class="q-row ' + rowCls + '">' +
            '<i class="fa-solid ' + icon + ' q-status"></i>' +
            '<div class="q-info">' +
            '<div class="q-name">' + escapeHtml(item.name) + '</div>' +
            '<div class="q-meta">' +
              '<i class="fa-solid ' + taskIcon + '"></i> ' + taskLabel + ' · ' + scaleLabel + ' · ' + escapeHtml(item.model ? item.model.replace("rife4.25", "RIFE 4.25") : "Unknown Model") +
              (item.preRenderPath ? ' · <i class="fa-solid fa-film"></i> pre-render saved' : '') +
            '</div>' +
              (item.status === "error" ? '<div class="q-err">' + escapeHtml(item.error || "Unknown error") + '</div>' : '') +
              progressHtml +
            '</div>' +
            (item.status === "queued"
              ? '<button class="q-remove" data-id="' + item.id + '"><i class="fa-solid fa-xmark"></i></button>'
              : (item.status === "processing"
                ? '<button class="q-cancel"><i class="fa-solid fa-stop"></i></button>'
                : '')) +
          '</div>';
      }
      container.innerHTML = html;

      var self = this;
      var removes = container.querySelectorAll(".q-remove");
      for (var j = 0; j < removes.length; j++) {
        removes[j].addEventListener("click", function (e) {
          e.stopPropagation();
          var id = this.getAttribute("data-id");
          if (id) window.QueueManager.remove(id);
        });
      }
      var cancels = container.querySelectorAll(".q-cancel");
      for (var k = 0; k < cancels.length; k++) {
        cancels[k].addEventListener("click", function (e) {
          e.stopPropagation();
          window.QueueManager.cancelItem();
        });
      }
    }
  };

  function escapeHtml(text) {
    var div = document.createElement("div");
    div.appendChild(document.createTextNode(text || ""));
    return div.innerHTML;
  }

  function formatDur(ms) {
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

  
  setInterval(function () {
    var running = window.QueueManager && window.QueueManager._running;
    if (running && QueuePanel.view && !QueuePanel.view.classList.contains("hidden")) {
      QueuePanel.render();
    }
  }, 1000);

  window.QueuePanel = QueuePanel;
})();
