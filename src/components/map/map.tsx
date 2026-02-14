"use client";

import maplibregl from "maplibre-gl";
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
import { DEFAULT_STYLE, type MapStyleSpec } from "@/lib/map-styles";

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
  isDark?: boolean;
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
    isDark = true,
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

  useEffect(() => {
    if (!containerRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: DEFAULT_STYLE.style as maplibregl.StyleSpecification | string,
      center,
      zoom,
      pitch,
      bearing,
      minZoom,
      maxZoom,
      maxPitch: 85,
      attributionControl: false,
      renderWorldCopies: false,
    });

    map.on("load", () => setIsLoaded(true));
    setMapInstance(map);

    return () => {
      map.remove();
      setIsLoaded(false);
      setMapInstance(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isDarkRef = useRef(isDark);
  isDarkRef.current = isDark;

  useEffect(() => {
    if (!mapInstance || !isLoaded) return;
    mapInstance.setStyle(mapStyle as maplibregl.StyleSpecification | string);

    const onStyleLoad = () => {
      if (typeof mapStyle === "object" && "terrain" in mapStyle) {
        const spec = mapStyle as Record<string, unknown>;
        try {
          mapInstance.setTerrain(
            spec.terrain as maplibregl.TerrainSpecification,
          );
        } catch {
          /* terrain source not yet loaded */
        }
      } else {
        try {
          mapInstance.setTerrain(null);
        } catch {
          /* no terrain to remove */
        }
      }

      addAerowayLayers(mapInstance, isDarkRef.current);
    };
    mapInstance.once("style.load", onStyleLoad);

    return () => {
      mapInstance.off("style.load", onStyleLoad);
    };
  }, [mapInstance, isLoaded, mapStyle]);

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
