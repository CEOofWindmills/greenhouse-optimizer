import { state, canvas } from '../core/state.js';
import { getScale, getParams, screenToMeters, metersToScreen } from '../core/transforms.js';
import { polygonArea } from '../core/geometry.js';
import { draw } from '../render/draw.js';

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

  if (state.isPanning) {
    state.panX += e.clientX - state.lastMouse.x;
    state.panY += e.clientY - state.lastMouse.y;
    state.lastMouse = { x: e.clientX, y: e.clientY };
  }

  draw();
}

function onMouseDown(e) {
  if (e.button === 1 || (e.button === 0 && e.ctrlKey)) {
    state.isPanning = true;
    state.lastMouse = { x: e.clientX, y: e.clientY };
    canvas.style.cursor = 'grabbing';
    e.preventDefault();
    return;
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
  if (e.key === 'Escape') {
    state.mode = 'idle';
    state.currentPolygon = [];
    document.getElementById('mode-indicator').style.display = 'none';
    canvas.style.cursor = 'default';
    draw();
  }
  // F8 toggles ortho mode (like AutoCAD)
  if (e.key === 'F8') {
    e.preventDefault();
    toggleOrtho();
  }
}

export function toggleOrtho() {
  state.orthoMode = !state.orthoMode;
  const btn = document.getElementById('btn-ortho');
  btn.textContent = state.orthoMode ? 'Ortho: On' : 'Ortho: Off';
  btn.style.background = state.orthoMode ? '#0f9b8e' : '';
}

export function finishPolygon() {
  if (state.mode === 'draw-land') {
    state.landPolygon = [...state.currentPolygon];
    state.currentPolygon = [];
    state.mode = 'idle';
    document.getElementById('mode-indicator').style.display = 'none';
    canvas.style.cursor = 'default';

    const area = polygonArea(state.landPolygon);
    document.getElementById('land-area').textContent = `${area.toFixed(0)} m²`;
    document.getElementById('results').innerHTML = '<div style="color:#0f9b8e;text-align:center;padding:10px">Land boundary set. Click "Optimize Coverage" to run.</div>';
    draw();
  } else if (state.mode === 'draw-exclusion') {
    state.exclusionZones.push([...state.currentPolygon]);
    state.currentPolygon = [];
    state.mode = 'idle';
    document.getElementById('mode-indicator').style.display = 'none';
    canvas.style.cursor = 'default';
    draw();
  }
}
