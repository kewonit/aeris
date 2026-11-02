import type { FlightState } from "@/lib/opensky";

/**
 * The aircraft under the pointer, shared from the flight layers to the
 * hover card. Who is hovered changes rarely; where the pointer is changes
 * on every move, so the two are told apart and the card re-renders only
 * for the first.
 */
type Hover = { flight: FlightState; x: number; y: number } | null;

let current: Hover = null;
const flightListeners = new Set<() => void>();
const moveListeners = new Set<(hover: Hover) => void>();

export function publishHover(next: Hover) {
  const changed = (current?.flight.icao24 ?? null) !== (next?.flight.icao24 ?? null);
  current = next;
  if (changed) for (const listener of flightListeners) listener();
  for (const listener of moveListeners) listener(next);
}

export function getHoveredFlight(): FlightState | null {
  return current?.flight ?? null;
}

export function subscribeHoveredFlight(listener: () => void) {
  flightListeners.add(listener);
  return () => {
    flightListeners.delete(listener);
  };
}

export function subscribeHoverMoves(listener: (hover: Hover) => void) {
  moveListeners.add(listener);
  return () => {
    moveListeners.delete(listener);
  };
}
