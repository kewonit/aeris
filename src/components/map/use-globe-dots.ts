"use client";

import { useEffect, useRef, type MutableRefObject } from "react";
import maplibregl from "maplibre-gl";
import type { FlightState } from "@/lib/opensky";
import { altitudeToColor } from "@/lib/flight-utils";
import { type PickingInfo } from "@deck.gl/core";
import {
  GLOBE_FADE_ZOOM_CEIL,
  GLOBE_FADE_ZOOM_FLOOR,
  GEOJSON_THROTTLE_MS,
  GEOJSON_DEBOUNCE_MS,
} from "./flight-layer-constants";

const SOURCE_ID = "globe-aircraft-source";
const LAYER_ID = "globe-aircraft-dots";

/**
 * Custom hook that manages a native MapLibre GeoJSON circle layer for
 * rendering aircraft dots at low globe zoom levels where deck.gl accuracy
 * degrades. Returns refs used by the RAF animation loop to update data.
 */
export function useGlobeDots(
  map: maplibregl.Map | null,
  isLoaded: boolean,
  flightsRef: MutableRefObject<FlightState[]>,
  dataTimestampRef: MutableRefObject<number>,
  onClickRef: MutableRefObject<(info: PickingInfo<FlightState> | null) => void>,
) {
  const lastGeoJsonUpdateRef = useRef(0);
  const lastGeoJsonTimestampRef = useRef(0);
  const geoJsonClearedRef = useRef(false);
  const globeZoomEnteredAtRef = useRef(0);

  // Set up MapLibre source, layer, and event handlers
  useEffect(() => {
    if (!map || !isLoaded) return;

    const ensureGlobeLayers = () => {
      if (!map.getSource(SOURCE_ID)) {
        map.addSource(SOURCE_ID, {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] },
        });
      }

      if (!map.getLayer(LAYER_ID)) {
        map.addLayer({
          id: LAYER_ID,
          type: "circle",
          source: SOURCE_ID,
          paint: {
            "circle-radius": [
              "interpolate",
              ["exponential", 1.5],
              ["zoom"],
              0,
              1.5,
              3,
              2.5,
              5,
              3.5,
              GLOBE_FADE_ZOOM_CEIL,
              4.5,
            ],
            "circle-color": ["get", "color"],
            "circle-opacity": [
              "interpolate",
              ["linear"],
              ["zoom"],
              GLOBE_FADE_ZOOM_FLOOR,
              0.85,
              GLOBE_FADE_ZOOM_CEIL,
              0,
            ],
            "circle-stroke-color": "rgba(255, 255, 255, 0.45)",
            "circle-stroke-width": [
              "interpolate",
              ["linear"],
              ["zoom"],
              0,
              0.3,
              GLOBE_FADE_ZOOM_CEIL,
              0.8,
            ],
            "circle-blur": 0.15,
          },
        });
      }
    };

    ensureGlobeLayers();
    map.on("style.load", ensureGlobeLayers);

    const onDotClick = (
      e: maplibregl.MapMouseEvent & { features?: maplibregl.GeoJSONFeature[] },
    ) => {
      const icao24 = e.features?.[0]?.properties?.icao24;
      if (!icao24) return;
      const flight = flightsRef.current.find((f) => f.icao24 === icao24);
      if (flight) {
        onClickRef.current({ object: flight } as PickingInfo<FlightState>);
      }
    };
    map.on("click", LAYER_ID, onDotClick);

    const onDotEnter = () => {
      map.getCanvas().style.cursor = "pointer";
    };
    const onDotLeave = () => {
      map.getCanvas().style.cursor = "";
    };
    map.on("mouseenter", LAYER_ID, onDotEnter);
    map.on("mouseleave", LAYER_ID, onDotLeave);

    return () => {
      map.off("style.load", ensureGlobeLayers);
      map.off("click", LAYER_ID, onDotClick);
      map.off("mouseenter", LAYER_ID, onDotEnter);
      map.off("mouseleave", LAYER_ID, onDotLeave);
      try {
        if (map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID);
        if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
      } catch {
        /* map already removed */
      }
    };
  }, [map, isLoaded, flightsRef, onClickRef]);

  /**
   * Called from the RAF animation loop. Updates (or clears) the GeoJSON
   * source based on current zoom level and globe mode.
   */
  function updateGlobeDots(isGlobe: boolean, currentZoom: number, now: number) {
    if (!map) return;

    if (isGlobe) {
      if (currentZoom < GLOBE_FADE_ZOOM_CEIL) {
        if (globeZoomEnteredAtRef.current === 0) {
          globeZoomEnteredAtRef.current = now;
        }
        const stableMs = now - globeZoomEnteredAtRef.current;

        if (stableMs >= GEOJSON_DEBOUNCE_MS) {
          const dataChanged =
            dataTimestampRef.current !== lastGeoJsonTimestampRef.current;
          const throttleExpired =
            now - lastGeoJsonUpdateRef.current > GEOJSON_THROTTLE_MS;

          if (dataChanged || throttleExpired) {
            const src = map.getSource(SOURCE_ID) as
              | maplibregl.GeoJSONSource
              | undefined;
            if (src) {
              const features = flightsRef.current
                .filter((f) => f.longitude != null && f.latitude != null)
                .map((f) => ({
                  type: "Feature" as const,
                  geometry: {
                    type: "Point" as const,
                    coordinates: [f.longitude!, f.latitude!],
                  },
                  properties: {
                    icao24: f.icao24,
                    color: (() => {
                      const c = altitudeToColor(f.baroAltitude);
                      return `rgb(${c[0]},${c[1]},${c[2]})`;
                    })(),
                  },
                }));
              src.setData({ type: "FeatureCollection", features });
              lastGeoJsonUpdateRef.current = now;
              lastGeoJsonTimestampRef.current = dataTimestampRef.current;
              geoJsonClearedRef.current = false;
            }
          }
        }
      } else {
        globeZoomEnteredAtRef.current = 0;
        if (!geoJsonClearedRef.current) {
          const src = map.getSource(SOURCE_ID) as
            | maplibregl.GeoJSONSource
            | undefined;
          if (src) {
            src.setData({ type: "FeatureCollection", features: [] });
            geoJsonClearedRef.current = true;
          }
        }
      }
    } else if (!geoJsonClearedRef.current) {
      const src = map.getSource(SOURCE_ID) as
        | maplibregl.GeoJSONSource
        | undefined;
      if (src) {
        src.setData({ type: "FeatureCollection", features: [] });
        geoJsonClearedRef.current = true;
      }
    }
  }

  return { updateGlobeDots };
}
