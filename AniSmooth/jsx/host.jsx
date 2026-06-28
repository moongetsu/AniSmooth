// --- Trimmed-render time helpers (issues #1 & #2) ---
// AE quirk: Layer.inPoint/outPoint and comp.workAreaStart are in DISPLAY
// coordinates (offset by comp.displayStartTime, i.e. what the timeline ruler
// shows), but RenderQueueItem.timeSpanStart is ABSOLUTE 0-based time. Assigning a
// display-relative time to timeSpanStart in a comp whose displayStartTime != 0
// makes the span start before the comp's first real frame, which triggers AE's
// "timeSpanStart of 0 seconds ... blank frames" warning and renders the wrong
// range. Convert display -> absolute by subtracting displayStartTime, snap to the
// frame grid (avoids float drift at 23.976/29.97 fps), and clamp to [0, duration].
function snapToFrame(t, frameDur) {
  if (!frameDur || frameDur <= 0) return t;
  return Math.round(t / frameDur) * frameDur;
}
function toAbsRenderTime(displayTime, comp) {
  var abs = snapToFrame(displayTime - comp.displayStartTime, comp.frameDuration);
  if (abs < 0) abs = 0;
  if (abs > comp.duration) abs = comp.duration;
  return abs;
}

function importFileToAE(filePath) {
  app.beginUndoGroup("Import AniSmooth Output");
  try {
    if (!app.project) {
      app.newProject();
    }
    var file = new File(filePath);
    if (!file.exists) {
      app.endUndoGroup();
      return "{\"ok\":false,\"message\":\"File not found: " + jsonEscape(filePath) + "\"}";
    }

    var importOptions = new ImportOptions(file);
    importOptions.importAs = ImportAsType.FOOTAGE;
    var footage = app.project.importFile(importOptions);
    
    var comp = app.project.activeItem;
    if (comp && comp instanceof CompItem) {
      // Capture selection BEFORE add() — adding a layer makes the new layer the
      // only selected one, so reading selectedLayers afterwards returns itself
      // and moveAfter() throws "Can not move a layer before or after itself".
      var selectedLayer = null;
      if (comp.selectedLayers && comp.selectedLayers.length > 0) {
        selectedLayer = comp.selectedLayers[0];
      }

      var layer = comp.layers.add(footage);

      if (selectedLayer && selectedLayer !== layer) {
        layer.startTime = selectedLayer.inPoint;
        layer.moveAfter(selectedLayer);
      } else {
        layer.startTime = comp.time;
      }
      
      if (footage.width > 0 && footage.height > 0 && comp.width > 0 && comp.height > 0) {
        var scaleX = (comp.width / footage.width) * 100;
        var scaleY = (comp.height / footage.height) * 100;
        var fitScale = Math.min(scaleX, scaleY);
        layer.property("Scale").setValue([fitScale, fitScale]);
      }
    }
    app.endUndoGroup();
    return "{\"ok\":true,\"message\":\"Imported clip to After Effects.\"}";
  } catch (err) {
    app.endUndoGroup();
    return "{\"ok\":false,\"message\":\"After Effects import error: " + jsonEscape(err.toString()) + "\"}";
  }
}

function getSelectedLayerFile() {
  try {
    if (!app.project) {
      return "{\"ok\":false,\"message\":\"No After Effects project open.\"}";
    }

    
    var comp = app.project.activeItem;
    if (comp && comp instanceof CompItem && comp.selectedLayers && comp.selectedLayers.length > 0) {
      for (var i = 0; i < comp.selectedLayers.length; i++) {
        var layer = comp.selectedLayers[i];
        if (layer && layer.source && layer.source instanceof FootageItem && layer.source.mainSource && layer.source.mainSource.file) {
          var file = layer.source.mainSource.file;
          if (file.exists) {
            return "{\"ok\":true,\"filePath\":\"" + jsonEscape(file.fsName) + "\",\"name\":\"" + jsonEscape(layer.name) + "\"}";
          }
        }
      }
    }

    
    if (app.project.selection && app.project.selection.length > 0) {
      for (var j = 0; j < app.project.selection.length; j++) {
        var item = app.project.selection[j];
        if (item instanceof FootageItem && item.mainSource && item.mainSource.file) {
          var projectFile = item.mainSource.file;
          if (projectFile.exists) {
            return "{\"ok\":true,\"filePath\":\"" + jsonEscape(projectFile.fsName) + "\",\"name\":\"" + jsonEscape(item.name) + "\"}";
          }
        }
      }
    }

    return "{\"ok\":false,\"message\":\"No local footage selected. Select a valid video footage layer in the timeline, or a footage item in the Project bin.\"}";
  } catch (err) {
    return "{\"ok\":false,\"message\":\"ExtendScript exception: " + jsonEscape(err.toString()) + "\"}";
  }
}

function getSelectedLayerInfo() {
  try {
    if (!app.project) {
      return "{\"ok\":false,\"message\":\"No project open\"}";
    }

    var comp = app.project.activeItem;
    var layer = null;
    var footage = null;

    
    if (comp && comp instanceof CompItem) {
      var sel = comp.selectedLayers;
      if (sel && sel.length > 0) {
        for (var i = 0; i < sel.length; i++) {
          var lyr = sel[i];
          if (!lyr) continue;
          var src = lyr.source;
          if (src && src instanceof FootageItem) {
            layer = lyr;
            footage = src;
            break;
          }
          
          if (src && src.width > 0 && src.height > 0) {
            layer = lyr;
            footage = src;
            break;
          }
        }
      }
    }

    
    if (!footage && app.project.selection && app.project.selection.length > 0) {
      for (var j = 0; j < app.project.selection.length; j++) {
        var itm = app.project.selection[j];
        if (itm instanceof FootageItem) {
          footage = itm;
          break;
        }
      }
    }

    
    if (!footage && comp instanceof FootageItem) {
      footage = comp;
    }

    if (!footage) {
      return "{\"ok\":false,\"message\":\"No footage found in selection\"}";
    }

    var w = parseInt(footage.width) || 0;
    var h = parseInt(footage.height) || 0;
    var fps = parseFloat(footage.frameRate) || 0;
    var dur = parseFloat(footage.duration) || 0;
    var name = footage.name || "Unknown";

    var json = "{\"ok\":true";
    json += ",\"name\":\"" + jsonEscape(String(name)) + "\"";
    json += ",\"width\":" + w;
    json += ",\"height\":" + h;
    json += ",\"frameRate\":" + fps.toFixed(3);
    json += ",\"duration\":" + dur.toFixed(2);

    if (comp && comp instanceof CompItem) {
      json += ",\"compName\":\"" + jsonEscape(String(comp.name || "")) + "\"";
      json += ",\"compFrameRate\":" + parseFloat(comp.frameRate || 0).toFixed(3);
      json += ",\"compDuration\":" + parseFloat(comp.duration || 0).toFixed(2);
      if (layer) {
        json += ",\"layerName\":\"" + jsonEscape(String(layer.name || "")) + "\"";
        json += ",\"layerIndex\":" + layer.index;
        var layerIn = parseFloat(layer.inPoint) || 0;
        var layerOut = parseFloat(layer.outPoint) || 0;
        json += ",\"layerDuration\":" + (layerOut - layerIn).toFixed(2);
      }
    }

    json += "}";
    return json;

  } catch (err) {
    return "{\"ok\":false,\"message\":\"Error: " + jsonEscape(String(err)) + "\"}";
  }
}

function removeDuplicateDeadframes(threshold) {
  
  
  app.beginUndoGroup("Remove Duplicate Deadframes");
  try {
    var comp = app.project.activeItem;
    if (!comp || !(comp instanceof CompItem)) {
      app.endUndoGroup();
      return "{\"ok\":false,\"message\":\"No active composition found.\"}";
    }
    
    
    app.endUndoGroup();
    return "{\"ok\":true,\"message\":\"Duplicate deadframes removal complete (placeholder).\"}";
  } catch (err) {
    app.endUndoGroup();
    return "{\"ok\":false,\"message\":\"Deadframes script error: " + jsonEscape(err.toString()) + "\"}";
  }
}

function jsonEscape(value) {
  value = String(value || "");
  value = value.replace(/\\/g, "\\\\");
  value = value.replace(/\"/g, "\\\"");
  value = value.replace(/\r/g, "\\r");
  value = value.replace(/\n/g, "\\n");
  return value;
}

function renderSelectedLayer(outputPathDir, layerName, layerIndex) {
  var originalSolos = [];
  try {
    var comp = app.project.activeItem;
    if (!comp || !(comp instanceof CompItem)) {
      return "{\"ok\":false,\"message\":\"No active composition found.\"}";
    }

    var layer = null;
    
    // Use layer index if provided — durable across selection changes
    if (layerIndex && layerIndex > 0 && layerIndex <= comp.numLayers) {
      layer = comp.layer(layerIndex);
    }
    
    // Fallback: currently selected layer
    if (!layer && comp.selectedLayers && comp.selectedLayers.length > 0) {
      layer = comp.selectedLayers[0];
    }
    
    // Fallback: search by name
    if (!layer && layerName) {
      for (var i = 1; i <= comp.numLayers; i++) {
        if (comp.layer(i).name === layerName) { layer = comp.layer(i); break; }
      }
    }
    
    if (!layer) {
      return "{\"ok\":false,\"message\":\"No layer selected in the timeline.\"}";
    }
    
    
    for (var i = 1; i <= comp.numLayers; i++) {
      var lyr = comp.layer(i);
      if (lyr.enabled) {
        originalSolos.push({
          layer: lyr,
          solo: lyr.solo
        });
      }
    }

    
    for (var i = 1; i <= comp.numLayers; i++) {
      var lyr = comp.layer(i);
      if (lyr.enabled) {
        lyr.solo = (lyr === layer);
      }
    }

    
    var rq = app.project.renderQueue;
    var item = rq.items.add(comp);
    
    // Save and temporarily set work area to match the selected layer
    var savedWAStart = comp.workAreaStart;
    var savedWADuration = comp.workAreaDuration;
    var fd = comp.frameDuration;
    // BOTH comp.workAreaStart and RenderQueueItem.timeSpanStart are ABSOLUTE
    // 0-based times (valid range [0, comp.duration]). layer.inPoint/outPoint are
    // DISPLAY-relative (offset by displayStartTime). Convert via toAbsRenderTime,
    // which subtracts displayStartTime, snaps to the frame grid, and clamps to
    // [0, duration]. Setting work area to the raw display value throws AE's
    // "workAreaStart value out of range" error when displayStartTime != 0.
    var absStart = toAbsRenderTime(layer.inPoint, comp);
    var absEnd = toAbsRenderTime(layer.outPoint, comp);
    // Guarantee at least one frame inside the comp.
    if (absEnd - absStart < fd) absEnd = Math.min(absStart + fd, comp.duration);
    if (absEnd <= absStart) {
      for (var i = 0; i < originalSolos.length; i++) {
        try { var oLyr2 = originalSolos[i].layer; if (oLyr2.enabled) oLyr2.solo = originalSolos[i].solo; } catch (e) {}
      }
      item.remove();
      return "{\"ok\":false,\"message\":\"Layer is outside the composition time bounds.\"}";
    }
    comp.workAreaStart = absStart;
    comp.workAreaDuration = absEnd - absStart;

    // Coordinate-space trap: comp.workAreaStart is ABSOLUTE (set above), but
    // RenderQueueItem.timeSpanStart is DISPLAY-relative — its valid range is
    // [displayStartTime, displayStartTime + duration]. Assigning the absolute
    // start (0 when displayStartTime != 0) triggers AE's "timeSpanStart of 0
    // seconds ... frames outside range" warning and renders blank/one frame.
    // Duration is identical in both spaces; only the start needs the offset.
    var absDur = absEnd - absStart;
    if (absDur < fd) absDur = Math.min(fd, comp.duration - absStart);
    item.timeSpanStart = absStart + comp.displayStartTime;
    item.timeSpanDuration = absDur;
    
    
    var outputModule = item.outputModule(1);
    
    
    var extension = ".avi"; 
    if (outputModule.file) {
      var defaultName = outputModule.file.name;
      var dotIdx = defaultName.lastIndexOf(".");
      if (dotIdx !== -1) {
        extension = defaultName.substring(dotIdx);
      }
    }
    
    
    var tempBaseName = "AniSmooth_Render_" + new Date().getTime();
    var tempPath = outputPathDir + "/" + tempBaseName + extension;
    outputModule.file = new File(tempPath);
    
    
    rq.render();
    
    // Restore work area
    comp.workAreaStart = savedWAStart;
    comp.workAreaDuration = savedWADuration;
    
    for (var i = 0; i < originalSolos.length; i++) {
      try {
        var oLyr = originalSolos[i].layer;
        if (oLyr.enabled) {
          oLyr.solo = originalSolos[i].solo;
        }
      } catch (e) {}
    }
    
    
    item.remove();
    
    
    var finalFile = new File(tempPath);
    var finalPath = "";
    
    if (finalFile.exists) {
      finalPath = finalFile.fsName;
    } else {
      
      var folder = new Folder(outputPathDir);
      var files = folder.getFiles(tempBaseName + "*");
      if (files && files.length > 0) {
        finalFile = files[0];
        finalPath = files[0].fsName;
      }
    }
    
    if (!finalFile || !finalFile.exists) {
      return "{\"ok\":false,\"message\":\"Render succeeded but output file could not be found.\"}";
    }

    return "{\"ok\":true,\"filePath\":\"" + jsonEscape(finalPath) + "\",\"name\":\"" + jsonEscape(layer.name) + "\",\"isTemp\":true}";
  } catch (err) {
    // Restore work area on error
    try { comp.workAreaStart = savedWAStart; comp.workAreaDuration = savedWADuration; } catch (e) {}
    
    if (originalSolos) {
      for (var i = 0; i < originalSolos.length; i++) {
        try { originalSolos[i].layer.solo = originalSolos[i].solo; } catch (e) {}
      }
    }
    return "{\"ok\":false,\"message\":\"ExtendScript render error: " + jsonEscape(err.toString()) + "\"}";
  }
}

function renderSelectedLayerPreview(outputPathDir, previewDuration) {
  var originalSolos = [];
  var debugLog = "";
  try {
    var comp = app.project.activeItem;
    if (!comp || !(comp instanceof CompItem)) {
      return "{\"ok\":false,\"message\":\"No active composition found.\"}";
    }
    if (!comp.selectedLayers || comp.selectedLayers.length === 0) {
      return "{\"ok\":false,\"message\":\"No layer selected in the timeline.\"}";
    }
    var layer = comp.selectedLayers[0];
    var startTime = layer.inPoint;
    var duration = parseFloat(previewDuration) || 3;
    var endTime = Math.min(startTime + duration, layer.outPoint);
    debugLog += "start=" + startTime + " dur=" + (endTime - startTime) + " ";

    for (var i = 1; i <= comp.numLayers; i++) {
      var lyr = comp.layer(i);
      if (lyr.enabled) {
        originalSolos.push({ layer: lyr, solo: lyr.solo });
        lyr.solo = (lyr === layer);
      }
    }

    var rq = app.project.renderQueue;
    var item = rq.items.add(comp);
    // Convert display-relative preview window to ABSOLUTE 0-based render time
    // (see toAbsRenderTime) so previews never warn about / produce blank frames.
    var fd = comp.frameDuration;
    var absStart = toAbsRenderTime(startTime, comp);
    var absEnd = toAbsRenderTime(endTime, comp);
    var absDur = absEnd - absStart;
    if (absDur < fd) absDur = Math.min(fd, comp.duration - absStart);
    item.timeSpanStart = absStart;
    item.timeSpanDuration = absDur;

    var outputModule = item.outputModule(1);
    var extension = ".avi";
    if (outputModule.file) {
      var dotIdx = outputModule.file.name.lastIndexOf(".");
      if (dotIdx !== -1) extension = outputModule.file.name.substring(dotIdx);
    }

    var tempBaseName = "AniSmooth_Preview_" + new Date().getTime();
    var tempPath = outputPathDir + "/" + tempBaseName + extension;
    outputModule.file = new File(tempPath);
    debugLog += "setPath=" + tempPath + " ";
    rq.render();

    
    var actualFile = outputModule.file;
    debugLog += "aeFile=" + (actualFile ? actualFile.fsName : "null") + " ";

    for (var i = 0; i < originalSolos.length; i++) {
      try {
        var oLyr = originalSolos[i].layer;
        if (oLyr.enabled) {
          oLyr.solo = originalSolos[i].solo;
        }
      } catch (e) {}
    }
    item.remove();

    
    var finalFile = new File(tempPath);
    if (finalFile.exists) {
      return "{\"ok\":true,\"filePath\":\"" + jsonEscape(finalFile.fsName) + "\",\"name\":\"" + jsonEscape(layer.name) + "\",\"isTemp\":true,\"isPreview\":true,\"duration\":" + (endTime - startTime) + "}";
    }
    
    if (actualFile && actualFile.exists) {
      return "{\"ok\":true,\"filePath\":\"" + jsonEscape(actualFile.fsName) + "\",\"name\":\"" + jsonEscape(layer.name) + "\",\"isTemp\":true,\"isPreview\":true,\"duration\":" + (endTime - startTime) + "}";
    }
    
    var folder = new Folder(outputPathDir);
    var files = folder.getFiles(tempBaseName + "*");
    if (files && files.length > 0) {
      return "{\"ok\":true,\"filePath\":\"" + jsonEscape(files[0].fsName) + "\",\"name\":\"" + jsonEscape(layer.name) + "\",\"isTemp\":true,\"isPreview\":true,\"duration\":" + (endTime - startTime) + "}";
    }
    debugLog += "folder=" + outputPathDir + " filesFound=" + (files ? files.length : 0);
    return "{\"ok\":false,\"message\":\"Preview file not found. Debug: " + jsonEscape(debugLog) + "\"}";
  } catch (err) {
    if (originalSolos) {
      for (var i = 0; i < originalSolos.length; i++) {
        try { originalSolos[i].layer.solo = originalSolos[i].solo; } catch (e) {}
      }
    }
    return "{\"ok\":false,\"message\":\"ExtendScript preview error: " + jsonEscape(err.toString()) + "\"}";
  }
}
