"use client";

import { Locate, LocateFixed } from "lucide-react";
import { useGeolocation } from "@/components/ui/camera-controls";
import { MapButton } from "./map-button";

/** Flies the map to wherever the device is, once asked. */
export function LocateButton() {
  const { flyToMe, locating } = useGeolocation();
  return (
    <MapButton
      onClick={flyToMe}
      aria-label={locating ? "Finding you" : "Show my location"}
      title="Show my location"
      aria-busy={locating || undefined}
    >
      {locating ? (
        <LocateFixed className="size-4 animate-pulse" aria-hidden="true" />
      ) : (
        <Locate className="size-4" aria-hidden="true" />
      )}
    </MapButton>
  );
}
