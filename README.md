# Aeris Mercosul

Real-time 3D flight tracking focused on the Mercosul region — altitude-aware, visually stunning.

Aeris Mercosul renders live air traffic over Latin American airspaces on a premium dark-mode map. Flights are separated by altitude in true 3D: low altitudes glow cyan, high altitudes shift to gold.

[Live Demo (Vercel)](https://aeris-latam.vercel.app)

---

## 🚁 THE SHOWPIECE: Full 3D Rotorcraft Implementation

**Aeris Mercosul** breaks away from the original project by implementing a state-of-the-art 3D Helicopter layer that the original creator couldn't pull off. This is a complete architectural breakthrough:

- **True 3D Modeling**: Scenegraph-based rendering of high-fidelity MD500 Helicopter models.
- **Rotorcraft Intelligence**: Automatic detection of Category A7 aircraft with dedicated rendering pipelines.
- **Ultra-Sharp Trails**: Specialized raw geometry trails designed specifically for helicopter maneuvers. By skipping fixed-wing planar smoothing, we achieved perfectly straight, artifact-free paths—showing the exact flight geometry without the "kinks" or loops common in other implementations.

---

## 🗺️ Roadmap

- [x] **ADS-B.fi Integration**: High-fidelity live data with no credit limits.
- [x] **3D Helicopter Layer**: Real-time rotorcraft tracking with custom GLB models.
- [ ] **Weather Overlays**: Real-time METAR/TAF visualization on the 3D map.
- [ ] **Multi-Model Support**: Dedicated 3D models for different aircraft types (Jumbo, Piper, etc.).
- [ ] **Flight History**: Playback of historical flight data for regional routes.
- [ ] **Mobile Optimization**: Progressive Web App (PWA) support for mobile flight tracking.
- [ ] **Alert System**: Custom desktop notifications for specific regional flight arrivals.

---

## Key Features

- **3D Altitude Separation**: Real-time z-displacement based on barometric altitude.
- **Mercosul Hubs**: Quick-jump presets for 20+ major airports in Brazil, Argentina, Chile, and more.
- **Cinematic Camera**: Smooth spring-eased transitions and automatic orbit modes.
- **Glassmorphism UI**: Premium frosted-glass interface designed for the dark-mode aesthetic.

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

## License

AGPL-3.0
