import { state, ctx } from '../core/state.js';
import { getScale, metersToScreen } from '../core/transforms.js';
import { polygonBounds, pointInPolygon, pointInAnyExclusion } from '../core/geometry.js';

export function drawTreeRows(params) {
  const bounds = polygonBounds(state.landPolygon);
  const margin = 20;
  const cosA = Math.cos(params.treeDirection);
  const sinA = Math.sin(params.treeDirection);

  // Determine range in rotated coordinate system
  const corners = [
    { x: bounds.minX - margin, y: bounds.minY - margin },
    { x: bounds.maxX + margin, y: bounds.minY - margin },
    { x: bounds.maxX + margin, y: bounds.maxY + margin },
    { x: bounds.minX - margin, y: bounds.maxY + margin },
  ];

  // Rotate corners into tree-row frame
  let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
  for (const c of corners) {
    const u = c.x * cosA + c.y * sinA;
    const v = -c.x * sinA + c.y * cosA;
    minU = Math.min(minU, u); maxU = Math.max(maxU, u);
    minV = Math.min(minV, v); maxV = Math.max(maxV, v);
  }

  // Draw rows (perpendicular lines spaced by treeRowSpacing)
  const startV = Math.floor(minV / params.treeRowSpacing) * params.treeRowSpacing;
  ctx.strokeStyle = 'rgba(46, 204, 113, 0.15)';
  ctx.lineWidth = 1;

  for (let v = startV; v <= maxV; v += params.treeRowSpacing) {
    const x1 = minU * cosA - v * sinA;
    const y1 = minU * sinA + v * cosA;
    const x2 = maxU * cosA - v * sinA;
    const y2 = maxU * sinA + v * cosA;

    const s1 = metersToScreen(x1, y1);
    const s2 = metersToScreen(x2, y2);
    ctx.beginPath();
    ctx.moveTo(s1.x, s1.y);
    ctx.lineTo(s2.x, s2.y);
    ctx.stroke();

    // Draw individual trees along the row
    if (getScale() * state.zoom > 2) {
      const startU = Math.floor(minU / params.treeSpacing) * params.treeSpacing;
      for (let u = startU; u <= maxU; u += params.treeSpacing) {
        const wx = u * cosA - v * sinA;
        const wy = u * sinA + v * cosA;
        if (pointInPolygon(wx, wy, state.landPolygon) && !pointInAnyExclusion(wx, wy)) {
          const s = metersToScreen(wx, wy);
          ctx.beginPath();
          ctx.arc(s.x, s.y, Math.max(2, getScale() * state.zoom * 0.3), 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(46, 204, 113, 0.6)';
          ctx.fill();
        }
      }
    }
  }
}
