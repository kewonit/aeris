"use client";

import { useMemo } from "react";
import { useSettings } from "@/hooks/use-settings";
import type { FlightState } from "@/lib/opensky";
import type { Airport } from "@/lib/airports";
import { findByIata } from "@/lib/airports";
import { formatCallsign } from "@/lib/flight-utils";
import {
  formatAltitude,
  formatDistanceNm,
  formatSpeed,
} from "@/lib/unit-formatters";

// ── Constants ──────────────────────────────────────────────────────────

/** Maximum distance (nautical miles) from airport to include a flight. */
const BOARD_RADIUS_NM = 35;

/** Earth radius in nautical miles. */
const EARTH_RADIUS_NM = 3440.065;

/** Vertical rate threshold (m/s) to consider "climbing" or "descending". */
const VRATE_THRESHOLD = 0.5;

/** Altitude (meters) below which aircraft near airport are likely arriving/departing. */
const LOW_ALTITUDE_M = 3048; // ~10,000 ft

/** Maximum flights to show per column. */
const MAX_PER_COLUMN = 20;

// ── Types ──────────────────────────────────────────────────────────────

export type FlightDirection = "arrival" | "departure" | "overflight";

export type BoardFlight = {
  icao24: string;
  callsign: string;
  direction: FlightDirection;
  altitude: string;
  altitudeMeters: number | null;
  speed: string;
  speedMs: number | null;
  distanceNm: number;
  distanceFormatted: string;
  verticalRate: number | null;
  heading: number | null;
  bearing: number;
  typeCode: string | null;
  registration: string | null;
  /** Bearing difference between aircraft heading and bearing TO airport. */
  bearingDiff: number;
  /** Status text like "Approach", "Climbing", "Cruise", etc. */
  status: string;
  /** Raw flight reference for selection. */
  flight: FlightState;
};

export type AirportBoardData = {
  arrivals: BoardFlight[];
  departures: BoardFlight[];
  overflights: BoardFlight[];
  airport: Airport | null;
  isActive: boolean;
  totalFlights: number;
};

// ── Geometry helpers (inlined for zero deps) ───────────────────────────

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

/** Haversine distance in nautical miles. */
function distanceNm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const la1 = lat1 * DEG2RAD;
  const la2 = lat2 * DEG2RAD;
  const dLat = (lat2 - lat1) * DEG2RAD;
  const dLng = (lng2 - lng1) * DEG2RAD;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * EARTH_RADIUS_NM;
}

/**
 * Initial bearing from point A to point B (degrees, 0-360).
 * https://www.movable-type.co.uk/scripts/latlong.html
 */
function bearingFromTo(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const la1 = lat1 * DEG2RAD;
  const la2 = lat2 * DEG2RAD;
  const dLng = (lng2 - lng1) * DEG2RAD;
  const y = Math.sin(dLng) * Math.cos(la2);
  const x =
    Math.cos(la1) * Math.sin(la2) -
    Math.sin(la1) * Math.cos(la2) * Math.cos(dLng);
  return (Math.atan2(y, x) * RAD2DEG + 360) % 360;
}

/**
 * Smallest angular difference between two headings (0-180).
 */
function angleDiff(a: number, b: number): number {
  const d = Math.abs(((a - b + 540) % 360) - 180);
  return d;
}

// ── Classification logic ───────────────────────────────────────────────

function classifyFlight(
  flight: FlightState,
  airport: Airport,
): {
  direction: FlightDirection;
  dist: number;
  brng: number;
  bearingToAirport: number;
  bDiff: number;
  status: string;
} {
  const fLat = flight.latitude!;
  const fLng = flight.longitude!;
  const dist = distanceNm(airport.lat, airport.lng, fLat, fLng);

  // Bearing from airport TO aircraft
  const brng = bearingFromTo(airport.lat, airport.lng, fLat, fLng);
  // Bearing from aircraft TO airport (reverse)
  const bearingToAirport = (brng + 180) % 360;

  const heading = flight.trueTrack;
  const vRate = flight.verticalRate;
  const alt = flight.baroAltitude ?? flight.geoAltitude;

  // If no heading data, use vertical rate only
  if (heading === null || !Number.isFinite(heading)) {
    if (vRate !== null && vRate < -VRATE_THRESHOLD) {
      return {
        direction: "arrival",
        dist,
        brng,
        bearingToAirport,
        bDiff: 0,
        status: "Descending",
      };
    }
    if (vRate !== null && vRate > VRATE_THRESHOLD) {
      return {
        direction: "departure",
        dist,
        brng,
        bearingToAirport,
        bDiff: 0,
        status: "Climbing",
      };
    }
    return {
      direction: "overflight",
      dist,
      brng,
      bearingToAirport,
      bDiff: 0,
      status: "Transit",
    };
  }

  // Angular difference between aircraft heading and bearing TO airport
  const bDiff = angleDiff(heading, bearingToAirport);

  // Heading toward airport (within 90°)?
  const headingToward = bDiff < 90;
  const isDescending = vRate !== null && vRate < -VRATE_THRESHOLD;
  const isClimbing = vRate !== null && vRate > VRATE_THRESHOLD;
  const isLowAlt = alt !== null && alt < LOW_ALTITUDE_M;
  const isCloseRange = dist < 15; // within 15nm

  // ── Arrival classification ──
  // Strong: heading toward + descending
  // Medium: heading toward + low altitude + close
  // Weak: heading toward + close (regardless of vrate)
  if (headingToward && isDescending) {
    const status = isCloseRange ? "Final" : dist < 25 ? "Approach" : "Inbound";
    return {
      direction: "arrival",
      dist,
      brng,
      bearingToAirport,
      bDiff,
      status,
    };
  }
  if (headingToward && isLowAlt && isCloseRange) {
    return {
      direction: "arrival",
      dist,
      brng,
      bearingToAirport,
      bDiff,
      status: "Approach",
    };
  }
  if (headingToward && !isClimbing && isCloseRange) {
    return {
      direction: "arrival",
      dist,
      brng,
      bearingToAirport,
      bDiff,
      status: "Approach",
    };
  }

  // ── Departure classification ──
  // Strong: heading away + climbing
  // Medium: heading away + low altitude (just took off)
  // Weak: climbing + close to airport
  if (!headingToward && isClimbing) {
    const status = isCloseRange ? "Departure" : "Climbing";
    return {
      direction: "departure",
      dist,
      brng,
      bearingToAirport,
      bDiff,
      status,
    };
  }
  if (!headingToward && isLowAlt && isCloseRange) {
    return {
      direction: "departure",
      dist,
      brng,
      bearingToAirport,
      bDiff,
      status: "Departure",
    };
  }
  if (isClimbing && isCloseRange) {
    return {
      direction: "departure",
      dist,
      brng,
      bearingToAirport,
      bDiff,
      status: "Climbing",
    };
  }

  // ── Heading-only classification (no strong vrate signal) ──
  if (headingToward && dist < 25) {
    return {
      direction: "arrival",
      dist,
      brng,
      bearingToAirport,
      bDiff,
      status: "Inbound",
    };
  }
  if (!headingToward && dist < 25) {
    return {
      direction: "departure",
      dist,
      brng,
      bearingToAirport,
      bDiff,
      status: "Outbound",
    };
  }

  // ── Far-away or ambiguous → overflight ──
  return {
    direction: "overflight",
    dist,
    brng,
    bearingToAirport,
    bDiff,
    status: "Transit",
  };
}

// ── Hook ───────────────────────────────────────────────────────────────

export function useAirportBoard(
  flights: FlightState[],
  mapCenter: { lat: number; lng: number } | null,
  zoom: number,
  activeIata: string | null,
  /** When set, the board opens for this specific airport (user clicked the dot). */
  selectedAirportIata: string | null = null,
): AirportBoardData {
  const { settings } = useSettings();

  return useMemo(() => {
    const inactive: AirportBoardData = {
      arrivals: [],
      departures: [],
      overflights: [],
      airport: null,
      isActive: false,
      totalFlights: 0,
    };

    // Only show the board when user explicitly selected an airport
    if (!selectedAirportIata) {
      return inactive;
    }

    // Find the selected airport
    const airport: Airport | null = findByIata(selectedAirportIata) ?? null;

    if (!airport) return inactive;

    const arrivals: BoardFlight[] = [];
    const departures: BoardFlight[] = [];
    const overflights: BoardFlight[] = [];

    for (const f of flights) {
      // Skip flights without position
      if (f.latitude == null || f.longitude == null) continue;
      // Skip on-ground flights
      if (f.onGround) continue;

      const { direction, dist, brng, bDiff, status } = classifyFlight(
        f,
        airport,
      );

      // Skip flights too far away
      if (dist > BOARD_RADIUS_NM) continue;

        const boardFlight: BoardFlight = {
          icao24: f.icao24,
          callsign: formatCallsign(f.callsign),
          direction,
          altitude: formatAltitude(
            f.baroAltitude ?? f.geoAltitude,
            settings.unitSystem,
          ),
          altitudeMeters: f.baroAltitude ?? f.geoAltitude,
          speed: formatSpeed(f.velocity, settings.unitSystem),
          speedMs: f.velocity,
          distanceNm: dist,
          distanceFormatted: formatDistanceNm(dist, settings.unitSystem),
          verticalRate: f.verticalRate,
        heading: f.trueTrack,
        bearing: brng,
        bearingDiff: bDiff,
        typeCode: f.typeCode ?? null,
        registration: f.registration ?? null,
        status,
        flight: f,
      };

      if (direction === "arrival") arrivals.push(boardFlight);
      else if (direction === "departure") departures.push(boardFlight);
      else overflights.push(boardFlight);
    }

    const compareBoardFlights = (left: BoardFlight, right: BoardFlight) => {
      if (left.distanceNm !== right.distanceNm) {
        return left.distanceNm - right.distanceNm;
      }

      return left.icao24.localeCompare(right.icao24);
    };

    const sortedArrivals = [...arrivals].sort(compareBoardFlights);
    const sortedDepartures = [...departures].sort(compareBoardFlights);

    // Sort overflights normally (they're not displayed in the board)
    overflights.sort(compareBoardFlights);

    const slicedArrivals = sortedArrivals.slice(0, MAX_PER_COLUMN);
    const slicedDepartures = sortedDepartures.slice(0, MAX_PER_COLUMN);

    return {
      arrivals: slicedArrivals,
      departures: slicedDepartures,
      overflights: overflights.slice(0, MAX_PER_COLUMN),
      airport,
      isActive: true,
      totalFlights: arrivals.length + departures.length,
    };
  }, [flights, selectedAirportIata, settings.unitSystem]);
}
