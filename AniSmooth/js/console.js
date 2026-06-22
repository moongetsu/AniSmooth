window.consoleLog = [];
window.consoleMaxEntries = 500;
window.consoleFilter = { level: 'all', source: 'all', search: '', mode: 'all' };
window.consoleSort = { by: 'time', order: 'asc' };

function dbg(level, source, message, mode) {
  const entry = {
    time: new Date(),
    level: level,
    source: source,
    message: String(message || ''),
    mode: mode || ''
  };

  window.consoleLog.push(entry);

  if (window.consoleLog.length > window.consoleMaxEntries) {
    window.consoleLog.shift();
  }

  var browserLevel = level === 'success' ? 'info' : (level === 'warn' ? 'warn' : (level === 'error' ? 'error' : 'log'));
  try {
    var prefix = '[' + source + ']';
    console[browserLevel](prefix, message);
  } catch (e) {}

  if (window.ConsolePanel && window.ConsolePanel.isActive && window.ConsolePanel.isActive()) {
    window.ConsolePanel.renderLogContent();
  }
}

function getFilteredAndSortedLogs() {
  var logs = window.consoleLog.slice();
  var filter = window.consoleFilter;

  if (filter.level !== 'all') {
    logs = logs.filter(function(entry) {
      return entry.level === filter.level;
    });
  }

  if (filter.mode !== 'all') {
    logs = logs.filter(function(entry) {
      return entry.mode === filter.mode;
    });
  }

  if (filter.search) {
    var search = filter.search.toLowerCase();
    logs = logs.filter(function(entry) {
      return entry.message.toLowerCase().indexOf(search) !== -1 ||
             entry.source.toLowerCase().indexOf(search) !== -1;
    });
  }

  var sort = window.consoleSort;
  logs.sort(function(a, b) {
    var result;
    switch (sort.by) {
      case 'source':
        result = a.source.localeCompare(b.source);
        break;
      case 'level':
        var levels = { error: 0, warn: 1, info: 2, debug: 3, success: 4 };
        result = (levels[a.level] || 2) - (levels[b.level] || 2);
        break;
      default:
        result = a.time - b.time;
    }
    return sort.order === 'desc' ? -result : result;
  });

  return logs;
}

window.setLogFilter = function(type, value) {
  if (type === 'level') window.consoleFilter.level = value;
  if (type === 'mode') window.consoleFilter.mode = value;
  if (type === 'search') window.consoleFilter.search = value;
  if (window.ConsolePanel && window.ConsolePanel.renderLogContent) window.ConsolePanel.renderLogContent();
};

window.setLogSort = function(by) {
  if (window.consoleSort.by === by) {
    window.consoleSort.order = window.consoleSort.order === 'asc' ? 'desc' : 'asc';
  } else {
    window.consoleSort.by = by;
    window.consoleSort.order = 'desc';
  }
  if (window.ConsolePanel && window.ConsolePanel.renderLogContent) window.ConsolePanel.renderLogContent();
};

window.clearLog = function() {
  window.consoleLog = [];
  if (window.ConsolePanel && window.ConsolePanel.renderLogContent) window.ConsolePanel.renderLogContent();
  dbg('info', 'Console', 'Log cleared');
};

window.exportLog = function() {
  var logs = getFilteredAndSortedLogs();
  var text = 'AniSmooth Console Log\n';
  text += 'Export: ' + new Date().toISOString() + '\n';
  text += 'Entries: ' + logs.length + '\n';
  text += Array(60).join('-') + '\n\n';

  logs.forEach(function(entry) {
    var time = entry.time.toISOString().replace('T', ' ').substring(0, 19);
    text += '[' + time + '] ' + entry.level.toUpperCase() + ' [' + entry.source + '] ' + entry.message + '\n';
  });

  try {
    var outDir = (window.FileSystem && window.FileSystem.os)
      ? window.FileSystem.os.homedir()
      : "";
    if (!outDir && window.App && window.App.settings.outputPath) {
      outDir = window.App.settings.outputPath;
    }
    var ts = new Date().toISOString().replace(/[:.]/g, "-").substring(0, 19);
    var filePath = window.FileSystem.path.join(outDir || "C:\\", "anismooth-log-" + ts + ".txt");
    window.FileSystem.fs.writeFileSync(filePath, text, "utf8");
    dbg("success", "Console", "Log exported: " + filePath);

    
    try {
      var childProcess = window.FileSystem.childProcess;
      childProcess.execFile('explorer.exe', ['/select,' + filePath]);
    } catch (e) {}
  } catch (e) {
    dbg("error", "Console", "Export failed: " + (e.message || e));
    
    try {
      var blob = new Blob([text], { type: "text/plain" });
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url;
      a.download = "anismooth-log.txt";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e2) {}
  }
};

function escapeHtmlLog(text) {
  var div = document.createElement('div');
  div.appendChild(document.createTextNode(text));
  return div.innerHTML;
}
window.escapeHtmlLog = escapeHtmlLog;
