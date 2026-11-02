"use client";

import { useEffect, useSyncExternalStore } from "react";
import { useMap } from "@/components/map/map";
import { MapButton } from "./map-button";

/**
 * The map's bearing, in whole degrees, shared from inside the map to the
 * compass in the chrome. Only a change of a degree or more is published,
 * so the compass re-renders as little as it can while the map turns.
 */
let bearing = 0;
const listeners = new Set<() => void>();

function publish(next: number) {
  const whole = Math.round(next);
  if (whole === bearing) return;
  bearing = whole;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Lives inside the map and reports its bearing. Renders nothing. */
export function CompassBridge() {
  const { map, isLoaded } = useMap();
  useEffect(() => {
    if (!map || !isLoaded) return;
    const update = () => publish(map.getBearing());
    update();
    map.on("rotate", update);
    return () => {
      map.off("rotate", update);
    };
  }, [map, isLoaded]);
  return null;
}

/**
 * Shows which way north is while the map is turned; pressing it turns the
 * map back. With north up there is nothing to show, so it goes away.
 */
export function Compass() {
  const value = useSyncExternalStore(
    subscribe,
    () => bearing,
    () => 0,
  );
  if (Math.abs(((value + 540) % 360) - 180) < 2) return null;

  return (
    <MapButton
      onClick={() => window.dispatchEvent(new CustomEvent("aeris:north-up"))}
      aria-label="Point north"
      aria-keyshortcuts="N"
      title="Point north (N)"
      className="aeris-pop"
    >
      <svg
        viewBox="0 0 24 24"
        className="size-5"
        style={{ transform: `rotate(${-value}deg)` }}
        aria-hidden="true"
      >
        <path d="M12 3 15.5 12h-7z" className="fill-danger" />
        <path d="M12 21 8.5 12h7z" className="fill-subtle" />
      </svg>
    </MapButton>
  );
}
