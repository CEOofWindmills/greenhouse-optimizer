import { state, canvas } from '../core/state.js';
import { getScale } from '../core/transforms.js';
import { polygonBounds } from '../core/geometry.js';
import { optimize } from '../engine/optimizer.js';
import { draw } from '../render/draw.js';
import { toggleOrtho } from './input-handlers.js';
import { setMapVisible, searchAddress, syncCanvasToMap, updateCanvasPointerEvents } from '../map/leaflet-map.js';

export function initButtons() {
  document.getElementById('btn-draw-land').addEventListener('click', () => {
    state.mode = 'draw-land';
    state.currentPolygon = [];
    canvas.style.cursor = 'crosshair';
    updateCanvasPointerEvents();
    const mi = document.getElementById('mode-indicator');
    mi.textContent = 'Drawing Land Boundary — click to place nodes, click the green first node (or double-click) to close, right-click to undo';
    mi.style.display = 'block';
  });

  document.getElementById('btn-draw-exclusion').addEventListener('click', () => {
    state.mode = 'draw-exclusion';
    state.currentPolygon = [];
    canvas.style.cursor = 'crosshair';
    updateCanvasPointerEvents();
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

  document.getElementById('btn-ortho').addEventListener('click', toggleOrtho);

  document.getElementById('btn-demo').addEventListener('click', () => {
    state.landPolygon = [
      {x: 0, y: 0}, {x: 200, y: 0}, {x: 200, y: 160}, {x: 0, y: 160}
    ];
    state.exclusionZones = [];
    state.currentPolygon = [];
    state.optimizationResult = null;
    state.mode = 'idle';
    document.getElementById('mode-indicator').style.display = 'none';
    canvas.style.cursor = 'default';
    document.getElementById('land-area').textContent = '32000 m²';
    optimize();
    // Fit to view
    document.getElementById('btn-fit').click();
  });

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

  // Map toggle
  document.getElementById('btn-map').addEventListener('click', () => {
    setMapVisible(!state.mapActive);
    document.getElementById('search-bar').style.display = state.mapActive ? 'flex' : 'none';
  });

  // Address search
  document.getElementById('btn-search').addEventListener('click', async () => {
    const input = document.getElementById('address-input');
    const result = await searchAddress(input.value);
    if (!result) {
      input.style.borderColor = '#e74c3c';
      setTimeout(() => input.style.borderColor = '#0f3460', 1500);
    }
  });

  document.getElementById('address-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      document.getElementById('btn-search').click();
    }
  });

  // Split toggle — show/hide detail inputs
  document.getElementById('no-parallel-splits').addEventListener('change', (e) => {
    document.getElementById('row-max-bays').style.display = e.target.checked ? 'none' : 'flex';
    document.getElementById('row-min-bays-split').style.display = e.target.checked ? 'none' : 'flex';
  });
  document.getElementById('no-perp-splits').addEventListener('change', (e) => {
    document.getElementById('row-max-drive-shaft').style.display = e.target.checked ? 'none' : 'flex';
  });

  // Redraw on param changes
  document.querySelectorAll('#sidebar input, #sidebar select').forEach(el => {
    el.addEventListener('change', () => {
      if (state.optimizationResult) optimize();
      draw();
    });
  });
}
