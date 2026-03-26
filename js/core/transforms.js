import { state, canvas } from './state.js';

export function getScale() {
  return parseFloat(document.getElementById('scale').value) || 5;
}

export function metersToScreen(mx, my) {
  const ppm = getScale();
  return {
    x: (mx * ppm * state.zoom) + state.panX + canvas.width / 2,
    y: (my * ppm * state.zoom) + state.panY + canvas.height / 2,
  };
}

export function screenToMeters(sx, sy) {
  const ppm = getScale();
  return {
    x: (sx - state.panX - canvas.width / 2) / (ppm * state.zoom),
    y: (sy - state.panY - canvas.height / 2) / (ppm * state.zoom),
  };
}

export function getParams() {
  return {
    treeRowSpacing: parseFloat(document.getElementById('tree-row-spacing').value),
    treeSpacing: parseFloat(document.getElementById('tree-spacing').value),
    treeDirection: parseFloat(document.getElementById('tree-direction').value) * Math.PI / 180,
    showTrees: document.getElementById('show-trees').checked,
    minHouse: parseFloat(document.getElementById('min-house').value),
    maxHouse: parseFloat(document.getElementById('max-house').value),
    minBay: parseFloat(document.getElementById('min-bay').value),
    maxBay: parseFloat(document.getElementById('max-bay').value),
    maxBays: parseInt(document.getElementById('max-bays').value),
    minBaysSplit: parseInt(document.getElementById('min-bays-split').value),
    maxDriveShaft: parseFloat(document.getElementById('max-drive-shaft').value),
    maxDriveCable: parseFloat(document.getElementById('max-drive-cable').value),
    gableBracingDist: parseFloat(document.getElementById('gable-bracing-dist').value),
    sidewallBracingDist: parseFloat(document.getElementById('sidewall-bracing-dist').value),
    bayPostOffset: parseFloat(document.getElementById('bay-post-offset').value) || null,  // null = auto
    housePostOffset: parseFloat(document.getElementById('house-post-offset').value) || null,  // null = auto
    postPenalty: parseFloat(document.getElementById('post-penalty').value) || null,  // null = use default (0.8)
    jogPenalty: parseFloat(document.getElementById('jog-penalty').value),
  };
}
