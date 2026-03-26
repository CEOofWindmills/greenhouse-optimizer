# Greenhouse Coverage Optimizer - Architecture & Documentation

## Overview

A vanilla JS canvas application that optimizes greenhouse placement on irregular land parcels with tree rows. The tool works like a simplified AutoCAD — users draw land boundaries, configure tree rows and greenhouse constraints, and the optimizer finds the best greenhouse layout that maximizes coverage while respecting structural rules.

**Stack**: Vanilla JS (ES modules), HTML5 Canvas, CSS. No build step, no framework.

---

## File Structure

```
Optimization Demo/
  index.html              # Main HTML: sidebar UI, canvas, status bar
  main.js                 # Entry point: init canvas, handlers, resize
  css/
    styles.css            # Dark theme styling for all UI
  js/
    core/
      state.js            # Global state object, canvas refs
      geometry.js         # Polygon math: area, bounds, point-in-polygon, coverage
      transforms.js       # Coordinate transforms: meters<->screen, getParams()
    engine/
      optimizer.js        # Main optimizer: iterates configs, scores, picks best
      greedy-placer.js    # Balanced placement: grid, blocks, distribution, splits
    render/
      draw.js             # Main render loop orchestrator
      grid.js             # Background grid with adaptive spacing
      trees.js            # Tree row lines and individual tree dots
      sections.js         # Greenhouse rendering: walls, posts, bracing, gables, splits
      results.js          # Metrics display in sidebar panels
    ui/
      buttons.js          # Button event handlers
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
}
```

### Params (from UI via `getParams()`)
```javascript
{
  treeRowSpacing: 5,      // meters between rows (V direction)
  treeSpacing: 3,         // meters between trees in-row (U direction)
  treeDirection: 0,       // degrees, converted to radians

  sidewallRule: 'flat',   // 'normal' | 'adjusted' | 'flat'
  minHouse: 3.5,          // min house width (meters)
  maxHouse: 5.2,          // max house width (meters)
  minBay: 6,              // min bay size (meters)
  maxBay: 10,             // max bay size (meters)
  maxBays: 10,            // max bays per section
  minBaysSplit: 4,        // min bays after a parallel split
  maxDriveShaft: 108,     // max drive shaft length (meters)
  maxDriveCable: 76,      // max drive cable length (meters)

  gableBracingDist: 1.5,  // bracing at gable ends (meters)
  sidewallBracingDist: 1.5,// bracing at sidewalls (meters)
  bayPostOffset: null,     // auto = treeSpacing / 2
  housePostOffset: null,   // auto = 0
  postPenalty: null,       // auto = 5.0 m^2/post
  jogPenalty: 50,          // m^2 per jog
}
```

### Section Object
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
```javascript
{
  sections: Section[],
  parallelSplits: [{u, v, height}],   // Interior drive shafts (along V)
  perpSplits: [{u, v, width}],        // Perpendicular splits (along U)
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
  |     |-- Calculate max bays by cable length
  |     |-- Call greedyPlace()
  |     |     |-- Build coverage grid (9-point sampling per cell)
  |     |     |-- Find largest contiguous rectangular block
  |     |     |-- distributeBays(): split evenly across sections
  |     |     |-- Detect parallel/perpendicular splits
  |     |     |-- Detect jogs (misaligned edges)
  |     |     |-- Return sections + splits + metrics
  |     |-- Count posts, calculate score
  |     |-- Keep best scoring result
  |-- Store result, display, render
```

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

---

## Rendering Pipeline

`draw()` calls in order:
1. Clear canvas
2. `drawGrid()` — adaptive background grid
3. `drawTreeRows()` — green row lines + tree dots (if zoomed in)
4. Exclusion zones — orange polygons
5. Land polygon — red boundary
6. Current drawing polygon — white with preview line
7. `drawOptimizationResult()` — all greenhouse sections
8. Land vertices — numbered red dots
9. In-progress vertices — numbered white/green dots

### Section Rendering (`drawOptimizationResult`)
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
| Max drive shaft | 108m | Limits houses per section |
| Max drive cable | 76m | Limits bays per section |
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
- **Demo**: Load a 100x80m test rectangle and auto-optimize.
- **Ortho**: Toggle snap to tree row / perpendicular directions (like AutoCAD).

### Canvas Interaction
- **Left click**: Place point (in drawing mode)
- **Right click**: Undo last point
- **Middle mouse / Ctrl+drag**: Pan
- **Mouse wheel**: Zoom (toward cursor)
- **ESC**: Cancel drawing
- **F8**: Toggle ortho mode

### Status Bar
Shows mouse position (meters), current scale, and land area.

---

## Color Scheme
| Element | Color |
|---------|-------|
| Land boundary | #e94560 (red) |
| Exclusion zone | #f39c12 (orange) |
| Greenhouse fill | rgba(15,155,142,0.3) (teal) |
| Jog fill | rgba(231,76,60,0.3) (red) |
| Drive gable | #3498db (blue) |
| Pulley gable | #9b59b6 (purple) |
| Parallel split | #e74c3c (red) |
| Perpendicular split | #e67e22 (orange) |
| Walls | white |
| Posts | white circles |
| Trees | green circles |
| Bracing | orange lines |
| Peak lines | purple dashed |
| Bay lines | teal dashed |
