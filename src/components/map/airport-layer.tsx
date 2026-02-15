"use client";

import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import { useMap } from "./map";
import { AIRPORTS, airportToCity } from "@/lib/airports";
import { CITIES, type City } from "@/lib/cities";

const SOURCE_ID = "airport-markers";
const DOTS_LAYER = "airport-dots";

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
  const markerRef = useRef<maplibregl.Marker | null>(null);
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
      ? "rgba(167,243,208,0.28)"
      : "rgba(15,118,110,0.22)";

    function addSourceAndLayers() {
      if (m.getSource(SOURCE_ID)) return;

      m.addSource(SOURCE_ID, { type: "geojson", data: airportGeoJson });

      m.addLayer({
        id: DOTS_LAYER,
        type: "circle",
        source: SOURCE_ID,
        paint: {
          "circle-radius": [
            "step",
            ["zoom"],
            0.55,
            6,
            0.8,
            10,
            1.05,
            14,
            1.35,
          ],
          "circle-color": dotColor,
          "circle-opacity": [
            "interpolate",
            ["linear"],
            ["zoom"],
            2,
            0.14,
            8,
            0.22,
            14,
            0.34,
          ],
          "circle-stroke-width": 0,
        },
      });
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

    m.on("mouseenter", DOTS_LAYER, onMouseEnter);
    m.on("mouseleave", DOTS_LAYER, onMouseLeave);
    m.on("click", DOTS_LAYER, onClick);

    return () => {
      m.off("style.load", addSourceAndLayers);
      m.off("mouseenter", DOTS_LAYER, onMouseEnter);
      m.off("mouseleave", DOTS_LAYER, onMouseLeave);
      m.off("click", DOTS_LAYER, onClick);
      popup.remove();
      try {
        if (m.getLayer(DOTS_LAYER)) m.removeLayer(DOTS_LAYER);
        if (m.getSource(SOURCE_ID)) m.removeSource(SOURCE_ID);
      } catch {
        /* already cleaned up */
      }
    };
  }, [map, isLoaded, isDark]);

  useEffect(() => {
    if (!map || !isLoaded) return;
    injectCSS();

    const el = document.createElement("div");
    el.className = "airport-beacon";
    el.innerHTML =
      '<div class="airport-beacon-ring"></div>' +
      '<div class="airport-beacon-ring"></div>' +
      '<div class="airport-beacon-ring"></div>' +
      '<div class="airport-beacon-core"></div>';
    if (!isValidCoordinates(activeCity.coordinates)) return;

    const marker = new maplibregl.Marker({ element: el })
      .setLngLat(activeCity.coordinates)
      .addTo(map);
    markerRef.current = marker;

    return () => {
      marker.remove();
      markerRef.current = null;
    };
  }, [map, isLoaded, activeCity]);

  return null;
}
