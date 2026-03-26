import { state, ctx } from '../core/state.js';
import { getScale, metersToScreen } from '../core/transforms.js';
import { polygonBounds, pointInPolygon } from '../core/geometry.js';
import { registerEntityType, addEntity } from '../core/entities.js';

export function initTreeGridEntity() {
  registerEntityType('tree-grid', {
    hitTest(entity, mx, my, params) {
      // Only hit-test when there's a land polygon and trees are visible
      if (state.landPolygon.length < 3 || !params.showTrees) return false;

      // Check mouse is within/near land polygon bounds
      const bounds = polygonBounds(state.landPolygon);
      const margin = 20;
      if (mx < bounds.minX - margin || mx > bounds.maxX + margin ||
          my < bounds.minY - margin || my > bounds.maxY + margin) {
        return false;
      }

      // Convert mouse to UV space
      const cosA = Math.cos(params.treeDirection);
      const sinA = Math.sin(params.treeDirection);
      const mouseU = mx * cosA + my * sinA;
      const mouseV = -mx * sinA + my * cosA;

      // Distance to nearest row line (V direction, offset by grid offset)
      const offsetV = state.treeGridOffset.v;
      const relV = ((mouseV - offsetV) % params.treeRowSpacing + params.treeRowSpacing) % params.treeRowSpacing;
      const distV = Math.min(relV, params.treeRowSpacing - relV);

      // Convert to screen pixels for threshold
      const distPx = distV * getScale() * state.zoom;
      return distPx < 10;
    },

    onDragStart(entity, mx, my, params) {
      const cosA = Math.cos(params.treeDirection);
      const sinA = Math.sin(params.treeDirection);
      entity._dragStartU = mx * cosA + my * sinA;
      entity._dragStartV = -mx * sinA + my * cosA;
      entity._origOffset = { u: state.treeGridOffset.u, v: state.treeGridOffset.v };
    },

    onDrag(entity, mx, my, params) {
      const cosA = Math.cos(params.treeDirection);
      const sinA = Math.sin(params.treeDirection);
      const currentU = mx * cosA + my * sinA;
      const currentV = -mx * sinA + my * cosA;

      const deltaU = currentU - entity._dragStartU;
      const deltaV = currentV - entity._dragStartV;

      state.treeGridOffset.u = entity._origOffset.u + deltaU;
      state.treeGridOffset.v = entity._origOffset.v + deltaV;
    },

    onDragEnd(entity) {
      delete entity._dragStartU;
      delete entity._dragStartV;
      delete entity._origOffset;
    },

    renderSelection(entity, params) {
      if (state.landPolygon.length < 3) return;

      const cosA = Math.cos(params.treeDirection);
      const sinA = Math.sin(params.treeDirection);
      const bounds = polygonBounds(state.landPolygon);
      const margin = 10;

      // Compute UV range
      const corners = [
        { x: bounds.minX - margin, y: bounds.minY - margin },
        { x: bounds.maxX + margin, y: bounds.minY - margin },
        { x: bounds.maxX + margin, y: bounds.maxY + margin },
        { x: bounds.minX - margin, y: bounds.maxY + margin },
      ];
      let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
      for (const c of corners) {
        const u = c.x * cosA + c.y * sinA;
        const v = -c.x * sinA + c.y * cosA;
        minU = Math.min(minU, u); maxU = Math.max(maxU, u);
        minV = Math.min(minV, v); maxV = Math.max(maxV, v);
      }

      // Draw highlighted row lines
      const offsetV = state.treeGridOffset.v;
      const startV = Math.floor((minV - offsetV) / params.treeRowSpacing) * params.treeRowSpacing + offsetV;

      ctx.strokeStyle = 'rgba(46, 204, 113, 0.5)';
      ctx.lineWidth = 2;

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
      }

      // Draw move icon at center of land polygon
      const cx = (bounds.minX + bounds.maxX) / 2;
      const cy = (bounds.minY + bounds.maxY) / 2;
      const sc = metersToScreen(cx, cy);
      drawMoveIcon(sc.x, sc.y);
    },
  });

  addEntity({
    type: 'tree-grid',
    id: 'tree-grid',
    selected: false,
    dragging: false,
  });
}

function drawMoveIcon(x, y) {
  const size = 12;
  ctx.strokeStyle = 'rgba(46, 204, 113, 0.8)';
  ctx.lineWidth = 2;

  // Cross arrows
  const dirs = [[0, -1], [0, 1], [-1, 0], [1, 0]];
  for (const [dx, dy] of dirs) {
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + dx * size, y + dy * size);
    ctx.stroke();

    // Arrowhead
    const ax = x + dx * size;
    const ay = y + dy * size;
    const perpX = -dy * 4;
    const perpY = dx * 4;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(ax - dx * 4 + perpX, ay - dy * 4 + perpY);
    ctx.moveTo(ax, ay);
    ctx.lineTo(ax - dx * 4 - perpX, ay - dy * 4 - perpY);
    ctx.stroke();
  }
}
