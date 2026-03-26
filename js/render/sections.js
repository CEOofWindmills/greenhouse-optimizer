import { state, ctx } from '../core/state.js';
import { getScale, metersToScreen } from '../core/transforms.js';

export function drawOptimizationResult(result, params) {
  const cosA = Math.cos(params.treeDirection);
  const sinA = Math.sin(params.treeDirection);

  // Grid mode: simple perimeter-based rendering (no-splits mode)
  if (result.gridMode) {
    drawGridResult(result, params, cosA, sinA);
    return;
  }

  // Build set of shared edge positions for suppression
  const splitUPositions = new Set();
  for (const split of result.parallelSplits || []) {
    splitUPositions.add(Math.round(split.u * 1000) / 1000);
  }
  const splitVPositions = new Set();
  for (const split of result.perpSplits || []) {
    splitVPositions.add(Math.round(split.v * 1000) / 1000);
  }

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
    drawSection(section, params, cosA, sinA, suppressDrive, suppressPulley, suppressTopSidewall, suppressBottomSidewall, false);
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

// ============================================================
// Grid-mode renderer — perimeter polygon + internal grid lines
// Matches the reference HTML approach: simple, clean, jog-friendly
// ============================================================
function drawGridResult(result, params, cosA, sinA) {
  const { activeGrid, numCols, numRows, perimUV, baySize, houseWidth: hw } = result;
  const startU = result.gridU[0];
  const startV = result.gridV[0];

  // Structural offsets — same as section renderer
  const bayOffset = params.bayPostOffset != null ? params.bayPostOffset : params.treeSpacing / 2;
  const houseOffset = params.housePostOffset != null ? params.housePostOffset : 0;
  let swOffset;
  if (params.sidewallRule === 'normal') swOffset = hw / 2;
  else if (params.sidewallRule === 'adjusted') swOffset = hw / 2 + 0.3048;
  else swOffset = hw; // flat

  const gableDist = params.gableBracingDist;
  const swDist = params.sidewallBracingDist;

  // Helper: peak V at a given row
  const peakV = (row) => startV + row * hw + houseOffset;
  // Helper: bay post U at a given col boundary
  const bayPostU = (col) => startU + col * baySize + bayOffset;

  // 1. Perimeter polygon fill — adjusted to structural boundaries (gable posts & sidewalls)
  if (perimUV.length >= 3) {
    // Adjust each perimeter vertex from raw grid-cell coords to structural positions:
    //   U: shift by bayOffset (all vertices)
    //   V: top boundary → peakV(row) - swOffset, bottom boundary → peakV(row-1) + swOffset
    // Determine top vs bottom by incoming edge direction (horizontal going right = top, left = bottom)
    const n = perimUV.length;
    const structPerim = [];
    for (let i = 0; i < n; i++) {
      const prev = perimUV[(i - 1 + n) % n];
      const curr = perimUV[i];

      // Recover grid col/row from raw UV
      const col = Math.round((curr.u - startU) / baySize);
      const row = Math.round((curr.v - startV) / hw);

      const u = bayPostU(col);

      // Determine V from incoming edge direction
      const inHoriz = Math.abs(prev.v - curr.v) < 0.001;
      let v;
      if (inHoriz) {
        // Horizontal incoming: right = top boundary, left = bottom boundary
        v = prev.u < curr.u ? peakV(row) - swOffset : peakV(row - 1) + swOffset;
      } else {
        // Vertical incoming — use outgoing edge to determine
        const next = perimUV[(i + 1) % n];
        const outHoriz = Math.abs(next.v - curr.v) < 0.001;
        if (outHoriz) {
          v = curr.u < next.u ? peakV(row) - swOffset : peakV(row - 1) + swOffset;
        } else {
          v = peakV(row) - swOffset; // fallback
        }
      }
      structPerim.push({ u, v });
    }

    ctx.beginPath();
    const s0 = uvToScreen(structPerim[0].u, structPerim[0].v, cosA, sinA);
    ctx.moveTo(s0.x, s0.y);
    for (let i = 1; i < structPerim.length; i++) {
      const s = uvToScreen(structPerim[i].u, structPerim[i].v, cosA, sinA);
      ctx.lineTo(s.x, s.y);
    }
    ctx.closePath();
    ctx.fillStyle = 'rgba(15, 155, 142, 0.08)';
    ctx.fill();
  }

  // Early exit if too zoomed out for detail
  if (getScale() * state.zoom <= 2) {
    drawGridLabel(result, cosA, sinA);
    return;
  }

  // 2. Sidewall wall lines (white, horizontal) — at sidewallOffset from outermost peaks
  // Process each cell's boundary edges, group contiguous spans
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
  ctx.lineWidth = 2;
  drawGridWalls(activeGrid, numCols, numRows, bayPostU, peakV, swOffset, cosA, sinA);

  // 3. Internal peak lines (at row boundaries where both sides active)
  ctx.strokeStyle = 'rgba(155, 89, 182, 0.35)';
  ctx.lineWidth = 1;
  for (let row = 1; row < numRows; row++) {
    let spanStart = -1;
    for (let col = 0; col <= numCols; col++) {
      const bothActive = col < numCols && activeGrid[col][row] && activeGrid[col][row - 1];
      if (bothActive && spanStart === -1) {
        spanStart = col;
      } else if (!bothActive && spanStart !== -1) {
        drawUVLine(bayPostU(spanStart), peakV(row), bayPostU(col), peakV(row), cosA, sinA);
        spanStart = -1;
      }
    }
  }

  // 4. Internal bay lines (at col boundaries where both sides active)
  ctx.strokeStyle = 'rgba(15, 155, 142, 0.25)';
  ctx.lineWidth = 1;
  for (let col = 1; col < numCols; col++) {
    for (let row = 0; row < numRows; row++) {
      if (!activeGrid[col][row] || !activeGrid[col - 1][row]) continue;
      // Find the V extent for this bay line within this column pair
      const topV = peakV(row);
      const bottomV = peakV(row) + hw; // within this cell
      drawUVLine(bayPostU(col), topV, bayPostU(col), bottomV, cosA, sinA);
    }
  }

  // 5. Gable lines — drive (blue) and pulley (purple)
  drawGridGables(activeGrid, numCols, numRows, bayPostU, peakV, swOffset, cosA, sinA);

  // 6. Bracing — orange ticks extending OUTWARD from boundary walls
  drawGridBracing(activeGrid, numCols, numRows, bayPostU, peakV, swOffset, gableDist, swDist, cosA, sinA);

  // 7. Posts at peak × bay post intersections (+ sidewall positions for outermost rows)
  drawGridPosts(activeGrid, numCols, numRows, bayPostU, peakV, swOffset, cosA, sinA);

  // 8. Area label
  drawGridLabel(result, cosA, sinA);
}

// Draw sidewall and gable wall lines for the grid
function drawGridWalls(activeGrid, numCols, numRows, bayPostU, peakV, swOffset, cosA, sinA) {
  // Top sidewall walls: cells with no neighbor above
  for (let row = 0; row < numRows; row++) {
    let spanStart = -1;
    for (let col = 0; col <= numCols; col++) {
      const isTopEdge = col < numCols && activeGrid[col][row] && (row === 0 || !activeGrid[col][row - 1]);
      if (isTopEdge && spanStart === -1) {
        spanStart = col;
      } else if (!isTopEdge && spanStart !== -1) {
        const v = peakV(row) - swOffset;
        drawUVLine(bayPostU(spanStart), v, bayPostU(col), v, cosA, sinA);
        spanStart = -1;
      }
    }
  }
  // Bottom sidewall walls: cells with no neighbor below
  for (let row = 0; row < numRows; row++) {
    let spanStart = -1;
    for (let col = 0; col <= numCols; col++) {
      const isBottomEdge = col < numCols && activeGrid[col][row] && (row === numRows - 1 || !activeGrid[col][row + 1]);
      if (isBottomEdge && spanStart === -1) {
        spanStart = col;
      } else if (!isBottomEdge && spanStart !== -1) {
        const v = peakV(row) + swOffset;
        drawUVLine(bayPostU(spanStart), v, bayPostU(col), v, cosA, sinA);
        spanStart = -1;
      }
    }
  }
  // Left gable walls: cells with no neighbor to the left (drawn as part of gable rendering)
  // Right gable walls: same — handled by drawGridGables
}

// Draw gable lines (drive=blue, pulley=purple) with proper structural positions
// Gable extends to sidewall only where there IS a sidewall (no active neighbor above/below).
// At jog boundaries (active neighbor above/below but not a gable edge), stop at the peak.
function drawGridGables(activeGrid, numCols, numRows, bayPostU, peakV, swOffset, cosA, sinA) {
  // Drive gables (left edges) — blue
  for (let col = 0; col < numCols; col++) {
    let spanStart = -1;
    for (let row = 0; row <= numRows; row++) {
      const isLeftEdge = row < numRows && activeGrid[col][row] && (col === 0 || !activeGrid[col - 1][row]);
      if (isLeftEdge && spanStart === -1) {
        spanStart = row;
      } else if (!isLeftEdge && spanStart !== -1) {
        const spanEnd = row - 1;
        const hasTopSW = spanStart === 0 || !activeGrid[col][spanStart - 1];
        const hasBottomSW = spanEnd === numRows - 1 || !activeGrid[col][spanEnd + 1];
        const u = bayPostU(col);
        const v1 = hasTopSW ? peakV(spanStart) - swOffset : peakV(spanStart);
        const v2 = hasBottomSW ? peakV(spanEnd) + swOffset : peakV(spanEnd + 1);
        drawUVLine(u, v1, u, v2, cosA, sinA, '#3498db', 3);
        spanStart = -1;
      }
    }
  }
  // Pulley gables (right edges) — purple
  for (let col = 0; col < numCols; col++) {
    let spanStart = -1;
    for (let row = 0; row <= numRows; row++) {
      const isRightEdge = row < numRows && activeGrid[col][row] && (col === numCols - 1 || !activeGrid[col + 1][row]);
      if (isRightEdge && spanStart === -1) {
        spanStart = row;
      } else if (!isRightEdge && spanStart !== -1) {
        const spanEnd = row - 1;
        const hasTopSW = spanStart === 0 || !activeGrid[col][spanStart - 1];
        const hasBottomSW = spanEnd === numRows - 1 || !activeGrid[col][spanEnd + 1];
        const u = bayPostU(col + 1);
        const v1 = hasTopSW ? peakV(spanStart) - swOffset : peakV(spanStart);
        const v2 = hasBottomSW ? peakV(spanEnd) + swOffset : peakV(spanEnd + 1);
        drawUVLine(u, v1, u, v2, cosA, sinA, '#9b59b6', 2);
        spanStart = -1;
      }
    }
  }
}

// Draw bracing ticks extending OUTWARD from boundary walls
function drawGridBracing(activeGrid, numCols, numRows, bayPostU, peakV, swOffset, gableDist, swDist, cosA, sinA) {
  if (gableDist <= 0 && swDist <= 0) return;

  ctx.strokeStyle = '#f39c12';
  ctx.lineWidth = 1.5;
  const drawn = new Set();

  for (let col = 0; col < numCols; col++) {
    for (let row = 0; row < numRows; row++) {
      if (!activeGrid[col][row]) continue;

      const peak = peakV(row);
      const topSW = peak - swOffset;
      const bottomSW = peak + swOffset;
      const driveU = bayPostU(col);
      const pulleyU = bayPostU(col + 1);

      // Gable bracing: at drive/pulley gable U, extending outward horizontally
      // Ticks at each V position (peak + sidewalls if on boundary)
      if (gableDist > 0) {
        // Left gable (drive side)
        if (col === 0 || !activeGrid[col - 1][row]) {
          bracingTick(driveU, peak, -gableDist, 0, drawn, cosA, sinA);
          if (row === 0 || !activeGrid[col][row - 1])
            bracingTick(driveU, topSW, -gableDist, 0, drawn, cosA, sinA);
          if (row === numRows - 1 || !activeGrid[col][row + 1])
            bracingTick(driveU, bottomSW, -gableDist, 0, drawn, cosA, sinA);
        }
        // Right gable (pulley side)
        if (col === numCols - 1 || !activeGrid[col + 1][row]) {
          bracingTick(pulleyU, peak, gableDist, 0, drawn, cosA, sinA);
          if (row === 0 || !activeGrid[col][row - 1])
            bracingTick(pulleyU, topSW, gableDist, 0, drawn, cosA, sinA);
          if (row === numRows - 1 || !activeGrid[col][row + 1])
            bracingTick(pulleyU, bottomSW, gableDist, 0, drawn, cosA, sinA);
        }
      }

      // Sidewall bracing: at top/bottom sidewall V, extending outward vertically
      // Ticks at each U position (bay posts within this cell)
      if (swDist > 0) {
        if (row === 0 || !activeGrid[col][row - 1]) {
          bracingTick(driveU, topSW, 0, -swDist, drawn, cosA, sinA);
          bracingTick(pulleyU, topSW, 0, -swDist, drawn, cosA, sinA);
        }
        if (row === numRows - 1 || !activeGrid[col][row + 1]) {
          bracingTick(driveU, bottomSW, 0, swDist, drawn, cosA, sinA);
          bracingTick(pulleyU, bottomSW, 0, swDist, drawn, cosA, sinA);
        }
      }
    }
  }
}

// Draw a single bracing tick with deduplication
function bracingTick(u, v, du, dv, drawn, cosA, sinA) {
  const key = `${u.toFixed(2)},${v.toFixed(2)},${du.toFixed(2)},${dv.toFixed(2)}`;
  if (drawn.has(key)) return;
  drawn.add(key);
  drawUVLine(u, v, u + du, v + dv, cosA, sinA);
}

// Draw posts at peak × bay post intersections + sidewall positions for boundary rows
function drawGridPosts(activeGrid, numCols, numRows, bayPostU, peakV, swOffset, cosA, sinA) {
  const postRadius = Math.max(2, Math.min(4, getScale() * state.zoom * 0.25));
  const drawn = new Set();

  function drawPost(u, v) {
    const key = `${u.toFixed(2)},${v.toFixed(2)}`;
    if (drawn.has(key)) return;
    drawn.add(key);
    const s = uvToScreen(u, v, cosA, sinA);
    ctx.beginPath();
    ctx.arc(s.x, s.y, postRadius, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  for (let col = 0; col < numCols; col++) {
    for (let row = 0; row < numRows; row++) {
      if (!activeGrid[col][row]) continue;

      const peak = peakV(row);
      const uL = bayPostU(col);
      const uR = bayPostU(col + 1);

      // Posts at peak (tree row) positions
      drawPost(uL, peak);
      drawPost(uR, peak);

      // Posts at sidewall positions (only at boundary rows)
      if (row === 0 || !activeGrid[col][row - 1]) {
        drawPost(uL, peak - swOffset);
        drawPost(uR, peak - swOffset);
      }
      if (row === numRows - 1 || !activeGrid[col][row + 1]) {
        drawPost(uL, peak + swOffset);
        drawPost(uR, peak + swOffset);
      }
    }
  }
}

// Draw combined area label at the center of the active grid
function drawGridLabel(result, cosA, sinA) {
  if (result.activeCells === 0) return;
  const { activeGrid, numCols, numRows, baySize, houseWidth } = result;
  const startU = result.gridU[0];
  const startV = result.gridV[0];

  // Find center of mass of active cells
  let sumU = 0, sumV = 0, count = 0;
  for (let col = 0; col < numCols; col++) {
    for (let row = 0; row < numRows; row++) {
      if (activeGrid[col][row]) {
        sumU += startU + (col + 0.5) * baySize;
        sumV += startV + (row + 0.5) * houseWidth;
        count++;
      }
    }
  }
  const centerU = sumU / count;
  const centerV = sumV / count;
  const s = uvToScreen(centerU, centerV, cosA, sinA);

  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  ctx.font = `${Math.max(10, 14 * state.zoom)}px Segoe UI`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`${result.totalArea.toLocaleString()} m²`, s.x, s.y);
}

// UV → screen coordinate helper
function uvToScreen(u, v, cosA, sinA) {
  const wx = u * cosA - v * sinA;
  const wy = u * sinA + v * cosA;
  return metersToScreen(wx, wy);
}

function drawSection(section, params, cosA, sinA, suppressDrive, suppressPulley, suppressTopSW, suppressBottomSW, skipLabel) {
  // Compute post grid positions in UV space FIRST — needed for correct fill boundaries
  // Bay post offset: posts sit between trees along U (default: treeSpacing / 2)
  const bayOffset = params.bayPostOffset != null ? params.bayPostOffset : params.treeSpacing / 2;
  // House post offset: peak posts sit ON tree rows (default: 0)
  const houseOffset = params.housePostOffset != null ? params.housePostOffset : 0;

  const uPositions = getUPositions(section, bayOffset);
  const { peaks: vPeaks, sidewalls: vSidewalls } = getVPositions(section, houseOffset, params.sidewallRule);

  // Section fill — use structural boundaries (gable posts & sidewalls), not raw grid cells
  const driveU = uPositions[0];
  const pulleyU = uPositions[uPositions.length - 1];
  const topV = vSidewalls.top;
  const bottomV = vSidewalls.bottom;
  const corners = [
    { u: driveU, v: topV },
    { u: pulleyU, v: topV },
    { u: pulleyU, v: bottomV },
    { u: driveU, v: bottomV },
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
