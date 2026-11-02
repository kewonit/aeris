"use client";

import { memo, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useSettings } from "@/hooks/use-settings";
import {
  getHoveredFlight,
  subscribeHoveredFlight,
  subscribeHoverMoves,
} from "@/components/map/hover-store";
import { describeFlightStatus } from "@/lib/flight-status";
import { formatAircraftIdentity } from "@/lib/aircraft-sidebar";
import { lookupAirline } from "@/lib/airlines";
import { formatSpeed } from "@/lib/unit-formatters";

/** Resting this long on an aircraft shows its card. */
const INTENT_MS = 120;
/** After a card, neighbours show at once for this long. */
const GRACE_MS = 300;
const OFFSET_PX = 16;

const pointerFine = () =>
  typeof window !== "undefined" &&
  window.matchMedia("(hover: hover) and (pointer: fine)").matches;

/**
 * What an aircraft is doing, shown beside the pointer when it rests on
 * one, without a click. It never takes the pointer, so clicking through it
 * still selects. Touch screens have no hover, so they never see it.
 */
export const HoverCard = memo(function HoverCard({
  hiddenFor,
}: {
  /** The aircraft whose card is already open, which needs no hover. */
  hiddenFor: string | null;
}) {
  const { settings } = useSettings();
  const ref = useRef<HTMLDivElement>(null);
  const hovered = useSyncExternalStore(
    subscribeHoveredFlight,
    getHoveredFlight,
    () => null,
  );
  const [shown, setShown] = useState<string | null>(null);
  const lastShownAt = useRef(0);

  // Follow the pointer by moving the element, not by re-rendering.
  useEffect(
    () =>
      subscribeHoverMoves((hover) => {
        const el = ref.current;
        if (!el || !hover) return;
        // Beside the pointer, on whichever side has room.
        const x =
          hover.x + OFFSET_PX + el.offsetWidth > window.innerWidth
            ? hover.x - OFFSET_PX - el.offsetWidth
            : hover.x + OFFSET_PX;
        const y =
          hover.y + OFFSET_PX + el.offsetHeight > window.innerHeight
            ? hover.y - OFFSET_PX - el.offsetHeight
            : hover.y + OFFSET_PX;
        el.style.translate = `${Math.max(8, x)}px ${Math.max(8, y)}px`;
      }),
    [],
  );

  const icao24 = hovered?.icao24 ?? null;
  useEffect(() => {
    if (!icao24 || !pointerFine()) {
      if (shown) lastShownAt.current = performance.now();
      const timer = window.setTimeout(() => setShown(null), 0);
      return () => window.clearTimeout(timer);
    }
    const recent = performance.now() - lastShownAt.current < GRACE_MS;
    const timer = window.setTimeout(
      () => setShown(icao24),
      shown || recent ? 0 : INTENT_MS,
    );
    return () => window.clearTimeout(timer);
  }, [icao24, shown]);

  const flight = hovered && shown === hovered.icao24 ? hovered : null;
  const visible = flight !== null && flight.icao24 !== hiddenFor;
  const status = flight
    ? describeFlightStatus({ flight, route: null, units: settings.unitSystem })
    : null;
  const speed = flight ? formatSpeed(flight.velocity, settings.unitSystem) : "-";
  const airline = flight ? lookupAirline(flight.callsign) : null;

  return (
    <div
      ref={ref}
      aria-hidden="true"
      className={`aeris-float pointer-events-none fixed top-0 left-0 z-30 max-w-72 rounded-lg px-3 py-2 transition-opacity duration-150 ${
        visible ? "opacity-100" : "opacity-0"
      }`}
    >
      {flight && status && (
        <>
          <p className="truncate text-small text-foreground">
            {formatAircraftIdentity(flight, { registration: flight.registration ?? null })}
            <span className="text-subtle">
              {[airline, flight.typeCode].filter(Boolean).map((part) => ` · ${part}`)}
            </span>
          </p>
          <p className="truncate text-label text-muted-foreground">
            {status.headline}
            {speed !== "-" && !flight.onGround && ` · ${speed}`}
          </p>
        </>
      )}
    </div>
  );
});
