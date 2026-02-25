# Aeris Mercosul

Real-time 3D flight tracking focused on the Mercosul region — altitude-aware, visually stunning.

Aeris Mercosul renders live air traffic over Latin American airspaces on a premium dark-mode map. Flights are separated by altitude in true 3D: low altitudes glow cyan, high altitudes shift to gold. Select a city, and the camera glides to that airspace with spring-eased animation. Defaults to São Paulo (GRU) with 20 curated regional hubs across Brazil, Argentina, Uruguay, Paraguay, Chile, Peru and Bolivia.

[Live Demo](https://aeris.edbn.me)

 
<img width="2559" height="1380" alt="Screenshot 2026-02-15 112222" src="https://github.com/user-attachments/assets/9d1f50ed-be4e-4ef5-95ac-257e9129f8c8" />


<img width="2555" height="1387" alt="image" src="https://github.com/user-attachments/assets/a1d2f673-dfdc-4c82-8ee2-7629d91ad94b" />



## Stack

| Layer     | Technology                                      |
| --------- | ----------------------------------------------- |
| Framework | Next.js 16 (App Router, Turbopack)              |
| Language  | TypeScript                                      |
| Styling   | Tailwind CSS v4                                 |
| Map       | MapLibre GL JS                                  |
| WebGL     | Deck.gl 9 (IconLayer, PathLayer, MapboxOverlay) |
| Animation | Motion (Framer Motion)                          |
| Data      | ADS-B.fi (opendata.adsb.fi)                     |
| Hosting   | Vercel                                          |

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
│   └── api/flights/route.ts   ADS-B.fi server-side proxy (CORS bypass)
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
│       ├── slider.tsx         Orbit speed slider (Radix)
│       └── status-bar.tsx     Live status indicator
├── hooks/
│   ├── use-flights.ts         10s polling hook via ADS-B.fi adapter
│   ├── use-settings.tsx       Settings context with localStorage persistence
│   └── use-trail-history.ts   Trail accumulation + Catmull-Rom smoothing
└── lib/
    ├── cities.ts              City type definition
    ├── regions.ts             Curated Mercosul aviation hub presets
    ├── adsbfi.ts              ADS-B.fi API adapter (drop-in for opensky.ts)
    ├── flight-utils.ts        Altitude→color, unit conversions
    ├── map-styles.ts          Map style definitions
    └── utils.ts               cn() utility
```

## Design

- **Dark-first**: CARTO Dark Matter base map, theme-aware UI
- **3D depth**: 55° pitch, altitude-based z-displacement via Deck.gl
- **Smooth animation**: Catmull-Rom spline trails, per-frame interpolation between polls
- **Glassmorphism**: `backdrop-blur-2xl`, `bg-black/60`, `border-white/[0.08]`
- **Spring physics**: All UI transitions use spring easing
- **Responsive**: Desktop sidebar dialog, mobile bottom-sheet with thumb-zone tab bar
- **API efficiency**: 10s fixed poll via ADS-B.fi, Page Visibility pause, no credit system
- **Persistence**: Settings + map style in localStorage, `?city=IATA` URL deep links

## Environment Variables

| Variable            | Required | Description                     |
| ------------------- | -------- | ------------------------------- |
| `NEXT_PUBLIC_GA_ID` | No       | Google Analytics measurement ID |

## License

AGPL-3.0
