"use client";

import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import { useMap } from "./map";
import { AIRPORTS, airportToCity } from "@/lib/airports";
import { REGIONS as CITIES, type City } from "@/lib/regions";

const SOURCE_ID = "airport-markers";
const DOTS_LAYER = "airport-dots";
const HIT_LAYER = "airport-hit";
const ACTIVE_SOURCE_ID = "active-airport-marker";
const ACTIVE_RING_LAYER = "active-airport-ring";
const ACTIVE_CORE_LAYER = "active-airport-core";

type AirportLayerProps = {
  activeCity: City;
  onSelectAirport: (city: City) => void;
  isDark: boolean;
};

function isValidCoordinates(
  coordinates: readonly [number, number],
): coordinates is [number, number] {
  const [lng, lat] = coordinates;
  return (
    Number.isFinite(lng) &&
    Number.isFinite(lat) &&
    lng >= -180 &&
    lng <= 180 &&
    lat >= -90 &&
    lat <= 90
  );
}

const airportGeoJson: GeoJSON.FeatureCollection = {
  type: "FeatureCollection",
  features: AIRPORTS.filter((a) => isValidCoordinates([a.lng, a.lat])).map(
    (a) => ({
      type: "Feature" as const,
      geometry: { type: "Point" as const, coordinates: [a.lng, a.lat] },
      properties: {
        iata: a.iata,
        name: a.name,
        city: a.city,
        country: a.country,
      },
    }),
  ),
};

const LAYER_CSS = `
.airport-beacon{position:relative;width:20px;height:20px;pointer-events:none}
.airport-beacon-core{position:absolute;inset:7px;border-radius:50%;background:rgba(255,255,255,0.3);box-shadow:0 0 6px rgba(255,255,255,0.1)}
.airport-beacon-ring{position:absolute;inset:2px;border-radius:50%;border:1px solid rgba(255,255,255,0.12);animation:ab-pulse 6s ease-out infinite}
.airport-beacon-ring:nth-child(2){animation-delay:2s}
.airport-beacon-ring:nth-child(3){animation-delay:4s}
@keyframes ab-pulse{0%{transform:scale(1);opacity:0.3}100%{transform:scale(2.5);opacity:0}}
.airport-popup .maplibregl-popup-content{background:rgba(12,12,14,0.9);color:rgba(255,255,255,0.8);font:500 11px/1.4 system-ui,sans-serif;padding:5px 10px;border-radius:8px;border:1px solid rgba(255,255,255,0.06);backdrop-filter:blur(12px);box-shadow:0 4px 20px rgba(0,0,0,0.4)}
.airport-popup .maplibregl-popup-tip{border-top-color:rgba(12,12,14,0.9)}
`;

let _cssInjected = false;
function injectCSS() {
  if (_cssInjected) return;
  const el = document.createElement("style");
  el.textContent = LAYER_CSS;
  document.head.appendChild(el);
  _cssInjected = true;
}

function resolveCity(iata: string): City {
  const preset = CITIES.find((c) => c.iata === iata);
  if (preset) return preset;
  const airport = AIRPORTS.find((a) => a.iata === iata);
  if (airport) return airportToCity(airport);
  return CITIES[0];
}

export function AirportLayer({
  activeCity,
  onSelectAirport,
  isDark,
}: AirportLayerProps) {
  const { map, isLoaded } = useMap();
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const callbackRef = useRef(onSelectAirport);
  useEffect(() => {
    callbackRef.current = onSelectAirport;
  });

  useEffect(() => {
    if (!map || !isLoaded) return;
    injectCSS();
    const m = map;

    const dotColor = isDark
      ? "rgba(188,248,221,0.68)"
      : "rgba(15,118,110,0.62)";

    function addSourceAndLayers() {
      if (m.getSource(SOURCE_ID)) return;

      m.addSource(SOURCE_ID, { type: "geojson", data: airportGeoJson });

      m.addLayer({
        id: HIT_LAYER,
        type: "circle",
        source: SOURCE_ID,
        paint: {
          "circle-radius": ["step", ["zoom"], 8, 6, 10, 10, 12, 14, 15],
          "circle-color": "rgba(255,255,255,0.01)",
          "circle-opacity": 0.01,
          "circle-pitch-alignment": "map",
          "circle-pitch-scale": "map",
        },
      });

      m.addLayer({
        id: DOTS_LAYER,
        type: "circle",
        source: SOURCE_ID,
        paint: {
          "circle-radius": ["step", ["zoom"], 1.3, 6, 1.8, 10, 2.4, 14, 3],
          "circle-color": dotColor,
          "circle-opacity": [
            "interpolate",
            ["linear"],
            ["zoom"],
            2,
            0.44,
            8,
            0.56,
            14,
            0.68,
          ],
          "circle-stroke-color": "rgba(255,255,255,0.18)",
          "circle-stroke-width": [
            "interpolate",
            ["linear"],
            ["zoom"],
            2,
            0.15,
            10,
            0.3,
            14,
            0.5,
          ],
          "circle-pitch-alignment": "map",
          "circle-pitch-scale": "map",
        },
      });

      if (!m.getSource(ACTIVE_SOURCE_ID)) {
        m.addSource(ACTIVE_SOURCE_ID, {
          type: "geojson",
          data: {
            type: "FeatureCollection",
            features: [],
          },
        });
      }

      if (!m.getLayer(ACTIVE_RING_LAYER)) {
        m.addLayer({
          id: ACTIVE_RING_LAYER,
          type: "circle",
          source: ACTIVE_SOURCE_ID,
          paint: {
            "circle-radius": [
              "interpolate",
              ["linear"],
              ["zoom"],
              2,
              4,
              8,
              6,
              14,
              9,
            ],
            "circle-color": "rgba(255,255,255,0)",
            "circle-stroke-color": "rgba(255,255,255,0.26)",
            "circle-stroke-width": 1,
            "circle-pitch-alignment": "map",
            "circle-pitch-scale": "map",
          },
        });
      }

      if (!m.getLayer(ACTIVE_CORE_LAYER)) {
        m.addLayer({
          id: ACTIVE_CORE_LAYER,
          type: "circle",
          source: ACTIVE_SOURCE_ID,
          paint: {
            "circle-radius": [
              "interpolate",
              ["linear"],
              ["zoom"],
              2,
              1.6,
              8,
              2.2,
              14,
              2.8,
            ],
            "circle-color": "rgba(255,255,255,0.62)",
            "circle-opacity": 0.95,
            "circle-pitch-alignment": "map",
            "circle-pitch-scale": "map",
          },
        });
      }
    }

    addSourceAndLayers();
    m.on("style.load", addSourceAndLayers);

    const popup = new maplibregl.Popup({
      closeButton: false,
      closeOnClick: false,
      className: "airport-popup",
      offset: 10,
    });
    popupRef.current = popup;

    function onMouseEnter(
      e: maplibregl.MapMouseEvent & {
        features?: maplibregl.MapGeoJSONFeature[];
      },
    ) {
      m.getCanvas().style.cursor = "pointer";
      const f = e.features?.[0];
      if (f?.properties) {
        const iata = String(f.properties.iata ?? "").toUpperCase();
        const city = String(f.properties.city ?? "");
        if (!iata) return;
        popup
          .setLngLat(e.lngLat)
          .setText(city ? `${iata} · ${city}` : iata)
          .addTo(m);
      }
    }

    function onMouseLeave() {
      m.getCanvas().style.cursor = "";
      popup.remove();
    }

    function onClick(
      e: maplibregl.MapMouseEvent & {
        features?: maplibregl.MapGeoJSONFeature[];
      },
    ) {
      const f = e.features?.[0];
      const iata = String(f?.properties?.iata ?? "");
      if (iata) {
        const city = resolveCity(iata);
        callbackRef.current(city);
      }
    }

    m.on("mouseenter", HIT_LAYER, onMouseEnter);
    m.on("mouseleave", HIT_LAYER, onMouseLeave);
    m.on("click", HIT_LAYER, onClick);

    return () => {
      m.off("style.load", addSourceAndLayers);
      m.off("mouseenter", HIT_LAYER, onMouseEnter);
      m.off("mouseleave", HIT_LAYER, onMouseLeave);
      m.off("click", HIT_LAYER, onClick);
      popup.remove();
      try {
        if (m.getLayer(ACTIVE_CORE_LAYER)) m.removeLayer(ACTIVE_CORE_LAYER);
        if (m.getLayer(ACTIVE_RING_LAYER)) m.removeLayer(ACTIVE_RING_LAYER);
        if (m.getSource(ACTIVE_SOURCE_ID)) m.removeSource(ACTIVE_SOURCE_ID);
        if (m.getLayer(DOTS_LAYER)) m.removeLayer(DOTS_LAYER);
        if (m.getLayer(HIT_LAYER)) m.removeLayer(HIT_LAYER);
        if (m.getSource(SOURCE_ID)) m.removeSource(SOURCE_ID);
      } catch {
        /* already cleaned up */
      }
    };
  }, [map, isLoaded, isDark]);

  useEffect(() => {
    if (!map || !isLoaded) return;
    if (!isValidCoordinates(activeCity.coordinates)) return;

    const src = map.getSource(ACTIVE_SOURCE_ID) as
      | maplibregl.GeoJSONSource
      | undefined;
    if (!src) return;

    src.setData({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: {
            type: "Point",
            coordinates: activeCity.coordinates,
          },
          properties: {},
        },
      ],
    });
  }, [map, isLoaded, activeCity]);

  return null;
}
