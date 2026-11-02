"use client";

import { useReducer } from "react";
import type { FlightState } from "@/lib/opensky";

/** What the place card shows: one aircraft, one airport, or nothing. */
export type Selection =
  | { kind: "none" }
  | { kind: "aircraft"; icao24: string }
  | { kind: "airport"; iata: string };

export type SelectionState = {
  selection: Selection;
  /** The aircraft the camera rides with. It outlives its card. */
  follow: string | null;
  /** The aircraft seen from the cockpit. */
  fpv: string | null;
  /**
   * The aircraft as last seen in search or on a click, kept until the live
   * feed has it, so its card can open before the next poll.
   */
  seed: FlightState | null;
};

export type FpvEnd = "exited" | "landed" | "lost";

export type SelectionAction =
  | { type: "selectAircraft"; icao24: string; seed?: FlightState | null }
  | { type: "selectAirport"; iata: string }
  | { type: "clear" }
  | { type: "follow"; icao24: string; seed?: FlightState | null }
  | { type: "unfollow" }
  | { type: "enterFpv"; icao24: string }
  | { type: "exitFpv"; how: FpvEnd }
  | { type: "dropSeed" }
  | { type: "reset" };

export const INITIAL_SELECTION: SelectionState = {
  selection: { kind: "none" },
  follow: null,
  fpv: null,
  seed: null,
};

const NONE: Selection = { kind: "none" };

function aircraft(icao24: string): Selection {
  return { kind: "aircraft", icao24 };
}

/**
 * One place card at a time, and follow and first person never at once.
 * Picking another aircraft stops following the first; closing a card does
 * not, so the camera can keep riding along with nothing open.
 */
export function selectionReducer(
  state: SelectionState,
  action: SelectionAction,
): SelectionState {
  switch (action.type) {
    case "selectAircraft": {
      const icao24 = action.icao24.toLowerCase();
      return {
        selection: aircraft(icao24),
        follow: state.follow === icao24 ? state.follow : null,
        fpv: state.fpv,
        seed: action.seed ?? null,
      };
    }
    case "selectAirport":
      return {
        selection: { kind: "airport", iata: action.iata },
        follow: null,
        fpv: null,
        seed: null,
      };
    case "clear":
      if (state.selection.kind === "none" && !state.seed) return state;
      return { ...state, selection: NONE, seed: null };
    case "follow": {
      const icao24 = action.icao24.toLowerCase();
      return {
        selection: aircraft(icao24),
        follow: icao24,
        fpv: null,
        seed: action.seed ?? state.seed,
      };
    }
    case "unfollow":
      return state.follow ? { ...state, follow: null } : state;
    case "enterFpv": {
      const icao24 = action.icao24.toLowerCase();
      return {
        selection: aircraft(icao24),
        follow: null,
        fpv: icao24,
        seed: state.seed,
      };
    }
    case "exitFpv":
      if (!state.fpv) return state;
      return {
        selection: action.how === "exited" ? aircraft(state.fpv) : NONE,
        follow: null,
        fpv: null,
        seed: null,
      };
    case "dropSeed":
      return state.seed ? { ...state, seed: null } : state;
    case "reset":
      return INITIAL_SELECTION;
  }
}

export function selectedAircraftIcao24(state: SelectionState): string | null {
  return state.selection.kind === "aircraft" ? state.selection.icao24 : null;
}

export function selectedAirportIata(state: SelectionState): string | null {
  return state.selection.kind === "airport" ? state.selection.iata : null;
}

export function useSelection(initial: SelectionState = INITIAL_SELECTION) {
  return useReducer(selectionReducer, initial);
}
