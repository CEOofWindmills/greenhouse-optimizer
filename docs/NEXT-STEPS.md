# Next Steps & Status

## Boundary Enforcement — IMPLEMENTED

The greenhouse footprint (posts, bracing, sidewall offsets) previously extended outside the land boundary. This has been addressed with two mechanisms:

### What Was Implemented

1. **Bounds insetting** (`computeMargins()` in optimizer.js): Before running the placer, the land bounds are shrunk by asymmetric margins that account for structural offsets:
   - **U direction**: `marginMinU = max(0, gableBracingDist - bayOffset)`, `marginMaxU = bayOffset + gableBracingDist`
   - **V direction**: `marginMinV = max(0, sidewallOffset + sidewallBracingDist - houseOffset)`, `marginMaxV = max(0, houseOffset + sidewallOffset + sidewallBracingDist - houseWidth)`
   - The grid starts from the inset bounds, so sections are placed within the smaller area.

2. **Iterative pruning** (`pruneFootprintOutsideLand()` in greedy-placer.js): After the coverage grid is built, boundary cells are iteratively checked against the actual land polygon (not just bounds). Each boundary cell's structural footprint corners and edge midpoints (8 points) are tested. Cells with any point outside the land or inside an exclusion zone are removed. The process repeats until stable, since removing a cell can expose new boundaries.

### Limitations
- The bounds insetting handles rectangular and near-rectangular parcels well.
- For truly irregular concave polygons, a full polygon inset algorithm (Minkowski-style) would be more precise, but the iterative pruning compensates by catching cases the simple bounds inset misses.
- The pruning checks 8 sample points per cell footprint — extremely narrow protrusions between sample points could theoretically slip through.

### What Was Tried & Failed (Historical)
A previous attempt tried:
1. Changing grid coverage threshold from >0.5 to >0.99 — killed edge cells due to floating point
2. Adding `rectFullyInLand()` with margins on every section — grid starts at boundary, so sections at edges always had margins extending outside. Every section got rejected.
3. Root cause: tried to validate margins AFTER placement instead of preventing boundary violations BEFORE placement.

---

## Completed Features

- [x] Modular vanilla JS architecture (was single HTML)
- [x] Post grid rendering (plan view, like AutoCAD)
- [x] Bay post offset (posts between trees, not on them)
- [x] Sidewall rules (normal/adjusted/flat roof)
- [x] Separate gable/sidewall bracing distances
- [x] Bracing rendering with suppression at splits
- [x] Parallel and perpendicular split detection and rendering
- [x] Drive gable suppression at parallel splits
- [x] Balanced bay distribution (no greedy starving)
- [x] Aggressive post cost penalty
- [x] Ortho mode (snap to row/perp axes like AutoCAD)
- [x] Demo button
- [x] Greenhouse calcs panel (post counts, dimensions, zone areas)
- [x] Boundary enforcement (bounds insetting + iterative pruning)
- [x] Leaflet satellite map integration with address geocoding
- [x] Grid-based no-splits placement mode (perimeter tracing, flood fill)
- [x] Show/hide trees toggle
- [x] No Parallel Splits / No Perp Splits toggles with conditional UI
- [x] Zoom In/Out/Fit toolbar buttons
- [x] Auto-reoptimize on parameter changes

## Future Work

- [ ] Migrate from Leaflet/Esri tiles to Google Maps API (better imagery, street view, etc.)
- [ ] More sophisticated jog/L-shape handling
- [ ] Full polygon inset algorithm for concave parcels (Clipper-style)
- [ ] Perpendicular split generation in the placer (currently only parallel in section mode)
- [ ] Save/load parcel configurations
- [ ] Export to DXF/AutoCAD format
- [ ] Multiple parcel comparison
