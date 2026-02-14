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

  useEffect(() => {
    if (!mapInstance || !isLoaded) return;
    mapInstance.setStyle(mapStyle as maplibregl.StyleSpecification | string);

    // Re-apply terrain/sky after style load (MapLibre can drop these on setStyle)
    const applyTerrain = () => {
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
    };
    mapInstance.once("style.load", applyTerrain);

    return () => {
      mapInstance.off("style.load", applyTerrain);
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
