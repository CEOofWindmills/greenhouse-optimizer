import { polygonArea } from '../core/geometry.js';
import { state } from '../core/state.js';

export function displayResults(result, params) {
  const landArea = polygonArea(state.landPolygon);
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
