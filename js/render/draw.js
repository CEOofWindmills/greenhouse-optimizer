import { state, canvas, ctx } from '../core/state.js';
import { getParams, metersToScreen } from '../core/transforms.js';
import { drawGrid } from './grid.js';
import { drawTreeRows } from './trees.js';
import { drawOptimizationResult } from './sections.js';

export function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Skip grid when map is active — satellite imagery provides context
  if (!state.mapActive) {
    drawGrid();
  }

  const params = getParams();
  if (params.showTrees && state.landPolygon.length > 2) {
    drawTreeRows(params);
  }

  // Exclusion zones
  for (const zone of state.exclusionZones) {
    drawPolygon(zone, 'rgba(243, 156, 18, 0.2)', 'rgba(243, 156, 18, 0.8)', true);
  }

  // Land polygon
  if (state.landPolygon.length > 0) {
    drawPolygon(state.landPolygon, 'rgba(233, 69, 96, 0.08)', '#e94560', true);
  }

  // Current drawing polygon
  if (state.currentPolygon.length > 0) {
    drawPolygon(state.currentPolygon, 'rgba(255,255,255,0.05)', '#ffffff', false);
    // Draw line to mouse
    const last = metersToScreen(
      state.currentPolygon[state.currentPolygon.length - 1].x,
      state.currentPolygon[state.currentPolygon.length - 1].y
    );
    const mScreen = metersToScreen(state.mouse.x, state.mouse.y);
    ctx.beginPath();
    ctx.moveTo(last.x, last.y);
    ctx.lineTo(mScreen.x, mScreen.y);
    ctx.strokeStyle = 'rgba(255,255,255,0.4)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Optimization result
  if (state.optimizationResult) {
    drawOptimizationResult(state.optimizationResult, params);
  }

  drawVertices(state.landPolygon, '#e94560', '#fff');
  drawInProgressVertices();
}

function drawPolygon(poly, fill, stroke, closed) {
  if (poly.length < 2) return;
  ctx.beginPath();
  const s0 = metersToScreen(poly[0].x, poly[0].y);
  ctx.moveTo(s0.x, s0.y);
  for (let i = 1; i < poly.length; i++) {
    const s = metersToScreen(poly[i].x, poly[i].y);
    ctx.lineTo(s.x, s.y);
  }
  if (closed && poly.length > 2) ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 2;
  ctx.stroke();
}

function drawVertices(poly, fillColor, labelColor) {
  for (let idx = 0; idx < poly.length; idx++) {
    const p = poly[idx];
    const s = metersToScreen(p.x, p.y);
    ctx.beginPath();
    ctx.arc(s.x, s.y, 6, 0, Math.PI * 2);
    ctx.fillStyle = fillColor;
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = labelColor;
    ctx.font = '10px Segoe UI';
    ctx.textAlign = 'center';
    ctx.fillText(idx + 1, s.x, s.y - 10);
  }
}

function drawInProgressVertices() {
  for (let idx = 0; idx < state.currentPolygon.length; idx++) {
    const p = state.currentPolygon[idx];
    const s = metersToScreen(p.x, p.y);
    // First point gets a larger "close" indicator
    if (idx === 0 && state.currentPolygon.length >= 3) {
      ctx.beginPath();
      ctx.arc(s.x, s.y, 14, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(15, 155, 142, 0.6)';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(s.x, s.y, 7, 0, Math.PI * 2);
    ctx.fillStyle = idx === 0 ? '#0f9b8e' : '#ffffff';
    ctx.fill();
    ctx.strokeStyle = '#1a1a2e';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.font = '10px Segoe UI';
    ctx.textAlign = 'center';
    ctx.fillText(idx + 1, s.x, s.y - 12);
  }
}
