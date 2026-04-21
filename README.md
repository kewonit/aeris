# Aeris

Real-time 3D flight tracking — altitude-aware, visually stunning.

Aeris renders live air traffic over the world's busiest airspaces on a premium dark-mode map. Flights are separated by altitude in true 3D: low altitudes glow cyan, high altitudes shift to gold. Select a city, and the camera glides to that airspace with spring-eased animation.

[Live Demo](https://aeris.edbn.me) | [HN discussion](https://news.ycombinator.com/item?id=47048004)

<img width="1280" height="832" alt="aeris - 1" src="https://github.com/user-attachments/assets/3fe48868-f8cd-48af-81d6-395c1fce8a2a" />

<img width="2559" height="1380" alt="Screenshot 2026-02-15 112222" src="https://github.com/user-attachments/assets/9d1f50ed-be4e-4ef5-95ac-257e9129f8c8" />

<img width="2555" height="1387" alt="image" src="https://github.com/user-attachments/assets/a1d2f673-dfdc-4c82-8ee2-7629d91ad94b" />

## Stack

| Layer     | Technology                                                       |
| --------- | ---------------------------------------------------------------- |
| Framework | Next.js 16 (App Router, Turbopack)                               |
| Language  | TypeScript                                                       |
| Styling   | Tailwind CSS v4                                                  |
| Map       | MapLibre GL JS                                                   |
| WebGL     | Deck.gl 9 (ScenegraphLayer, IconLayer, PathLayer, MapboxOverlay) |
| Animation | Motion (Framer Motion)                                           |
| Data      | Airplanes.live / adsb.lol / OpenSky (3-tier fallback)            |
| Hosting   | Vercel                                                           |

## Getting Started

```bash
pnpm install
cp .env.example .env.local
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

## Architecture

```
src/
├── app/
│   ├── globals.css            Tailwind config, theme vars
│   ├── layout.tsx             Root layout (Inter font)
│   ├── page.tsx               Entry — renders <FlightTracker />
│   └── api/flights/route.ts   adsb.lol reverse proxy (CORS workaround + rate limit)
├── components/
│   ├── flight-tracker.tsx     Orchestrator — state, camera, layers, UI
│   ├── map/
│   │   ├── map.tsx            MapLibre GL wrapper with React context
│   │   ├── flight-layers.tsx  Deck.gl overlay — icons, trails, shadows, animation
│   │   ├── aircraft-model-mapping.ts  ADS-B category → 3D model key + bucketing
│   │   └── aircraft-model-layers.ts   Builds per-model ScenegraphLayers
│   └── ui/
│       ├── altitude-legend.tsx
│       ├── control-panel.tsx  Tabbed dialog — search, map style, settings
│       ├── flight-card.tsx    Hover card with flight details
│       ├── scroll-area.tsx    Custom scrollbar
│       ├── slider.tsx         Orbit speed slider (Radix)
│       └── status-bar.tsx     Live status indicator
├── hooks/
│   ├── use-flights.ts         Adaptive polling hook with credit-aware throttling
│   ├── use-settings.tsx       Settings context with localStorage persistence
│   └── use-trail-history.ts   Trail accumulation + Catmull-Rom smoothing
└── lib/
    ├── cities.ts              Curated aviation hub presets
    ├── flight-api.ts          Barrel re-export for the 3-tier flight client
    ├── flight-api-client.ts   airplanes.live → adsb.lol → OpenSky fallback chain
    ├── flight-api-parsing.ts  readsb JSON → FlightState normalization
    ├── flight-api-types.ts    Shared types for ADS-B providers
    ├── flight-utils.ts        Altitude→color, unit conversions
    ├── map-styles.ts          Map style definitions
    ├── opensky.ts             OpenSky API client + types (Tier 3 fallback)
    └── utils.ts               cn() utility
```

## Design

- **Dark-first**: CARTO Dark Matter base map, theme-aware UI
- **3D depth**: 55° pitch, altitude-based z-displacement via Deck.gl

## Aircraft Models

Aeris renders 14 distinct aircraft silhouettes based on ADS-B emitter category and ICAO type code:

| Model Key       | Represents                      | Assignment                                     |
| --------------- | ------------------------------- | ---------------------------------------------- |
| `narrowbody`    | A320, B737 family               | Category 3 (Small), 4 (Large), 5 (High vortex) |
| `widebody-2eng` | A330, A350, B777, B787          | Category 6 (Heavy)                             |
| `widebody-4eng` | A380, B747, A340                | —                                              |
| `a380`          | Airbus A380                     | Type codes A38x                                |
| `b737`          | Boeing 737 family               | Type codes B73x, B3xM                          |
| `regional-jet`  | CRJ, E-Jets, Fokker             | —                                              |
| `light-prop`    | Cessna, Piper, Cirrus           | Category 2 (Light), 12 (Ultralight)            |
| `turboprop`     | ATR, Dash-8, Saab               | —                                              |
| `helicopter`    | All rotorcraft                  | Category 8 (Rotorcraft)                        |
| `bizjet`        | Gulfstream, Citation, Learjet   | —                                              |
| `glider`        | Sailplanes                      | Category 9 (Glider)                            |
| `fighter`       | Military fast-movers            | Category 7 (High-perf)                         |
| `drone`         | UAVs                            | Category 14 (UAV)                              |
| `generic`       | Fallback for unknown categories | Category 0, 1, default                         |

Models are optimised GLB files (no Draco compression — avoids external WASM decoder dependency) served from Cloudinary CDN (local backups in `public/models/aircraft/`). A second-tier mapping from ICAO type codes (A320, B738, etc.) refines the assignment when type data is available via the readsb feed.

- **Smooth animation**: Catmull-Rom spline trails, per-frame interpolation between polls
- **Glassmorphism**: `backdrop-blur-2xl`, `bg-black/60`, `border-white/[0.08]`
- **Spring physics**: All UI transitions use spring easing
- **Responsive**: Desktop sidebar dialog, mobile bottom-sheet with thumb-zone tab bar
- **API efficiency**: Adaptive polling (30 s → 5 min) based on remaining credits, Page Visibility pause, grid-snapped cache
- **Persistence**: Settings + map style in localStorage, `?city=IATA` URL deep links

## Environment Variables

All variables are optional — Aeris runs with no secrets. See `.env.example` for the full template.

| Variable                | Required | Description                                                                                                                                                                           |
| ----------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_GA_ID`     | No       | Google Analytics 4 measurement ID.                                                                                                                                                    |
| `OPENSKY_CLIENT_ID`     | No       | OAuth2 client id for the server-side OpenSky trace fallback in `src/lib/trails/source/server-trace-service.ts`. Without it, the trace service falls back to public ADS-B aggregators. |
| `OPENSKY_CLIENT_SECRET` | No       | OAuth2 secret that pairs with `OPENSKY_CLIENT_ID`. Set both or neither.                                                                                                               |
| `OPENAIP_API_KEY`       | No       | API key used by the airspace vector-tile proxy `src/app/api/airspace-tiles/route.ts`. Without it the airspace overlay stays empty; flight rendering is unaffected.                    |

Live flight data (airplanes.live, adsb.lol) is called directly from the browser with CORS — no credentials needed.

## License

AGPL-3.0
