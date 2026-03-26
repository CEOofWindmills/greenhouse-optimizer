import { state } from '../core/state.js';
import { getScale } from '../core/transforms.js';
import { draw } from '../render/draw.js';

let map = null;
let mapContainer = null;

// Meters per pixel at a given latitude and Leaflet zoom level (Web Mercator)
function metersPerPixel(lat, zoomLevel) {
  return 156543.03392 * Math.cos(lat * Math.PI / 180) / Math.pow(2, zoomLevel);
}

export function initMap() {
  mapContainer = document.getElementById('map-container');

  map = L.map(mapContainer, {
    center: [43.0, -79.0], // Default: Southern Ontario
    zoom: 16,
    zoomControl: false,
    attributionControl: false,
  });

  // Esri World Imagery — free satellite tiles
  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 19,
  }).addTo(map);

  // Small attribution in corner
  L.control.attribution({ position: 'bottomright', prefix: false })
    .addAttribution('Tiles © Esri')
    .addTo(map);

  // Sync canvas on every map move/zoom
  map.on('move', syncCanvasToMap);
  map.on('zoom', syncCanvasToMap);

  // Start hidden
  mapContainer.style.display = 'none';
}

export function syncCanvasToMap() {
  if (!map || !state.mapActive || !state.refLatLng) return;

  const ppm = getScale();
  const canvas = document.getElementById('canvas');

  // Where does the reference point (meters origin) appear on screen?
  const containerPt = map.latLngToContainerPoint(state.refLatLng);
  state.panX = containerPt.x - canvas.width / 2;
  state.panY = containerPt.y - canvas.height / 2;

  // Match zoom: canvas pixels_per_meter must equal map's pixels_per_meter
  const mpp = metersPerPixel(state.refLatLng.lat, map.getZoom());
  state.zoom = 1 / (mpp * ppm);

  document.getElementById('scale-display').textContent = `${(ppm * state.zoom).toFixed(1)} px/m`;
  draw();
}

export function setMapVisible(visible) {
  state.mapActive = visible;
  const canvas = document.getElementById('canvas');

  if (visible) {
    mapContainer.style.display = 'block';
    canvas.style.background = 'transparent';

    // When map is active, canvas passes pointer events to Leaflet for pan/zoom
    // but we still need canvas to capture clicks for drawing
    // Solution: canvas uses pointer-events:none, drawing clicks go through to map container
    // BUT we need drawing clicks on canvas... so we use a different approach:
    // Canvas stays interactive for left-click drawing. We disable Leaflet's click/drag
    // on the map and instead relay pan events ourselves.
    // Actually simplest: let canvas be pointer-events:none when NOT drawing,
    // and pointer-events:auto when drawing.
    updateCanvasPointerEvents();

    // Set reference point to current map center
    if (!state.refLatLng) {
      const center = map.getCenter();
      state.refLatLng = { lat: center.lat, lng: center.lng };
    }

    // Force map to recalculate size (it was display:none)
    setTimeout(() => {
      map.invalidateSize();
      syncCanvasToMap();
    }, 50);
  } else {
    mapContainer.style.display = 'none';
    canvas.style.background = '';
    canvas.style.pointerEvents = 'auto';

    // Reset canvas pan/zoom to sensible defaults when leaving map mode
    state.panX = 0;
    state.panY = 0;
    state.zoom = 1;
    draw();
  }

  // Update toggle button
  const btn = document.getElementById('btn-map');
  if (btn) {
    btn.textContent = visible ? 'Map: On' : 'Map: Off';
    btn.style.background = visible ? '#0f9b8e' : '';
  }
}

export async function searchAddress(query) {
  if (!query.trim()) return;

  try {
    // Nominatim free geocoding (OpenStreetMap)
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1`;
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'GreenhouseOptimizer/1.0' }
    });
    const results = await resp.json();

    if (results.length > 0) {
      const { lat, lon } = results[0];
      const latLng = L.latLng(parseFloat(lat), parseFloat(lon));

      // Set as new reference point (meters origin)
      state.refLatLng = { lat: latLng.lat, lng: latLng.lng };

      // Fly to location
      map.flyTo(latLng, 18, { duration: 1.5 });

      return results[0].display_name;
    }
    return null;
  } catch (err) {
    console.error('Geocoding failed:', err);
    return null;
  }
}

export function setMapLocked(locked) {
  state.mapLocked = locked;
  if (!map) return;

  if (locked) {
    // Freeze Leaflet — disable all interaction handlers
    map.dragging.disable();
    map.scrollWheelZoom.disable();
    map.doubleClickZoom.disable();
    map.touchZoom.disable();
    map.boxZoom.disable();
    map.keyboard.disable();
  } else {
    // Unfreeze Leaflet
    map.dragging.enable();
    map.scrollWheelZoom.enable();
    map.doubleClickZoom.enable();
    map.touchZoom.enable();
    map.boxZoom.enable();
    map.keyboard.enable();
  }

  updateCanvasPointerEvents();

  // Update lock button
  const btn = document.getElementById('btn-map-lock');
  if (btn) {
    btn.textContent = locked ? 'Unlock Map' : 'Lock Map';
    btn.style.background = locked ? '#e94560' : '';
  }
}

// When map is active: canvas needs pointer-events:none so Leaflet gets pan/zoom,
// BUT when drawing or map is locked, canvas needs pointer-events:auto.
// Call this whenever mode changes.
export function updateCanvasPointerEvents() {
  const canvas = document.getElementById('canvas');
  if (!state.mapActive) {
    canvas.style.pointerEvents = 'auto';
    return;
  }

  // Locked map or drawing modes — canvas captures events
  if (state.mapLocked || state.mode === 'draw-land' || state.mode === 'draw-exclusion') {
    canvas.style.pointerEvents = 'auto';
  } else {
    // Idle, unlocked — let Leaflet handle all interactions (pan/zoom)
    canvas.style.pointerEvents = 'none';
  }
}

export function getMap() { return map; }
