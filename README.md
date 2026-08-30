# Aeris

Real-time 3D flight tracking - altitude-aware, visually stunning.

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
| Data      | Authorized provider-neutral ADS-B relay                          |

## Getting Started

```bash
pnpm install
cp .env.example .env.local
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

The interface can run without aircraft credentials, but live aircraft data is
disabled until an authorized source is configured.

> This repository provides software only and grants no rights to third-party
> aircraft data. Operators must obtain authorization covering access,
> processing, retention, attribution, commercial use, and downstream
> redistribution. The relay may reduce client fanout but does not improve the
> accuracy, completeness, or availability of its upstream sources and is not
> intended for safety-critical use.

## Architecture

```
src/
├── app/
│   ├── globals.css            Tailwind config, theme vars
│   ├── layout.tsx             Root layout (Inter font)
│   ├── page.tsx               Entry - renders <FlightTracker />
│   ├── api/flights/route.ts   bounded HTTP relay fallback
│   ├── api/trails/            viewport history proxy
│   └── api/tracks/            selected-track history proxy
├── components/
│   ├── flight-tracker.tsx     Orchestrator - state, camera, layers, UI
│   ├── map/
│   │   ├── map.tsx            MapLibre GL wrapper with React context
│   │   ├── flight-layers.tsx  Deck.gl overlay - icons, trails, shadows, animation
│   │   ├── aircraft-model-mapping.ts  ADS-B category → 3D model key + bucketing
│   │   └── aircraft-model-layers.ts   Builds per-model ScenegraphLayers
│   └── ui/
│       ├── altitude-legend.tsx
│       ├── control-panel.tsx  Tabbed dialog - search, map style, settings
│       ├── flight-card.tsx    Hover card with flight details
│       ├── scroll-area.tsx    Custom scrollbar
│       ├── slider.tsx         Orbit speed slider (Radix)
│       └── status-bar.tsx     Live status indicator
├── hooks/
│   ├── use-flight-stream.ts   Snapshot-first relay WebSocket client
│   ├── use-flights.ts         Live stream with bounded HTTP fallback
│   ├── use-settings.tsx       Settings context with localStorage persistence
│   └── use-trail-history.ts   Trail accumulation + Catmull-Rom smoothing
└── lib/
    ├── cities.ts              Curated aviation hub presets
    ├── relay/                 Protocol, ticketing, and history normalization
    ├── flight-api.ts          Flight client barrel exports
    ├── flight-api-client.ts   Relay HTTP fallback and authorized legacy mode
    ├── flight-api-parsing.ts  readsb JSON → FlightState normalization
    ├── flight-api-types.ts    Shared types for ADS-B providers
    ├── flight-utils.ts        Altitude→color, unit conversions
    ├── map-styles.ts          Map style definitions
    ├── opensky.ts             OpenSky API client + types (Tier 4 fallback)
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
| `widebody-4eng` | A380, B747, A340                | -                                              |
| `a380`          | Airbus A380                     | Type codes A38x                                |
| `b737`          | Boeing 737 family               | Type codes B73x, B3xM                          |
| `regional-jet`  | CRJ, E-Jets, Fokker             | -                                              |
| `light-prop`    | Cessna, Piper, Cirrus           | Category 2 (Light), 12 (Ultralight)            |
| `turboprop`     | ATR, Dash-8, Saab               | -                                              |
| `helicopter`    | All rotorcraft                  | Category 8 (Rotorcraft)                        |
| `bizjet`        | Gulfstream, Citation, Learjet   | -                                              |
| `glider`        | Sailplanes                      | Category 9 (Glider)                            |
| `fighter`       | Military fast-movers            | Category 7 (High-perf)                         |
| `drone`         | UAVs                            | Category 14 (UAV)                              |
| `generic`       | Fallback for unknown categories | Category 0, 1, default                         |

Models are optimised GLB files (no Draco compression - avoids external WASM decoder dependency) served from Cloudinary CDN (local backups in `public/models/aircraft/`). A second-tier mapping from ICAO type codes (A320, B738, etc.) refines the assignment when type data is available via the readsb feed.

- **Smooth animation**: Catmull-Rom spline trails, per-frame interpolation between polls
- **Glassmorphism**: `backdrop-blur-2xl`, `bg-black/60`, `border-white/[0.08]`
- **Spring physics**: All UI transitions use spring easing
- **Responsive**: Desktop sidebar dialog, mobile bottom-sheet with thumb-zone tab bar
- **API efficiency**: Adaptive polling (30 s → 5 min) based on remaining credits, Page Visibility pause, grid-snapped cache
- **Persistence**: Settings + map style in localStorage, `?city=IATA` URL deep links

## Environment Variables

See `.env.example` for the full provider-neutral template. Production endpoints,
credentials, topology, capacity data, and operational settings are deliberately
not included in this repository.

| Variable                                    | Required for relay | Description                                                        |
| ------------------------------------------- | ------------------ | ------------------------------------------------------------------ |
| `FLIGHT_DATA_ORIGIN`                        | Yes                | Server-only relay HTTP origin.                                     |
| `FLIGHT_RELAY_HTTP_TOKEN`                   | Yes                | Server-only bearer token for bounded relay endpoints.              |
| `FLIGHT_STREAM_PRIVATE_KEY`                 | Yes                | Ed25519 key used to issue short-lived, one-use stream tickets.      |
| `NEXT_PUBLIC_FLIGHT_STREAM_URL`             | Yes                | Browser WebSocket endpoint; tickets are sent as a subprotocol.      |
| `FLIGHT_APP_ORIGIN`                         | Yes                | Exact application origin accepted by the ticket route.             |
| `FLIGHT_DATA_ATTRIBUTION_*`                 | As terms require   | Provider attribution rendered in the application.                  |
| `FLIGHT_DIRECT_PROVIDER_ACCESS`             | No                 | Explicit server gate for separately authorized legacy providers.   |
| `NEXT_PUBLIC_AUTHORIZED_DIRECT_FLIGHT_DATA` | No                 | Matching browser/CSP gate for separately authorized direct access. |
| `NEXT_PUBLIC_GA_ID`                         | No                 | Google Analytics measurement ID.                                   |
| `OPENAIP_API_KEY`                           | No                 | Server-only key for the optional airspace tile proxy.               |

The relay service and its synthetic tests live in `services/adsb-relay`. Raw
upstream payloads are not persisted by that service. Provider accounts,
negotiated endpoints, feed captures, and operational configuration must remain
outside the public repository.

## Open Aviation Data

Aeris stores reproducible aircraft and airport snapshots in `public/data/aviation`.

- Mictronics supplies global registration, type, model, and database flag data.
- The FAA supplies US registration, manufacturer, and model data.
- OurAirports supplies airport codes and coordinates.

The generator copies only approved aircraft fields. It excludes FAA owner names, addresses, and other personal fields.

Run these commands to refresh and check the files:

```bash
pnpm data:refresh
pnpm data:check
pnpm test:data
```

The automation refreshes FAA data each day and OurAirports data each night. The job starts at 03:17 UTC. It downloads Mictronics data once per UTC week. It validates the combined snapshot each day and opens one draft review PR on Monday when generated files change.

The [aviation data notice](public/data/aviation/NOTICE.md) lists each source and license.

## License

AGPL-3.0
