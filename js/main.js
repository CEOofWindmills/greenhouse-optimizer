import { state, initCanvas, canvas } from './core/state.js';
import { draw } from './render/draw.js';
import { initInputHandlers } from './ui/input-handlers.js';
import { initButtons } from './ui/buttons.js';

// Initialize canvas
const container = document.getElementById('canvas-container');
const canvasEl = document.getElementById('canvas');
initCanvas(canvasEl);

function resizeCanvas() {
  canvasEl.width = container.clientWidth;
  canvasEl.height = container.clientHeight;
  draw();
}

window.addEventListener('resize', resizeCanvas);

// Wire up UI
initInputHandlers();
initButtons();

// Initial render
resizeCanvas();
