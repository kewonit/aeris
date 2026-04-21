"use client";

import { useEffect, useRef, useCallback } from "react";
import type maplibregl from "maplibre-gl";
import { useMap } from "./map";
import {
  airspaceBoundsKey,
  type AirspaceBounds,
  type CancellationToken,
} from "@/lib/airspace-style";

const RAINVIEWER_API = "https://api.rainviewer.com/public/weather-maps.json";
const REFRESH_INTERVAL_MS = 10 * 60_000; // 10 minutes
const SOURCE_ID = "rainviewer-radar";
const LAYER_ID = "rainviewer-radar-layer";

// RainViewer tiles are only available up to zoom level 7.
// MapLibre will over-zoom level 7 tiles for higher zoom levels.
const RAINVIEWER_MAX_ZOOM = 7;

/**
 * Build tile URL via our server proxy. Absolute URL is required because
 * MapLibre resolves tile URLs inside a Web Worker where relative paths
 * can't be parsed into Requests.
 */
function proxyTileUrl(timestamp: number): string {
  const base = typeof window !== "undefined" ? window.location.origin : "";
  return `${base}/api/weather-tiles?ts=${timestamp}&z={z}&x={x}&y={y}`;
}

type RainViewerFrame = { time: number; path: string };
type RainViewerResponse = {
  host: string;
  radar: { past: RainViewerFrame[] };
};

type WeatherRadarLayerProps = {
  visible: boolean;
  opacity: number;
  /**
   * Optional bounding box `[west, south, east, north]` that restricts
   * tile fetches to the active city's vicinity. `null` disables the
   * restriction.
   */
  bounds?: AirspaceBounds | null;
};

/** Add the radar raster source and layer to the map. */
function addSourceAndLayer(
  map: maplibregl.Map,
  tileUrl: string,
  visible: boolean,
  opacity: number,
  bounds: AirspaceBounds | null,
) {
  if (map.getSource(SOURCE_ID)) return;
  try {
    map.addSource(SOURCE_ID, {
      type: "raster",
      tiles: [tileUrl],
      tileSize: 256,
      maxzoom: RAINVIEWER_MAX_ZOOM,
      ...(bounds
        ? { bounds: [...bounds] as [number, number, number, number] }
        : {}),
      attribution: '© <a href="https://www.rainviewer.com/">RainViewer</a>',
    });
  } catch {
    return;
  }

  const layers = map.getStyle()?.layers ?? [];
  const firstSymbol = layers.find((l) => l.type === "symbol");

  if (map.getLayer(LAYER_ID)) return;
  try {
    map.addLayer(
      {
        id: LAYER_ID,
        type: "raster",
        source: SOURCE_ID,
        paint: {
          "raster-opacity": visible ? opacity : 0,
          "raster-fade-duration": 300,
          // RainViewer encodes precipitation as discrete intensity bins;
          // bilinear interpolation turns them into a blurry smear when
          // MapLibre over-zooms the z≤7 tiles. Nearest preserves the
          // crisp pixel blocks you expect from a radar product.
          "raster-resampling": "nearest",
        },
      },
      firstSymbol?.id,
    );
  } catch {
    /* style swap raced with add — bail */
  }
}

/** Remove the radar source and layer if present. Safe on a destroyed map. */
function removeRadarFromMap(map: maplibregl.Map) {
  try {
    if (map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID);
    if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
  } catch {
    /* already gone */
  }
}

/**
 * Type guard for raster sources that expose `setTiles`. MapLibre's
 * RasterTileSource has it, but the union type from `getSource()`
 * doesn't surface it directly.
 */
type SourceWithSetTiles = { setTiles: (tiles: string[]) => void };
function hasSetTiles(
  source: ReturnType<maplibregl.Map["getSource"]>,
): source is ReturnType<maplibregl.Map["getSource"]> & SourceWithSetTiles {
  return (
    !!source &&
    typeof (source as Partial<SourceWithSetTiles>).setTiles === "function"
  );
}

export function WeatherRadarLayer({
  visible,
  opacity,
  bounds = null,
}: WeatherRadarLayerProps) {
  const { map, isLoaded } = useMap();
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const currentTimeRef = useRef<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Bounds, opacity, and visible go through refs so the async
  // updateRadarTiles callback can read the latest values without
  // forcing the lifecycle effect to re-run (and tear down + rebuild
  // the source) on every slider tick.
  const boundsRef = useRef<AirspaceBounds | null>(bounds);
  const opacityRef = useRef(opacity);
  const visibleRef = useRef(visible);
  useEffect(() => {
    boundsRef.current = bounds;
  }, [bounds]);
  useEffect(() => {
    opacityRef.current = opacity;
  }, [opacity]);
  useEffect(() => {
    visibleRef.current = visible;
  }, [visible]);
  const boundsKey = airspaceBoundsKey(bounds);

  const updateRadarTiles = useCallback(
    async (cancelled?: CancellationToken) => {
      if (!map) return;

      // Abort any previous in-flight fetch
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const res = await fetch(RAINVIEWER_API, { signal: controller.signal });
        if (!res.ok) return;
        const data: RainViewerResponse = await res.json();
        const frames = data.radar?.past;
        if (!frames || frames.length === 0) return;

        // Bail if aborted while parsing or the caller cancelled.
        if (controller.signal.aborted || cancelled?.current) return;

        const latest = frames[frames.length - 1];
        const tileUrl = proxyTileUrl(latest.time);

        // Skip if same frame already loaded AND the source still exists.
        const source = map.getSource(SOURCE_ID);
        if (source && currentTimeRef.current === latest.time) return;

        if (source && hasSetTiles(source)) {
          source.setTiles([tileUrl]);
          currentTimeRef.current = latest.time;
          return;
        }

        // No source — add it. Wait for `idle` if the style is
        // transiently busy (common right after a city tap fly-to).
        const doAdd = () => {
          if (cancelled?.current) return;
          if (!visibleRef.current) return;
          if (map.getSource(SOURCE_ID)) return;
          addSourceAndLayer(
            map,
            tileUrl,
            visibleRef.current,
            opacityRef.current,
            boundsRef.current,
          );
          currentTimeRef.current = latest.time;
        };
        if (map.isStyleLoaded()) {
          doAdd();
        } else {
          map.once("idle", doAdd);
        }
      } catch (err) {
        // Ignore AbortError (expected on cleanup) and network failures (retry next interval)
        if (err instanceof DOMException && err.name === "AbortError") return;
      }
    },
    [map],
  );

  // ── Lifecycle + bounds ────────────────────────────────────────────
  // Same architectural principle as the airspace layer: cleanup does
  // NOT eagerly remove the source. It only sets a cancellation flag
  // and clears the refresh interval. The next effect run reconciles
  // by either swapping bounds (remove+add) or no-op'ing if the
  // source is already current. The dedicated unmount effect below
  // handles final teardown.
  useEffect(() => {
    if (!map || !isLoaded) return;

    const cancelled = { current: false };

    if (!visible) {
      removeRadarFromMap(map);
      currentTimeRef.current = null;
      return () => {
        cancelled.current = true;
      };
    }

    // MapLibre vector/raster sources don't allow mutating `bounds`
    // in place, so a bounds-key change requires a full remove + add.
    // We tear down here unconditionally; `updateRadarTiles` below
    // re-creates the source with `boundsRef.current` once the next
    // RainViewer frame is fetched (or immediately, if cached).
    if (map.getSource(SOURCE_ID)) {
      removeRadarFromMap(map);
      currentTimeRef.current = null;
    }

    void updateRadarTiles(cancelled);
    intervalRef.current = setInterval(() => {
      if (!cancelled.current) void updateRadarTiles(cancelled);
    }, REFRESH_INTERVAL_MS);

    return () => {
      cancelled.current = true;
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      abortRef.current?.abort();
      // NOTE: do NOT remove source/layer here. See architectural note above.
    };
  }, [map, isLoaded, visible, boundsKey, updateRadarTiles]);

  // Toggle opacity in place when slider moves (no rebuild).
  useEffect(() => {
    if (!map || !isLoaded) return;
    if (!map.getLayer(LAYER_ID)) return;
    try {
      map.setPaintProperty(LAYER_ID, "raster-opacity", visible ? opacity : 0);
    } catch {
      /* layer raced with removal */
    }
  }, [map, isLoaded, visible, opacity]);

  // Unmount-only teardown.
  useEffect(() => {
    return () => {
      if (!map) return;
      removeRadarFromMap(map);
    };
  }, [map]);

  // Re-add source/layer after style change (MapLibre removes custom layers on style swap)
  useEffect(() => {
    if (!map || !isLoaded) return;

    const onStyleLoad = () => {
      // Only re-add if we had a valid timestamp and source was removed by style swap
      if (
        currentTimeRef.current &&
        !map.getSource(SOURCE_ID) &&
        visibleRef.current
      ) {
        const tileUrl = proxyTileUrl(currentTimeRef.current);
        addSourceAndLayer(
          map,
          tileUrl,
          visibleRef.current,
          opacityRef.current,
          boundsRef.current,
        );
      }
    };

    map.on("style.load", onStyleLoad);
    return () => {
      map.off("style.load", onStyleLoad);
    };
  }, [map, isLoaded]);

  return null;
}
