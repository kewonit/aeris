# Aeris Mercosul

Real-time 3D flight tracking focused on the Mercosul region — altitude-aware, visually stunning.

Aeris Mercosul renders live air traffic over Latin American airspaces on a premium dark-mode map. Flights are separated by altitude in true 3D: low altitudes glow cyan, high altitudes shift to gold. Select a city, and the camera glides to that airspace with spring-eased animation. Defaults to São Paulo (GRU) with 20 curated regional hubs across Brazil, Argentina, Uruguay, Paraguay, Chile, Peru and Bolivia.

[Live Demo](https://aeris-latam.vercel.app)

## Features

- **3D Altitude Separation**: Real-time z-displacement based on barometric altitude.
- **Rotorcraft Layer**: Dedicated 3D models for helicopters (category A7) with performance-optimized raw geometry trails.
- **Mercosul Hubs**: Quick-jump presets for major airports in Brazil, Argentina, Chile, and more.
- **ADS-B.fi Integration**: High-fidelity live data via the `opendata.adsb.fi` API.
- **Cinematic Camera**: Smooth spring-eased transitions and automatic orbit modes.

## Roadmap

- [x] **ADS-B.fi Integration**: High-fidelity live data via server-side proxy.
- [x] **3D Helicopter Layer**: Dedicated ScenegraphLayer rendering for rotorcraft.
- [ ] **Weather Overlays**: Real-time METAR/TAF visualization.
- [ ] **Multi-Model Support**: Specialized 3D models for various aircraft classes.
- [ ] **Flight History**: Historical playback for regional routes.
- [ ] **Mobile Optimization**: Progressive Web App (PWA) support.

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

## Design

- **Dark-first**: CARTO Dark Matter base map, theme-aware UI.
- **Rotorcraft Precision**: Straight-line trail segments for helicopters to reflect actual flight paths without smoothing artifacts.
- **Glassmorphism**: Premium frosted-glass UI elements with `backdrop-blur-2xl`.
- **Spring Physics**: All UI transitions and camera movements use spring easing for a premium feel.

## License

AGPL-3.0
