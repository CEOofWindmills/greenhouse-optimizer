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
  orthoMode: false,

  // Map
  mapActive: false,
  mapLocked: false, // When true, map is frozen and canvas gets pointer events
  refLatLng: null, // { lat, lng } — anchor point where lat/lng = meters (0,0)

  // Vertex dragging (double-click to drag land/exclusion nodes)
  draggingVertex: null, // { polygon: 'land' | 'exclusion', zoneIndex?: number, index: number }

  // Measurement tool
  measurements: [],      // [{start, end, startRef?, endRef?}] — persisted dimensions
  measureStart: null,    // {x,y} in meters — in-progress start point
  measureStartRef: null, // snap reference for in-progress start
  snapPoint: null,       // {x, y, type, ref} — current snap target for rendering
  selectedMeasurement: -1, // index of selected measurement, -1 = none
  showMeasurements: true, // toggle visibility of saved measurements

  // Tree grid offset in rotated UV space (draggable)
  treeGridOffset: { u: 0, v: 0 },
};

// Canvas references — set once in main.js
export let canvas = null;
export let ctx = null;

export function initCanvas(canvasEl) {
  canvas = canvasEl;
  ctx = canvas.getContext('2d');
}
