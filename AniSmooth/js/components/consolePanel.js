(function () {
  var ConsolePanel = {
    init: function(app) {
      this.app = app;
      this.active = false;
      this.bindEvents();
    },

    isActive: function() {
      return this.active;
    },

    bindEvents: function() {
      var self = this;

      var searchInput = document.getElementById('consoleSearch');
      if (searchInput) {
        searchInput.addEventListener('input', function() {
          window.setLogFilter('search', this.value);
        });
      }

      var cats = document.querySelectorAll('.console-cat');
      cats.forEach(function(cat) {
        cat.addEventListener('click', function() {
          cats.forEach(function(c) { c.classList.remove('active'); });
          this.classList.add('active');
          window.setLogFilter('mode', this.dataset.mode);
        });
      });

      var clearBtn = document.getElementById('consoleClearBtn');
      if (clearBtn) {
        clearBtn.addEventListener('click', function() {
          window.clearLog();
        });
      }

      var exportBtn = document.getElementById('consoleExportBtn');
      if (exportBtn) {
        exportBtn.addEventListener('click', function() {
          window.exportLog();
        });
      }
    },

    getLevelIcon: function(level) {
      switch (level) {
        case 'error': return 'fa-solid fa-circle-xmark';
        case 'warn':  return 'fa-solid fa-triangle-exclamation';
        case 'success': return 'fa-solid fa-circle-check';
        case 'debug': return 'fa-solid fa-code';
        case 'info':
        default: return 'fa-solid fa-circle-info';
      }
    },

    renderLogContent: function() {
      var container = document.getElementById('consoleEntries');
      if (!container) return;

      var logs = getFilteredAndSortedLogs();

      if (logs.length === 0) {
        container.innerHTML =
          '<div class="console-empty">' +
          '  <i class="fa-solid fa-terminal"></i>' +
          '  <span>No log entries yet</span>' +
          '</div>';
        return;
      }

      var wasAtBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 30;

      var html = '';
      logs.forEach(function(entry) {
        var timeStr = entry.time.toISOString().replace('T', ' ').substring(11, 19);
        var iconClass = ConsolePanel.getLevelIcon(entry.level);
        var modeBadge = entry.mode ? '<span class="console-entry-mode">' + window.escapeHtmlLog(entry.mode) + '</span>' : '';

        html +=
          '<div class="console-entry console-' + entry.level + '">' +
          '  <div class="console-entry-header">' +
          '    <span class="console-entry-icon"><i class="' + iconClass + '"></i></span>' +
          '    <span class="console-entry-source">' + window.escapeHtmlLog(entry.source) + '</span>' +
          modeBadge +
          '    <span class="console-entry-time">' + timeStr + '</span>' +
          '  </div>' +
          '  <div class="console-entry-message">' + window.escapeHtmlLog(entry.message) + '</div>' +
          '</div>';
      });

      container.innerHTML = html;
      if (wasAtBottom || container.dataset.firstRender !== "done") {
        container.scrollTop = container.scrollHeight;
        container.dataset.firstRender = "done";
      }
    }
  };

  window.ConsolePanel = ConsolePanel;
})();
