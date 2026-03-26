// Core application state — single source of truth
export const state = {
  mode: 'idle',           // idle | draw-land | draw-exclusion
  landPolygon: [],        // [{x,y}] in meters
  exclusionZones: [],     // [polygon, ...]
  currentPolygon: [],     // in-progress polygon
  optimizationResult: null,

  // Camera
  panX: 0, panY: 0,
  zoom: 1,

  // Interaction
  isPanning: false,
  lastMouse: { x: 0, y: 0 },
  mouse: { x: 0, y: 0 }, // in meters
};

// Canvas references — set once in main.js
export let canvas = null;
export let ctx = null;

export function initCanvas(canvasEl) {
  canvas = canvasEl;
  ctx = canvas.getContext('2d');
}
