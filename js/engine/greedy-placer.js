import { state } from '../core/state.js';
import { polygonArea, rectCoverageInLand } from '../core/geometry.js';

// Balanced placement algorithm
// Instead of greedy "take max first", distributes bays evenly across sections
export function greedyPlace(rotatedPoly, startU, startV, rBounds, uSpacing, vSpacing, maxUCount, maxVCount, params, cosA, sinA) {
  // Build grid — bounded by adjusted bounds (inset for structural margins)
  // A cell at u spans [u, u+uSpacing], so its right edge must fit within adjusted bounds
  const gridU = [];
  const gridV = [];
  for (let u = startU; u + uSpacing <= rBounds.maxX + 0.001; u += uSpacing) gridU.push(u);
  for (let v = startV; v + vSpacing <= rBounds.maxY + 0.001; v += vSpacing) gridV.push(v);

  // Coverage grid: 1 = inside land, 0 = outside
  const grid = [];
  for (let i = 0; i < gridU.length; i++) {
    grid[i] = [];
    for (let j = 0; j < gridV.length; j++) {
      const coverage = rectCoverageInLand(gridU[i], gridV[j], uSpacing, vSpacing, params.treeDirection, state.landPolygon);
      grid[i][j] = coverage > 0.25 ? 1 : 0;
    }
  }

  // No-splits mode: use simple grid-based perimeter tracing (like the reference)
  const noSplitsMode = params.noParallelSplits && params.noPerpSplits;
  if (noSplitsMode) {
    return gridPlace(grid, gridU, gridV, uSpacing, vSpacing, params);
  }

  const sections = [];
  const splits = [];
  let totalArea = 0;
  let jogCount = 0;

  const used = grid.map(row => row.map(() => false));

  // Phase 1: Find contiguous horizontal spans for each row of houses
  // Phase 2: For each span, distribute bays evenly into sections
  // Phase 3: Fall back to greedy for irregular leftovers

  // Find the tallest contiguous house run for each starting j
  while (true) {
    // Find the largest contiguous block (houses × total bays)
    const block = findLargestBlock(grid, used, gridU, gridV);
    if (!block) break;

    // block = { i, j, spanBays, numHouses } — full horizontal span, not yet split

    // Distribute spanBays evenly along U (parallel splits)
    const bayDist = distributeBays(block.spanBays, maxUCount, params.minBaysSplit);

    // Distribute numHouses evenly along V (perpendicular splits)
    // minHousesSplit = 1 (any single house is valid as a section)
    const houseDist = distributeBays(block.numHouses, maxVCount, 1);

    if (bayDist.length === 0 || houseDist.length === 0) {
      // Can't distribute — mark as used and skip
      for (let ii = block.i; ii < block.i + block.spanBays; ii++) {
        for (let jj = block.j; jj < block.j + block.numHouses; jj++) {
          used[ii][jj] = true;
        }
      }
      continue;
    }

    // Place sections for each (bayGroup, houseGroup) combination
    let currentJ = block.j;
    for (const numHouses of houseDist) {
      let currentI = block.i;
      for (const numBays of bayDist) {
        const sectionWidth = numBays * uSpacing;
        const sectionHeight = numHouses * vSpacing;

        // Mark cells as used
        for (let ii = currentI; ii < currentI + numBays; ii++) {
          for (let jj = currentJ; jj < currentJ + numHouses; jj++) {
            used[ii][jj] = true;
          }
        }

        const isJog = false; // jogs determined after all sections placed

        const footprintWidth = sectionWidth + 2 * params.gableBracingDist;
        const footprintHeight = sectionHeight + 2 * params.sidewallBracingDist;

        sections.push({
          u: gridU[currentI],
          v: gridV[currentJ],
          width: sectionWidth,
          height: sectionHeight,
          footprintWidth,
          footprintHeight,
          houses: numHouses,
          bays: numBays,
          baySize: uSpacing,
          houseWidth: vSpacing,
          isJog,
          effectiveArea: sectionWidth * sectionHeight,
          footprintArea: footprintWidth * footprintHeight,
        });

        totalArea += sectionWidth * sectionHeight;
        currentI += numBays;
      }
      currentJ += numHouses;
    }
  }

  // Filter sections below mechanical minimum (need at least 4 bays and 2 houses)
  const mechanicalMinBays = params.mechanicalMinBays || 4;
  const validSections = sections.filter(s => s.bays >= mechanicalMinBays && s.houses >= 2);
  totalArea = validSections.reduce((sum, s) => sum + s.effectiveArea, 0);

  // Detect splits and jogs between section pairs
  const parallelSplits = [];   // runs along V (parallel to gables) — sections adjacent along U
  const perpSplits = [];       // runs along U (parallel to sidewalls) — sections adjacent along V

  for (let a = 0; a < validSections.length; a++) {
    for (let b = a + 1; b < validSections.length; b++) {
      const sa = validSections[a], sb = validSections[b];

      // Parallel split: sections share a U edge (one ends where the other starts along U)
      // and overlap in V (same sidewall range)
      const uAdjacent = Math.abs((sa.u + sa.width) - sb.u) < 0.01 ||
                         Math.abs((sb.u + sb.width) - sa.u) < 0.01;
      // Perpendicular split: sections share a V edge and overlap in U
      const vAdjacent = Math.abs((sa.v + sa.height) - sb.v) < 0.01 ||
                         Math.abs((sb.v + sb.height) - sa.v) < 0.01;

      if (uAdjacent && !params.noParallelSplits) {
        // Check V overlap
        const vOverlap = Math.min(sa.v + sa.height, sb.v + sb.height) - Math.max(sa.v, sb.v);
        if (vOverlap > 0.01) {
          const splitU = Math.abs((sa.u + sa.width) - sb.u) < 0.01
            ? sa.u + sa.width : sb.u + sb.width;
          parallelSplits.push({
            u: splitU,
            v: Math.max(sa.v, sb.v),
            height: vOverlap,
          });
        }
      }

      if (vAdjacent && !params.noPerpSplits) {
        const uOverlap = Math.min(sa.u + sa.width, sb.u + sb.width) - Math.max(sa.u, sb.u);
        if (uOverlap > 0.01) {
          const splitV = Math.abs((sa.v + sa.height) - sb.v) < 0.01
            ? sa.v + sa.height : sb.v + sb.height;
          perpSplits.push({
            u: Math.max(sa.u, sb.u),
            v: splitV,
            width: uOverlap,
          });
        }
      }
    }
  }

  // Jog detection: a jog occurs when adjacent sections are offset
  // (not fully aligned along their shared edge)
  jogCount = 0;
  for (let a = 0; a < validSections.length; a++) {
    for (let b = a + 1; b < validSections.length; b++) {
      const sa = validSections[a], sb = validSections[b];
      const uAdj = Math.abs((sa.u + sa.width) - sb.u) < 0.01 ||
                    Math.abs((sb.u + sb.width) - sa.u) < 0.01;
      const vAdj = Math.abs((sa.v + sa.height) - sb.v) < 0.01 ||
                    Math.abs((sb.v + sb.height) - sa.v) < 0.01;

      if (uAdj) {
        if (Math.abs(sa.v - sb.v) > 0.01 || Math.abs(sa.height - sb.height) > 0.01) {
          jogCount++;
          validSections[a].isJog = true;
          validSections[b].isJog = true;
        }
      }
      if (vAdj) {
        if (Math.abs(sa.u - sb.u) > 0.01 || Math.abs(sa.width - sb.width) > 0.01) {
          jogCount++;
          validSections[a].isJog = true;
          validSections[b].isJog = true;
        }
      }
    }
  }

  const landArea = polygonArea(state.landPolygon);
  const coverage = landArea > 0 ? totalArea / landArea : 0;
  const score = totalArea - jogCount * params.jogPenalty;

  return {
    sections: validSections,
    parallelSplits,
    perpSplits,
    splits: parallelSplits, // backward compat
    totalArea,
    jogCount,
    coverage,
    score,
    baySize: uSpacing,
    houseWidth: vSpacing,
  };
}

// Find the largest contiguous block in the grid
// Returns { i, j, spanBays, numHouses } — the full horizontal span of available bays
// No max cap here — distribution handles splitting into valid sizes
function findLargestBlock(grid, used, gridU, gridV) {
  let bestBlock = null;
  let bestArea = 0;

  for (let j = 0; j < gridV.length; j++) {
    for (let i = 0; i < gridU.length; i++) {
      if (!grid[i][j] || used[i][j]) continue;

      // Find max contiguous bays starting at i
      let spanEnd = i;
      while (spanEnd < gridU.length && grid[spanEnd][j] && !used[spanEnd][j]) {
        spanEnd++;
      }
      const spanBays = spanEnd - i;
      if (spanBays < 1) continue;

      // Find max houses downward from j, keeping the full span valid
      let numHouses = 0;
      for (let jj = j; jj < gridV.length; jj++) {
        let rowOk = true;
        for (let ii = i; ii < i + spanBays; ii++) {
          if (!grid[ii][jj] || used[ii][jj]) { rowOk = false; break; }
        }
        if (!rowOk) break;
        numHouses++;
      }

      if (numHouses < 1) continue;

      const area = spanBays * numHouses;
      if (area > bestArea) {
        bestArea = area;
        bestBlock = { i, j, spanBays, numHouses };
      }
    }
  }

  return bestBlock;
}

// Distribute totalBays evenly into sections
// Each section must have between minBays and maxBays bays
function distributeBays(totalBays, maxBays, minBays) {
  if (totalBays < minBays) return [];

  // How many sections do we need at minimum?
  const minSections = Math.ceil(totalBays / maxBays);

  // Try to split as evenly as possible
  // Start with minSections and see if it works
  for (let numSections = minSections; numSections <= totalBays; numSections++) {
    const base = Math.floor(totalBays / numSections);
    const remainder = totalBays % numSections;

    // Check all sections would meet minimum
    if (base < minBays) continue;
    // Check sections with extra bay don't exceed max
    if (base + 1 > maxBays && remainder > 0) continue;

    // Build distribution: 'remainder' sections get base+1, rest get base
    // Distribute larger sections first for visual balance
    const dist = [];
    for (let s = 0; s < numSections; s++) {
      dist.push(s < remainder ? base + 1 : base);
    }
    return dist;
  }

  // Fallback: can't distribute evenly, try taking what we can
  const dist = [];
  let remaining = totalBays;
  while (remaining >= minBays) {
    const take = Math.min(remaining, maxBays);
    // Check if what's left after this take is valid
    const left = remaining - take;
    if (left > 0 && left < minBays) {
      // Taking max would strand the remainder — take less
      const adjusted = remaining - minBays;
      if (adjusted >= minBays && adjusted <= maxBays) {
        dist.push(adjusted);
        dist.push(minBays);
        remaining = 0;
      } else {
        // Can't split nicely — just take it all if it fits
        if (remaining <= maxBays) {
          dist.push(remaining);
          remaining = 0;
        } else {
          break;
        }
      }
    } else {
      dist.push(take);
      remaining = left;
    }
  }

  return dist;
}

// ============================================================
// Grid-based placement for no-splits mode
// Simple: active cells → enforce min bays → flood fill → perimeter trace
// ============================================================
function gridPlace(grid, gridU, gridV, uSpacing, vSpacing, params) {
  const numCols = gridU.length; // U direction (bays)
  const numRows = gridV.length; // V direction (houses)
  const minBays = params.mechanicalMinBays || 4;

  // Step 1: Enforce min bays per row — kill contiguous runs shorter than minBays
  for (let row = 0; row < numRows; row++) {
    let runStart = -1;
    for (let col = 0; col <= numCols; col++) {
      const active = col < numCols && grid[col][row];
      if (active && runStart === -1) {
        runStart = col;
      } else if (!active && runStart !== -1) {
        if (col - runStart < minBays) {
          for (let k = runStart; k < col; k++) grid[k][row] = 0;
        }
        runStart = -1;
      }
    }
  }

  // Step 2: Remove orphan rows (no active cells)
  for (let row = 0; row < numRows; row++) {
    let hasAny = false;
    for (let col = 0; col < numCols; col++) {
      if (grid[col][row]) { hasAny = true; break; }
    }
    if (!hasAny) {
      for (let col = 0; col < numCols; col++) grid[col][row] = 0;
    }
  }

  // Step 3: Flood fill → keep only the largest connected component
  const visited = Array.from({ length: numCols }, () => Array(numRows).fill(false));
  let bestComponent = [];

  function floodFill(startCol, startRow) {
    const component = [];
    const stack = [[startCol, startRow]];
    while (stack.length > 0) {
      const [c, r] = stack.pop();
      if (c < 0 || c >= numCols || r < 0 || r >= numRows) continue;
      if (visited[c][r] || !grid[c][r]) continue;
      visited[c][r] = true;
      component.push([c, r]);
      stack.push([c - 1, r], [c + 1, r], [c, r - 1], [c, r + 1]);
    }
    return component;
  }

  for (let col = 0; col < numCols; col++) {
    for (let row = 0; row < numRows; row++) {
      if (grid[col][row] && !visited[col][row]) {
        const comp = floodFill(col, row);
        if (comp.length > bestComponent.length) bestComponent = comp;
      }
    }
  }

  // Build clean active grid from best component
  const activeGrid = Array.from({ length: numCols }, () => Array(numRows).fill(false));
  for (const [c, r] of bestComponent) activeGrid[c][r] = true;

  // Step 4: Trace perimeter
  const perimPath = tracePerimeter(activeGrid, numCols, numRows);

  // Convert grid vertices to UV coordinates
  const perimUV = perimPath.map(coordStr => {
    const [col, row] = coordStr.split(',').map(Number);
    return { u: gridU[0] + col * uSpacing, v: gridV[0] + row * vSpacing };
  });

  // Step 5: Stats
  const activeCells = bestComponent.length;
  const totalArea = activeCells * uSpacing * vSpacing;

  // Detect jogs (non-rectangular shape)
  let jogCount = 0;
  let prevFirst = -1, prevLast = -1;
  for (let row = 0; row < numRows; row++) {
    let first = -1, last = -1;
    for (let col = 0; col < numCols; col++) {
      if (activeGrid[col][row]) {
        if (first === -1) first = col;
        last = col;
      }
    }
    if (first === -1) continue; // empty row
    if (prevFirst !== -1 && (first !== prevFirst || last !== prevLast)) {
      jogCount++;
    }
    prevFirst = first;
    prevLast = last;
  }

  const landArea = polygonArea(state.landPolygon);
  const coverage = landArea > 0 ? totalArea / landArea : 0;
  const score = totalArea - jogCount * params.jogPenalty;

  return {
    gridMode: true,
    activeGrid,
    gridU,
    gridV,
    numCols,
    numRows,
    perimUV,
    activeCells,
    sections: [],         // empty — no sections in grid mode
    parallelSplits: [],
    perpSplits: [],
    splits: [],
    totalArea,
    jogCount,
    coverage,
    score,
    baySize: uSpacing,
    houseWidth: vSpacing,
  };
}

// Trace perimeter of active grid cells → closed polygon path as grid coordinate strings
// Uses directed boundary edges and adjacency walking (CW winding)
function tracePerimeter(activeGrid, numCols, numRows) {
  const edges = [];

  for (let row = 0; row < numRows; row++) {
    for (let col = 0; col < numCols; col++) {
      if (!activeGrid[col][row]) continue;

      // Bottom edge (low V): no neighbor above (lower row index)
      if (row === 0 || !activeGrid[col][row - 1])
        edges.push({ from: `${col},${row}`, to: `${col + 1},${row}` });
      // Right edge: no neighbor to the right
      if (col === numCols - 1 || !activeGrid[col + 1][row])
        edges.push({ from: `${col + 1},${row}`, to: `${col + 1},${row + 1}` });
      // Top edge (high V): no neighbor below (higher row index)
      if (row === numRows - 1 || !activeGrid[col][row + 1])
        edges.push({ from: `${col + 1},${row + 1}`, to: `${col},${row + 1}` });
      // Left edge: no neighbor to the left
      if (col === 0 || !activeGrid[col - 1][row])
        edges.push({ from: `${col},${row + 1}`, to: `${col},${row}` });
    }
  }

  if (edges.length === 0) return [];

  // Build adjacency: point → next point
  const adj = {};
  for (const e of edges) {
    adj[e.from] = e.to;
  }

  // Walk the perimeter
  const start = edges[0].from;
  const path = [start];
  let current = adj[start];
  let safety = edges.length + 2;
  while (current && current !== start && safety-- > 0) {
    path.push(current);
    current = adj[current];
  }

  return path;
}
