import { state } from './state.js';

export function polygonArea(poly) {
  let area = 0;
  for (let i = 0; i < poly.length; i++) {
    const j = (i + 1) % poly.length;
    area += poly[i].x * poly[j].y;
    area -= poly[j].x * poly[i].y;
  }
  return Math.abs(area) / 2;
}

export function polygonBounds(poly) {
  if (!poly.length) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of poly) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { minX, minY, maxX, maxY };
}

export function pointInPolygon(px, py, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y;
    const xj = poly[j].x, yj = poly[j].y;
    if ((yi > py) !== (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

export function pointInAnyExclusion(px, py) {
  for (const zone of state.exclusionZones) {
    if (pointInPolygon(px, py, zone)) return true;
  }
  return false;
}

// Check if a rectangle (axis-aligned in rotated frame) is substantially inside the land polygon
export function rectCoverageInLand(rx, ry, rw, rh, angle, poly) {
  const samples = 9; // 3x3 grid
  let inside = 0;
  const cosA = Math.cos(angle), sinA = Math.sin(angle);
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      const lx = rx + (rw * (i + 0.5) / 3);
      const ly = ry + (rh * (j + 0.5) / 3);
      // Rotate back to world space
      const wx = lx * cosA - ly * sinA;
      const wy = lx * sinA + ly * cosA;
      if (pointInPolygon(wx, wy, poly) && !pointInAnyExclusion(wx, wy)) {
        inside++;
      }
    }
  }
  return inside / samples;
}
