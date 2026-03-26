import { state, ctx } from '../core/state.js';
import { getScale, metersToScreen } from '../core/transforms.js';

export function drawOptimizationResult(result, params) {
  const cosA = Math.cos(params.treeDirection);
  const sinA = Math.sin(params.treeDirection);

  // Build set of shared edge positions for suppression
  const splitUPositions = new Set();
  for (const split of result.parallelSplits || []) {
    splitUPositions.add(Math.round(split.u * 1000) / 1000);
  }
  const splitVPositions = new Set();
  for (const split of result.perpSplits || []) {
    splitVPositions.add(Math.round(split.v * 1000) / 1000);
  }

  const noSplitsMode = params.noParallelSplits && params.noPerpSplits;

  // Draw each section — shared edges suppressed, outer edges drawn = natural perimeter
  for (const section of result.sections) {
    const driveU = section.u;
    const pulleyU = section.u + section.width;
    const topV = section.v;
    const bottomV = section.v + section.height;
    const suppressDrive = splitUPositions.has(Math.round(driveU * 1000) / 1000);
    const suppressPulley = splitUPositions.has(Math.round(pulleyU * 1000) / 1000);
    const suppressTopSidewall = splitVPositions.has(Math.round(topV * 1000) / 1000);
    const suppressBottomSidewall = splitVPositions.has(Math.round(bottomV * 1000) / 1000);
    // In no-splits mode: skip individual labels — one combined label drawn after
    drawSection(section, params, cosA, sinA, suppressDrive, suppressPulley, suppressTopSidewall, suppressBottomSidewall, noSplitsMode);
  }

  // In no-splits mode, draw one combined label at the center of the largest section
  if (noSplitsMode && result.sections.length > 0) {
    const largest = result.sections.reduce((a, b) => a.effectiveArea > b.effectiveArea ? a : b);
    const totalArea = result.sections.reduce((sum, s) => sum + s.effectiveArea, 0);
    const centerU = largest.u + largest.width / 2;
    const centerV = largest.v + largest.height / 2;
    const centerW = { x: centerU * cosA - centerV * sinA, y: centerU * sinA + centerV * cosA };
    const centerS = metersToScreen(centerW.x, centerW.y);
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.font = `${Math.max(10, 14 * state.zoom)}px Segoe UI`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${totalArea.toLocaleString()} m²`, centerS.x, centerS.y);
  }

  // Draw split lines only when splits are enabled
  const bayOffset = params.bayPostOffset != null ? params.bayPostOffset : params.treeSpacing / 2;
  const houseOffset = params.housePostOffset != null ? params.housePostOffset : 0;

  if (!params.noParallelSplits) {
    for (const split of result.parallelSplits || []) {
      const splitPostU = split.u + bayOffset;
      const v0 = split.v + houseOffset;
      const v1 = split.v + split.height;
      drawUVLine(splitPostU, v0, splitPostU, v1, cosA, sinA, '#e74c3c', 3);
    }
  }

  if (!params.noPerpSplits) {
    const hw = result.houseWidth;
    for (const split of result.perpSplits || []) {
      const splitValleyV = split.v + houseOffset - hw / 2;
      const u0 = split.u + bayOffset;
      const u1 = split.u + bayOffset + split.width;
      drawUVLine(u0, splitValleyV, u1, splitValleyV, cosA, sinA, '#e67e22', 3);
    }
  }
}

function drawSection(section, params, cosA, sinA, suppressDrive, suppressPulley, suppressTopSW, suppressBottomSW, skipLabel) {
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
  const { peaks: vPeaks, sidewalls: vSidewalls } = getVPositions(section, houseOffset, params.sidewallRule);

  drawWalls(uPositions, vPeaks, vSidewalls, cosA, sinA, suppressDrive, suppressPulley, suppressTopSW, suppressBottomSW);
  drawStructuralLines(uPositions, vPeaks, vSidewalls, cosA, sinA);
  drawBracing(uPositions, vPeaks, vSidewalls, params.gableBracingDist, params.sidewallBracingDist, cosA, sinA, suppressDrive, suppressPulley, suppressTopSW, suppressBottomSW);
  // Posts at peaks + non-suppressed sidewalls (suppressed = shared boundary, no posts there)
  const allVPositions = [];
  if (!suppressTopSW) allVPositions.push(vSidewalls.top);
  allVPositions.push(...vPeaks);
  if (!suppressBottomSW) allVPositions.push(vSidewalls.bottom);
  drawPosts(uPositions, allVPositions, cosA, sinA);
  if (!suppressDrive) drawDriveGable(uPositions, vSidewalls, cosA, sinA);
  if (!suppressPulley) drawPulleyGable(uPositions, vSidewalls, cosA, sinA);
  if (!skipLabel) drawLabel(section, cosA, sinA);
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

// House positions along V — separated into peaks (post rows) and sidewalls (valleys, no posts)
// Peaks are anchored to tree rows and NEVER move.
// Sidewall rule only changes how far the valley sits from the first/last peak.
function getVPositions(section, houseOffset, sidewallRule) {
  const hw = section.houseWidth;

  // Sidewall offset: distance from peak to sidewall (outward)
  let sidewallOffset;
  if (sidewallRule === 'normal') {
    sidewallOffset = hw / 2;           // valley sits halfway between peaks
  } else if (sidewallRule === 'adjusted') {
    sidewallOffset = hw / 2 + 0.3048;  // half house + 1 ft
  } else {
    // 'flat' — full house width
    sidewallOffset = hw;
  }

  // First peak is anchored at the section grid position + houseOffset
  const firstPeak = section.v + houseOffset;
  const lastPeak = firstPeak + (section.houses - 1) * hw;

  // Peaks: post rows on tree rows — posts and bracing live here
  const peaks = [];
  for (let h = 0; h < section.houses; h++) {
    peaks.push(firstPeak + h * hw);
  }

  // Sidewalls: valleys — wall lines only, NO posts, NO bracing
  const sidewalls = {
    top: firstPeak - sidewallOffset,
    bottom: lastPeak + sidewallOffset,
  };

  return { peaks, sidewalls };
}

// Sidewalls and gable walls
// Sidewalls are at valley positions (no posts). Gables run from sidewall to sidewall.
function drawWalls(uPositions, vPeaks, vSidewalls, cosA, sinA, suppressDrive, suppressPulley, suppressTopSW, suppressBottomSW) {
  const u0 = uPositions[0];
  const u1 = uPositions[uPositions.length - 1];
  const swTop = vSidewalls.top;
  const swBottom = vSidewalls.bottom;

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
  ctx.lineWidth = 2;

  // Sidewalls (along U, at valley positions) — suppress at perpendicular splits
  if (!suppressTopSW) drawUVLine(u0, swTop, u1, swTop, cosA, sinA);
  if (!suppressBottomSW) drawUVLine(u0, swBottom, u1, swBottom, cosA, sinA);

  // Gables (along V, from sidewall to sidewall) — suppress at parallel splits
  if (!suppressDrive) drawUVLine(u0, swTop, u0, swBottom, cosA, sinA);
  if (!suppressPulley) drawUVLine(u1, swTop, u1, swBottom, cosA, sinA);
}

// Internal structural lines — peak lines and bay lines
function drawStructuralLines(uPositions, vPeaks, vSidewalls, cosA, sinA) {
  const u0 = uPositions[0];
  const u1 = uPositions[uPositions.length - 1];

  if (getScale() * state.zoom <= 2) return;

  // Peak lines — HORIZONTAL (along U), at each peak (post row)
  // Skip first and last peaks (they're the outer peaks, already visible as gable extents)
  ctx.strokeStyle = 'rgba(155, 89, 182, 0.35)';
  ctx.lineWidth = 1;
  for (let i = 1; i < vPeaks.length - 1; i++) {
    drawUVLine(u0, vPeaks[i], u1, vPeaks[i], cosA, sinA);
  }

  // Bay lines — VERTICAL (along V), at each internal U post position
  // Run from sidewall to sidewall (full section height)
  ctx.strokeStyle = 'rgba(15, 155, 142, 0.25)';
  for (let i = 1; i < uPositions.length - 1; i++) {
    drawUVLine(uPositions[i], vSidewalls.top, uPositions[i], vSidewalls.bottom, cosA, sinA);
  }
}

// Draw bracing — orange lines extending outward from perimeter PEAK posts only
// Valleys (sidewalls) have no posts, so no bracing originates from them
function drawBracing(uPositions, vPeaks, vSidewalls, gableBracingDist, sidewallBracingDist, cosA, sinA, suppressDrive, suppressPulley, suppressTopSW, suppressBottomSW) {
  if (getScale() * state.zoom <= 2) return;

  const u0 = uPositions[0];
  const u1 = uPositions[uPositions.length - 1];
  const firstPeak = vPeaks[0];
  const lastPeak = vPeaks[vPeaks.length - 1];

  ctx.strokeStyle = '#f39c12';
  ctx.lineWidth = 1.5;

  // Sidewall bracing — short ticks extending outward from the sidewall (valley) position
  // The bracing attaches at the sidewall and extends outward by sidewallBracingDist
  if (sidewallBracingDist > 0) {
    if (!suppressTopSW) {
      for (const u of uPositions) {
        drawUVLine(u, vSidewalls.top, u, vSidewalls.top - sidewallBracingDist, cosA, sinA);
      }
    }
    if (!suppressBottomSW) {
      for (const u of uPositions) {
        drawUVLine(u, vSidewalls.bottom, u, vSidewalls.bottom + sidewallBracingDist, cosA, sinA);
      }
    }
  }

  // Gable bracing — extends from peaks + non-suppressed sidewalls at drive/pulley gables
  // Suppressed sidewalls have no posts, so no bracing there
  const allV = [];
  if (!suppressTopSW) allV.push(vSidewalls.top);
  allV.push(...vPeaks);
  if (!suppressBottomSW) allV.push(vSidewalls.bottom);
  if (gableBracingDist > 0) {
    if (!suppressDrive) {
      for (const v of allV) {
        drawUVLine(u0, v, u0 - gableBracingDist, v, cosA, sinA);
      }
    }
    if (!suppressPulley) {
      for (const v of allV) {
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

// Drive gable — at first U post, runs from top sidewall to bottom sidewall
function drawDriveGable(uPositions, vSidewalls, cosA, sinA) {
  const u = uPositions[0];
  drawUVLine(u, vSidewalls.top, u, vSidewalls.bottom, cosA, sinA, '#3498db', 3);
}

// Pulley gable — at last U post, runs from top sidewall to bottom sidewall
function drawPulleyGable(uPositions, vSidewalls, cosA, sinA) {
  const u = uPositions[uPositions.length - 1];
  drawUVLine(u, vSidewalls.top, u, vSidewalls.bottom, cosA, sinA, '#9b59b6', 2);
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
