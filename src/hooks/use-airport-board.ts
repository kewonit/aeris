"use client";

import { useMemo, useRef } from "react";
import type { FlightState } from "@/lib/opensky";
import type { Airport } from "@/lib/airports";
import { AIRPORTS, findByIata } from "@/lib/airports";
import { formatCallsign, metersToFeet, msToKnots } from "@/lib/flight-utils";

// ── Constants ──────────────────────────────────────────────────────────

/** Minimum map zoom to activate the board (close enough to see an airport). */
const BOARD_MIN_ZOOM = 9.5;

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

/** Maximum distance (degrees) to search for nearest airport to map center. */
const NEAREST_AIRPORT_SEARCH_DEG = 1.5;

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

// ── Nearest airport finder (optimized for viewport) ────────────────────

/**
 * Pre-built spatial index: bucket airports by 1° grid cells.
 * Lazy-initialized on first call.
 */
let _airportGrid: Map<string, Airport[]> | null = null;

function getAirportGrid(): Map<string, Airport[]> {
  if (_airportGrid) return _airportGrid;
  _airportGrid = new Map();
  for (const a of AIRPORTS) {
    const key = `${Math.floor(a.lat)}:${Math.floor(a.lng)}`;
    const bucket = _airportGrid.get(key);
    if (bucket) bucket.push(a);
    else _airportGrid.set(key, [a]);
  }
  return _airportGrid;
}

/**
 * Find the nearest airport to a given coordinate within `maxDeg` degrees.
 * Uses grid-based spatial lookup to avoid scanning all 72K airports.
 */
function findNearestAirport(
  lat: number,
  lng: number,
  maxDeg: number = NEAREST_AIRPORT_SEARCH_DEG,
): Airport | null {
  const grid = getAirportGrid();
  const minLat = Math.floor(lat - maxDeg);
  const maxLat = Math.floor(lat + maxDeg);
  const minLng = Math.floor(lng - maxDeg);
  const maxLng = Math.floor(lng + maxDeg);

  let best: Airport | null = null;
  let bestDist = Infinity;

  for (let gLat = minLat; gLat <= maxLat; gLat++) {
    for (let gLng = minLng; gLng <= maxLng; gLng++) {
      const bucket = grid.get(`${gLat}:${gLng}`);
      if (!bucket) continue;
      for (const a of bucket) {
        const d = distanceNm(lat, lng, a.lat, a.lng);
        if (d < bestDist) {
          bestDist = d;
          best = a;
        }
      }
    }
  }

  return best;
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

function formatDistance(nm: number): string {
  if (nm < 0.1) return "<0.1 nm";
  if (nm < 10) return `${nm.toFixed(1)} nm`;
  return `${Math.round(nm)} nm`;
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
  const prevAirportRef = useRef<Airport | null>(null);
  /** Tracks the previous order of icao24 IDs to keep sort stable across updates. */
  const prevArrivalOrderRef = useRef<string[]>([]);
  const prevDepartureOrderRef = useRef<string[]>([]);

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
      prevArrivalOrderRef.current = [];
      prevDepartureOrderRef.current = [];
      return inactive;
    }

    // Find the selected airport
    let airport: Airport | null = findByIata(selectedAirportIata) ?? null;

    if (!airport) return inactive;

    // Cache airport to avoid flicker
    prevAirportRef.current = airport;

    const arrivals: BoardFlight[] = [];
    const departures: BoardFlight[] = [];
    const overflights: BoardFlight[] = [];

    for (const f of flights) {
      // Skip flights without position
      if (f.latitude == null || f.longitude == null) continue;
      // Skip on-ground flights
      if (f.onGround) continue;

      const { direction, dist, brng, bearingToAirport, bDiff, status } =
        classifyFlight(f, airport);

      // Skip flights too far away
      if (dist > BOARD_RADIUS_NM) continue;

      const boardFlight: BoardFlight = {
        icao24: f.icao24,
        callsign: formatCallsign(f.callsign),
        direction,
        altitude: metersToFeet(f.baroAltitude ?? f.geoAltitude),
        altitudeMeters: f.baroAltitude ?? f.geoAltitude,
        speed: msToKnots(f.velocity),
        speedMs: f.velocity,
        distanceNm: dist,
        distanceFormatted: formatDistance(dist),
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

    // ── Stable sort: preserve previous order, only insert new flights by distance ──
    // This prevents constant re-ordering when distances change slightly between polls.
    const stableSort = (
      list: BoardFlight[],
      prevOrder: string[],
    ): BoardFlight[] => {
      const byId = new Map(list.map((f) => [f.icao24, f]));
      const result: BoardFlight[] = [];
      const seen = new Set<string>();

      // 1. Keep previously ordered flights in the same order (if still present)
      for (const id of prevOrder) {
        const f = byId.get(id);
        if (f) {
          result.push(f);
          seen.add(id);
        }
      }

      // 2. Insert new flights sorted by distance into the list
      const newFlights = list
        .filter((f) => !seen.has(f.icao24))
        .sort((a, b) => a.distanceNm - b.distanceNm);

      for (const nf of newFlights) {
        // Find insertion point: first existing flight that is farther away
        let inserted = false;
        for (let i = 0; i < result.length; i++) {
          if (nf.distanceNm < result[i].distanceNm) {
            result.splice(i, 0, nf);
            inserted = true;
            break;
          }
        }
        if (!inserted) result.push(nf);
      }

      return result;
    };

    const sortedArrivals = stableSort(arrivals, prevArrivalOrderRef.current);
    const sortedDepartures = stableSort(
      departures,
      prevDepartureOrderRef.current,
    );

    // Sort overflights normally (they're not displayed in the board)
    overflights.sort((a, b) => a.distanceNm - b.distanceNm);

    const slicedArrivals = sortedArrivals.slice(0, MAX_PER_COLUMN);
    const slicedDepartures = sortedDepartures.slice(0, MAX_PER_COLUMN);

    // Update order refs for next render
    prevArrivalOrderRef.current = slicedArrivals.map((f) => f.icao24);
    prevDepartureOrderRef.current = slicedDepartures.map((f) => f.icao24);

    return {
      arrivals: slicedArrivals,
      departures: slicedDepartures,
      overflights: overflights.slice(0, MAX_PER_COLUMN),
      airport,
      isActive: true,
      totalFlights: arrivals.length + departures.length,
    };
  }, [flights, selectedAirportIata]);
}
