import { state, ctx } from '../core/state.js';
import { getScale, metersToScreen } from '../core/transforms.js';

export function drawOptimizationResult(result, params) {
  const cosA = Math.cos(params.treeDirection);
  const sinA = Math.sin(params.treeDirection);

  // Build set of U positions that are parallel splits
  const splitUPositions = new Set();
  for (const split of result.parallelSplits || []) {
    splitUPositions.add(Math.round(split.u * 1000) / 1000);
  }

  for (const section of result.sections) {
    const driveU = section.u; // drive gable U position
    const pulleyU = section.u + section.width; // pulley gable U position
    const suppressDrive = splitUPositions.has(Math.round(driveU * 1000) / 1000);
    const suppressPulley = splitUPositions.has(Math.round(pulleyU * 1000) / 1000);
    drawSection(section, params, cosA, sinA, suppressDrive, suppressPulley);
  }

  // Draw parallel splits at the actual post position (not section grid boundary)
  // The split runs through the shared column of posts between adjacent zones
  const bayOffset = params.bayPostOffset != null ? params.bayPostOffset : params.treeSpacing / 2;
  const houseOffset = params.housePostOffset != null ? params.housePostOffset : 0;
  for (const split of result.parallelSplits || []) {
    // The last post of zone A = split.u + bayOffset (offset into zone B)
    // which equals zone A's last bay post position
    // Since zones share the boundary, the split post column is at split.u + bayOffset
    const splitPostU = split.u + bayOffset;
    const v0 = split.v + houseOffset;
    const v1 = split.v + split.height; // already at last house position
    drawUVLine(splitPostU, v0, splitPostU, v1, cosA, sinA, '#e74c3c', 3);
  }

  // Draw perpendicular splits — run along U, parallel to sidewalls
  for (const split of result.perpSplits || []) {
    drawUVLine(split.u, split.v, split.u + split.width, split.v, cosA, sinA, '#e67e22', 3);
  }
}

function drawSection(section, params, cosA, sinA, suppressDrive, suppressPulley) {
  // Section fill
  const corners = [
    { u: section.u, v: section.v },
    { u: section.u + section.width, v: section.v },
    { u: section.u + section.width, v: section.v + section.height },
    { u: section.u, v: section.v + section.height },
  ];
  const worldCorners = corners.map(c => ({
    x: c.u * cosA - c.v * sinA,
    y: c.u * sinA + c.v * cosA,
  }));

  ctx.beginPath();
  const s0 = metersToScreen(worldCorners[0].x, worldCorners[0].y);
  ctx.moveTo(s0.x, s0.y);
  for (let i = 1; i < 4; i++) {
    const s = metersToScreen(worldCorners[i].x, worldCorners[i].y);
    ctx.lineTo(s.x, s.y);
  }
  ctx.closePath();
  ctx.fillStyle = section.isJog ? 'rgba(231, 76, 60, 0.1)' : 'rgba(15, 155, 142, 0.08)';
  ctx.fill();

  // Compute post grid positions in UV space
  // Bay post offset: posts sit between trees along U (default: treeSpacing / 2)
  const bayOffset = params.bayPostOffset != null ? params.bayPostOffset : params.treeSpacing / 2;
  // House post offset: peak posts sit ON tree rows (default: 0)
  const houseOffset = params.housePostOffset != null ? params.housePostOffset : 0;

  const uPositions = getUPositions(section, bayOffset);
  const vPositions = getVPositions(section, houseOffset);

  drawWalls(uPositions, vPositions, cosA, sinA, suppressDrive, suppressPulley);
  drawStructuralLines(uPositions, vPositions, cosA, sinA);
  drawBracing(uPositions, vPositions, params.gableBracingDist, params.sidewallBracingDist, cosA, sinA, suppressDrive, suppressPulley);
  drawPosts(uPositions, vPositions, cosA, sinA);
  if (!suppressDrive) drawDriveGable(uPositions, vPositions, cosA, sinA);
  if (!suppressPulley) drawPulleyGable(uPositions, vPositions, cosA, sinA);
  drawLabel(section, cosA, sinA);
}

// Bay post positions along U — gable walls ARE at first/last bay post
function getUPositions(section, bayOffset) {
  const positions = [];
  // bays+1 posts: first post at u + offset, then every baySize
  for (let b = 0; b <= section.bays; b++) {
    positions.push(section.u + bayOffset + b * section.baySize);
  }
  return positions;
}

// House post positions along V — sidewall walls ARE at first/last house post
function getVPositions(section, houseOffset) {
  const positions = [];
  // houses+1 posts: first post at v + offset, then every houseWidth
  for (let h = 0; h <= section.houses; h++) {
    positions.push(section.v + houseOffset + h * section.houseWidth);
  }
  return positions;
}

// Sidewalls and gable walls — drawn at post grid boundaries
function drawWalls(uPositions, vPositions, cosA, sinA, suppressDrive, suppressPulley) {
  const u0 = uPositions[0];
  const u1 = uPositions[uPositions.length - 1];
  const v0 = vPositions[0];
  const v1 = vPositions[vPositions.length - 1];

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
  ctx.lineWidth = 2;

  // Sidewalls (along U, at V edges)
  drawUVLine(u0, v0, u1, v0, cosA, sinA);
  drawUVLine(u0, v1, u1, v1, cosA, sinA);

  // Gables (along V, at U edges) — suppress at parallel splits
  if (!suppressDrive) drawUVLine(u0, v0, u0, v1, cosA, sinA);
  if (!suppressPulley) drawUVLine(u1, v0, u1, v1, cosA, sinA);
}

// Internal structural lines — peak lines and bay lines
function drawStructuralLines(uPositions, vPositions, cosA, sinA) {
  const u0 = uPositions[0];
  const u1 = uPositions[uPositions.length - 1];
  const v0 = vPositions[0];
  const v1 = vPositions[vPositions.length - 1];

  if (getScale() * state.zoom <= 2) return;

  // Peak lines — HORIZONTAL (along U), at each internal V post position
  ctx.strokeStyle = 'rgba(155, 89, 182, 0.35)';
  ctx.lineWidth = 1;
  for (let i = 1; i < vPositions.length - 1; i++) {
    drawUVLine(u0, vPositions[i], u1, vPositions[i], cosA, sinA);
  }

  // Bay lines — VERTICAL (along V), at each internal U post position
  ctx.strokeStyle = 'rgba(15, 155, 142, 0.25)';
  for (let i = 1; i < uPositions.length - 1; i++) {
    drawUVLine(uPositions[i], v0, uPositions[i], v1, cosA, sinA);
  }
}

// Draw bracing — orange lines extending outward from perimeter posts
// suppressDrive/suppressPulley: skip gable bracing at parallel split edges
function drawBracing(uPositions, vPositions, gableBracingDist, sidewallBracingDist, cosA, sinA, suppressDrive, suppressPulley) {
  if (getScale() * state.zoom <= 2) return;

  const u0 = uPositions[0];
  const u1 = uPositions[uPositions.length - 1];
  const v0 = vPositions[0];
  const v1 = vPositions[vPositions.length - 1];

  ctx.strokeStyle = '#f39c12';
  ctx.lineWidth = 1.5;

  // Sidewall bracing — posts along top (v0) and bottom (v1) sidewalls
  if (sidewallBracingDist > 0) {
    for (const u of uPositions) {
      drawUVLine(u, v0, u, v0 - sidewallBracingDist, cosA, sinA);
      drawUVLine(u, v1, u, v1 + sidewallBracingDist, cosA, sinA);
    }
  }

  // Gable bracing — posts along left (u0) and right (u1) gables
  // Skip at parallel splits (interior connection, not exposed edge)
  if (gableBracingDist > 0) {
    if (!suppressDrive) {
      for (const v of vPositions) {
        drawUVLine(u0, v, u0 - gableBracingDist, v, cosA, sinA);
      }
    }
    if (!suppressPulley) {
      for (const v of vPositions) {
        drawUVLine(u1, v, u1 + gableBracingDist, v, cosA, sinA);
      }
    }
  }
}

// Draw posts at every grid intersection
function drawPosts(uPositions, vPositions, cosA, sinA) {
  if (getScale() * state.zoom <= 2) return;

  const postRadius = Math.max(2, Math.min(4, getScale() * state.zoom * 0.25));

  for (const u of uPositions) {
    for (const v of vPositions) {
      const wx = u * cosA - v * sinA;
      const wy = u * sinA + v * cosA;
      const s = metersToScreen(wx, wy);

      ctx.beginPath();
      ctx.arc(s.x, s.y, postRadius, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.5)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }
}

// Drive gable — at first U post, runs along V
function drawDriveGable(uPositions, vPositions, cosA, sinA) {
  const u = uPositions[0];
  const v0 = vPositions[0];
  const v1 = vPositions[vPositions.length - 1];
  drawUVLine(u, v0, u, v1, cosA, sinA, '#3498db', 3);
}

// Pulley gable — at last U post, runs along V
function drawPulleyGable(uPositions, vPositions, cosA, sinA) {
  const u = uPositions[uPositions.length - 1];
  const v0 = vPositions[0];
  const v1 = vPositions[vPositions.length - 1];
  drawUVLine(u, v0, u, v1, cosA, sinA, '#9b59b6', 2);
}

function drawLabel(section, cosA, sinA) {
  const centerU = section.u + section.width / 2;
  const centerV = section.v + section.height / 2;
  const centerW = { x: centerU * cosA - centerV * sinA, y: centerU * sinA + centerV * cosA };
  const centerS = metersToScreen(centerW.x, centerW.y);
  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  ctx.font = `${Math.max(10, 12 * state.zoom)}px Segoe UI`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`${section.houses}H x ${section.bays}B`, centerS.x, centerS.y);
}

// Helper: draw a line from (u1,v1) to (u2,v2) in rotated space
function drawUVLine(u1, v1, u2, v2, cosA, sinA, color, width) {
  const w1 = { x: u1 * cosA - v1 * sinA, y: u1 * sinA + v1 * cosA };
  const w2 = { x: u2 * cosA - v2 * sinA, y: u2 * sinA + v2 * cosA };
  const s1 = metersToScreen(w1.x, w1.y);
  const s2 = metersToScreen(w2.x, w2.y);
  if (color) ctx.strokeStyle = color;
  if (width) ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(s1.x, s1.y);
  ctx.lineTo(s2.x, s2.y);
  ctx.stroke();
}
