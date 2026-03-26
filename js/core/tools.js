import { state, canvas } from './state.js';
import { updateCanvasPointerEvents } from '../map/leaflet-map.js';

const tools = {
  pointer: { name: 'Pointer', cursor: 'default', mode: 'idle' },
  'draw-land': { name: 'Draw Land', cursor: 'crosshair', mode: 'draw-land' },
  'draw-exclusion': { name: 'Exclusion Zone', cursor: 'crosshair', mode: 'draw-exclusion' },
  measure: { name: 'Measure', cursor: 'crosshair', mode: 'measure' },
};

let activeTool = 'pointer';

export function getActiveTool() { return activeTool; }

export function setActiveTool(toolId) {
  if (!tools[toolId]) return;
  activeTool = toolId;
  const tool = tools[toolId];

  state.mode = tool.mode;
  canvas.style.cursor = tool.cursor;

  // Update mode indicator
  const mi = document.getElementById('mode-indicator');
  if (toolId === 'draw-land') {
    state.currentPolygon = [];
    mi.textContent = 'Drawing Land Boundary — click to place nodes, click the green first node (or double-click) to close, right-click to undo';
    mi.style.display = 'block';
  } else if (toolId === 'draw-exclusion') {
    state.currentPolygon = [];
    mi.textContent = 'Drawing Exclusion Zone — click to add points, double-click to finish';
    mi.style.display = 'block';
  } else if (toolId === 'measure') {
    state.measureStart = null;
    state.measureStartRef = null;
    state.snapPoint = null;
    mi.textContent = 'Measure — click to set start, click again to set end. Right-click a dimension to delete it.';
    mi.style.display = 'block';
  } else {
    state.measureStart = null;
    state.measureStartRef = null;
    state.snapPoint = null;
    mi.style.display = 'none';
  }

  // Update toolbar button active states
  document.querySelectorAll('.tool-btn').forEach(btn => btn.classList.remove('active'));
  const activeBtn = document.getElementById(`tool-${toolId}`);
  if (activeBtn) activeBtn.classList.add('active');

  updateCanvasPointerEvents();
}
