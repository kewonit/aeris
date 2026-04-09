# 3D Aircraft Models

## Overview

Aeris uses 14 distinct 3D aircraft silhouettes to represent different aircraft types on the globe. Models are assigned based on ICAO type code (when available) or ADS-B emitter category.

Two iconic aircraft types — the **Airbus A380** and **Boeing 737** — have dedicated models for visual distinction. All other aircraft are mapped to generic silhouette categories.

## Model Inventory

| File                | Size (KB) | Description                                | Source         |
| ------------------- | --------: | ------------------------------------------ | -------------- |
| `b737.glb`          |     156.1 | Boeing 737 family (incl. MAX)              | fr24-3d-models |
| `bizjet.glb`        |     452.8 | Business jets (Gulfstream, Citation, etc.) | FlightAirMap   |
| `drone.glb`         |     131.0 | Unmanned aerial vehicles                   | FlightAirMap   |
| `fighter.glb`       |      58.2 | Military high-performance aircraft         | FlightAirMap   |
| `generic.glb`       |     401.8 | Default fallback (A320 silhouette)         | FlightAirMap   |
| `glider.glb`        |      68.1 | Gliders and sailplanes                     | FlightAirMap   |
| `helicopter.glb`    |     270.8 | Rotorcraft                                 | FlightAirMap   |
| `light-prop.glb`    |     131.0 | Light GA props (Cessna, Piper, etc.)       | FlightAirMap   |
| `narrowbody.glb`    |     401.8 | Narrow-body jets (A320, other non-737)     | FlightAirMap   |
| `regional-jet.glb`  |     127.0 | Regional jets (CRJ, Embraer E-Jets)        | FlightAirMap   |
| `turboprop.glb`     |      86.4 | Turboprops (ATR, Dash-8)                   | FlightAirMap   |
| `widebody-2eng.glb` |     149.3 | Wide-body twin-engine (777, 787, A330)     | FlightAirMap   |
| `widebody-4eng.glb` |     241.8 | Wide-body four-engine (A340, A380)         | FlightAirMap   |

### Totals

| Metric                            |                Value |
| --------------------------------- | -------------------: |
| **Aircraft models**               |             13 files |
| **Aircraft total**                | 2,676.1 KB (2.61 MB) |
| **Legacy model** (`airplane.glb`) | 1,295.2 KB (1.26 MB) |
| **All GLB files**                 | 3,971.3 KB (3.88 MB) |

## Optimization Pipeline

All models are optimized for web delivery using `@gltf-transform/cli`:

1. **Texture stripping** — Materials set to neutral unlit gray
2. **Mesh simplification** — Triangle count reduced to ~30% of original
3. **B737 format conversion** — Converted from glTF 1.0 → 2.0 via `gltf-pipeline`

> Note: Draco compression is **not** used for these models, to avoid
> introducing an external WASM decoder dependency.
> See `public/models/aircraft/NOTICE.md` for details.

## Scale Pipeline

Aircraft size now uses measured mesh metrics plus a separate physical-class scale, instead of one mixed hand-tuned constant table.

1. Mesh measurement: `scripts/inspect-aircraft-model-extents.mjs` measures each GLB's axis spans and centers and writes them to `src/components/map/model-mesh-metrics.ts`. It also keeps `src/components/map/model-mesh-extents.ts` updated for the legacy max-extent normalization input.
2. Mesh normalization: Scenegraph `getScale` still normalizes by measured max extent so very large raw assets do not dominate the screen.
3. Composite physical display scale: `sizeScale` now uses family wingspan together with the measured mesh extent. The display multiplier grows with real aircraft class, but only with the square root of the raw mesh extent. This preserves compact silhouettes while preventing one oversized raw mesh from collapsing the hierarchy.

This is what keeps the A380 logically larger than narrowbody and 737-family models even though `a380` still reuses the `widebody-4eng` GLB and that source asset is authored much larger than the narrowbody mesh.

## Model Assignment

### Priority: TypeCode → Category

When an aircraft's ICAO type code is available (from readsb providers), it takes priority over the generic ADS-B category mapping.

**Dedicated model types:**

| Aircraft Type    | TypeCode Pattern      | Model Key |
| ---------------- | --------------------- | --------- |
| Airbus A380      | `A38x`                | `a380`    |
| Boeing 737 (all) | `B73x`, `B37M`–`B39M` | `b737`    |

**Category-based fallback (DO-260B):**

| ADS-B Category | Weight Class           | Model Key       |
| -------------- | ---------------------- | --------------- |
| 2              | Light (<15,500 lbs)    | `light-prop`    |
| 3              | Small (15,500–75,000)  | `narrowbody`    |
| 4              | Large (75,000–300,000) | `narrowbody`    |
| 5              | High vortex (B757)     | `narrowbody`    |
| 6              | Heavy (>300,000 lbs)   | `widebody-2eng` |
| 7              | High performance       | `fighter`       |
| 8              | Rotorcraft             | `helicopter`    |
| 9              | Glider/sailplane       | `glider`        |
| 12             | Ultralight             | `light-prop`    |
| 14             | UAV                    | `drone`         |
| Other          | Unknown                | `generic`       |

## Performance

- Models are **lazy-loaded**: only fetched when an aircraft of that type first appears in data
- The 6 most common model types are **prefetched** via `<link rel="prefetch">` on page load
- Empty ScenegraphLayers are kept alive with stable empty arrays to avoid shader recompilation
- deck.gl caches models by URL, so the `a380` key (which maps to `widebody-4eng.glb`) shares the cache entry

## Licensing

All models are licensed under **GPL v2**, compatible with the project's AGPL v3 license.

- **FlightAirMap-3dmodels**: https://github.com/Ysurac/FlightAirMap-3dmodels
- **fr24-3d-models**: https://github.com/Flightradar24/fr24-3d-models
- Original sources: [FlightGear FGMEMBERS](https://github.com/FGMEMBERS)

See [public/models/aircraft/NOTICE.md](../public/models/aircraft/NOTICE.md) for full attribution.
