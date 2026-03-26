# Next Steps - Critical Issue: Boundary Enforcement

## The Problem

The greenhouse footprint (posts, bracing, sidewall offsets) currently extends OUTSIDE the land boundary. The optimizer places sections based on grid cells that are >50% inside the land, but doesn't account for:

1. **Bay post offset** — posts are offset from the grid edge by `treeSpacing / 2` (default 1.5m)
2. **Sidewall rule offset** — the sidewall extends outward from the first/last peak by `sidewallOffset` (varies by rule: half house, half house + 1ft, or full house width)
3. **Gable bracing** — extends beyond the gable wall by `gableBracingDist` (default 1.5m)
4. **Sidewall bracing** — extends beyond the sidewall by `sidewallBracingDist` (default 1.5m)

All of these can push the physical greenhouse footprint outside the drawn land boundary.

## The Solution (Agreed Approach)

**Inset the land boundary polygon** before running the optimizer. Shrink the polygon inward by the maximum margin amount so the optimizer works on a smaller area that already accounts for all offsets.

### Margin Calculations

**U direction (along tree rows, bay direction):**
```
marginU = bayPostOffset + gableBracingDist
```
Default: 1.5 + 1.5 = 3.0m inset on each side

**V direction (perpendicular to tree rows, house direction):**
```
sidewallOffset = depends on sidewallRule:
  - normal:   houseWidth / 2
  - adjusted: houseWidth / 2 + 0.3048
  - flat:     houseWidth

marginV = sidewallOffset + sidewallBracingDist
```
Default (flat, 5m house): 5.0 + 1.5 = 6.5m inset on each side

### Implementation Plan

1. **Add polygon inset function** to `geometry.js`
   - Takes a polygon and inset distances (marginU, marginV in rotated UV space)
   - Returns a new polygon shrunk inward
   - This is a "polygon offset" or "buffer" operation (inward)
   - For convex polygons: move each edge inward by the margin, find new intersections
   - For concave polygons: more complex — may need to handle self-intersections

2. **In `optimizer.js`**, before the main loop:
   - Calculate marginU and marginV from current params
   - Rotate the land polygon to UV space (already done)
   - Inset the rotated polygon by marginU (U edges) and marginV (V edges)
   - Use the inset polygon for grid coverage testing
   - Sections placed within the inset polygon will automatically have room for offsets + bracing

3. **The grid coverage check stays as-is** (>50% threshold) — it just operates on the smaller polygon

4. **Section rendering stays as-is** — sections are placed within the inset area, but rendered with full offsets/bracing which will now fit within the original boundary

### Considerations

- The inset is **directional** (different in U vs V), not uniform. This means we need an anisotropic polygon offset, OR we can do the inset in UV space where U and V margins are applied to the respective edges.
- For a simple rectangular parcel, this is trivial: just shrink the bounds.
- For irregular polygons, a proper polygon inset algorithm is needed. The Clipper library handles this well, but we're vanilla JS — implement a basic version or use the Minkowski difference approach.
- **Simpler alternative**: Instead of insetting the polygon, just adjust the grid start positions inward by the margins. This works for convex parcels but won't handle concave boundaries correctly.

### Simplest First Pass

For the initial implementation:
1. After rotating the polygon and computing bounds, shrink the bounds by margins:
   ```
   adjustedMinX = rBounds.minX + marginU
   adjustedMaxX = rBounds.maxX - marginU
   adjustedMinY = rBounds.minY + marginV
   adjustedMaxY = rBounds.maxY - marginV
   ```
2. Start the grid from `adjustedMinX` instead of `rBounds.minX`
3. This handles rectangular and near-rectangular parcels
4. For truly irregular parcels, implement full polygon insetting later

### What Was Tried & Failed

A previous attempt tried:
1. Changing grid coverage threshold from >0.5 to >0.99 — killed edge cells due to floating point
2. Adding `rectFullyInLand()` with margins on every section — grid starts at boundary, so sections at edges always had margins extending outside. Every section got rejected.
3. Root cause: tried to validate margins AFTER placement instead of preventing boundary violations BEFORE placement by using an inset polygon.

---

## Other Pending Items (Lower Priority)

### Already Implemented (for reference)
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

### Future Work
- [ ] **Boundary enforcement** (this document — CRITICAL)
- [ ] Google Maps integration for land tracing
- [ ] More sophisticated jog/L-shape handling
- [ ] Perpendicular split generation in the placer (currently only parallel)
- [ ] Save/load parcel configurations
- [ ] Export to DXF/AutoCAD format
- [ ] Multiple parcel comparison
