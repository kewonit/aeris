"use client";

import { useEffect, useRef, type MutableRefObject } from "react";
import maplibregl from "maplibre-gl";
import type { FlightState } from "@/lib/opensky";
import { altitudeToColor } from "@/lib/flight-utils";
import { type PickingInfo } from "@deck.gl/core";
import type { TrailEntry } from "@/hooks/use-trail-history";
import {
  densifyGreatCircle2D,
  splitAtAntimeridian,
  unwrapLngPath,
} from "@/lib/geo";
import {
  GLOBE_NATIVE_ZOOM_CEIL,
  GLOBE_SWITCH_ZOOM,
  GEOJSON_THROTTLE_MS,
  GEOJSON_DEBOUNCE_MS,
} from "./flight-layer-constants";

const SOURCE_ID = "globe-aircraft-source";
const LAYER_ID = "globe-aircraft-dots";
const TRAIL_SOURCE_ID = "globe-trail-source";
const TRAIL_LAYER_ID = "globe-trail-lines";

/**
 * Custom hook that manages native MapLibre GeoJSON circle + line layers for
 * rendering aircraft dots AND trail lines at low globe zoom levels where
 * deck.gl accuracy degrades. Native MapLibre layers follow the globe
 * curvature perfectly and handle antimeridian crossings automatically.
 */
export function useGlobeDots(
  map: maplibregl.Map | null,
  isLoaded: boolean,
  flightsRef: MutableRefObject<FlightState[]>,
  trailsRef: MutableRefObject<TrailEntry[]>,
  dataTimestampRef: MutableRefObject<number>,
  onClickRef: MutableRefObject<(info: PickingInfo<FlightState> | null) => void>,
  showTrailsRef: MutableRefObject<boolean>,
) {
  const lastGeoJsonUpdateRef = useRef(0);
  const lastGeoJsonTimestampRef = useRef(0);
  const geoJsonClearedRef = useRef(false);
  const globeZoomEnteredAtRef = useRef(0);

  // Set up MapLibre source, layer, and event handlers
  useEffect(() => {
    if (!map || !isLoaded) return;

    const ensureGlobeLayers = () => {
      // ── Aircraft dots ──
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
              ["interpolate", ["linear"], ["get", "alt_norm"], 0, 1.2, 1, 2.0],
              2,
              ["interpolate", ["linear"], ["get", "alt_norm"], 0, 1.8, 1, 2.8],
              GLOBE_NATIVE_ZOOM_CEIL,
              ["interpolate", ["linear"], ["get", "alt_norm"], 0, 3.0, 1, 5.0],
            ],
            "circle-color": ["get", "color"],
            "circle-opacity": [
              "interpolate",
              ["linear"],
              ["zoom"],
              GLOBE_SWITCH_ZOOM - 0.05,
              0.9,
              GLOBE_SWITCH_ZOOM,
              0,
            ],
            "circle-stroke-color": "rgba(255, 255, 255, 0.5)",
            "circle-stroke-width": [
              "interpolate",
              ["linear"],
              ["zoom"],
              0,
              0.3,
              GLOBE_SWITCH_ZOOM,
              0.8,
            ],
            "circle-blur": 0.1,
          },
        });
      }

      // ── Trail lines ──
      if (!map.getSource(TRAIL_SOURCE_ID)) {
        map.addSource(TRAIL_SOURCE_ID, {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] },
        });
      }

      if (!map.getLayer(TRAIL_LAYER_ID)) {
        map.addLayer(
          {
            id: TRAIL_LAYER_ID,
            type: "line",
            source: TRAIL_SOURCE_ID,
            paint: {
              "line-color": ["get", "color"],
              "line-width": [
                "interpolate",
                ["linear"],
                ["zoom"],
                0,
                0.8,
                2,
                1.2,
                GLOBE_NATIVE_ZOOM_CEIL,
                1.8,
              ],
              "line-opacity": [
                "interpolate",
                ["linear"],
                ["zoom"],
                GLOBE_SWITCH_ZOOM - 0.05,
                0.65,
                GLOBE_SWITCH_ZOOM,
                0,
              ],
            },
            layout: {
              "line-cap": "round",
              "line-join": "round",
            },
          },
          LAYER_ID, // render trails below dots
        );
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
        if (map.getLayer(TRAIL_LAYER_ID)) map.removeLayer(TRAIL_LAYER_ID);
        if (map.getSource(TRAIL_SOURCE_ID)) map.removeSource(TRAIL_SOURCE_ID);
        if (map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID);
        if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
      } catch {
        /* map already removed */
      }
    };
  }, [map, isLoaded, flightsRef, onClickRef]);

  /**
   * Called from the RAF animation loop. Updates (or clears) both the dot
   * GeoJSON source and the trail line GeoJSON source based on current
   * zoom level and globe mode.
   */
  function updateGlobeDots(isGlobe: boolean, currentZoom: number, now: number) {
    if (!map) return;

    const MAX_ALTITUDE_METERS = 13000;

    // Hide layers unless globe mode AND below switch zoom
    const dotsVisible = isGlobe && currentZoom < GLOBE_NATIVE_ZOOM_CEIL;
    try {
      if (map.getLayer(LAYER_ID)) {
        map.setLayoutProperty(
          LAYER_ID,
          "visibility",
          dotsVisible ? "visible" : "none",
        );
      }
      if (map.getLayer(TRAIL_LAYER_ID)) {
        map.setLayoutProperty(
          TRAIL_LAYER_ID,
          "visibility",
          dotsVisible ? "visible" : "none",
        );
      }
    } catch {
      /* layer may not exist yet */
    }

    if (isGlobe) {
      if (currentZoom < GLOBE_NATIVE_ZOOM_CEIL) {
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
            // ── Update aircraft dots ──
            const dotSrc = map.getSource(SOURCE_ID) as
              | maplibregl.GeoJSONSource
              | undefined;
            if (dotSrc) {
              const flights = flightsRef.current;
              const features = [];
              for (const f of flights) {
                if (
                  f.longitude == null ||
                  f.latitude == null ||
                  !Number.isFinite(f.longitude) ||
                  !Number.isFinite(f.latitude)
                )
                  continue;
                const c = altitudeToColor(f.baroAltitude);
                const altNorm = Math.min(
                  1,
                  Math.max(0, (f.baroAltitude ?? 0) / MAX_ALTITUDE_METERS),
                );
                features.push({
                  type: "Feature" as const,
                  geometry: {
                    type: "Point" as const,
                    coordinates: [f.longitude, f.latitude],
                  },
                  properties: {
                    icao24: f.icao24,
                    color: `rgb(${c[0]},${c[1]},${c[2]})`,
                    alt_norm: altNorm,
                  },
                });
              }
              dotSrc.setData({ type: "FeatureCollection", features });
            }

            // ── Update trail lines ──
            const trailSrc = map.getSource(TRAIL_SOURCE_ID) as
              | maplibregl.GeoJSONSource
              | undefined;
            if (trailSrc) {
              // Respect the showTrails user setting
              if (!showTrailsRef.current) {
                trailSrc.setData({ type: "FeatureCollection", features: [] });
              } else {
                const trails = trailsRef.current;
                const trailFeatures: GeoJSON.Feature[] = [];

                for (const trail of trails) {
                  if (trail.path.length < 2) continue;

                  // Get the trail color from the most recent altitude
                  const lastAlt =
                    trail.baroAltitude ??
                    trail.altitudes[trail.altitudes.length - 1] ??
                    0;
                  const c = altitudeToColor(lastAlt);
                  const color = `rgba(${c[0]},${c[1]},${c[2]},0.7)`;

                  // Limit to last N points for performance at globe zoom
                  const maxPts = 60;
                  const rawPath =
                    trail.path.length > maxPts
                      ? trail.path.slice(trail.path.length - maxPts)
                      : trail.path;

                  // Unwrap longitudes for continuity
                  const unwrapped = unwrapLngPath(rawPath);

                  // Densify along great-circle arcs so trails curve
                  // properly on the globe (segments > 0.3° get subdivided)
                  const densified = densifyGreatCircle2D(unwrapped, 0.3, 16);

                  // Normalize longitudes back to [-180, 180] range
                  const normalized: [number, number][] = densified.map(
                    ([lng, lat]) => {
                      let normLng = lng;
                      while (normLng > 180) normLng -= 360;
                      while (normLng < -180) normLng += 360;
                      return [normLng, lat];
                    },
                  );

                  // Split at antimeridian crossings for MapLibre
                  const segments = splitAtAntimeridian(normalized);

                  for (const seg of segments) {
                    if (seg.length < 2) continue;
                    trailFeatures.push({
                      type: "Feature",
                      geometry: {
                        type: "LineString",
                        coordinates: seg,
                      },
                      properties: { color, icao24: trail.icao24 },
                    });
                  }
                }

                trailSrc.setData({
                  type: "FeatureCollection",
                  features: trailFeatures,
                });
              } // end showTrails check
            }

            lastGeoJsonUpdateRef.current = now;
            lastGeoJsonTimestampRef.current = dataTimestampRef.current;
            geoJsonClearedRef.current = false;
          }
        }
      } else {
        globeZoomEnteredAtRef.current = 0;
        if (!geoJsonClearedRef.current) {
          clearNativeSources();
        }
      }
    } else if (!geoJsonClearedRef.current) {
      clearNativeSources();
    }
  }

  function clearNativeSources() {
    if (!map) return;
    try {
      const dotSrc = map.getSource(SOURCE_ID) as
        | maplibregl.GeoJSONSource
        | undefined;
      if (dotSrc) {
        dotSrc.setData({ type: "FeatureCollection", features: [] });
      }
      const trailSrc = map.getSource(TRAIL_SOURCE_ID) as
        | maplibregl.GeoJSONSource
        | undefined;
      if (trailSrc) {
        trailSrc.setData({ type: "FeatureCollection", features: [] });
      }
      geoJsonClearedRef.current = true;
    } catch {
      /* source may be removed */
    }
  }

  return { updateGlobeDots };
}
