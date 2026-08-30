import type {
  FlightState,
  PositionSource,
} from "@/lib/opensky-types";

export const RELAY_PROTOCOL_VERSION = 1;

const FEET_TO_METERS = 0.3048;
const KNOTS_TO_METERS_PER_SECOND = 0.514444;
const FEET_PER_MINUTE_TO_METERS_PER_SECOND = 0.00508;

export type RelaySourceStatus = "starting" | "live" | "degraded" | "stale";
export type RelayAltitudeReference =
  | "barometric"
  | "geometric"
  | "ground"
  | "unknown";

export type RelayBoundingBox = {
  west: number;
  south: number;
  east: number;
  north: number;
};

export type RelayAttribution = {
  provider: string;
  label?: string;
  url?: string;
};

export type RelayRetention = {
  retentionStart: string;
  retentionEnd: string;
  retentionComplete: boolean;
};

export type RelayResponseMeta = {
  sourceStatus: RelaySourceStatus;
  sourceAgeMs?: number;
  attribution: RelayAttribution;
  retention?: RelayRetention;
};

export type RelayObservation = {
  trackId: string;
  provider: string;
  sourceEpoch: string;
  sessionGeneration: number;
  address: string;
  addressType: string;
  callsign?: string;
  registration?: string;
  aircraftType?: string;
  fixTime: string;
  receivedAt: string;
  publishedAt: string;
  latitude: number;
  longitude: number;
  baroAltitudeFt?: number;
  geomAltitudeFt?: number;
  altitudeReference: RelayAltitudeReference;
  onGround: boolean;
  trackDeg?: number;
  groundSpeedKt?: number;
  verticalRateFpm?: number;
  positionSource: string;
  nic?: number;
  nacP?: number;
  sil?: number;
  discontinuity?: boolean;
};

export type RelayHistoryTrack = {
  trackId: string;
  address: string;
  addressType: string;
  provider: string;
  observations: RelayObservation[];
};

export type RelayTrailsResponse = {
  tracks: RelayHistoryTrack[];
  meta: RelayResponseMeta;
};

export type RelayTrackResponse = {
  track: RelayHistoryTrack | null;
  meta: RelayResponseMeta;
};

export type RelayStreamMessage = {
  type: "snapshot" | "delta" | "heartbeat" | "source_status";
  protocolVersion: number;
  serverEpoch: string;
  subscriptionRevision: number;
  sequence: number;
  asOf: string;
  sourceStatus?: RelaySourceStatus;
  sourceAgeMs?: number;
  aircraft?: RelayObservation[];
  upserts?: RelayObservation[];
  removals?: string[];
  reason?: string;
};

export type RelayClientState = {
  serverEpoch: string | null;
  subscriptionRevision: number;
  sequence: number;
  asOf: number | null;
  sourceStatus: RelaySourceStatus;
  sourceAgeMs: number | null;
  aircraft: Map<string, RelayObservation>;
  hasSnapshot: boolean;
  needsResnapshot: boolean;
};

export function createRelayClientState(): RelayClientState {
  return {
    serverEpoch: null,
    subscriptionRevision: 0,
    sequence: 0,
    asOf: null,
    sourceStatus: "starting",
    sourceAgeMs: null,
    aircraft: new Map(),
    hasSnapshot: false,
    needsResnapshot: false,
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isOptionalNumberInRange(
  value: unknown,
  minimum: number,
  maximum: number,
): value is number | undefined {
  return (
    value === undefined ||
    (isFiniteNumber(value) && value >= minimum && value <= maximum)
  );
}

function isBoundedString(value: unknown, maxLength: number): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maxLength &&
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

export function isRelaySourceStatus(value: unknown): value is RelaySourceStatus {
  return (
    value === "starting" ||
    value === "live" ||
    value === "degraded" ||
    value === "stale"
  );
}

export function isRelayResponseMeta(
  value: unknown,
): value is RelayResponseMeta {
  if (!isObject(value) || !isRelaySourceStatus(value.sourceStatus)) {
    return false;
  }
  if (
    value.sourceAgeMs !== undefined &&
    (!isFiniteNumber(value.sourceAgeMs) || value.sourceAgeMs < 0)
  ) {
    return false;
  }
  if (!isObject(value.attribution)) return false;
  if (
    !isBoundedString(value.attribution.provider, 64) ||
    (value.attribution.label !== undefined &&
      !isBoundedString(value.attribution.label, 128)) ||
    (value.attribution.url !== undefined &&
      !isBoundedString(value.attribution.url, 2_048))
  ) {
    return false;
  }
  if (typeof value.attribution.url === "string") {
    try {
      const url = new URL(value.attribution.url);
      if (url.protocol !== "https:" && url.protocol !== "http:") {
        return false;
      }
    } catch {
      return false;
    }
  }

  if (value.retention === undefined) return true;
  if (!isObject(value.retention)) return false;
  if (
    !isTimestamp(value.retention.retentionStart) ||
    !isTimestamp(value.retention.retentionEnd) ||
    typeof value.retention.retentionComplete !== "boolean"
  ) {
    return false;
  }
  return (
    Date.parse(value.retention.retentionStart) <=
    Date.parse(value.retention.retentionEnd)
  );
}

export function isRelayObservation(value: unknown): value is RelayObservation {
  if (!isObject(value)) return false;

  if (
    !isBoundedString(value.trackId, 128) ||
    !isBoundedString(value.provider, 64) ||
    !isBoundedString(value.sourceEpoch, 64) ||
    !Number.isSafeInteger(value.sessionGeneration) ||
    (value.sessionGeneration as number) <= 0 ||
    !isBoundedString(value.address, 32) ||
    !isBoundedString(value.addressType, 32) ||
    !isTimestamp(value.fixTime) ||
    !isTimestamp(value.receivedAt) ||
    !isTimestamp(value.publishedAt) ||
    !isFiniteNumber(value.latitude) ||
    value.latitude < -90 ||
    value.latitude > 90 ||
    !isFiniteNumber(value.longitude) ||
    value.longitude < -180 ||
    value.longitude > 180 ||
    !["barometric", "geometric", "ground", "unknown"].includes(
      String(value.altitudeReference),
    ) ||
    typeof value.onGround !== "boolean" ||
    !isBoundedString(value.positionSource, 32)
  ) {
    return false;
  }

  const fixTime = Date.parse(value.fixTime as string);
  const receivedAt = Date.parse(value.receivedAt as string);
  const publishedAt = Date.parse(value.publishedAt as string);
  if (
    fixTime > receivedAt + 30_000 ||
    publishedAt < receivedAt ||
    (value.altitudeReference === "ground" && value.onGround !== true) ||
    (value.altitudeReference === "barometric" &&
      (value.onGround === true || value.baroAltitudeFt === undefined)) ||
    (value.altitudeReference === "geometric" &&
      (value.onGround === true || value.geomAltitudeFt === undefined)) ||
    (value.altitudeReference === "unknown" && value.onGround === true)
  ) {
    return false;
  }

  for (const optionalString of [
    value.callsign,
    value.registration,
    value.aircraftType,
  ]) {
    if (
      optionalString !== undefined &&
      (typeof optionalString !== "string" || optionalString.length > 64)
    ) {
      return false;
    }
  }

  return (
    isOptionalNumberInRange(value.baroAltitudeFt, -2_000, 100_000) &&
    isOptionalNumberInRange(value.geomAltitudeFt, -2_000, 100_000) &&
    isOptionalNumberInRange(value.trackDeg, 0, 360) &&
    (value.trackDeg === undefined || value.trackDeg < 360) &&
    isOptionalNumberInRange(value.groundSpeedKt, 0, 1_500) &&
    isOptionalNumberInRange(value.verticalRateFpm, -20_000, 20_000) &&
    isOptionalNumberInRange(value.nic, 0, 11) &&
    isOptionalNumberInRange(value.nacP, 0, 11) &&
    isOptionalNumberInRange(value.sil, 0, 3) &&
    (value.nic === undefined || Number.isInteger(value.nic)) &&
    (value.nacP === undefined || Number.isInteger(value.nacP)) &&
    (value.sil === undefined || Number.isInteger(value.sil)) &&
    (value.discontinuity === undefined ||
      typeof value.discontinuity === "boolean")
  );
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= 10_000 &&
    value.every((entry) => isBoundedString(entry, 128))
  );
}

function isObservationArray(value: unknown): value is RelayObservation[] {
  return (
    Array.isArray(value) &&
    value.length <= 10_000 &&
    value.every(isRelayObservation)
  );
}

export function parseRelayStreamMessage(
  value: unknown,
): RelayStreamMessage | null {
  if (!isObject(value)) return null;
  if (
    value.protocolVersion !== RELAY_PROTOCOL_VERSION ||
    !["snapshot", "delta", "heartbeat", "source_status"].includes(
      String(value.type),
    ) ||
    !isBoundedString(value.serverEpoch, 128) ||
    !Number.isSafeInteger(value.subscriptionRevision) ||
    (value.subscriptionRevision as number) <= 0 ||
    !Number.isSafeInteger(value.sequence) ||
    (value.sequence as number) < 0 ||
    !isTimestamp(value.asOf) ||
    (value.sourceStatus !== undefined &&
      !isRelaySourceStatus(value.sourceStatus)) ||
    (value.sourceAgeMs !== undefined &&
      (!isFiniteNumber(value.sourceAgeMs) || value.sourceAgeMs < 0)) ||
    (value.aircraft !== undefined && !isObservationArray(value.aircraft)) ||
    (value.upserts !== undefined && !isObservationArray(value.upserts)) ||
    (value.removals !== undefined && !isStringArray(value.removals)) ||
    (value.reason !== undefined &&
      (typeof value.reason !== "string" || value.reason.length > 128))
  ) {
    return null;
  }

  if (value.type === "snapshot" && !Array.isArray(value.aircraft)) return null;
  return value as unknown as RelayStreamMessage;
}

/**
 * Applies a reliable WebSocket message. Sequence numbers are monotonic but not
 * necessarily contiguous because the server does not enqueue irrelevant
 * viewport updates. A reconnect or server-epoch change always requires a new
 * snapshot; v1 deliberately does not claim replay.
 */
export function applyRelayStreamMessage(
  previous: RelayClientState,
  message: RelayStreamMessage,
  expectedRevision: number,
): RelayClientState {
  if (message.subscriptionRevision < expectedRevision) return previous;
  if (message.subscriptionRevision > expectedRevision) {
    return { ...previous, needsResnapshot: true };
  }

  const asOf = Date.parse(message.asOf);
  const sourceStatus = message.sourceStatus ?? previous.sourceStatus;
  const sourceAgeMs = message.sourceAgeMs ?? previous.sourceAgeMs;

  if (message.type === "snapshot") {
    const aircraft = new Map<string, RelayObservation>();
    for (const observation of message.aircraft ?? []) {
      aircraft.set(observation.trackId, observation);
    }
    return {
      serverEpoch: message.serverEpoch,
      subscriptionRevision: message.subscriptionRevision,
      sequence: message.sequence,
      asOf,
      sourceStatus,
      sourceAgeMs,
      aircraft,
      hasSnapshot: true,
      needsResnapshot: false,
    };
  }

  if (
    !previous.hasSnapshot ||
    previous.serverEpoch !== message.serverEpoch ||
    message.sequence < previous.sequence
  ) {
    return { ...previous, needsResnapshot: true };
  }
  if (message.sequence === previous.sequence && message.type !== "heartbeat") {
    return previous;
  }

  let aircraft = previous.aircraft;
  if (message.type === "delta") {
    aircraft = new Map(previous.aircraft);
    for (const trackId of message.removals ?? []) aircraft.delete(trackId);
    for (const observation of message.upserts ?? []) {
      aircraft.set(observation.trackId, observation);
    }
  }

  return {
    ...previous,
    subscriptionRevision: message.subscriptionRevision,
    sequence: Math.max(previous.sequence, message.sequence),
    asOf,
    sourceStatus,
    sourceAgeMs,
    aircraft,
    needsResnapshot: false,
  };
}

function normalizePositionSource(source: string): PositionSource {
  const normalized = source.toLowerCase();
  if (normalized.startsWith("adsb") || normalized.startsWith("adsr")) {
    return "adsb";
  }
  if (normalized === "mlat") return "mlat";
  if (normalized.startsWith("tisb")) return "tisb";
  if (normalized === "adsc") return "adsc";
  if (normalized === "asterix") return "asterix";
  if (normalized === "flarm") return "flarm";
  return "other";
}

export function relayObservationToFlightState(
  observation: RelayObservation,
): FlightState {
  const fixTime = Date.parse(observation.fixTime);
  const receivedAt = Date.parse(observation.receivedAt);
  const responseTime = Date.parse(observation.publishedAt);
  const baroAltitude =
    observation.baroAltitudeFt === undefined
      ? null
      : observation.baroAltitudeFt * FEET_TO_METERS;
  const geoAltitude =
    observation.geomAltitudeFt === undefined
      ? null
      : observation.geomAltitudeFt * FEET_TO_METERS;

  return {
    icao24: observation.address.trim().toLowerCase(),
    trackId: observation.trackId,
    sourceEpoch: observation.sourceEpoch,
    altitudeReference: observation.altitudeReference,
    discontinuity: observation.discontinuity ?? false,
    callsign: observation.callsign?.trim() || null,
    registrationCountry: null,
    longitude: observation.longitude,
    latitude: observation.latitude,
    baroAltitude,
    onGround: observation.onGround,
    velocity:
      observation.groundSpeedKt === undefined
        ? null
        : observation.groundSpeedKt * KNOTS_TO_METERS_PER_SECOND,
    trueTrack: observation.trackDeg ?? null,
    verticalRate:
      observation.verticalRateFpm === undefined
        ? null
        : observation.verticalRateFpm * FEET_PER_MINUTE_TO_METERS_PER_SECOND,
    geoAltitude,
    squawk: null,
    spiFlag: false,
    positionSource: normalizePositionSource(observation.positionSource),
    category: null,
    typeCode: observation.aircraftType || null,
    registration: observation.registration || null,
    provenance: {
      responseTime,
      observationTime: fixTime,
      positionAgeSeconds: Math.max(0, (receivedAt - fixTime) / 1000),
      contributingSources: [observation.provider],
      positionProvider: "aeris-relay",
    },
    debugData: {
      nic: observation.nic ?? null,
      nacP: observation.nacP ?? null,
      nacV: null,
      sil: observation.sil ?? null,
      version: null,
      alert: null,
      messages: null,
      seen: Math.max(0, (responseTime - receivedAt) / 1000),
      rssi: null,
    },
  };
}

/** Keep one current session per displayed address while retaining its track ID. */
export function relayStateToFlights(
  aircraft: ReadonlyMap<string, RelayObservation>,
): FlightState[] {
  const byAddress = new Map<string, RelayObservation>();
  for (const observation of aircraft.values()) {
    const key = observation.address.trim().toLowerCase();
    const existing = byAddress.get(key);
    if (
      !existing ||
      Date.parse(observation.receivedAt) > Date.parse(existing.receivedAt)
    ) {
      byAddress.set(key, observation);
    }
  }
  return [...byAddress.values()]
    .sort((left, right) => left.trackId.localeCompare(right.trackId))
    .map(relayObservationToFlightState);
}

export function relayBoundingBoxKey(bbox: RelayBoundingBox): string {
  return [bbox.west, bbox.south, bbox.east, bbox.north]
    .map((value) => value.toFixed(4))
    .join(",");
}

function wrapLongitude(value: number): number {
  let result = value;
  while (result < -180) result += 360;
  while (result > 180) result -= 360;
  return result;
}

export function relayBoundingBoxAround(
  latitude: number,
  longitude: number,
  radiusDegrees: number,
): RelayBoundingBox {
  const safeLatitude = Math.max(-90, Math.min(90, latitude));
  const safeLongitude = wrapLongitude(longitude);
  const latDelta = Math.max(0.01, Math.min(4.9, radiusDegrees));
  const cosine = Math.max(
    0.05,
    Math.abs(Math.cos((safeLatitude * Math.PI) / 180)),
  );
  const lonDelta = Math.min(
    180,
    latDelta / cosine,
    100 / (4 * latDelta),
  );

  return {
    west: wrapLongitude(safeLongitude - lonDelta),
    south: Math.max(-90, safeLatitude - latDelta),
    east: wrapLongitude(safeLongitude + lonDelta),
    north: Math.min(90, safeLatitude + latDelta),
  };
}
