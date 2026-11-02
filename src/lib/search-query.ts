import { expandFlightQuery, flightQueryMatches } from "@/lib/airlines";
import type { FlightState } from "@/lib/opensky";

/**
 * What a search box query probably is, so one field can look for flights,
 * airports and places without asking which.
 */
export type SearchQueryKind = {
  /** Lower case, without spaces. */
  compact: string;
  /** Six hex digits: an ICAO aircraft address. */
  hex: boolean;
  /** A callsign or flight number, such as "BAW20R", "UA 123" or "6E2341". */
  flightLike: boolean;
  /** A registration, such as "G-VIIJ" or "N123AB". */
  registrationLike: boolean;
  /** Three or four letters, which could be an airport code. */
  airportCodeLike: boolean;
  /** Worth asking the geocoder about. */
  placeLike: boolean;
};

const HEX_RE = /^[0-9a-f]{6}$/;
/** ICAO callsigns: three letters and a number, such as BAW20R. */
const CALLSIGN_RE = /^[a-z]{3}\d[a-z0-9]{0,4}$/;
/** IATA flight numbers: a two-character airline code and a number. */
const FLIGHT_NUMBER_RE = /^(?:[a-z]{2}|[a-z]\d|\d[a-z])\d{1,4}[a-z]?$/;
const REGISTRATION_RE = /^(?:[a-z0-9]{1,2}-[a-z0-9]{2,5}|n\d{1,5}[a-z]{0,2})$/;
const AIRPORT_CODE_RE = /^[a-z]{3,4}$/;

export function classifySearchQuery(raw: string): SearchQueryKind {
  const trimmed = raw.trim().toLowerCase();
  const compact = trimmed.replace(/\s+/g, "");
  const flightLike = CALLSIGN_RE.test(compact) || FLIGHT_NUMBER_RE.test(compact);
  const registrationLike = REGISTRATION_RE.test(trimmed.replace(/\s+/g, ""));
  const hex = HEX_RE.test(compact);
  return {
    compact,
    hex,
    flightLike,
    registrationLike,
    airportCodeLike: AIRPORT_CODE_RE.test(compact),
    placeLike:
      compact.length >= 3 && /[a-z]/.test(compact) && !flightLike && !registrationLike,
  };
}

function compactText(value: string | null | undefined): string {
  return value?.trim().toLowerCase().replace(/[\s-]+/g, "") ?? "";
}

/**
 * How well a live aircraft matches the query: 3 for an exact callsign,
 * address or registration, 2 for a flight number that names it, 1 for a
 * partial match, 0 for none.
 */
export function scoreFlightMatch(query: string, flight: FlightState): number {
  const q = compactText(query);
  if (!q) return 0;
  const callsign = compactText(flight.callsign);
  const registration = compactText(flight.registration);
  const hex = flight.icao24.toLowerCase();
  if (q === callsign || q === hex || (registration && q === registration)) return 3;
  if (expandFlightQuery(query).some((variant) => compactText(variant) === callsign)) {
    return 2;
  }
  if (
    callsign.includes(q) ||
    hex.startsWith(q) ||
    (registration && registration.includes(q)) ||
    flightQueryMatches(query, flight.callsign)
  ) {
    return 1;
  }
  return 0;
}

/** Live aircraft matching the query, best match first, then by callsign. */
export function matchLiveFlights(
  query: string,
  flights: FlightState[],
  limit = 8,
): FlightState[] {
  if (compactText(query).length < 2) return [];
  return flights
    .map((flight) => ({ flight, score: scoreFlightMatch(query, flight) }))
    .filter(({ score }) => score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        compactText(a.flight.callsign).localeCompare(compactText(b.flight.callsign)),
    )
    .slice(0, limit)
    .map(({ flight }) => flight);
}

/** The aircraft nearest a point, for the empty search box. */
export function nearestFlights(
  flights: FlightState[],
  [lng, lat]: [number, number],
  limit = 5,
): FlightState[] {
  const cosLat = Math.cos((lat * Math.PI) / 180);
  return flights
    .filter(
      (f) =>
        f.latitude != null &&
        f.longitude != null &&
        !f.onGround &&
        Boolean(f.callsign?.trim()),
    )
    .map((f) => {
      const dx = (f.longitude! - lng) * cosLat;
      const dy = f.latitude! - lat;
      return { f, d: dx * dx + dy * dy };
    })
    .sort((a, b) => a.d - b.d)
    .slice(0, limit)
    .map(({ f }) => f);
}
