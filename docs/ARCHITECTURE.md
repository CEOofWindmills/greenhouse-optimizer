# Greenhouse Coverage Optimizer - Architecture & Documentation

## Overview

A vanilla JS canvas application that optimizes greenhouse placement on irregular land parcels with tree rows. The tool works like a simplified AutoCAD — users draw land boundaries, configure tree rows and greenhouse constraints, and the optimizer finds the best greenhouse layout that maximizes coverage while respecting structural rules. Includes optional Leaflet satellite map integration for tracing real-world parcels.

**Stack**: Vanilla JS (ES modules), HTML5 Canvas, Leaflet.js, CSS. No build step, no framework.

---

## File Structure

```
greenhouse-optimizer/
  index.html              # Main HTML: sidebar UI, canvas, map container, status bar
  css/
    styles.css            # Dark theme styling for all UI
  js/
    main.js               # Entry point: init canvas, map, handlers, resize
    core/
      state.js            # Global state object, canvas refs
      geometry.js         # Polygon math: area, bounds, point-in-polygon, coverage
      transforms.js       # Coordinate transforms: meters<->screen, getParams()
    engine/
      optimizer.js        # Main optimizer: iterates configs, scores, picks best
      greedy-placer.js    # Placement: section-based (splits) + grid-based (no-splits)
    map/
      leaflet-map.js      # Leaflet satellite map: init, sync, geocoding, visibility
    render/
      draw.js             # Main render loop orchestrator
      grid.js             # Background grid with adaptive spacing
      trees.js            # Tree row lines and individual tree dots
      sections.js         # Greenhouse rendering: walls, posts, bracing, gables, splits + grid mode
      results.js          # Metrics display in sidebar panels (section + grid modes)
    ui/
      buttons.js          # Button event handlers (drawing, map, zoom, splits)
      input-handlers.js   # Canvas interaction: drawing, panning, zooming, ortho
```

---

## Key Data Structures

### Global State (`state` in state.js)
```javascript
{
  mode: 'idle' | 'draw-land' | 'draw-exclusion',
  landPolygon: [{x, y}, ...],       // Land boundary in meters
  exclusionZones: [polygon, ...],    // Areas to avoid
  currentPolygon: [{x, y}, ...],     // In-progress drawing
  optimizationResult: Result | null, // Output from optimizer
  panX, panY: number,               // Camera offset
  zoom: number,                     // Zoom multiplier
  isPanning: boolean,
  lastMouse: {x, y},                // Screen coords
  mouse: {x, y},                    // World coords (meters)
  orthoMode: boolean,               // Snap to row/perp axes

  // Map
  mapActive: boolean,               // Whether Leaflet satellite map is displayed
  refLatLng: {lat, lng} | null,     // Anchor point: lat/lng that maps to meters (0,0)
}
```

### Params (from UI via `getParams()`)
```javascript
{
  treeRowSpacing: 5,      // meters between rows (V direction)
  treeSpacing: 3,         // meters between trees in-row (U direction)
  treeDirection: 0,       // degrees, converted to radians
  showTrees: true,        // toggle tree row visibility

  sidewallRule: 'flat',   // 'normal' | 'adjusted' | 'flat'
  minHouse: 3.5,          // min house width (meters)
  maxHouse: 5.2,          // max house width (meters)
  minBay: 6,              // min bay size (meters)
  maxBay: 10,             // max bay size (meters)

  noParallelSplits: true, // disable parallel splits (default on)
  noPerpSplits: true,     // disable perpendicular splits (default on)
  maxBays: 10,            // max bays per section (9999 when noParallelSplits)
  minBaysSplit: 4,        // min bays after a parallel split (1 when noParallelSplits)
  mechanicalMinBays: 4,   // raw min-bays-split value for mechanical minimums
  maxDriveShaft: 108,     // max drive shaft length (99999 when noPerpSplits)
  maxDriveCable: 76,      // max drive cable length (meters)

  gableBracingDist: 1.5,  // bracing at gable ends (meters)
  sidewallBracingDist: 1.5,// bracing at sidewalls (meters)
  bayPostOffset: null,     // auto = treeSpacing / 2
  housePostOffset: null,   // auto = 0
  postPenalty: null,       // auto = 5.0 m^2/post
  jogPenalty: 50,          // m^2 per jog
}
```

### Section Object (section-based mode)
```javascript
{
  u, v: number,            // Origin in rotated UV space
  width, height: number,   // Section dimensions (meters)
  footprintWidth/Height,   // Including bracing margins
  houses, bays: number,    // Integer counts
  baySize, houseWidth,     // Resolved spacing (meters)
  isJog: boolean,
  effectiveArea, footprintArea: number,
}
```

### OptimizationResult

**Section-based mode** (when splits are allowed):
```javascript
{
  sections: Section[],
  parallelSplits: [{u, v, height}],   // Interior drive shafts (along V)
  perpSplits: [{u, v, width}],        // Perpendicular splits (along U)
  splits: parallelSplits,             // backward compat alias
  totalArea, coverage, score: number,
  baySize, houseWidth: number,
  totalPosts: number,
  jogCount: number,
}
```

**Grid-based mode** (when both noParallelSplits and noPerpSplits are true):
```javascript
{
  gridMode: true,
  activeGrid: boolean[][],             // 2D array [col][row] of active cells
  gridU: number[],                     // U-axis grid positions
  gridV: number[],                     // V-axis grid positions
  numCols, numRows: number,            // Grid dimensions
  perimUV: [{u, v}, ...],             // Perimeter polygon in UV coords
  activeCells: number,                 // Count of active grid cells
  sections: [],                        // Empty in grid mode
  parallelSplits: [], perpSplits: [],  // Empty in grid mode
  totalArea, coverage, score: number,
  baySize, houseWidth: number,
  totalPosts: number,
  jogCount: number,
}
```

---

## Coordinate System

The app uses a **rotated UV coordinate system** aligned to tree rows:

- **U axis**: Along tree rows (0 degrees = horizontal). This is the **bay direction**.
- **V axis**: Perpendicular to tree rows. This is the **house direction**.

When `treeDirection = 0`:
- U = X (horizontal, left to right)
- V = Y (vertical, top to bottom)
- Trees run left-to-right
- **Sidewalls** run parallel to tree rows (along U, at V edges)
- **Gables** run perpendicular to tree rows (along V, at U edges)
- **Drive gable** is the first gable (blue line)
- **Pulley gable** is the last gable (purple line)

Rotation formula (UV -> world XY):
```
worldX = u * cos(angle) - v * sin(angle)
worldY = u * sin(angle) + v * cos(angle)
```

---

## Optimization Pipeline

```
optimize()
  |-- Rotate land polygon to UV space
  |-- Generate valid bay sizes (multiples of treeSpacing in [minBay, maxBay])
  |-- Generate valid house widths (multiples of treeRowSpacing in [minHouse, maxHouse])
  |-- For each (baySize, houseWidth) combo:
  |     |-- Calculate max houses by shaft length
  |     |-- Calculate max bays by cable length (9999 if noParallelSplits)
  |     |-- Compute asymmetric margins via computeMargins()
  |     |-- Inset bounds by margins (so structural footprint stays inside land)
  |     |-- Snap grid start to first cell inside adjusted bounds
  |     |-- Call greedyPlace()
  |     |     |-- Build coverage grid (>25% threshold per cell)
  |     |     |-- pruneFootprintOutsideLand(): iteratively remove boundary cells
  |     |     |     whose structural footprint extends outside the land polygon
  |     |     |-- IF no-splits mode (both splits disabled):
  |     |     |     |-- gridPlace(): enforce min bays, flood-fill largest component,
  |     |     |     |   trace perimeter, return grid-based result
  |     |     |-- ELSE (section-based mode):
  |     |     |     |-- Find largest contiguous rectangular block
  |     |     |     |-- distributeBays(): split evenly across sections
  |     |     |     |-- Detect parallel/perpendicular splits
  |     |     |     |-- Detect jogs (misaligned edges)
  |     |     |     |-- Filter sections below mechanical minimum
  |     |     |     |-- Return sections + splits + metrics
  |     |-- Count posts (grid-based or section-based), calculate score
  |     |-- Keep best scoring result
  |-- Store result, display, render
```

### Boundary Enforcement

The optimizer prevents the greenhouse footprint from extending outside the land boundary using two mechanisms:

1. **Bounds insetting** (`computeMargins()` in optimizer.js): Before running the placer, bounds are shrunk by asymmetric margins that account for bay post offset, sidewall offset, and bracing distances. Margins differ per direction:
   - **U margins**: based on bayPostOffset + gableBracingDist
   - **V margins**: based on sidewallOffset + sidewallBracingDist

2. **Iterative pruning** (`pruneFootprintOutsideLand()` in greedy-placer.js): After the coverage grid is built, boundary cells are iteratively checked. Each boundary cell's structural footprint (including posts, sidewalls, and bracing) is tested against the land polygon. Cells whose footprint extends outside are removed, and the process repeats since removing a cell can expose new boundaries.

### Scoring Function
```
score = totalArea - (totalPosts * postPenalty) - (jogCount * jogPenalty)
```
Post penalty is aggressive (default 5.0 m^2/post) to strongly prefer larger bays with fewer posts.

### Bay Distribution
Instead of greedy "take max first", `distributeBays()` splits bays evenly:
- Total bays across a span are divided into sections
- Each section gets at least `minBaysSplit` bays
- Prevents one section starving the next

### Grid-Based Placement (No-Splits Mode)

When both `noParallelSplits` and `noPerpSplits` are enabled, the optimizer uses `gridPlace()` instead of the section-based algorithm:

1. **Enforce min bays**: Contiguous runs shorter than `mechanicalMinBays` are removed per row
2. **Remove orphan rows**: Rows with no active cells are cleared
3. **Flood fill**: Keep only the largest connected component of active cells
4. **Perimeter trace**: Walk directed boundary edges (CW winding) to produce a closed polygon
5. **Jog detection**: Count row-to-row boundary changes (different first/last column)

This mode produces an irregular footprint that conforms to the land shape without needing rectangular sections or splits.

---

## Leaflet Map Integration

The map module (`js/map/leaflet-map.js`) provides satellite imagery overlay for tracing real-world parcels.

### How It Works
- **Tile source**: Esri World Imagery (free satellite tiles), max zoom 19
- **Default center**: Southern Ontario [43.0, -79.0]
- **Canvas-map sync**: When the map is active, canvas pan/zoom is driven by Leaflet. The sync uses Web Mercator `metersPerPixel()` to match canvas pixels-per-meter to the map's current zoom level.
- **Reference point**: `state.refLatLng` anchors the coordinate systems — this lat/lng corresponds to meters (0,0) in canvas space.
- **Pointer events**: When the map is active and not drawing, the canvas passes pointer events through to Leaflet for pan/zoom. During drawing modes, the canvas captures clicks.

### Address Search
Uses OpenStreetMap Nominatim geocoding API. Typing an address and pressing Enter/Go flies the map to that location and sets a new reference point.

---

## Rendering Pipeline

`draw()` calls in order:
1. Clear canvas
2. `drawGrid()` — adaptive background grid (**skipped when map is active** — satellite imagery provides context)
3. `drawTreeRows()` — green row lines + tree dots (**only if `showTrees` is checked** and land polygon exists)
4. Exclusion zones — orange polygons
5. Land polygon — red boundary
6. Current drawing polygon — white with preview line
7. `drawOptimizationResult()` — greenhouse rendering (section or grid mode)
8. Land vertices — numbered red dots
9. In-progress vertices — numbered white/green dots

### Section Rendering (`drawOptimizationResult` — section mode)
Per section:
1. Fill (teal or red for jogs)
2. Walls (white perimeter, suppressed at splits)
3. Structural lines (peak lines purple, bay lines teal)
4. Bracing (orange, outward from perimeter posts, suppressed at splits)
5. Posts (white dots at all grid intersections)
6. Drive gable (blue, suppressed at parallel splits)
7. Pulley gable (purple, suppressed at parallel splits)
8. Label ("HxB" at center)

Then globally:
- Parallel split lines (red)
- Perpendicular split lines (orange)

### Grid Mode Rendering (`drawGridResult` — no-splits mode)
1. Perimeter polygon fill — adjusted to structural boundaries (gable posts & sidewalls)
2. Sidewall wall lines (white, horizontal spans at boundary rows)
3. Internal peak lines (purple, at row boundaries where both sides are active)
4. Internal bay lines (teal, at col boundaries where both sides are active)
5. Gable lines — drive (blue) at left edges, pulley (purple) at right edges
6. Bracing — orange ticks extending outward from boundary walls
7. Posts at peak × bay post intersections (+ sidewall positions for boundary rows)
8. Area label at center of mass

Detail rendering (steps 2-7) is skipped when zoomed out (`scale * zoom <= 2`).

### Results Display

**Section mode**: Shows land area, greenhouse area, coverage %, sections count, jogs, parallel/perp splits, score, per-section breakdown (HxB), and detailed greenhouse calcs (resolved values, zone areas, post counts by type).

**Grid mode**: Shows land area, greenhouse area, coverage %, shape (rectangle or jog count), active cells, houses, max bays, total posts, resolved values (house width, bay size), and per-row breakdown.

---

## Greenhouse Physical Model

### Terminology
- **House**: One peaked roof section. Peak line (ridge) runs from gable to gable.
- **Bay**: One division along the length, parallel to tree rows.
- **Drive gable**: End wall where the drive shaft is (first U edge).
- **Pulley gable**: Opposite end wall (last U edge).
- **Parallel split**: Interior drive shaft between zones. Runs same direction as gables (along V). The second zone does NOT have its own drive gable — the split IS its drive.
- **Perpendicular split**: Splits zones perpendicular to drive shafts (along U).
- **Sidewall**: Long wall parallel to tree rows (at V edges).

### Post Grid
- **Peak posts (V direction)**: Always ON tree rows. Spacing = houseWidth (multiple of treeRowSpacing).
- **Bay posts (U direction)**: Offset between trees by bayPostOffset (default = treeSpacing/2). Spacing = baySize (multiple of treeSpacing).
- **Sidewall posts**: Placed at sidewallOffset from first/last peak, based on sidewall rule.

### Sidewall Rules
Controls where the sidewall (valley) sits relative to peaks:
- **Normal**: sidewall at `houseWidth / 2` from first peak
- **Adjusted**: sidewall at `houseWidth / 2 + 1 ft (0.3048m)` from first peak
- **Flat Roof**: sidewall at full `houseWidth` from first peak (current default)

Peaks are the fixed reference. They ALWAYS sit on tree rows. The sidewall moves based on the rule. Same applies symmetrically to last peak.

### Bracing
- Extends outward from perimeter posts
- Gable bracing: along U at gable edges
- Sidewall bracing: along V at sidewall edges
- Corner posts get both directions
- NO bracing at parallel or perpendicular splits (interior connections)

### Constraints
| Constraint | Default | Rule |
|------------|---------|------|
| Min bays after split | 4 | Each section needs >= 4 bays |
| Max drive shaft | 108m | Limits houses per section (disabled when noPerpSplits) |
| Max drive cable | 76m | Limits bays per section (bypassed when noParallelSplits) |
| Bay size | 6-10m | Must be multiple of tree spacing |
| House width | 3.5-5.2m | Must be multiple of row spacing |
| Posts between trees | auto | Posts offset by treeSpacing/2 |
| No U-shapes | enforced | Only rectangles, L, crosses |

---

## UI Controls

### Drawing Tools
- **Draw Land**: Click points to define land boundary. Close by clicking first point or double-click.
- **Exclusion Zone**: Same as land drawing but creates exclusion areas.
- **Clear All**: Reset everything.
- **Demo**: Load a 200x160m test rectangle and auto-optimize, then fit to view.
- **Ortho**: Toggle snap to tree row / perpendicular directions (like AutoCAD).

### Sidebar Toggles
- **Show Trees**: Checkbox to toggle tree row visibility (default: on).
- **No Parallel Splits**: Checkbox to disable parallel splits (default: on). When unchecked, reveals "Max Bays per Section" and "Min Bays (parallel split)" inputs.
- **No Perp Splits**: Checkbox to disable perpendicular splits (default: on). When unchecked, reveals "Max Drive Shaft" input.
- When **both** split checkboxes are checked, the optimizer uses grid-based placement mode instead of section-based.

### Toolbar (top-right of canvas)
- **Map: Off/On**: Toggle Leaflet satellite map overlay. When on, reveals address search bar.
- **Address search**: Text input + Go button. Geocodes via Nominatim and flies the map to the result.
- **Zoom +/−**: Zoom in/out by 1.3x factor.
- **Fit**: Zoom and pan to fit the land polygon with 60px padding.

### Canvas Interaction
- **Left click**: Place point (in drawing mode)
- **Right click**: Undo last point
- **Middle mouse / Ctrl+drag**: Pan (disabled when map is active — Leaflet handles pan/zoom)
- **Mouse wheel**: Zoom (toward cursor; delegated to Leaflet when map is active)
- **ESC**: Cancel drawing
- **F8**: Toggle ortho mode

### Auto-Reoptimize
Any change to sidebar inputs (params, checkboxes, selects) automatically re-runs the optimizer if a result already exists, then redraws.

### Status Bar
Shows mouse position (meters), current scale (px/m), and land area.

---

## Color Scheme
| Element | Color |
|---------|-------|
| Land boundary | #e94560 (red) |
| Exclusion zone | #f39c12 (orange) |
| Greenhouse fill | rgba(15,155,142,0.08) (teal) |
| Jog fill | rgba(231,76,60,0.1) (red) |
| Drive gable | #3498db (blue) |
| Pulley gable | #9b59b6 (purple) |
| Parallel split | #e74c3c (red) |
| Perpendicular split | #e67e22 (orange) |
| Walls | rgba(255,255,255,0.5) |
| Posts | white circles with dark stroke |
| Trees | green circles |
| Bracing | #f39c12 (orange) lines |
| Peak lines | rgba(155,89,182,0.35) (purple) |
| Bay lines | rgba(15,155,142,0.25) (teal) |
