"use client";

import { memo } from "react";
import { X } from "lucide-react";
import { useRouteInfo } from "@/hooks/use-route-info";
import { useSettings } from "@/hooks/use-settings";
import { describeFlightStatus } from "@/lib/flight-status";
import { formatAircraftIdentity } from "@/lib/aircraft-sidebar";
import type { FlightState } from "@/lib/opensky";
import { formatAltitude } from "@/lib/unit-formatters";

/**
 * Stays on screen while the camera rides with an aircraft whose card is
 * closed: who is being followed and how long until it lands, a tap to open
 * its card again, and a way to stop.
 */
export const FollowChip = memo(function FollowChip({
  flight,
  onOpen,
  onStop,
}: {
  flight: FlightState;
  onOpen: () => void;
  onStop: () => void;
}) {
  const { settings } = useSettings();
  const route = useRouteInfo(flight);
  const status = describeFlightStatus({
    flight,
    route: route.available
      ? {
          origin: route.origin,
          destination: route.destination,
          mismatch: route.mismatch,
        }
      : null,
    units: settings.unitSystem,
  });
  const identity = formatAircraftIdentity(flight, { registration: flight.registration ?? null });
  const detail = status.timing ?? formatAltitude(flight.baroAltitude, settings.unitSystem);

  return (
    <div
      role="status"
      className="aeris-pop flex h-11 items-center aeris-float rounded-full pl-1"
    >
      <button
        type="button"
        onClick={onOpen}
        className="flex h-11 min-w-0 items-center gap-2 rounded-full pr-1 pl-3 text-small text-muted-foreground"
        aria-label={`Following ${identity}. Open its card`}
      >
        <span className="size-2 shrink-0 rounded-full bg-tint" aria-hidden="true" />
        <span className="truncate">
          Following <span className="text-foreground">{identity}</span>
          {detail !== "-" && <span className="text-subtle"> · {detail}</span>}
        </span>
      </button>
      <button
        type="button"
        onClick={onStop}
        className="grid size-11 shrink-0 place-items-center rounded-full text-subtle transition-colors hover:text-foreground"
        aria-label="Stop following"
        aria-keyshortcuts="Escape"
      >
        <X className="size-4" aria-hidden="true" />
      </button>
    </div>
  );
});
