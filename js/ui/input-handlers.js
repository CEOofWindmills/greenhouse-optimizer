import { state, canvas } from '../core/state.js';
import { getScale, getParams, screenToMeters, metersToScreen } from '../core/transforms.js';
import { polygonArea } from '../core/geometry.js';
import { draw } from '../render/draw.js';
import { updateCanvasPointerEvents } from '../map/leaflet-map.js';
import { hitTestAll, selectEntity, deselectAll, getSelected, getTypeHandler } from '../core/entities.js';
import { setActiveTool } from '../core/tools.js';
import { optimize } from '../engine/optimizer.js';

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
    canvas.style.cursor = hover ? 'move' : 'default';
  }

  // When map is active and unlocked, Leaflet handles panning — skip canvas pan
  if (state.isPanning && (!state.mapActive || state.mapLocked)) {
    state.panX += e.clientX - state.lastMouse.x;
    state.panY += e.clientY - state.lastMouse.y;
    state.lastMouse = { x: e.clientX, y: e.clientY };
  }

  draw();
}

function onMouseDown(e) {
  // When map is active and unlocked, Leaflet handles panning — skip canvas pan initiation
  if ((e.button === 1 || (e.button === 0 && e.ctrlKey)) && (!state.mapActive || state.mapLocked)) {
    state.isPanning = true;
    state.lastMouse = { x: e.clientX, y: e.clientY };
    canvas.style.cursor = 'grabbing';
    e.preventDefault();
    return;
  }

  // Pointer tool — entity hit-test and drag start
  if (e.button === 0 && state.mode === 'idle') {
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
  if (state.currentPolygon.length > 0) {
    state.currentPolygon.pop();
    draw();
  }
}

function onWheel(e) {
  // When map is active and unlocked, let Leaflet handle zoom
  if (state.mapActive && !state.mapLocked) return;

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
    deselectAll();
    setActiveTool('pointer');
    state.currentPolygon = [];
    draw();
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
