import { state } from '../core/state.js';
import { polygonBounds } from '../core/geometry.js';
import { getParams } from '../core/transforms.js';
import { greedyPlace } from './greedy-placer.js';
import { displayResults } from '../render/results.js';
import { draw } from '../render/draw.js';

// Default scoring weights — baked in, but overridable via params
const DEFAULT_AREA_WEIGHT = 1.0;      // weight for coverage area
const DEFAULT_POST_PENALTY = 5.0;     // penalty per post (m² equivalent) — very aggressive
const DEFAULT_JOG_PENALTY = 50;       // penalty per jog (m² equivalent)

// Compute asymmetric margins: how far the physical footprint extends beyond grid cells on each side
// Returns { minU, maxU, minV, maxV } in meters
function computeMargins(params, houseWidth) {
  const bayOffset = params.bayPostOffset != null ? params.bayPostOffset : params.treeSpacing / 2;
  const houseOffset = params.housePostOffset != null ? params.housePostOffset : 0;

  let sidewallOffset;
  if (params.sidewallRule === 'normal') sidewallOffset = houseWidth / 2;
  else if (params.sidewallRule === 'adjusted') sidewallOffset = houseWidth / 2 + 0.3048;
  else sidewallOffset = houseWidth; // flat

  return {
    minU: Math.max(0, params.gableBracingDist - bayOffset),
    maxU: bayOffset + params.gableBracingDist,
    minV: Math.max(0, sidewallOffset + params.sidewallBracingDist - houseOffset),
    maxV: Math.max(0, houseOffset + sidewallOffset + params.sidewallBracingDist - houseWidth),
  };
}

export function optimize() {
  if (state.landPolygon.length < 3) {
    alert('Draw a land boundary first (at least 3 points).');
    return;
  }

  const params = getParams();
  const poly = state.landPolygon;
  const cosA = Math.cos(params.treeDirection);
  const sinA = Math.sin(params.treeDirection);

  // Transform polygon into rotated (tree-aligned) coordinate system
  const rotatedPoly = poly.map(p => ({
    x: p.x * cosA + p.y * sinA,   // u
    y: -p.x * sinA + p.y * cosA,  // v
  }));
  const rBounds = polygonBounds(rotatedPoly);

  // Valid bay sizes: must be multiples of tree spacing, within [minBay, maxBay]
  const validBaySizes = [];
  for (let mult = 1; mult <= 20; mult++) {
    const baySize = params.treeSpacing * mult;
    if (baySize >= params.minBay && baySize <= params.maxBay) {
      validBaySizes.push(baySize);
    }
  }
  // Sort largest first — prefer bigger bays (fewer posts = less cost)
  validBaySizes.sort((a, b) => b - a);

  if (validBaySizes.length === 0) {
    alert(`No valid bay sizes found. Tree spacing ${params.treeSpacing}m produces no multiples in [${params.minBay}, ${params.maxBay}].`);
    return;
  }

  // Valid house widths: must be multiples of tree row spacing, within [minHouse, maxHouse]
  const validHouseWidths = [];
  for (let mult = 1; mult <= 10; mult++) {
    const hw = params.treeRowSpacing * mult;
    if (hw >= params.minHouse && hw <= params.maxHouse) {
      validHouseWidths.push(hw);
    }
  }
  if (validHouseWidths.length === 0) {
    validHouseWidths.push(params.minHouse);
    if (params.maxHouse !== params.minHouse) {
      validHouseWidths.push((params.minHouse + params.maxHouse) / 2);
      validHouseWidths.push(params.maxHouse);
    }
  }

  const areaWeight = DEFAULT_AREA_WEIGHT;
  const postPenalty = params.postPenalty != null ? params.postPenalty : DEFAULT_POST_PENALTY;
  const jogPenalty = params.jogPenalty;

  let bestResult = null;
  let bestScore = -Infinity;

  for (const baySize of validBaySizes) {
    for (const houseWidth of validHouseWidths) {
      const maxHousesByShaft = Math.floor(params.maxDriveShaft / houseWidth);
      const maxBaysByCable = params.noParallelSplits ? 9999 : Math.floor(params.maxDriveCable / baySize);
      const effectiveMaxBays = Math.min(params.maxBays, maxBaysByCable);

      if (effectiveMaxBays < params.minBaysSplit) continue;

      // Inset bounds by asymmetric margins so physical footprint stays inside land
      const margins = computeMargins(params, houseWidth);
      const adjustedBounds = {
        minX: rBounds.minX + margins.minU,
        maxX: rBounds.maxX - margins.maxU,
        minY: rBounds.minY + margins.minV,
        maxY: rBounds.maxY - margins.maxV,
      };

      // Skip if margins consume the entire parcel
      if (adjustedBounds.minX >= adjustedBounds.maxX || adjustedBounds.minY >= adjustedBounds.maxY) continue;

      // Snap grid start to first cell inside adjusted bounds
      const startU = Math.ceil(adjustedBounds.minX / baySize) * baySize;
      const startV = Math.ceil(adjustedBounds.minY / houseWidth) * houseWidth;

      const result = greedyPlace(
        rotatedPoly, startU, startV, adjustedBounds,
        baySize, houseWidth, effectiveMaxBays, maxHousesByShaft,
        params, cosA, sinA
      );

      // Count total posts for this configuration
      const totalPosts = result.gridMode ? countGridPosts(result) : countPosts(result.sections);
      result.totalPosts = totalPosts;

      // Score: maximize area, penalize posts and jogs
      const score = (result.totalArea * areaWeight)
                  - (totalPosts * postPenalty)
                  - (result.jogCount * jogPenalty);
      result.score = score;

      if (score > bestScore) {
        bestScore = score;
        bestResult = result;
      }
    }
  }

  if (bestResult) {
    state.optimizationResult = bestResult;
    displayResults(bestResult, params);
  } else {
    document.getElementById('results').innerHTML = '<div style="color:#e94560;text-align:center;padding:10px">No valid placement found</div>';
  }

  draw();
}

// Count total structural posts across all sections
// Posts = (bays + 1) × (houses + 1) per section
function countPosts(sections) {
  let total = 0;
  for (const s of sections) {
    total += (s.bays + 1) * (s.houses + 1);
  }
  return total;
}

// Count posts for grid mode — all grid corners touching active cells
function countGridPosts(result) {
  const { activeGrid, numCols, numRows } = result;
  const postSet = new Set();
  for (let col = 0; col < numCols; col++) {
    for (let row = 0; row < numRows; row++) {
      if (!activeGrid[col][row]) continue;
      postSet.add(`${col},${row}`);
      postSet.add(`${col + 1},${row}`);
      postSet.add(`${col},${row + 1}`);
      postSet.add(`${col + 1},${row + 1}`);
    }
  }
  return postSet.size;
}
