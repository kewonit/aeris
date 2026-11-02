import type { UnitSystem } from "@/hooks/use-settings";
import type { FlightState } from "@/lib/opensky";
import { formatAirportCode, type RouteAirport } from "@/lib/route-lookup";
import { distanceNm } from "@/lib/route-validation";
import { formatDuration } from "@/lib/format-duration";
import { formatAltitude } from "@/lib/unit-formatters";

/**
 * Says what an aircraft is doing in one line, the way a departures board
 * would: "Descending into BOM · about 14 min out". The line is built only
 * from what ADS-B and the reported route can support, so it never claims a
 * gate, a schedule or a delay.
 */

export type FlightPhase =
  | "parked"
  | "taxiing"
  | "takingOff"
  | "climbing"
  | "cruising"
  | "descending"
  | "approach"
  | "landed"
  | "unknown";

export type StatusTone = "neutral" | "warning" | "danger";

export type FlightStatus = {
  phase: FlightPhase;
  /** "Descending into BOM". */
  headline: string;
  /** "about 14 min out", when there is a fair estimate. */
  timing: string | null;
  /** Why the line matters, such as an emergency or weather on arrival. */
  cause: { text: string; tone: StatusTone } | null;
  /** Share of the way flown, 0 to 1, when both ends are known. */
  progress: number | null;
  /** Minutes to the destination at the current ground speed. */
  minutesRemaining: number | null;
  /** Headline and timing together, for screen readers and shared text. */
  sentence: string;
};

export type FlightStatusInput = {
  flight: Pick<
    FlightState,
    | "onGround"
    | "baroAltitude"
    | "geoAltitude"
    | "verticalRate"
    | "geomRate"
    | "velocity"
    | "latitude"
    | "longitude"
    | "squawk"
    | "emergencyStatus"
  >;
  route?: {
    origin: RouteAirport | null;
    destination: RouteAirport | null;
    mismatch?: boolean;
  } | null;
  /** Notable weather at the destination, from describeNotableWeather. */
  weather?: string | null;
  units: UnitSystem;
};

const FEET = 0.3048;
const KNOTS = 0.514444;
/** About 800 ft per minute: a clear climb or descent, as route checks use. */
const CLIMB_MPS = 4;
/** At cruise heights a step climb or a slow drift is still cruising. */
const CRUISE_FLOOR_M = 25_000 * FEET;
const CRUISE_DRIFT_MPS = 6;
/** On the ground, slower than this is parked, and faster than taxi is a runway. */
const PARKED_MPS = 3 * KNOTS;
const TAXI_MPS = 40 * KNOTS;
/** Closer than this to an airport, the aircraft is at it. */
const AT_AIRPORT_NM = 5;
/** A departure climbing within this of its origin is "climbing out of" it. */
const CLIMB_OUT_NM = 60;
/** On approach: close to the destination, low, and not climbing away. */
const APPROACH_NM = 30;
const APPROACH_CEILING_M = 10_000 * FEET;
/** Below this ground speed the estimate would be noise. */
const ETA_MIN_SPEED_MPS = 50 * KNOTS;
/**
 * The last stretch is flown slowing down toward landing speed, so it is
 * timed at the mean of the current speed and a typical approach speed.
 */
const ARRIVAL_STRETCH_NM = 100;
const APPROACH_SPEED_MPS = 150 * KNOTS;
/** With this little time left, the aircraft is landing now. */
const LANDING_NOW_MIN = 2;

const EMERGENCY_SQUAWKS: Record<string, string> = {
  "7700": "Squawking 7700 · emergency",
  "7600": "Squawking 7600 · radio failure",
  "7500": "Squawking 7500 · unlawful interference",
};

const EMERGENCY_STATUS: Record<string, { text: string; tone: StatusTone }> = {
  general: { text: "Declared an emergency", tone: "danger" },
  lifeguard: { text: "Medical priority flight", tone: "warning" },
  minfuel: { text: "Declared minimum fuel", tone: "danger" },
  nordo: { text: "No radio contact", tone: "danger" },
  unlawful: { text: "Unlawful interference", tone: "danger" },
  downed: { text: "Reported down", tone: "danger" },
};

type Distances = { origin: number | null; destination: number | null };

function finite(value: number | null | undefined): value is number {
  return value != null && Number.isFinite(value);
}

function distancesTo(
  flight: FlightStatusInput["flight"],
  origin: RouteAirport | null,
  destination: RouteAirport | null,
): Distances {
  if (!finite(flight.latitude) || !finite(flight.longitude)) {
    return { origin: null, destination: null };
  }
  const here = { latitude: flight.latitude, longitude: flight.longitude };
  return {
    origin: origin ? distanceNm(here, origin) : null,
    destination: destination ? distanceNm(here, destination) : null,
  };
}

function near(distance: number | null, limit: number): boolean {
  return distance !== null && distance < limit;
}

/** What the aircraft is doing, from its height, speed, climb and position. */
export function classifyFlightPhase(
  flight: FlightStatusInput["flight"],
  distances: Distances,
): FlightPhase {
  const speed = finite(flight.velocity) ? flight.velocity : null;
  if (flight.onGround) {
    if (speed === null) return "unknown";
    if (speed < PARKED_MPS) return "parked";
    if (speed < TAXI_MPS) return "taxiing";
    if (near(distances.destination, AT_AIRPORT_NM)) return "landed";
    if (near(distances.origin, AT_AIRPORT_NM)) return "takingOff";
    return "unknown";
  }

  const altitude = finite(flight.baroAltitude)
    ? flight.baroAltitude
    : finite(flight.geoAltitude)
      ? flight.geoAltitude
      : null;
  if (altitude === null) return "unknown";
  const rate = flight.verticalRate ?? flight.geomRate ?? 0;

  if (
    near(distances.origin, AT_AIRPORT_NM) &&
    rate > CLIMB_MPS / 2 &&
    altitude < 5_000 * FEET
  ) {
    return "takingOff";
  }
  if (
    near(distances.destination, APPROACH_NM) &&
    altitude < APPROACH_CEILING_M &&
    rate <= CLIMB_MPS / 2
  ) {
    return "approach";
  }
  if (altitude >= CRUISE_FLOOR_M && Math.abs(rate) < CRUISE_DRIFT_MPS) {
    return "cruising";
  }
  if (rate > CLIMB_MPS) return "climbing";
  if (rate < -CLIMB_MPS) return "descending";
  return "cruising";
}

/** Altitude rounded to the nearest hundred, as "12,300 ft". */
function roundedAltitude(meters: number, units: UnitSystem): string {
  const step = units === "metric" ? 100 : 100 * FEET;
  return formatAltitude(Math.round(meters / step) * step, units);
}

function headlineFor(
  phase: FlightPhase,
  input: FlightStatusInput,
  distances: Distances,
): string {
  const { flight, units } = input;
  const origin = formatAirportCode(input.route?.origin ?? null) || null;
  const destination = formatAirportCode(input.route?.destination ?? null) || null;
  const altitude = finite(flight.baroAltitude)
    ? flight.baroAltitude
    : finite(flight.geoAltitude)
      ? flight.geoAltitude
      : null;
  const here = near(distances.destination, AT_AIRPORT_NM)
    ? destination
    : near(distances.origin, AT_AIRPORT_NM)
      ? origin
      : null;
  const at = (verb: string, fallback: string) =>
    here ? `${verb} at ${here}` : fallback;

  switch (phase) {
    case "parked":
      return at("Parked", "On the ground");
    case "taxiing":
      return at("Taxiing", "Taxiing");
    case "takingOff":
      return origin ? `Taking off from ${origin}` : "Taking off";
    case "landed":
      return destination ? `Landed at ${destination}` : "Landed";
    case "approach":
      return destination ? `On approach to ${destination}` : "On approach";
    case "climbing":
      if (origin && near(distances.origin, CLIMB_OUT_NM)) {
        return `Climbing out of ${origin}`;
      }
      if (destination) return `Climbing toward ${destination}`;
      return altitude === null
        ? "Climbing"
        : `Climbing through ${roundedAltitude(altitude, units)}`;
    case "descending":
      if (destination) return `Descending into ${destination}`;
      return altitude === null
        ? "Descending"
        : `Descending through ${roundedAltitude(altitude, units)}`;
    case "cruising":
      if (destination) return `Cruising to ${destination}`;
      if (altitude === null) return "In the air";
      return altitude >= 18_000 * FEET
        ? `Cruising at ${roundedAltitude(altitude, units)}`
        : `Flying at ${roundedAltitude(altitude, units)}`;
    case "unknown":
      if (!flight.onGround) return "In the air";
      return finite(flight.velocity) && flight.velocity >= TAXI_MPS
        ? "On the runway"
        : "On the ground";
  }
}

function causeFor(input: FlightStatusInput): FlightStatus["cause"] {
  const squawk = input.flight.squawk?.trim();
  if (squawk && EMERGENCY_SQUAWKS[squawk]) {
    return { text: EMERGENCY_SQUAWKS[squawk], tone: "danger" };
  }
  const status = input.flight.emergencyStatus?.trim().toLowerCase();
  if (status && status !== "none" && EMERGENCY_STATUS[status]) {
    return EMERGENCY_STATUS[status];
  }
  if (input.route?.mismatch) {
    return {
      text: "The reported route doesn’t match this aircraft",
      tone: "neutral",
    };
  }
  if (input.weather) return { text: input.weather, tone: "warning" };
  return null;
}

/**
 * Minutes to cover `distanceNm` from a ground speed of `speed` m/s: the
 * cruise part at that speed, the last stretch slowing toward an approach.
 */
export function estimateMinutesRemaining(distance: number, speed: number): number {
  const arrival = Math.min(distance, ARRIVAL_STRETCH_NM);
  const cruise = distance - arrival;
  const arrivalSpeed = Math.min(speed, (speed + APPROACH_SPEED_MPS) / 2);
  const seconds = (cruise * 1_852) / speed + (arrival * 1_852) / arrivalSpeed;
  return seconds / 60;
}

/** The line for one aircraft, recomputed whenever its position updates. */
export function describeFlightStatus(input: FlightStatusInput): FlightStatus {
  const origin = input.route?.mismatch ? null : (input.route?.origin ?? null);
  const destination = input.route?.mismatch
    ? null
    : (input.route?.destination ?? null);
  const trusted: FlightStatusInput = {
    ...input,
    route: input.route ? { ...input.route, origin, destination } : null,
  };
  const distances = distancesTo(input.flight, origin, destination);
  const phase = classifyFlightPhase(input.flight, distances);
  const headline = headlineFor(phase, trusted, distances);

  const airborne = !input.flight.onGround;
  const speed = finite(input.flight.velocity) ? input.flight.velocity : null;
  const minutesRemaining =
    airborne &&
    distances.destination !== null &&
    speed !== null &&
    speed >= ETA_MIN_SPEED_MPS
      ? estimateMinutesRemaining(distances.destination, speed)
      : null;

  let timing: string | null = null;
  if (minutesRemaining !== null) {
    if (phase === "approach" || phase === "descending") {
      timing =
        minutesRemaining <= LANDING_NOW_MIN
          ? "landing now"
          : `about ${formatDuration(minutesRemaining, { estimate: true })} out`;
    } else if (phase === "climbing" || phase === "cruising") {
      timing = `about ${formatDuration(minutesRemaining, { estimate: true })} to go`;
    }
  }

  const progress =
    distances.origin !== null && distances.destination !== null
      ? Math.min(
          1,
          Math.max(
            0,
            distances.origin / (distances.origin + distances.destination || 1),
          ),
        )
      : null;

  return {
    phase,
    headline,
    timing,
    cause: causeFor(input),
    progress,
    minutesRemaining,
    sentence: timing ? `${headline} · ${timing}` : headline,
  };
}
