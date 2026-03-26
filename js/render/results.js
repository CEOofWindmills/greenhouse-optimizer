import { polygonArea } from '../core/geometry.js';
import { state } from '../core/state.js';

export function displayResults(result, params) {
  const landArea = polygonArea(state.landPolygon);

  if (result.gridMode) {
    displayGridResults(result, landArea);
    return;
  }

  const html = `
    <div class="metric"><span>Land Area</span><span class="metric-value">${landArea.toFixed(0)} m²</span></div>
    <div class="metric"><span>Greenhouse Area</span><span class="metric-value">${result.totalArea.toFixed(0)} m²</span></div>
    <div class="metric"><span>Coverage</span><span class="metric-value">${(result.coverage * 100).toFixed(1)}%</span></div>
    <div class="metric"><span>Sections</span><span class="metric-value">${result.sections.length}</span></div>
    <div class="metric"><span>Jogs</span><span class="${result.jogCount > 0 ? 'metric-bad' : 'metric-value'}">${result.jogCount}</span></div>
    <div class="metric"><span>Parallel Splits</span><span class="metric-value">${(result.parallelSplits || []).length}</span></div>
    <div class="metric"><span>Perpendicular Splits</span><span class="metric-value">${(result.perpSplits || []).length}</span></div>
    <div class="metric"><span>Score</span><span class="metric-value">${result.score.toFixed(0)}</span></div>
    <hr style="border-color:#0f3460;margin:6px 0">
    ${result.sections.map((s, i) => `
      <div class="metric"><span>Sec ${i + 1}</span><span class="metric-value">${s.houses}H × ${s.bays}B (${s.effectiveArea.toFixed(0)}m²)</span></div>
    `).join('')}
  `;
  document.getElementById('results').innerHTML = html;

  displayGreenhouseCalcs(result, params);
}

function displayGridResults(result, landArea) {
  // Count rows and max cols for summary
  const { activeGrid, numCols, numRows, baySize, houseWidth } = result;
  let totalRows = 0;
  let maxBaysInRow = 0;
  for (let row = 0; row < numRows; row++) {
    let count = 0;
    for (let col = 0; col < numCols; col++) {
      if (activeGrid[col][row]) count++;
    }
    if (count > 0) {
      totalRows++;
      maxBaysInRow = Math.max(maxBaysInRow, count);
    }
  }

  // Count posts (all grid corners touching active cells)
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

  const isRect = result.jogCount === 0;
  const shapeLabel = isRect ? 'Rectangle' : `Jog (${result.jogCount})`;

  const html = `
    <div class="metric"><span>Land Area</span><span class="metric-value">${landArea.toFixed(0)} m²</span></div>
    <div class="metric"><span>Greenhouse Area</span><span class="metric-value">${result.totalArea.toLocaleString()} m²</span></div>
    <div class="metric"><span>Coverage</span><span class="metric-value">${(result.coverage * 100).toFixed(1)}%</span></div>
    <div class="metric"><span>Shape</span><span class="metric-value">${shapeLabel}</span></div>
    <div class="metric"><span>Active Cells</span><span class="metric-value">${result.activeCells}</span></div>
    <div class="metric"><span>Houses</span><span class="metric-value">${totalRows}</span></div>
    <div class="metric"><span>Max Bays</span><span class="metric-value">${maxBaysInRow}</span></div>
    <div class="metric"><span>Total Posts</span><span class="metric-value">${postSet.size}</span></div>
    <hr style="border-color:#0f3460;margin:6px 0">
    <div class="metric" style="color:#0f9b8e;font-weight:600"><span>Resolved Values</span><span></span></div>
    <div class="metric"><span>House Width</span><span class="metric-value">${houseWidth} m</span></div>
    <div class="metric"><span>Bay Size</span><span class="metric-value">${baySize} m</span></div>
    <hr style="border-color:#0f3460;margin:6px 0">
    <div class="metric" style="color:#0f9b8e;font-weight:600"><span>Per-Row Breakdown</span><span></span></div>
    ${buildRowBreakdown(activeGrid, numCols, numRows, baySize, houseWidth)}
  `;
  document.getElementById('results').innerHTML = html;
  document.getElementById('greenhouse-calcs').innerHTML = '';
}

function buildRowBreakdown(activeGrid, numCols, numRows, baySize, houseWidth) {
  let html = '';
  let rowIdx = 0;
  for (let row = 0; row < numRows; row++) {
    let first = -1, last = -1;
    for (let col = 0; col < numCols; col++) {
      if (activeGrid[col][row]) {
        if (first === -1) first = col;
        last = col;
      }
    }
    if (first === -1) continue;
    rowIdx++;
    const bays = last - first + 1;
    const area = bays * baySize * houseWidth;
    html += `<div class="metric" style="font-size:11px"><span>Row ${rowIdx}</span><span class="metric-value">${bays}B (${area.toFixed(0)} m²)</span></div>`;
  }
  return html;
}

function displayGreenhouseCalcs(result, params) {
  const treesPerBay = result.baySize / params.treeSpacing;
  const bayOffset = params.bayPostOffset != null ? params.bayPostOffset : params.treeSpacing / 2;

  // Post counts per section
  let totalGablePosts = 0;
  let totalSidewallPosts = 0;
  let totalInteriorPosts = 0;
  let totalAllPosts = 0;

  const sectionCalcs = result.sections.map((s, i) => {
    const uCount = s.bays + 1;  // posts along U (bay direction)
    const vCount = s.houses + 1; // posts along V (house direction)

    // Corner posts: 4 per section
    const cornerPosts = 4;
    // Gable posts: posts on left/right edges, excluding corners
    const gablePosts = 2 * (vCount - 2);
    // Sidewall posts: posts on top/bottom edges, excluding corners
    const sidewallPosts = 2 * (uCount - 2);
    // Interior posts: everything else
    const interiorPosts = (uCount - 2) * (vCount - 2);
    const sectionTotal = cornerPosts + gablePosts + sidewallPosts + interiorPosts;

    totalGablePosts += gablePosts + cornerPosts; // corners are on gables too
    totalSidewallPosts += sidewallPosts;
    totalInteriorPosts += interiorPosts;
    totalAllPosts += sectionTotal;

    return { cornerPosts, gablePosts, sidewallPosts, interiorPosts, sectionTotal, section: s };
  });

  let html = `
    <div class="metric" style="color:#0f9b8e;font-weight:600"><span>Resolved Values</span><span></span></div>
    <div class="metric"><span>House Width</span><span class="metric-value">${result.houseWidth} m</span></div>
    <div class="metric"><span>Bay Size</span><span class="metric-value">${result.baySize} m</span></div>
    <div class="metric"><span>Trees Between Posts</span><span class="metric-value">${treesPerBay}</span></div>
    <div class="metric"><span>Bay Post Offset</span><span class="metric-value">${bayOffset.toFixed(2)} m</span></div>
    <hr style="border-color:#0f3460;margin:6px 0">
    <div class="metric" style="color:#0f9b8e;font-weight:600"><span>Zone Areas</span><span></span></div>
  `;

  sectionCalcs.forEach((sc, i) => {
    const s = sc.section;
    const widthM = s.width.toFixed(1);
    const heightM = s.height.toFixed(1);
    html += `
      <div class="metric"><span>Zone ${i + 1} (${s.houses}H × ${s.bays}B)</span><span class="metric-value">${s.effectiveArea.toFixed(0)} m²</span></div>
      <div class="metric" style="font-size:10px;color:#888"><span>  Dimensions</span><span>${widthM} × ${heightM} m</span></div>
      <div class="metric" style="font-size:10px;color:#888"><span>  Footprint w/ bracing</span><span>${s.footprintWidth.toFixed(1)} × ${s.footprintHeight.toFixed(1)} m</span></div>
    `;
  });

  html += `
    <hr style="border-color:#0f3460;margin:6px 0">
    <div class="metric" style="color:#0f9b8e;font-weight:600"><span>Post Counts</span><span></span></div>
    <div class="metric"><span>Total Posts</span><span class="metric-value">${totalAllPosts}</span></div>
    <div class="metric"><span>Gable Posts (incl. corners)</span><span class="metric-value">${totalGablePosts}</span></div>
    <div class="metric"><span>Sidewall Posts</span><span class="metric-value">${totalSidewallPosts}</span></div>
    <div class="metric"><span>Interior Posts</span><span class="metric-value">${totalInteriorPosts}</span></div>
  `;

  // Per-section breakdown
  if (sectionCalcs.length > 1) {
    html += `<hr style="border-color:#0f3460;margin:6px 0">
      <div class="metric" style="font-size:10px;color:#0f9b8e;font-weight:600"><span>Posts by Zone</span><span></span></div>`;
    sectionCalcs.forEach((sc, i) => {
      html += `
        <div class="metric" style="font-size:10px"><span>Zone ${i + 1}</span><span class="metric-value">${sc.sectionTotal} (G:${sc.gablePosts + sc.cornerPosts} S:${sc.sidewallPosts} I:${sc.interiorPosts})</span></div>
      `;
    });
  }

  document.getElementById('greenhouse-calcs').innerHTML = html;
}
