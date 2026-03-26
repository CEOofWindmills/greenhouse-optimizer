import { state } from './state.js';
import { getParams } from './transforms.js';

// Resolve a snap reference to current world coordinates
export function resolveSnapRef(ref) {
  if (!ref) return null;
  if (ref.type === 'vertex') {
    if (ref.polygon === 'land' && ref.index < state.landPolygon.length) {
      const p = state.landPolygon[ref.index];
      return { x: p.x, y: p.y };
    }
    if (ref.polygon === 'exclusion' && ref.zoneIndex < state.exclusionZones.length) {
      const zone = state.exclusionZones[ref.zoneIndex];
      if (ref.index < zone.length) return { x: zone[ref.index].x, y: zone[ref.index].y };
    }
  }
  if (ref.type === 'post' || ref.type === 'tree') {
    // UV coords stored relative to grid offset — resolve with current offset + direction
    const params = getParams();
    const cosA = Math.cos(params.treeDirection);
    const sinA = Math.sin(params.treeDirection);
    const u = ref.u + state.treeGridOffset.u;
    const v = ref.v + state.treeGridOffset.v;
    return { x: u * cosA - v * sinA, y: u * sinA + v * cosA };
  }
  return null;
}
