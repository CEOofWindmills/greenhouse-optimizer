import { state, canvas } from '../core/state.js';
import { getScale, getParams, screenToMeters, metersToScreen } from '../core/transforms.js';
import { polygonArea, polygonBounds, pointInPolygon, pointInAnyExclusion } from '../core/geometry.js';
import { draw } from '../render/draw.js';
import { updateCanvasPointerEvents } from '../map/leaflet-map.js';
import { hitTestAll, selectEntity, deselectAll, getSelected, getTypeHandler } from '../core/entities.js';
import { setActiveTool } from '../core/tools.js';
import { optimize } from '../engine/optimizer.js';
import { resolveSnapRef } from '../core/snap.js';

// Hit-test measurement lines — returns index or -1
function hitTestMeasurement(screenX, screenY) {
  const threshold = 10;
  let bestIdx = -1, bestDist = threshold;
  for (let i = 0; i < state.measurements.length; i++) {
    const m = state.measurements[i];
    const start = resolveSnapRef(m.startRef) || m.start;
    const end = resolveSnapRef(m.endRef) || m.end;
    const s1 = metersToScreen(start.x, start.y);
    const s2 = metersToScreen(end.x, end.y);
    const dx = s2.x - s1.x, dy = s2.y - s1.y;
    const len2 = dx * dx + dy * dy;
    if (len2 === 0) continue;
    let t = ((screenX - s1.x) * dx + (screenY - s1.y) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    const cx = s1.x + t * dx, cy = s1.y + t * dy;
    const dist = Math.hypot(screenX - cx, screenY - cy);
    if (dist < bestDist) { bestDist = dist; bestIdx = i; }
  }
  return bestIdx;
}

// Snap a point to the nearest ortho direction (along or perpendicular to tree rows)
// relative to an anchor point
function orthoSnap(anchor, point) {
  const params = getParams();
  const angle = params.treeDirection; // already in radians
  const cosA = Math.cos(angle);
  const sinA = Math.sin(angle);

  const dx = point.x - anchor.x;
  const dy = point.y - anchor.y;

  // Project delta onto row direction (U) and perpendicular (V)
  const projU = dx * cosA + dy * sinA;
  const projV = -dx * sinA + dy * cosA;

  // Snap to whichever axis has the larger projection
  if (Math.abs(projU) >= Math.abs(projV)) {
    // Snap along U (row direction)
    return {
      x: anchor.x + projU * cosA,
      y: anchor.y + projU * sinA,
    };
  } else {
    // Snap along V (perpendicular to rows)
    return {
      x: anchor.x - projV * sinA,
      y: anchor.y + projV * cosA,
    };
  }
}

// Get the effective mouse position (with ortho snap if active)
function getEffectiveMouse(rawMouse) {
  if (!state.orthoMode || state.currentPolygon.length === 0) return rawMouse;
  const anchor = state.currentPolygon[state.currentPolygon.length - 1];
  return orthoSnap(anchor, rawMouse);
}

// Hit-test polygon vertices — returns { polygon, index, zoneIndex? } or null
function hitTestVertex(screenX, screenY) {
  const threshold = 10; // px
  // Check land polygon vertices
  for (let i = 0; i < state.landPolygon.length; i++) {
    const s = metersToScreen(state.landPolygon[i].x, state.landPolygon[i].y);
    if (Math.hypot(screenX - s.x, screenY - s.y) < threshold) {
      return { polygon: 'land', index: i };
    }
  }
  // Check exclusion zone vertices
  for (let zi = 0; zi < state.exclusionZones.length; zi++) {
    for (let i = 0; i < state.exclusionZones[zi].length; i++) {
      const s = metersToScreen(state.exclusionZones[zi][i].x, state.exclusionZones[zi][i].y);
      if (Math.hypot(screenX - s.x, screenY - s.y) < threshold) {
        return { polygon: 'exclusion', zoneIndex: zi, index: i };
      }
    }
  }
  return null;
}

// Hit-test polygon edges — returns { polygon, zoneIndex?, insertAfter, point } or null
function hitTestEdge(screenX, screenY) {
  const threshold = 8; // px
  function checkPoly(poly, polygonType, zoneIndex) {
    if (poly.length < 2) return null;
    let best = null;
    let bestDist = threshold;
    for (let i = 0; i < poly.length; i++) {
      const j = (i + 1) % poly.length;
      const a = metersToScreen(poly[i].x, poly[i].y);
      const b = metersToScreen(poly[j].x, poly[j].y);
      // Closest point on segment a-b to (screenX, screenY)
      const dx = b.x - a.x, dy = b.y - a.y;
      const len2 = dx * dx + dy * dy;
      if (len2 === 0) continue;
      let t = ((screenX - a.x) * dx + (screenY - a.y) * dy) / len2;
      t = Math.max(0, Math.min(1, t));
      const cx = a.x + t * dx, cy = a.y + t * dy;
      const dist = Math.hypot(screenX - cx, screenY - cy);
      if (dist < bestDist) {
        bestDist = dist;
        // Convert the closest screen point back to meters for the new vertex
        const meters = screenToMeters(cx, cy);
        best = { polygon: polygonType, zoneIndex, insertAfter: i, point: meters };
      }
    }
    return best;
  }
  // Check land polygon
  const landHit = checkPoly(state.landPolygon, 'land');
  if (landHit) return landHit;
  // Check exclusion zones
  for (let zi = 0; zi < state.exclusionZones.length; zi++) {
    const exHit = checkPoly(state.exclusionZones[zi], 'exclusion', zi);
    if (exHit) return exHit;
  }
  return null;
}

// Find nearest snap point to screen coordinates — returns {x, y, type, ref} or null
function findSnapPoint(screenX, screenY) {
  const threshold = 12; // px
  let best = null;
  let bestDist = threshold;

  function check(mx, my, type, ref) {
    const s = metersToScreen(mx, my);
    const d = Math.hypot(screenX - s.x, screenY - s.y);
    if (d < bestDist) {
      bestDist = d;
      best = { x: mx, y: my, type, ref };
    }
  }

  // 1. Polygon vertices (highest priority)
  for (let i = 0; i < state.landPolygon.length; i++) {
    const p = state.landPolygon[i];
    check(p.x, p.y, 'vertex', { type: 'vertex', polygon: 'land', index: i });
  }
  for (let zi = 0; zi < state.exclusionZones.length; zi++) {
    for (let i = 0; i < state.exclusionZones[zi].length; i++) {
      const p = state.exclusionZones[zi][i];
      check(p.x, p.y, 'vertex', { type: 'vertex', polygon: 'exclusion', zoneIndex: zi, index: i });
    }
  }

  // 2. Post positions from optimization result
  const result = state.optimizationResult;
  if (result) {
    const params = getParams();
    const cosA = Math.cos(params.treeDirection);
    const sinA = Math.sin(params.treeDirection);
    const bayOffset = params.bayPostOffset != null ? params.bayPostOffset : params.treeSpacing / 2;
    const houseOffset = params.housePostOffset != null ? params.housePostOffset : 0;
    const hw = result.houseWidth || (result.sections && result.sections[0] ? result.sections[0].houseWidth : 0);
    let swOffset;
    if (params.sidewallRule === 'normal') swOffset = hw / 2;
    else if (params.sidewallRule === 'adjusted') swOffset = hw / 2 + 0.3048;
    else swOffset = hw;

    const offU = state.treeGridOffset.u;
    const offV = state.treeGridOffset.v;

    function checkPost(u, v) {
      const wx = u * cosA - v * sinA;
      const wy = u * sinA + v * cosA;
      check(wx, wy, 'post', { type: 'post', u: u - offU, v: v - offV });
    }

    if (result.gridMode) {
      const { activeGrid, numCols, numRows, gridU, gridV, baySize } = result;
      const startU = gridU[0], startV = gridV[0];
      const bayPostU = (col) => startU + col * baySize + bayOffset;
      const peakV = (row) => startV + row * hw + houseOffset;

      for (let col = 0; col < numCols; col++) {
        for (let row = 0; row < numRows; row++) {
          if (!activeGrid[col][row]) continue;
          const peak = peakV(row);
          const uL = bayPostU(col), uR = bayPostU(col + 1);
          checkPost(uL, peak);
          checkPost(uR, peak);
          if (row === 0 || !activeGrid[col][row - 1]) {
            checkPost(uL, peak - swOffset);
            checkPost(uR, peak - swOffset);
          }
          if (row === numRows - 1 || !activeGrid[col][row + 1]) {
            checkPost(uL, peak + swOffset);
            checkPost(uR, peak + swOffset);
          }
        }
      }
    } else if (result.sections) {
      for (const section of result.sections) {
        for (let b = 0; b <= section.bays; b++) {
          const u = section.u + bayOffset + b * section.baySize;
          const firstPeak = section.v + houseOffset;
          for (let h = 0; h < section.houses; h++) {
            checkPost(u, firstPeak + h * hw);
          }
        }
      }
    }
  }

  // 3. Tree positions (only if visible)
  const params = getParams();
  if (params.showTrees && state.landPolygon.length > 2) {
    const bounds = polygonBounds(state.landPolygon);
    const cosA = Math.cos(params.treeDirection);
    const sinA = Math.sin(params.treeDirection);
    const margin = 5;
    const corners = [
      { x: bounds.minX - margin, y: bounds.minY - margin },
      { x: bounds.maxX + margin, y: bounds.minY - margin },
      { x: bounds.maxX + margin, y: bounds.maxY + margin },
      { x: bounds.minX - margin, y: bounds.maxY + margin },
    ];
    let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
    for (const c of corners) {
      const u = c.x * cosA + c.y * sinA;
      const v = -c.x * sinA + c.y * cosA;
      minU = Math.min(minU, u); maxU = Math.max(maxU, u);
      minV = Math.min(minV, v); maxV = Math.max(maxV, v);
    }
    const offsetU = state.treeGridOffset.u;
    const offsetV = state.treeGridOffset.v;

    // Only check trees near the mouse for performance
    const mouseMeter = screenToMeters(screenX, screenY);
    const searchRadius = threshold / (getScale() * state.zoom); // convert px threshold to meters
    const mU = mouseMeter.x * cosA + mouseMeter.y * sinA;
    const mV = -mouseMeter.x * sinA + mouseMeter.y * cosA;

    const nearU = Math.round((mU - offsetU) / params.treeSpacing) * params.treeSpacing + offsetU;
    const nearV = Math.round((mV - offsetV) / params.treeRowSpacing) * params.treeRowSpacing + offsetV;

    for (let du = -1; du <= 1; du++) {
      for (let dv = -1; dv <= 1; dv++) {
        const u = nearU + du * params.treeSpacing;
        const v = nearV + dv * params.treeRowSpacing;
        if (u < minU || u > maxU || v < minV || v > maxV) continue;
        const wx = u * cosA - v * sinA;
        const wy = u * sinA + v * cosA;
        if (pointInPolygon(wx, wy, state.landPolygon) && !pointInAnyExclusion(wx, wy)) {
          check(wx, wy, 'tree', { type: 'tree', u: u - offsetU, v: v - offsetV });
        }
      }
    }
  }

  return best;
}

export function initInputHandlers() {
  canvas.addEventListener('mousemove', onMouseMove);
  canvas.addEventListener('mousedown', onMouseDown);
  canvas.addEventListener('mouseup', onMouseUp);
  canvas.addEventListener('dblclick', onDoubleClick);
  canvas.addEventListener('contextmenu', onContextMenu);
  canvas.addEventListener('wheel', onWheel);
  document.addEventListener('keydown', onKeyDown);
}

function onMouseMove(e) {
  const rect = canvas.getBoundingClientRect();
  const sx = e.clientX - rect.left;
  const sy = e.clientY - rect.top;
  const rawMouse = screenToMeters(sx, sy);
  state.mouse = getEffectiveMouse(rawMouse);

  document.getElementById('mouse-pos').textContent = `${state.mouse.x.toFixed(1)}, ${state.mouse.y.toFixed(1)} m`;

  // Measure tool — update snap point (but don't block panning)
  if (state.mode === 'measure' && !state.isPanning) {
    state.snapPoint = findSnapPoint(sx, sy);
  }

  // Vertex dragging (double-click initiated)
  if (state.draggingVertex) {
    const dv = state.draggingVertex;
    if (dv.polygon === 'land') {
      state.landPolygon[dv.index] = { x: state.mouse.x, y: state.mouse.y };
    } else if (dv.polygon === 'exclusion') {
      state.exclusionZones[dv.zoneIndex][dv.index] = { x: state.mouse.x, y: state.mouse.y };
    }
    draw();
    return;
  }

  // Entity dragging — pointer tool
  const sel = getSelected();
  if (sel && sel.dragging) {
    const handler = getTypeHandler(sel.type);
    if (handler) handler.onDrag(sel, state.mouse.x, state.mouse.y, getParams());
    draw();
    return;
  }

  // Hover cursor feedback — show 'move' when over a selectable entity in pointer mode
  if (state.mode === 'idle' && !state.isPanning) {
    const hover = hitTestAll(state.mouse.x, state.mouse.y, getParams());
    const vertexHover = hitTestVertex(sx, sy);
    canvas.style.cursor = (hover || vertexHover !== null) ? 'move' : 'default';
  }

  // When map is active, skip canvas pan (locked = frozen view, unlocked = Leaflet handles it)
  if (state.isPanning && !state.mapActive) {
    state.panX += e.clientX - state.lastMouse.x;
    state.panY += e.clientY - state.lastMouse.y;
    state.lastMouse = { x: e.clientX, y: e.clientY };
  }

  draw();
}

function onMouseDown(e) {
  // Pan: middle-click or ctrl+left-click. Disabled when map is active (locked or not —
  // locked map means frozen view, panning canvas would desync from satellite imagery).
  if ((e.button === 1 || (e.button === 0 && e.ctrlKey)) && !state.mapActive) {
    state.isPanning = true;
    state.lastMouse = { x: e.clientX, y: e.clientY };
    canvas.style.cursor = 'grabbing';
    e.preventDefault();
    return;
  }

  // Measure tool — set start or end point
  if (e.button === 0 && state.mode === 'measure') {
    const snap = state.snapPoint;
    const point = snap ? { x: snap.x, y: snap.y } : { ...state.mouse };
    const ref = snap ? snap.ref : null;
    if (!state.measureStart) {
      state.measureStart = point;
      state.measureStartRef = ref;
    } else {
      state.measurements.push({
        start: state.measureStart, end: point,
        startRef: state.measureStartRef || null, endRef: ref,
      });
      state.measureStart = null;
      state.measureStartRef = null;
      // Show the toggle button once we have measurements
      document.getElementById('btn-toggle-dims').style.display = '';
    }
    draw();
    return;
  }

  // Pointer tool — entity hit-test and drag start (skip if clicking on a polygon vertex)
  if (e.button === 0 && state.mode === 'idle') {
    const rect2 = canvas.getBoundingClientRect();
    const sx2 = e.clientX - rect2.left;
    const sy2 = e.clientY - rect2.top;
    if (hitTestVertex(sx2, sy2)) return; // vertex takes priority — let dblclick handle it

    // Check measurement selection
    if (state.showMeasurements) {
      const mIdx = hitTestMeasurement(sx2, sy2);
      if (mIdx >= 0) {
        state.selectedMeasurement = mIdx;
        draw();
        return;
      }
    }
    state.selectedMeasurement = -1;

    const params = getParams();
    const hit = hitTestAll(state.mouse.x, state.mouse.y, params);
    if (hit) {
      selectEntity(hit);
      hit.dragging = true;
      const handler = getTypeHandler(hit.type);
      if (handler) handler.onDragStart(hit, state.mouse.x, state.mouse.y, params);
      canvas.style.cursor = 'move';
      draw();
      return;
    } else {
      deselectAll();
      draw();
    }
  }

  if (e.button === 0 && (state.mode === 'draw-land' || state.mode === 'draw-exclusion')) {
    // If we have 3+ points and click near the first point, close the polygon
    if (state.currentPolygon.length >= 3) {
      const first = metersToScreen(state.currentPolygon[0].x, state.currentPolygon[0].y);
      const rect2 = canvas.getBoundingClientRect();
      const clickX = e.clientX - rect2.left;
      const clickY = e.clientY - rect2.top;
      const dist = Math.hypot(clickX - first.x, clickY - first.y);
      if (dist < 15) {
        finishPolygon();
        return;
      }
    }
    state.currentPolygon.push({ ...state.mouse });
    draw();
  }
}

function onMouseUp() {
  // Vertex drag end
  if (state.draggingVertex) {
    state.draggingVertex = null;
    canvas.style.cursor = 'default';
    // Update land area display
    if (state.landPolygon.length >= 3) {
      const area = polygonArea(state.landPolygon);
      document.getElementById('land-area').textContent = `${area.toFixed(0)} m²`;
    }
    // Re-optimize if needed
    if (state.optimizationResult) optimize();
    draw();
    return;
  }

  // Entity drag end
  const sel = getSelected();
  if (sel && sel.dragging) {
    sel.dragging = false;
    const handler = getTypeHandler(sel.type);
    if (handler) handler.onDragEnd(sel);
    canvas.style.cursor = 'default';
    // Re-optimize with new offset
    if (state.optimizationResult) optimize();
    draw();
  }

  if (state.isPanning) {
    state.isPanning = false;
    canvas.style.cursor = state.mode !== 'idle' ? 'crosshair' : 'default';
  }
}

function onDoubleClick(e) {
  e.preventDefault();

  // In pointer mode, double-click on a vertex to start dragging it
  if (state.mode === 'idle') {
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const hit = hitTestVertex(sx, sy);
    if (hit) {
      state.draggingVertex = hit;
      canvas.style.cursor = 'move';
      draw();
      return;
    }
  }

  // Remove the two extra points added by the two mousedown events that precede dblclick
  if (state.currentPolygon.length >= 2) {
    state.currentPolygon.pop();
    state.currentPolygon.pop();
  }
  if (state.currentPolygon.length >= 3) {
    finishPolygon();
  }
}

function onContextMenu(e) {
  e.preventDefault();

  // Measure mode: right-click to delete nearest measurement, or cancel in-progress
  if (state.mode === 'measure') {
    if (state.measureStart) {
      state.measureStart = null;
      draw();
      return;
    }
    // Delete nearest measurement line
    if (state.measurements.length > 0) {
      const rect = canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      let bestIdx = -1, bestDist = 15;
      for (let i = 0; i < state.measurements.length; i++) {
        const m = state.measurements[i];
        const s1 = metersToScreen(m.start.x, m.start.y);
        const s2 = metersToScreen(m.end.x, m.end.y);
        // Distance from point to line segment
        const dx = s2.x - s1.x, dy = s2.y - s1.y;
        const len2 = dx * dx + dy * dy;
        if (len2 === 0) continue;
        let t = ((sx - s1.x) * dx + (sy - s1.y) * dy) / len2;
        t = Math.max(0, Math.min(1, t));
        const cx = s1.x + t * dx, cy = s1.y + t * dy;
        const dist = Math.hypot(sx - cx, sy - cy);
        if (dist < bestDist) { bestDist = dist; bestIdx = i; }
      }
      if (bestIdx >= 0) {
        state.measurements.splice(bestIdx, 1);
        if (state.measurements.length === 0) {
          document.getElementById('btn-toggle-dims').style.display = 'none';
        }
        draw();
        return;
      }
    }
    return;
  }

  // In pointer mode: right-click vertex to delete, right-click edge to add node
  if (state.mode === 'idle') {
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;

    // Check vertex first — delete it
    const vertexHit = hitTestVertex(sx, sy);
    if (vertexHit) {
      if (vertexHit.polygon === 'land') {
        if (state.landPolygon.length > 3) {
          state.landPolygon.splice(vertexHit.index, 1);
          const area = polygonArea(state.landPolygon);
          document.getElementById('land-area').textContent = `${area.toFixed(0)} m²`;
          if (state.optimizationResult) optimize();
        }
      } else if (vertexHit.polygon === 'exclusion') {
        const zone = state.exclusionZones[vertexHit.zoneIndex];
        if (zone.length > 3) {
          zone.splice(vertexHit.index, 1);
        }
      }
      draw();
      return;
    }

    // Check edge — insert new node
    const edgeHit = hitTestEdge(sx, sy);
    if (edgeHit) {
      if (edgeHit.polygon === 'land') {
        state.landPolygon.splice(edgeHit.insertAfter + 1, 0, edgeHit.point);
        const area = polygonArea(state.landPolygon);
        document.getElementById('land-area').textContent = `${area.toFixed(0)} m²`;
        if (state.optimizationResult) optimize();
      } else if (edgeHit.polygon === 'exclusion') {
        state.exclusionZones[edgeHit.zoneIndex].splice(edgeHit.insertAfter + 1, 0, edgeHit.point);
      }
      draw();
      return;
    }
  }

  // During drawing: undo last node
  if (state.currentPolygon.length > 0) {
    state.currentPolygon.pop();
    draw();
  }
}

function onWheel(e) {
  // When map is active, disable canvas zoom (locked = frozen view, unlocked = Leaflet handles it)
  if (state.mapActive) return;

  e.preventDefault();
  const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
  const rect = canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;

  // Zoom toward mouse position
  state.panX = mx - (mx - state.panX) * zoomFactor;
  state.panY = my - (my - state.panY) * zoomFactor;
  state.zoom *= zoomFactor;

  document.getElementById('scale-display').textContent = `${(getScale() * state.zoom).toFixed(1)} px/m`;
  draw();
}

function onKeyDown(e) {
  // Skip shortcuts when typing in input fields
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;

  if (e.key === 'Escape') {
    if (state.mode === 'measure' && state.measureStart) {
      // Just cancel in-progress measurement, stay in measure mode
      state.measureStart = null;
      draw();
      return;
    }
    deselectAll();
    state.selectedMeasurement = -1;
    setActiveTool('pointer');
    state.currentPolygon = [];
    draw();
  }
  // Delete selected measurement
  if ((e.key === 'Delete' || e.key === 'Backspace') && state.selectedMeasurement >= 0) {
    state.measurements.splice(state.selectedMeasurement, 1);
    state.selectedMeasurement = -1;
    if (state.measurements.length === 0) {
      document.getElementById('btn-toggle-dims').style.display = 'none';
    }
    draw();
    return;
  }
  // F8 toggles ortho mode (like AutoCAD)
  if (e.key === 'F8') {
    e.preventDefault();
    toggleOrtho();
  }
  // Tool shortcuts
  if (e.key === 'v' || e.key === 'V') setActiveTool('pointer');
  if (e.key === 'l' || e.key === 'L') setActiveTool('draw-land');
  if (e.key === 'e' || e.key === 'E') setActiveTool('draw-exclusion');
  if (e.key === 'm' || e.key === 'M') setActiveTool('measure');
}

export function toggleOrtho() {
  state.orthoMode = !state.orthoMode;
  // Update toolbar ortho button
  const toolBtn = document.getElementById('tool-ortho');
  if (toolBtn) toolBtn.classList.toggle('active', state.orthoMode);
}

export function finishPolygon() {
  if (state.mode === 'draw-land') {
    state.landPolygon = [...state.currentPolygon];
    state.currentPolygon = [];
    setActiveTool('pointer');

    const area = polygonArea(state.landPolygon);
    document.getElementById('land-area').textContent = `${area.toFixed(0)} m²`;
    document.getElementById('results').innerHTML = '<div style="color:#0f9b8e;text-align:center;padding:10px">Land boundary set. Click "Optimize Coverage" to run.</div>';
    draw();
  } else if (state.mode === 'draw-exclusion') {
    state.exclusionZones.push([...state.currentPolygon]);
    state.currentPolygon = [];
    setActiveTool('pointer');
    draw();
  }
}
