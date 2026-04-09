"use client";

import { useEffect, useRef, useCallback } from "react";
import { useMap } from "./map";

// ── OpenAIP Airspace Tile Overlay ──────────────────────────────────────
//
// Adds OpenAIP's pre-styled airspace raster tiles as a MapLibre layer.
// Tiles are fetched through /api/airspace-tiles to keep the API key
// server-side.  The layer is inserted below symbol layers so labels
// remain readable.
//
// MEMORY OPTIMISATION: When airspace is hidden the entire source is
// removed (not just set to `visibility: none`).  This releases all
// decoded tile ArrayBuffers from GPU memory — each 256×256 PNG tile
// occupies ~262 KB decoded, and 100+ cached tiles can easily add
// 26+ MB per source.  The proxy sets Cache-Control: immutable so
// the browser disk-cache serves tiles instantly when re-enabled.
//
// Data: openaip.net (CC BY-NC 4.0)
// Tiles update daily; cached 24h by the proxy.
// ────────────────────────────────────────────────────────────────────────

const SOURCE_ID = "openaip-airspace-tiles";
const LAYER_ID = "openaip-airspace-layer";

const AIRSPACE_CONTRAST = 0.3;
const AIRSPACE_SATURATION = 0.2;
const AIRSPACE_BRIGHTNESS_MIN = 0.08;
const AIRSPACE_MIN_ZOOM = 4;
const AIRSPACE_MAX_ZOOM = 14;

const HOTSPOT_SOURCE_ID = "openaip-hotspot-tiles";
const HOTSPOT_LAYER_ID = "openaip-hotspot-layer";
const HOTSPOT_OPACITY = 0.7;

type AirspaceLayerProps = {
  visible: boolean;
  opacity: number;
  showHotspots: boolean;
};

export function AirspaceLayer({
  visible,
  opacity,
  showHotspots,
}: AirspaceLayerProps) {
  const { map, isLoaded } = useMap();

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // ── Helpers ────────────────────────────────────────────────────────

  /** Remove airspace + hotspot layers/sources if they exist. */
  const removeSources = useCallback(() => {
    if (!map) return;
    try {
      if (map.getLayer(HOTSPOT_LAYER_ID)) map.removeLayer(HOTSPOT_LAYER_ID);
      if (map.getSource(HOTSPOT_SOURCE_ID)) map.removeSource(HOTSPOT_SOURCE_ID);
      if (map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID);
      if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
    } catch {
      /* map may already be destroyed */
    }
  }, [map]);

  /** Add airspace + hotspot sources and layers. */
  const addSources = useCallback(
    (nextOpacity: number, nextShowHotspots: boolean) => {
      if (!map || !mountedRef.current) return;
      if (map.getSource(SOURCE_ID)) return; // already added

      map.addSource(SOURCE_ID, {
        type: "raster",
        tiles: ["/api/airspace-tiles?z={z}&x={x}&y={y}"],
        tileSize: 256,
        minzoom: AIRSPACE_MIN_ZOOM,
        maxzoom: AIRSPACE_MAX_ZOOM,
        attribution:
          '&copy; <a href="https://www.openaip.net" target="_blank">OpenAIP</a>',
      });

      // Insert below the first symbol layer so airspace doesn't occlude
      // map labels, airport markers, or other overlay text.
      const layers = map.getStyle()?.layers ?? [];
      let beforeId: string | undefined;
      for (const layer of layers) {
        if (layer.type === "symbol") {
          beforeId = layer.id;
          break;
        }
      }

      map.addLayer(
        {
          id: LAYER_ID,
          type: "raster",
          source: SOURCE_ID,
          minzoom: AIRSPACE_MIN_ZOOM,
          paint: {
            "raster-opacity": nextOpacity,
            "raster-contrast": AIRSPACE_CONTRAST,
            "raster-saturation": AIRSPACE_SATURATION,
            "raster-brightness-min": AIRSPACE_BRIGHTNESS_MIN,
            "raster-fade-duration": 200,
          },
        },
        beforeId,
      );

      // ── Hotspots layer (thermal/glider activity) ────────────────────
      if (!map.getSource(HOTSPOT_SOURCE_ID)) {
        map.addSource(HOTSPOT_SOURCE_ID, {
          type: "raster",
          tiles: ["/api/airspace-tiles?layer=hotspots&z={z}&x={x}&y={y}"],
          tileSize: 256,
          minzoom: AIRSPACE_MIN_ZOOM,
          maxzoom: AIRSPACE_MAX_ZOOM,
          attribution:
            '&copy; <a href="https://www.openaip.net" target="_blank">OpenAIP</a>',
        });
      }

      map.addLayer(
        {
          id: HOTSPOT_LAYER_ID,
          type: "raster",
          source: HOTSPOT_SOURCE_ID,
          minzoom: AIRSPACE_MIN_ZOOM,
          paint: {
            "raster-opacity": HOTSPOT_OPACITY,
            "raster-fade-duration": 200,
          },
          layout: {
            visibility: nextShowHotspots ? "visible" : "none",
          },
        },
        beforeId,
      );
    },
    [map],
  );

  // ── Add/remove sources based on visibility ─────────────────────────
  // When hidden → remove sources entirely to free tile ArrayBuffers.
  // When shown  → re-add (browser HTTP cache makes this instant).
  useEffect(() => {
    if (!map || !isLoaded) return;

    const onStyleLoad = () => {
      // After style swap, re-add only if currently visible
      if (visible) addSources(opacity, showHotspots);
    };
    map.on("style.load", onStyleLoad);

    // Initial add (if visible and style already loaded)
    if (visible && map.isStyleLoaded()) {
      addSources(opacity, showHotspots);
    } else if (!visible) {
      removeSources();
    }

    return () => {
      map.off("style.load", onStyleLoad);
      removeSources();
    };
  }, [
    map,
    isLoaded,
    addSources,
    opacity,
    removeSources,
    showHotspots,
    visible,
  ]);

  // ── Toggle hotspot layer visibility ────────────────────────────────
  useEffect(() => {
    if (!map || !isLoaded || !visible) return;
    try {
      if (map.getLayer(HOTSPOT_LAYER_ID)) {
        map.setLayoutProperty(
          HOTSPOT_LAYER_ID,
          "visibility",
          showHotspots ? "visible" : "none",
        );
      }
    } catch {
      /* layer may not exist yet after style swap */
    }
  }, [map, isLoaded, visible, showHotspots]);

  // ── Dynamic opacity ───────────────────────────────────────────────
  useEffect(() => {
    if (!map || !isLoaded || !visible) return;
    try {
      if (map.getLayer(LAYER_ID)) {
        map.setPaintProperty(LAYER_ID, "raster-opacity", opacity);
      }
    } catch {
      /* layer may not exist yet */
    }
  }, [map, isLoaded, visible, opacity]);

  return null;
}
