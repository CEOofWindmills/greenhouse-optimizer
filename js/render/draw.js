import { state, canvas, ctx } from '../core/state.js';
import { getParams, metersToScreen } from '../core/transforms.js';
import { drawGrid } from './grid.js';
import { drawTreeRows } from './trees.js';
import { drawOptimizationResult } from './sections.js';
import { getEntities, getTypeHandler } from '../core/entities.js';
import { resolveSnapRef } from '../core/snap.js';

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

  // Render entity selection state (e.g., highlighted tree grid when selected)
  for (const entity of getEntities()) {
    if (entity.selected) {
      const handler = getTypeHandler(entity.type);
      if (handler && handler.renderSelection) handler.renderSelection(entity, params);
    }
  }

  // Exclusion zones
  for (let zi = 0; zi < state.exclusionZones.length; zi++) {
    const zone = state.exclusionZones[zi];
    drawPolygon(zone, 'rgba(243, 156, 18, 0.2)', 'rgba(243, 156, 18, 0.8)', true);
    drawVertices(zone, 'rgba(243, 156, 18, 0.9)', '#fff', 'exclusion', zi);
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

  drawVertices(state.landPolygon, '#e94560', '#fff', 'land');
  drawInProgressVertices();
  drawMeasurements();
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

function drawVertices(poly, fillColor, labelColor, polygonType, zoneIndex) {
  const dv = state.draggingVertex;
  for (let idx = 0; idx < poly.length; idx++) {
    const p = poly[idx];
    const s = metersToScreen(p.x, p.y);
    const isDragging = dv && dv.polygon === polygonType && dv.index === idx
      && (polygonType !== 'exclusion' || dv.zoneIndex === zoneIndex);
    // Highlight ring for dragged vertex
    if (isDragging) {
      ctx.beginPath();
      ctx.arc(s.x, s.y, 14, 0, Math.PI * 2);
      ctx.strokeStyle = '#0f9b8e';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(s.x, s.y, isDragging ? 8 : 6, 0, Math.PI * 2);
    ctx.fillStyle = isDragging ? '#0f9b8e' : fillColor;
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = labelColor;
    ctx.font = '10px Segoe UI';
    ctx.textAlign = 'center';
    ctx.fillText(idx + 1, s.x, s.y - (isDragging ? 12 : 10));
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

function drawMeasurements() {
  // Draw saved measurements (if visible), resolving snap refs for attached dimensions
  if (state.showMeasurements) {
    for (const m of state.measurements) {
      const start = resolveSnapRef(m.startRef) || m.start;
      const end = resolveSnapRef(m.endRef) || m.end;
      drawMeasurementLine(start, end);
    }
  }

  // Draw in-progress measurement
  if (state.measureStart) {
    const resolvedStart = resolveSnapRef(state.measureStartRef) || state.measureStart;
    const endPoint = state.snapPoint || state.mouse;
    drawMeasurementLine(resolvedStart, endPoint, true);
  }

  // Draw snap indicator
  if (state.snapPoint && state.mode === 'measure') {
    const s = metersToScreen(state.snapPoint.x, state.snapPoint.y);
    const size = 6;
    const colors = { vertex: '#e94560', post: '#ffffff', tree: '#2ecc71', grid: '#0f9b8e' };
    const color = colors[state.snapPoint.type] || '#ffffff';

    // Diamond shape
    ctx.beginPath();
    ctx.moveTo(s.x, s.y - size);
    ctx.lineTo(s.x + size, s.y);
    ctx.lineTo(s.x, s.y + size);
    ctx.lineTo(s.x - size, s.y);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

function drawMeasurementLine(start, end, inProgress) {
  const s1 = metersToScreen(start.x, start.y);
  const s2 = metersToScreen(end.x, end.y);

  // Line
  ctx.beginPath();
  ctx.moveTo(s1.x, s1.y);
  ctx.lineTo(s2.x, s2.y);
  ctx.strokeStyle = inProgress ? 'rgba(255, 255, 255, 0.6)' : '#ffffff';
  ctx.lineWidth = 1.5;
  ctx.setLineDash(inProgress ? [6, 4] : []);
  ctx.stroke();
  ctx.setLineDash([]);

  // End ticks (perpendicular marks at start and end)
  const dx = s2.x - s1.x, dy = s2.y - s1.y;
  const len = Math.hypot(dx, dy);
  if (len < 1) return;
  const nx = -dy / len * 6, ny = dx / len * 6; // perpendicular, 6px
  ctx.beginPath();
  ctx.moveTo(s1.x + nx, s1.y + ny);
  ctx.lineTo(s1.x - nx, s1.y - ny);
  ctx.moveTo(s2.x + nx, s2.y + ny);
  ctx.lineTo(s2.x - nx, s2.y - ny);
  ctx.strokeStyle = inProgress ? 'rgba(255, 255, 255, 0.6)' : '#ffffff';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Distance label at midpoint
  const dist = Math.hypot(end.x - start.x, end.y - start.y);
  const midX = (s1.x + s2.x) / 2;
  const midY = (s1.y + s2.y) / 2;
  const label = dist < 10 ? `${dist.toFixed(2)} m` : `${dist.toFixed(1)} m`;

  ctx.font = '11px Segoe UI';
  const textWidth = ctx.measureText(label).width;
  const pad = 3;

  // Background pill
  ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
  ctx.beginPath();
  ctx.roundRect(midX - textWidth / 2 - pad, midY - 7 - pad, textWidth + pad * 2, 14 + pad * 2, 3);
  ctx.fill();

  // Text
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, midX, midY);
}
