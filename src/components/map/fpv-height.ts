import {
  findNearestAirport,
  isRunwayAirport,
  type Airport,
} from "@/lib/airports";
import type { FlightState } from "@/lib/opensky";

const FEET = 0.3048;
/**
 * Each hPa of QNH above standard puts an aircraft this much higher than its
 * pressure altitude says.
 */
const METERS_PER_HPA = 8.23;
const STANDARD_HPA = 1013.25;
/** A setting this close to standard is the flight level setting, not QNH. */
const STANDARD_SETTING_HPA = 0.6;
const MIN_QNH_HPA = 930;
const MAX_QNH_HPA = 1_070;
/** A difference from pressure altitude larger than this is a bad reading. */
const MAX_CORRECTION_METERS = 1_000;
/** The ground of the airport within this distance is the local ground. */
const AIRPORT_RADIUS_KM = 30;
/**
 * The local ground and altimeter setting count in full this close above
 * the ground, and fade out by the upper height, so the drawn heights move
 * smoothly as the aircraft climbs or descends through them.
 */
const FULL_CORRECTION_BELOW_METERS = 3_000 * FEET;
const NO_CORRECTION_ABOVE_METERS = 10_000 * FEET;

function finite(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * How far the aircraft's pressure altitude is from its height above sea
 * level: from the crew's altimeter setting when they report a local one,
 * else from its satellite altitude.
 */
function altitudeCorrectionMeters(flight: FlightState): number {
  const qnh = flight.navQnh;
  if (
    finite(qnh) &&
    qnh >= MIN_QNH_HPA &&
    qnh <= MAX_QNH_HPA &&
    Math.abs(qnh - STANDARD_HPA) > STANDARD_SETTING_HPA
  ) {
    return (qnh - STANDARD_HPA) * METERS_PER_HPA;
  }
  if (finite(flight.geoAltitude) && finite(flight.baroAltitude)) {
    const difference = flight.geoAltitude - flight.baroAltitude;
    if (Math.abs(difference) <= MAX_CORRECTION_METERS) return difference;
  }
  return 0;
}

/** The runway airport an aircraft is near, if it has a known elevation. */
function localAirport(latitude: number, longitude: number): Airport | null {
  return findNearestAirport(latitude, longitude, AIRPORT_RADIUS_KM, {
    accept: (airport) =>
      airport.elevation_ft !== null && isRunwayAirport(airport),
  });
}

/**
 * What to add to every aircraft's pressure altitude in first person view,
 * so heights sit above a map that has no terrain the way they sit above the
 * real ground. The map is flat at sea level, so near an airport the local
 * ground is taken off, and the altimeter setting put back, or a landing
 * would touch down hundreds of metres above the runway. One offset, taken
 * from the aircraft the camera rides in, applies to all traffic, so
 * aircraft at the same level stay level with the camera.
 */
export function fpvHeightOffsetMeters(flight: FlightState | null): number {
  if (
    !flight ||
    !finite(flight.baroAltitude) ||
    !finite(flight.latitude) ||
    !finite(flight.longitude)
  ) {
    return 0;
  }
  const correction = altitudeCorrectionMeters(flight);
  const airport = localAirport(flight.latitude, flight.longitude);
  const ground = (airport?.elevation_ft ?? 0) * FEET;
  const height = flight.baroAltitude + correction - ground;
  const share = Math.min(
    1,
    Math.max(
      0,
      (NO_CORRECTION_ABOVE_METERS - height) /
        (NO_CORRECTION_ABOVE_METERS - FULL_CORRECTION_BELOW_METERS),
    ),
  );
  return share > 0 ? share * (correction - ground) : 0;
}
