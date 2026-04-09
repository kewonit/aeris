"use client";

import { useEffect } from "react";
import { useMap } from "@/components/map/map";

export type MapViewState = {
  zoom: number;
  center: { lat: number; lng: number };
};

type MapStateTrackerProps = {
  /** Mutable ref updated on every moveend — avoids re-renders. */
  stateRef: React.MutableRefObject<MapViewState>;
  /** Optional callback fired on every moveend/zoomend event. */
  onChange?: (state: MapViewState) => void;
};

/**
 * Invisible component that sits inside <MapView> and tracks zoom + center.
 * Updates a parent-owned ref (zero re-renders) and optionally calls onChange.
 */
export function MapStateTracker({ stateRef, onChange }: MapStateTrackerProps) {
  const { map, isLoaded } = useMap();

  useEffect(() => {
    if (!map || !isLoaded) return;

    function update() {
      if (!map) return;
      const center = map.getCenter();
      const zoom = map.getZoom();
      const next: MapViewState = {
        zoom,
        center: { lat: center.lat, lng: center.lng },
      };
      stateRef.current = next;
      onChange?.(next);
    }

    // Seed initial state
    update();

    map.on("moveend", update);
    map.on("zoomend", update);

    return () => {
      map.off("moveend", update);
      map.off("zoomend", update);
    };
  }, [map, isLoaded, onChange, stateRef]);

  return null;
}
