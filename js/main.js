import { state, initCanvas, canvas } from './core/state.js';
import { draw } from './render/draw.js';
import { initInputHandlers } from './ui/input-handlers.js';
import { initButtons } from './ui/buttons.js';
import { initMap, syncCanvasToMap } from './map/leaflet-map.js';
import { initTreeGridEntity } from './entities/tree-grid-entity.js';

// Initialize canvas
const container = document.getElementById('canvas-container');
const canvasEl = document.getElementById('canvas');
initCanvas(canvasEl);

function resizeCanvas() {
  canvasEl.width = container.clientWidth;
  canvasEl.height = container.clientHeight;
  if (state.mapActive) {
    syncCanvasToMap();
  } else {
    draw();
  }
}

window.addEventListener('resize', resizeCanvas);

// Wire up UI
initInputHandlers();
initButtons();
initTreeGridEntity();

// Initialize Leaflet map (starts hidden)
initMap();

// Initial render
resizeCanvas();
