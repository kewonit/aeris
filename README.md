# Aeris Mercosul

Real-time 3D flight tracking focused on the Mercosul region — altitude-aware, visually stunning.

Aeris Mercosul renders live air traffic over Latin American airspaces on a premium dark-mode map. Flights are separated by altitude in true 3D: low altitudes glow cyan, high altitudes shift to gold. Select a city, and the camera glides to that airspace with spring-eased animation. Defaults to São Paulo (GRU) with 20 curated regional hubs across Brazil, Argentina, Uruguay, Paraguay, Chile, Peru and Bolivia.

[Live Demo (Vercel)](https://aeris-latam.vercel.app)

---

## 🔥 Standout Feature: Advanced 3D Rotorcraft Layer

Unlike the original fork, **Aeris Mercosul** features a fully realized 3D Helicopter layer. This isn't just a different icon—it's a complete architectural implementation:
- **Custom 3D Model**: High-fidelity MD500 Helicopter GLB model.
- **Precision Logic**: Custom `isRotorcraft` detection (Category A7).
- **Rotor-Specific Trails**: Performance-tuned raw geometry trails that skip planar smoothing, ensuring helicopter paths remain perfectly straight and realistic without the smoothing artifacts that plague fixed-wing trails.

---

## Key Features

- **3D Altitude Separation**: Real-time z-displacement based on barometric altitude.
- **Rotorcraft Layer**: Dedicated 3D models for helicopters (category A7) with performance-optimized raw geometry trails.
- **Mercosul Hubs**: Quick-jump presets for major airports in Brazil, Argentina, Chile, and more.
- **ADS-B.fi Integration**: High-fidelity live data via the `opendata.adsb.fi` API.
- **Cinematic Camera**: Smooth spring-eased transitions and automatic orbit modes.

## Stack

| Layer     | Technology                                      |
| --------- | ----------------------------------------------- |
| Framework | Next.js 16 (App Router, Turbopack)              |
| Language  | TypeScript                                      |
| Styling   | Tailwind CSS v4                                 |
| Map       | MapLibre GL JS                                  |
| WebGL     | Deck.gl 9 (IconLayer, PathLayer, ScenegraphLayer) |
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
│   └── api/flights/route.ts   ADS-B.fi server-side proxy
├── components/
│   ├── map/
│   │   ├── flight-layers.tsx  Deck.gl overlay — icons, 3D models, trails
│   │   └── camera-controller.tsx Cinematic camera management
│   └── ui/
│       ├── control-panel.tsx  Tabbed dialog — search, settings, regions
│       └── status-bar.tsx     Live connection status
├── hooks/
│   ├── use-flights.ts         ADS-B.fi polling adapter
│   └── use-trail-history.ts   Trail accumulation & smoothing logic
└── lib/
    ├── regions.ts             Curated Mercosul aviation hub presets
    └── adsbfi.ts              ADS-B.fi API client
```

## Design

- **Dark-first**: CARTO Dark Matter base map, theme-aware UI.
- **Rotorcraft Precision**: Straight-line trail segments for helicopters to reflect actual flight paths without smoothing artifacts.
- **Glassmorphism**: Premium frosted-glass UI elements with `backdrop-blur-2xl`.
- **Spring Physics**: All UI transitions and camera movements use spring easing for a premium feel.

## License

AGPL-3.0
