import { state } from '../core/state.js';
import { polygonArea, rectCoverageInLand } from '../core/geometry.js';

// Balanced placement algorithm
// Instead of greedy "take max first", distributes bays evenly across sections
export function greedyPlace(rotatedPoly, startU, startV, rBounds, uSpacing, vSpacing, maxUCount, maxVCount, params, cosA, sinA) {
  const sections = [];
  const splits = [];
  let totalArea = 0;
  let jogCount = 0;

  // Build grid
  const gridU = [];
  const gridV = [];
  for (let u = startU; u < rBounds.maxX + uSpacing; u += uSpacing) gridU.push(u);
  for (let v = startV; v < rBounds.maxY + vSpacing; v += vSpacing) gridV.push(v);

  // Coverage grid: 1 = inside land, 0 = outside
  const grid = [];
  for (let i = 0; i < gridU.length; i++) {
    grid[i] = [];
    for (let j = 0; j < gridV.length; j++) {
      const coverage = rectCoverageInLand(gridU[i], gridV[j], uSpacing, vSpacing, params.treeDirection, state.landPolygon);
      grid[i][j] = coverage > 0.5 ? 1 : 0;
    }
  }

  const used = grid.map(row => row.map(() => false));

  // Phase 1: Find contiguous horizontal spans for each row of houses
  // Phase 2: For each span, distribute bays evenly into sections
  // Phase 3: Fall back to greedy for irregular leftovers

  // Find the tallest contiguous house run for each starting j
  while (true) {
    // Find the largest contiguous block (houses × total bays)
    const block = findLargestBlock(grid, used, gridU, gridV, maxVCount);
    if (!block) break;

    // block = { i, j, spanBays, numHouses } — full horizontal span, not yet split

    // Distribute spanBays evenly into sections respecting maxUCount and minBaysSplit
    const distribution = distributeBays(block.spanBays, maxUCount, params.minBaysSplit);

    if (distribution.length === 0) {
      // Can't distribute — mark as used and skip
      for (let ii = block.i; ii < block.i + block.spanBays; ii++) {
        for (let jj = block.j; jj < block.j + block.numHouses; jj++) {
          used[ii][jj] = true;
        }
      }
      continue;
    }

    // Place each section from the distribution
    let currentI = block.i;
    for (const numBays of distribution) {
      const sectionWidth = numBays * uSpacing;
      const sectionHeight = block.numHouses * vSpacing;

      // Mark cells as used
      for (let ii = currentI; ii < currentI + numBays; ii++) {
        for (let jj = block.j; jj < block.j + block.numHouses; jj++) {
          used[ii][jj] = true;
        }
      }

      const isJog = false; // jogs determined after all sections placed

      const footprintWidth = sectionWidth + 2 * params.bracingDist;
      const footprintHeight = sectionHeight + 2 * params.bracingDist;

      sections.push({
        u: gridU[currentI],
        v: gridV[block.j],
        width: sectionWidth,
        height: sectionHeight,
        footprintWidth,
        footprintHeight,
        houses: block.numHouses,
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
  }

  // Detect splits and jogs between section pairs
  const parallelSplits = [];   // runs along V (parallel to gables) — sections adjacent along U
  const perpSplits = [];       // runs along U (parallel to sidewalls) — sections adjacent along V

  for (let a = 0; a < sections.length; a++) {
    for (let b = a + 1; b < sections.length; b++) {
      const sa = sections[a], sb = sections[b];

      // Parallel split: sections share a U edge (one ends where the other starts along U)
      // and overlap in V (same sidewall range)
      const uAdjacent = Math.abs((sa.u + sa.width) - sb.u) < 0.01 ||
                         Math.abs((sb.u + sb.width) - sa.u) < 0.01;
      // Perpendicular split: sections share a V edge and overlap in U
      const vAdjacent = Math.abs((sa.v + sa.height) - sb.v) < 0.01 ||
                         Math.abs((sb.v + sb.height) - sa.v) < 0.01;

      if (uAdjacent) {
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

      if (vAdjacent) {
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
  for (let a = 0; a < sections.length; a++) {
    for (let b = a + 1; b < sections.length; b++) {
      const sa = sections[a], sb = sections[b];
      const uAdj = Math.abs((sa.u + sa.width) - sb.u) < 0.01 ||
                    Math.abs((sb.u + sb.width) - sa.u) < 0.01;
      const vAdj = Math.abs((sa.v + sa.height) - sb.v) < 0.01 ||
                    Math.abs((sb.v + sb.height) - sa.v) < 0.01;

      if (uAdj) {
        // Adjacent along U — jog if V extents don't match
        if (Math.abs(sa.v - sb.v) > 0.01 || Math.abs(sa.height - sb.height) > 0.01) {
          jogCount++;
          sections[a].isJog = true;
          sections[b].isJog = true;
        }
      }
      if (vAdj) {
        // Adjacent along V — jog if U extents don't match
        if (Math.abs(sa.u - sb.u) > 0.01 || Math.abs(sa.width - sb.width) > 0.01) {
          jogCount++;
          sections[a].isJog = true;
          sections[b].isJog = true;
        }
      }
    }
  }

  const landArea = polygonArea(state.landPolygon);
  const coverage = landArea > 0 ? totalArea / landArea : 0;
  const score = totalArea - jogCount * params.jogPenalty;

  return {
    sections,
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
function findLargestBlock(grid, used, gridU, gridV, maxVCount) {
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
      for (let jj = j; jj < gridV.length && numHouses < maxVCount; jj++) {
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
