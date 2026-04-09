"use client";

import { useEffect, useRef, useCallback } from "react";
import type maplibregl from "maplibre-gl";
import { useMap } from "./map";

const RAINVIEWER_API = "https://api.rainviewer.com/public/weather-maps.json";
const REFRESH_INTERVAL_MS = 10 * 60_000; // 10 minutes
const SOURCE_ID = "rainviewer-radar";
const LAYER_ID = "rainviewer-radar-layer";

// RainViewer tiles are only available up to zoom level 7.
// MapLibre will over-zoom level 7 tiles for higher zoom levels.
const RAINVIEWER_MAX_ZOOM = 7;

/** Build tile URL via our server proxy (avoids CORS issues with RainViewer). */
function proxyTileUrl(timestamp: number): string {
  return `/api/weather-tiles?ts=${timestamp}&z={z}&x={x}&y={y}`;
}

type RainViewerFrame = { time: number; path: string };
type RainViewerResponse = {
  host: string;
  radar: { past: RainViewerFrame[] };
};

type WeatherRadarLayerProps = {
  visible: boolean;
  opacity: number;
};

/** Add the radar raster source and layer to the map. */
function addSourceAndLayer(
  map: maplibregl.Map,
  tileUrl: string,
  visible: boolean,
  opacity: number,
) {
  map.addSource(SOURCE_ID, {
    type: "raster",
    tiles: [tileUrl],
    tileSize: 256,
    maxzoom: RAINVIEWER_MAX_ZOOM,
    attribution: '© <a href="https://www.rainviewer.com/">RainViewer</a>',
  });

  const layers = map.getStyle()?.layers ?? [];
  const firstSymbol = layers.find((l) => l.type === "symbol");

  map.addLayer(
    {
      id: LAYER_ID,
      type: "raster",
      source: SOURCE_ID,
      paint: {
        "raster-opacity": visible ? opacity : 0,
        "raster-fade-duration": 300,
      },
    },
    firstSymbol?.id,
  );
}

export function WeatherRadarLayer({
  visible,
  opacity,
}: WeatherRadarLayerProps) {
  const { map, isLoaded } = useMap();
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const currentTimeRef = useRef<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const updateRadarTiles = useCallback(async () => {
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

      // Bail if aborted while parsing (component unmounted)
      if (controller.signal.aborted) return;

      const latest = frames[frames.length - 1];

      // Skip if same frame already loaded AND the source still exists on the map
      const sourceExists = !!map.getSource(SOURCE_ID);
      if (currentTimeRef.current === latest.time && sourceExists) return;
      currentTimeRef.current = latest.time;

      const tileUrl = proxyTileUrl(latest.time);

      const source = map.getSource(SOURCE_ID);
      if (source && "setTiles" in source) {
        (source as { setTiles: (tiles: string[]) => void }).setTiles([tileUrl]);
      } else if (source) {
        // Source exists but lacks setTiles (unexpected type) — remove and re-add
        try {
          if (map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID);
          map.removeSource(SOURCE_ID);
        } catch {
          /* already removed */
        }
        // Fall through to re-create below
        addSourceAndLayer(map, tileUrl, visible, opacity);
      } else {
        addSourceAndLayer(map, tileUrl, visible, opacity);
      }
    } catch (err) {
      // Ignore AbortError (expected on cleanup) and network failures (retry next interval)
      if (err instanceof DOMException && err.name === "AbortError") return;
    }
  }, [map, opacity, visible]);

  // Initial fetch + periodic refresh
  useEffect(() => {
    if (!map || !isLoaded || !visible) return;

    updateRadarTiles();
    intervalRef.current = setInterval(updateRadarTiles, REFRESH_INTERVAL_MS);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      abortRef.current?.abort();
    };
  }, [map, isLoaded, visible, updateRadarTiles]);

  // Toggle visibility and opacity
  useEffect(() => {
    if (!map || !isLoaded) return;
    if (!map.getLayer(LAYER_ID)) return;

    map.setPaintProperty(LAYER_ID, "raster-opacity", visible ? opacity : 0);
  }, [map, isLoaded, visible, opacity]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (!map) return;
      try {
        if (map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID);
        if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
      } catch {
        /* map may already be removed */
      }
    };
  }, [map]);

  // Re-add source/layer after style change (MapLibre removes custom layers on style swap)
  useEffect(() => {
    if (!map || !isLoaded) return;

    const onStyleLoad = () => {
      // Only re-add if we had a valid timestamp and source was removed by style swap
      if (currentTimeRef.current && !map.getSource(SOURCE_ID) && visible) {
        const tileUrl = proxyTileUrl(currentTimeRef.current);
        addSourceAndLayer(map, tileUrl, visible, opacity);
      }
    };

    map.on("style.load", onStyleLoad);
    return () => {
      map.off("style.load", onStyleLoad);
    };
  }, [map, isLoaded, opacity, visible]);

  return null;
}
