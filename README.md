# Aeris

Real-time 3D flight tracking — altitude-aware, visually stunning.

Aeris renders live air traffic over the world's busiest airspaces on a premium dark-mode map. Flights are separated by altitude in true 3D: low altitudes glow cyan, high altitudes shift to gold. Select a city, and the camera glides to that airspace with spring-eased animation.

## Stack

| Layer     | Technology                                      |
| --------- | ----------------------------------------------- |
| Framework | Next.js 16 (App Router, Turbopack)              |
| Language  | TypeScript                                      |
| Styling   | Tailwind CSS v4                                 |
| Map       | MapLibre GL JS                                  |
| WebGL     | Deck.gl 9 (IconLayer, PathLayer, MapboxOverlay) |
| Animation | Motion (Framer Motion)                          |
| Data      | OpenSky Network API                             |

## Getting Started

```bash
pnpm install
cp .env.example .env.local
# Optionally add OpenSky credentials — see .env.example
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
│   └── api/flights/route.ts   OpenSky proxy with rate limiting + auth
├── components/
│   ├── flight-tracker.tsx     Orchestrator — state, camera, layers, UI
│   ├── map/
│   │   ├── map.tsx            MapLibre GL wrapper with React context
│   │   └── flight-layers.tsx  Deck.gl overlay — icons, trails, shadows, animation
│   └── ui/
│       ├── altitude-legend.tsx
│       ├── control-panel.tsx  Tabbed dialog — search, map style, settings
│       ├── flight-card.tsx    Hover card with flight details
│       ├── scroll-area.tsx    Custom scrollbar
│       └── status-bar.tsx     Live status indicator
├── hooks/
│   ├── use-flights.ts         Polling hook for OpenSky API
│   ├── use-settings.tsx       Settings context with localStorage persistence
│   └── use-trail-history.ts   Trail accumulation + Catmull-Rom smoothing
└── lib/
    ├── cities.ts              Curated aviation hub presets
    ├── flight-utils.ts        Altitude→color, unit conversions
    ├── map-styles.ts          Map style definitions
    ├── opensky.ts             OpenSky API client + types
    └── utils.ts               cn() utility
```

## Design

- **Dark-first**: CARTO Dark Matter base map, theme-aware UI
- **3D depth**: 55° pitch, altitude-based z-displacement via Deck.gl
- **Smooth animation**: Catmull-Rom spline trails, per-frame interpolation between polls
- **Glassmorphism**: `backdrop-blur-2xl`, `bg-black/60`, `border-white/[0.08]`
- **Spring physics**: All UI transitions use spring easing
- **Persistence**: Settings + map style in localStorage, `?city=IATA` URL deep links

## Environment Variables

| Variable                | Required | Description                    |
| ----------------------- | -------- | ------------------------------ |
| `OPENSKY_CLIENT_ID`     | No       | OAuth2 client ID (recommended) |
| `OPENSKY_CLIENT_SECRET` | No       | OAuth2 client secret           |
| `OPENSKY_USERNAME`      | No       | Basic auth username (legacy)   |
| `OPENSKY_PASSWORD`      | No       | Basic auth password (legacy)   |

Without credentials, anonymous access is used (~10 requests/minute).

## License

AGPL-3.0
