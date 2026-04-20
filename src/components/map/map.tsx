"use client";

import maplibregl, { setMaxParallelImageRequests } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import {
  createContext,
  forwardRef,
  useContext,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { cn } from "@/lib/utils";
import {
  createTerrainDemSource,
  DEFAULT_STYLE,
  DARK_TERRAIN_HILLSHADE_LAYER,
  DARK_TERRAIN_SKY,
  DARK_TERRAIN_SPEC,
  TERRAIN_DEM_SOURCE_ID,
  TERRAIN_HILLSHADE_LAYER_ID,
  type MapStyleSpec,
  type TerrainProfile,
} from "@/lib/map-styles";
import { addBuildings3DLayer } from "./buildings-3d-layer";

// Increase parallel tile requests for faster DEM + base tile loading.
// Default is 6; 16 allows terrain tiles to saturate HTTP/2 connections.
setMaxParallelImageRequests(16);

const GLOBE_MAX_PITCH = 80;

type MapContextValue = {
  map: maplibregl.Map | null;
  isLoaded: boolean;
};

const MapContext = createContext<MapContextValue | null>(null);

export function useMap() {
  const context = useContext(MapContext);
  if (!context)
    throw new Error("useMap must be used within a <Map /> provider");
  return context;
}

type MapProps = {
  children?: ReactNode;
  className?: string;
  mapStyle?: MapStyleSpec;
  terrainProfile?: TerrainProfile;
  isDark?: boolean;
  globeMode?: boolean;
  center?: [number, number];
  zoom?: number;
  pitch?: number;
  bearing?: number;
  minZoom?: number;
  maxZoom?: number;
};

export type MapRef = maplibregl.Map;

export const Map = forwardRef<MapRef, MapProps>(function Map(
  {
    children,
    className,
    mapStyle = DEFAULT_STYLE.style,
    terrainProfile = "none",
    isDark = true,
    globeMode = false,
    center = [0, 20],
    zoom = 2.5,
    pitch = 49,
    bearing = -20,
    minZoom = 2,
    maxZoom = 16,
  },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [mapInstance, setMapInstance] = useState<maplibregl.Map | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);

  useImperativeHandle(ref, () => mapInstance as maplibregl.Map, [mapInstance]);

  // Ref that allows style-load callbacks to see the latest value without re-running effects
  const isDarkRef = useRef(isDark);
  isDarkRef.current = isDark;

  // ── Map creation ──────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return;

    const safePitch = Math.min(pitch, GLOBE_MAX_PITCH);

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: DEFAULT_STYLE.style as maplibregl.StyleSpecification | string,
      center,
      zoom,
      pitch: safePitch,
      bearing,
      minZoom,
      maxZoom,
      maxPitch: GLOBE_MAX_PITCH,
      attributionControl: false,
      cancelPendingTileRequestsWhileZooming: true,
      maxTileCacheZoomLevels: 2, // fewer cached zoom levels = less GPU memory for tile textures
      renderWorldCopies: false,
      pixelRatio: 1, // render at 1x regardless of display DPI — significant GPU savings on HiDPI
      fadeDuration: 0, // disable tile/symbol fade animations — fewer intermediate render frames
    });

    map.on("load", () => setIsLoaded(true));
    setMapInstance(map);

    return () => {
      map.remove();
      setIsLoaded(false);
      setMapInstance(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Map initializes once; containerRef is stable, style/terrain/globe applied in separate effects
  }, []);

  // Inject globe projection into every style change when globe mode is on.
  // In Mercator mode, skip projection injection entirely.
  useEffect(() => {
    if (!mapInstance || !isLoaded) return;

    mapInstance.setStyle(
      mapStyle as maplibregl.StyleSpecification | string,
      {
        transformStyle: (_prev, next) => {
          const style = next as MutableStyleSpecification;

          if (globeMode) {
            style.projection = { type: "globe" };
            if (!style.sky) {
              style.sky = {
                "atmosphere-blend": [
                  "interpolate",
                  ["linear"],
                  ["zoom"],
                  0,
                  1,
                  5,
                  0,
                ],
              };
            }
          }

          if (terrainProfile === "dark" && !globeMode) {
            applyDarkTerrainStyle(style);
            style.sky = DARK_TERRAIN_SKY as Record<string, unknown>;
          }

          return style;
        },
      } as maplibregl.StyleSwapOptions & { transformStyle: unknown },
    );

    // Set projection imperatively so it takes effect immediately.
    const onStyleLoad = () => {
      mapInstance.setProjection({ type: globeMode ? "globe" : "mercator" });
      addAerowayLayers(mapInstance, isDarkRef.current);
      addBuildings3DLayer(mapInstance, { dark: isDarkRef.current });
    };

    mapInstance.once("style.load", onStyleLoad);

    return () => {
      mapInstance.off("style.load", onStyleLoad);
    };
  }, [mapInstance, isLoaded, mapStyle, terrainProfile, globeMode]);

  const ctx = useMemo(
    () => ({ map: mapInstance, isLoaded }),
    [mapInstance, isLoaded],
  );

  return (
    <MapContext.Provider value={ctx}>
      <div
        ref={containerRef}
        className={cn("relative h-full w-full", className)}
      >
        {mapInstance && children}
      </div>
    </MapContext.Provider>
  );
});

Map.displayName = "Map";

type MutableStyleSpecification = maplibregl.StyleSpecification & {
  projection?: maplibregl.ProjectionSpecification;
  sky?: Record<string, unknown>;
  sources?: Record<string, unknown>;
  layers?: maplibregl.LayerSpecification[];
  terrain?: maplibregl.TerrainSpecification;
};

function applyDarkTerrainStyle(style: MutableStyleSpecification): void {
  const sources = (style.sources ??=
    {}) as maplibregl.StyleSpecification["sources"];

  // Single DEM source shared by both terrain mesh and hillshade layer.
  // This halves tile downloads vs. having two separate sources.
  if (!sources[TERRAIN_DEM_SOURCE_ID]) {
    sources[TERRAIN_DEM_SOURCE_ID] =
      createTerrainDemSource() as maplibregl.SourceSpecification;
  }

  style.terrain = DARK_TERRAIN_SPEC as maplibregl.TerrainSpecification;

  const layers = (style.layers ??= []);
  if (!layers.some((layer) => layer.id === TERRAIN_HILLSHADE_LAYER_ID)) {
    const firstSymbolIndex = layers.findIndex(
      (layer) => layer.type === "symbol",
    );
    const insertIndex =
      firstSymbolIndex === -1 ? layers.length : firstSymbolIndex;
    layers.splice(
      insertIndex,
      0,
      DARK_TERRAIN_HILLSHADE_LAYER as maplibregl.LayerSpecification,
    );
  }
}

function findVectorSource(map: maplibregl.Map): string | null {
  const style = map.getStyle();
  if (!style?.sources) return null;
  for (const [name, source] of Object.entries(style.sources)) {
    if (
      source &&
      typeof source === "object" &&
      "type" in source &&
      source.type === "vector"
    ) {
      return name;
    }
  }
  return null;
}

function addAerowayLayers(map: maplibregl.Map, dark: boolean): void {
  const source = findVectorSource(map);
  if (!source) return;

  const runwayColor = dark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.1)";
  const taxiwayColor = dark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)";

  try {
    if (!map.getLayer("aeroway-runway")) {
      map.addLayer({
        id: "aeroway-runway",
        type: "line",
        source,
        "source-layer": "aeroway",
        filter: ["==", "class", "runway"],
        minzoom: 10,
        layout: { "line-cap": "round" },
        paint: {
          "line-color": runwayColor,
          "line-width": [
            "interpolate",
            ["exponential", 1.5],
            ["zoom"],
            10,
            1,
            14,
            30,
            18,
            100,
          ],
        },
      });
    }

    if (!map.getLayer("aeroway-taxiway")) {
      map.addLayer({
        id: "aeroway-taxiway",
        type: "line",
        source,
        "source-layer": "aeroway",
        filter: ["==", "class", "taxiway"],
        minzoom: 12,
        layout: { "line-cap": "round" },
        paint: {
          "line-color": taxiwayColor,
          "line-width": [
            "interpolate",
            ["exponential", 1.5],
            ["zoom"],
            12,
            0.5,
            14,
            6,
            18,
            20,
          ],
        },
      });
    }
  } catch {
    /* aeroway source-layer may not exist in this tileset */
  }
}
