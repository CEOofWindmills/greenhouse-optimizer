import { state, canvas } from '../core/state.js';
import { getScale } from '../core/transforms.js';
import { polygonBounds } from '../core/geometry.js';
import { optimize } from '../engine/optimizer.js';
import { draw } from '../render/draw.js';

export function initButtons() {
  document.getElementById('btn-draw-land').addEventListener('click', () => {
    state.mode = 'draw-land';
    state.currentPolygon = [];
    canvas.style.cursor = 'crosshair';
    const mi = document.getElementById('mode-indicator');
    mi.textContent = 'Drawing Land Boundary — click to place nodes, click the green first node (or double-click) to close, right-click to undo';
    mi.style.display = 'block';
  });

  document.getElementById('btn-draw-exclusion').addEventListener('click', () => {
    state.mode = 'draw-exclusion';
    state.currentPolygon = [];
    canvas.style.cursor = 'crosshair';
    const mi = document.getElementById('mode-indicator');
    mi.textContent = 'Drawing Exclusion Zone — click to add points, double-click to finish';
    mi.style.display = 'block';
  });

  document.getElementById('btn-clear').addEventListener('click', () => {
    state.landPolygon = [];
    state.exclusionZones = [];
    state.currentPolygon = [];
    state.optimizationResult = null;
    state.mode = 'idle';
    document.getElementById('mode-indicator').style.display = 'none';
    canvas.style.cursor = 'default';
    document.getElementById('land-area').textContent = '0 m²';
    document.getElementById('results').innerHTML = '<div style="color:#666;text-align:center;padding:20px 0">Draw land boundary to begin</div>';
    draw();
  });

  document.getElementById('btn-optimize').addEventListener('click', optimize);

  document.getElementById('btn-zoom-in').addEventListener('click', () => {
    state.zoom *= 1.3;
    document.getElementById('scale-display').textContent = `${(getScale() * state.zoom).toFixed(1)} px/m`;
    draw();
  });

  document.getElementById('btn-zoom-out').addEventListener('click', () => {
    state.zoom *= 0.7;
    document.getElementById('scale-display').textContent = `${(getScale() * state.zoom).toFixed(1)} px/m`;
    draw();
  });

  document.getElementById('btn-fit').addEventListener('click', () => {
    if (state.landPolygon.length < 2) return;
    const bounds = polygonBounds(state.landPolygon);
    const ppm = getScale();
    const rangeX = (bounds.maxX - bounds.minX) * ppm;
    const rangeY = (bounds.maxY - bounds.minY) * ppm;
    const padding = 60;
    state.zoom = Math.min(
      (canvas.width - padding * 2) / rangeX,
      (canvas.height - padding * 2) / rangeY
    );
    const centerX = (bounds.minX + bounds.maxX) / 2;
    const centerY = (bounds.minY + bounds.maxY) / 2;
    state.panX = -(centerX * ppm * state.zoom);
    state.panY = -(centerY * ppm * state.zoom);
    document.getElementById('scale-display').textContent = `${(ppm * state.zoom).toFixed(1)} px/m`;
    draw();
  });

  // Redraw on param changes
  document.querySelectorAll('#sidebar input, #sidebar select').forEach(el => {
    el.addEventListener('change', () => {
      if (state.optimizationResult) optimize();
      draw();
    });
  });
}
