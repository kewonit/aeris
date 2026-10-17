import type { FlightState } from "@/lib/opensky";
import type { Snapshot } from "./flight-layer-constants";
import { TELEPORT_THRESHOLD } from "./flight-layer-constants";
import { lerpAngle, horizontalDistanceFromLngLat } from "./flight-math";

const MIN_DISPLAY_TRACK_DISTANCE_METERS = 15;
export const FLIGHT_RENDER_STALE_MS = 15_000;
export const MAX_FLIGHT_EXTRAPOLATION_MS = 2_000;

/**
 * How far along its move from the previous snapshot to the current one
 * traffic is drawn, and whether it is still moving.
 *
 * A poll that arrives late leaves aircraft gliding on along their last move
 * for up to `maxExtrapolationMs`, rather than parked at its end until the
 * report lands. Reports are timed to when they arrive (see carryForward),
 * so the drawn traffic trails them by a poll and the next move carries on
 * from there at the same speed. While the page is inactive, traffic holds
 * at the current snapshot.
 */
export function getSafeInterpolationProgress(input: {
  elapsedMs: number;
  animDurationMs: number;
  pageActive: boolean;
  maxExtrapolationMs?: number;
}): { tPos: number; moving: boolean } {
  const elapsedMs = Number.isFinite(input.elapsedMs)
    ? Math.max(0, input.elapsedMs)
    : 0;
  const animDurationMs =
    Number.isFinite(input.animDurationMs) && input.animDurationMs > 0
      ? input.animDurationMs
      : 1;
  const maxExtrapolationMs = Math.max(
    0,
    input.maxExtrapolationMs ?? MAX_FLIGHT_EXTRAPOLATION_MS,
  );

  if (!input.pageActive) {
    return { tPos: 1, moving: false };
  }

  const end = 1 + maxExtrapolationMs / animDurationMs;
  const tPos = Math.min(elapsedMs / animDurationMs, end);
  return { tPos, moving: tPos < end };
}

export function normalizeBearing(bearing: number): number {
  return ((bearing % 360) + 360) % 360;
}

function bearingFromLngLat(
  previousPosition: { lng: number; lat: number },
  currentPosition: { lng: number; lat: number },
): number | null {
  // A degree of longitude shrinks with latitude, so scale it before taking
  // the angle. Without this a 125° track reads as 119° at 37° N.
  const midLatitude =
    ((previousPosition.lat + currentPosition.lat) / 2) * (Math.PI / 180);
  const dx =
    (((currentPosition.lng - previousPosition.lng + 540) % 360) - 180) *
    Math.cos(midLatitude);
  const dy = currentPosition.lat - previousPosition.lat;
  const distanceMeters = horizontalDistanceFromLngLat(
    previousPosition.lng,
    previousPosition.lat,
    currentPosition.lng,
    currentPosition.lat,
  );

  if (distanceMeters < MIN_DISPLAY_TRACK_DISTANCE_METERS) {
    return null;
  }

  return normalizeBearing((Math.atan2(dx, dy) * 180) / Math.PI);
}

export function resolveDisplayTrack(input: {
  reportedTrack?: number | null;
  previousPosition?: { lng: number; lat: number } | null;
  currentPosition?: { lng: number; lat: number } | null;
}): number {
  const reportedTrack = Number.isFinite(input.reportedTrack)
    ? normalizeBearing(input.reportedTrack!)
    : null;

  const motionTrack =
    input.previousPosition && input.currentPosition
      ? bearingFromLngLat(input.previousPosition, input.currentPosition)
      : null;

  if (motionTrack == null) {
    return reportedTrack ?? 0;
  }

  if (reportedTrack == null) {
    return motionTrack;
  }

  return motionTrack;
}

// ── Heading ────────────────────────────────────────────────────────────

/**
 * When a report sets an aircraft on a new course, its nose turns onto the
 * new direction over about this long instead of snapping to it.
 */
export const HEADING_TURN_MS = 1_500;

function smoothStepUnit(t: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  return clamped * clamped * (3 - 2 * clamped);
}

/**
 * Which way an aircraft points `elapsedMs` into its move from one snapshot
 * to the next. It points along the way it moves, so the nose never crabs
 * across the drawn path; at each new report it turns there from wherever
 * it was pointing, smoothly, rather than jumping.
 */
export function displayHeading(
  prev: Snapshot,
  curr: Snapshot,
  elapsedMs: number,
): number {
  const course = resolveDisplayTrack({
    reportedTrack: curr.track,
    previousPosition: prev,
    currentPosition: curr,
  });
  if (prev.heading === undefined) return course;
  return normalizeBearing(
    lerpAngle(prev.heading, course, smoothStepUnit(elapsedMs / HEADING_TURN_MS)),
  );
}

// ── Report timing ──────────────────────────────────────────────────────

/** A report is carried forward at most this far. */
export const MAX_REPORT_LEAD_MS = 10_000;
/** Recent polls kept per provider to find its quickest answer. */
const RECEIPT_HISTORY = 12;
const METERS_PER_DEGREE = 111_320;

/**
 * How long each provider's recent answers took to reach us, in ms, as our
 * clock less theirs. That holds both the network delay and any offset
 * between the clocks; only how far one answer lags the quickest counts, so
 * the offset cancels out.
 */
export type ReceiptDelays = Map<string, number[]>;

/** Notes when a poll's answer arrived, once for each provider in it. */
export function noteReceipt(
  delays: ReceiptDelays,
  flights: FlightState[],
  receivedAt: number,
): void {
  const seen = new Set<string>();
  for (const flight of flights) {
    const provenance = flight.provenance;
    if (!provenance || seen.has(provenance.positionProvider)) continue;
    seen.add(provenance.positionProvider);
    const recent = delays.get(provenance.positionProvider) ?? [];
    recent.push(receivedAt - provenance.responseTime);
    if (recent.length > RECEIPT_HISTORY) recent.shift();
    delays.set(provenance.positionProvider, recent);
  }
}

/**
 * How long before `receivedAt` a flight's reported position was true: its
 * age when the provider answered, plus however long that answer sat in a
 * cache before it reached us.
 */
export function reportLeadMs(
  flight: FlightState,
  receivedAt: number,
  delays: ReceiptDelays,
): number {
  const provenance = flight.provenance;
  if (!provenance) return 0;
  const age =
    provenance.positionAgeSeconds !== null &&
    Number.isFinite(provenance.positionAgeSeconds)
      ? provenance.positionAgeSeconds * 1_000
      : 0;
  const recent = delays.get(provenance.positionProvider);
  const waited = recent?.length
    ? receivedAt - provenance.responseTime - Math.min(...recent)
    : 0;
  const lead = age + Math.max(0, waited);
  return Number.isFinite(lead)
    ? Math.min(MAX_REPORT_LEAD_MS, Math.max(0, lead))
    : 0;
}

/**
 * Where an aircraft is `leadMs` after its reported position, flying on
 * straight at its reported speed and climb.
 *
 * Providers answer from caches and report positions of differing ages, so
 * two reports a poll apart can be 4 or 6 seconds of flight apart. Carried
 * forward to the moment each arrived, they are a poll's worth apart, and the
 * aircraft glides between them at its true speed instead of surging and
 * slowing with each report.
 */
export function carryForward(
  flight: FlightState,
  leadMs: number,
): { lng: number; lat: number; alt: number | null } | null {
  if (flight.longitude == null || flight.latitude == null) return null;
  const alt = Number.isFinite(flight.baroAltitude) ? flight.baroAltitude! : null;
  const seconds = leadMs / 1_000;
  const speed = flight.velocity;
  const track = flight.trueTrack;
  if (
    flight.onGround ||
    !(seconds > 0) ||
    speed == null ||
    !Number.isFinite(speed) ||
    speed <= 0 ||
    track == null ||
    !Number.isFinite(track)
  ) {
    return { lng: flight.longitude, lat: flight.latitude, alt };
  }

  const radians = (track * Math.PI) / 180;
  const distance = speed * seconds;
  const cosLat = Math.max(Math.cos((flight.latitude * Math.PI) / 180), 1e-6);
  const climb = flight.verticalRate ?? flight.geomRate;
  return {
    lng: flight.longitude + (distance * Math.sin(radians)) / (METERS_PER_DEGREE * cosLat),
    lat: flight.latitude + (distance * Math.cos(radians)) / METERS_PER_DEGREE,
    alt:
      alt !== null && climb != null && Number.isFinite(climb)
        ? Math.max(0, alt + climb * seconds)
        : alt,
  };
}

// ── Flight Interpolation ───────────────────────────────────────────────

export function computeInterpolatedFlights(
  currentFlights: FlightState[],
  prevSnapshots: Map<string, Snapshot>,
  currSnapshots: Map<string, Snapshot>,
  tPos: number,
  animDuration: number,
): FlightState[] {
  return currentFlights.map((f) => {
    if (f.longitude == null || f.latitude == null) return f;

    const curr = currSnapshots.get(f.icao24);
    if (!curr) return f;

    const prev = prevSnapshots.get(f.icao24);
    if (!prev) {
      return {
        ...f,
        longitude: curr.lng,
        latitude: curr.lat,
        baroAltitude: curr.alt,
        trueTrack: resolveDisplayTrack({
          reportedTrack: Number.isFinite(f.trueTrack)
            ? f.trueTrack!
            : curr.track,
        }),
      };
    }

    const dx = curr.lng - prev.lng;
    const dy = curr.lat - prev.lat;
    if (dx * dx + dy * dy > TELEPORT_THRESHOLD * TELEPORT_THRESHOLD) {
      return f;
    }

    return {
      ...f,
      longitude: prev.lng + dx * tPos,
      latitude: prev.lat + dy * tPos,
      baroAltitude: prev.alt + (curr.alt - prev.alt) * tPos,
      trueTrack: displayHeading(prev, curr, tPos * animDuration),
    };
  });
}

/**
 * In-place position update for an existing interpolated array.
 *
 * Called on animation frames between data polls. Instead of creating new
 * FlightState objects with `{...f}`, this mutates the existing objects'
 * position fields directly. Combined with a stable array reference this
 * eliminates ~18K object allocations/sec and ~360K property copies/sec.
 *
 * `rawFlights` must be the SAME array that was used to create `out` via
 * `computeInterpolatedFlights` (i.e. `flightsRef.current` hasn't changed).
 * Elements where `out[i] === rawFlights[i]` are raw references (no
 * interpolation was needed) and are left untouched.
 */
export function updateInterpolatedInPlace(
  out: FlightState[],
  rawFlights: FlightState[],
  prevSnapshots: Map<string, Snapshot>,
  currSnapshots: Map<string, Snapshot>,
  tPos: number,
  animDuration: number,
): void {
  for (let i = 0; i < out.length; i++) {
    const o = out[i];
    const f = rawFlights[i];
    if (!o || !f) continue;

    // Skip raw references - these flights had no position or snapshot,
    // so computeInterpolatedFlights returned the raw object directly.
    // Mutating them would corrupt the source data.
    if (o === f) continue;

    const curr = currSnapshots.get(f.icao24);
    if (!curr) continue;

    const prev = prevSnapshots.get(f.icao24);
    if (!prev) {
      o.longitude = curr.lng;
      o.latitude = curr.lat;
      o.baroAltitude = curr.alt;
      o.trueTrack = resolveDisplayTrack({
        reportedTrack: Number.isFinite(f.trueTrack) ? f.trueTrack! : curr.track,
      });
      continue;
    }

    const dx = curr.lng - prev.lng;
    const dy = curr.lat - prev.lat;
    if (dx * dx + dy * dy > TELEPORT_THRESHOLD * TELEPORT_THRESHOLD) continue;

    o.longitude = prev.lng + dx * tPos;
    o.latitude = prev.lat + dy * tPos;
    o.baroAltitude = prev.alt + (curr.alt - prev.alt) * tPos;
    o.trueTrack = displayHeading(prev, curr, tPos * animDuration);
  }
}
