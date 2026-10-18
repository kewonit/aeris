"use client";

import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import { useMap } from "./map";
import { AIRPORTS, airportToCity } from "@/lib/airports";
import { CITIES, type City } from "@/lib/cities";

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
        // Keep the generic empty-map click handler from immediately clearing
        // the airport selection opened by this delegated layer event.
        e.preventDefault();
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
