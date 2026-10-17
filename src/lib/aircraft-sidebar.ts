import type { AircraftDetails } from "@/hooks/use-aircraft-photos";
import type { UnitSystem } from "@/hooks/use-settings";
import type { FlightState } from "@/lib/opensky";
import { isFiniteNumber } from "@/lib/opensky-parsing";
import { formatAltitude, formatSpeedFromKnots } from "@/lib/unit-formatters";

export type AircraftSidebarViewModel = {
  airline: string | null;
  registration: string | null;
  registrationCountry: string | null;
  registrationCountryFlag: string | null;
  manufacturer: string | null;
  model: string | null;
  typeCode: string | null;
};

type SidebarFlightFields = Pick<
  FlightState,
  | "manufacturer"
  | "model"
  | "registration"
  | "registrationCountry"
  | "registrationCountryFlag"
  | "typeCode"
  | "typeDescription"
>;

type PhotoAircraftFields = Pick<
  AircraftDetails,
  "manufacturer" | "registration" | "type" | "typeCode"
>;

export function buildAircraftSidebarViewModel(
  flight: SidebarFlightFields,
  airline: string | null,
  photoAircraft: PhotoAircraftFields | null,
): AircraftSidebarViewModel {
  return {
    airline: cleanText(airline),
    registration: cleanText(flight.registration ?? photoAircraft?.registration),
    registrationCountry: cleanText(flight.registrationCountry),
    registrationCountryFlag: cleanText(flight.registrationCountryFlag),
    manufacturer: cleanText(
      flight.manufacturer ?? photoAircraft?.manufacturer,
    ),
    model: cleanText(
      flight.model ?? flight.typeDescription ?? photoAircraft?.type,
    ),
    typeCode: cleanText(flight.typeCode ?? photoAircraft?.typeCode),
  };
}

/**
 * A readable aircraft name such as "Boeing 737-8H4". Registries often
 * store the maker apart from the model and in capitals ("BOEING",
 * "737-8H4"), so the maker's first word is title-cased and prefixed when
 * the model does not already name it. Falls back to the ICAO type code.
 */
export function formatAircraftName(
  details: Pick<AircraftSidebarViewModel, "manufacturer" | "model" | "typeCode">,
): string | null {
  const model = details.model;
  const maker = details.manufacturer?.split(/\s+/)[0];
  if (!model) return details.typeCode;
  if (!maker || model.toLowerCase().includes(maker.toLowerCase())) return model;
  const brand = /[a-z]/.test(maker)
    ? maker
    : maker.charAt(0) + maker.slice(1).toLowerCase();
  return `${brand} ${model}`;
}

export function formatAircraftDataSources(sources: string[]): string[] {
  const labels = sources.map((source) => SOURCE_LABELS[source] ?? source);
  return [...new Set(labels.filter(Boolean))];
}

export function formatAircraftFreshness(
  updatedAt: number,
  now: number,
): string {
  const ageSeconds = Math.max(0, Math.floor((now - updatedAt) / 1_000));
  const unit = ageSeconds === 1 ? "second" : "seconds";
  return `Updated ${ageSeconds} ${unit} ago`;
}

const SOURCE_LABELS: Record<string, string> = {
  "adsb.fi": "adsb.fi",
  "adsb.lol": "adsb.lol",
  "airplanes.live": "Airplanes.live",
  faa: "FAA",
  mictronics: "Mictronics",
  opensky: "OpenSky",
};

export function cleanText(value: string | null | undefined): string | null {
  const cleaned = value?.trim();
  return cleaned ? cleaned : null;
}

/** readsb sets bit 0 of dbFlags for military aircraft. */
export function isMilitaryAircraft(dbFlags: number | null | undefined): boolean {
  return ((dbFlags ?? 0) & 1) !== 0;
}

const POSITION_SOURCE_LABELS: Record<NonNullable<FlightState["positionSource"]>, string> = {
  adsb: "ADS-B",
  adsc: "ADS-C",
  asterix: "ASTERIX",
  flarm: "FLARM",
  mlat: "MLAT",
  tisb: "TIS-B",
  other: "Other",
};

export function positionSourceLabel(
  source: FlightState["positionSource"],
): string | null {
  return source ? POSITION_SOURCE_LABELS[source] : null;
}

export function hasEmergencyStatus(status: string | null | undefined): boolean {
  return Boolean(status && status !== "none");
}

/** What to call the aircraft: its callsign, else registration, else ICAO address. */
export function formatAircraftIdentity(
  flight: Pick<FlightState, "callsign" | "icao24">,
  details: Pick<AircraftSidebarViewModel, "registration">,
): string {
  return (
    cleanText(flight.callsign) ??
    details.registration ??
    flight.icao24.toUpperCase()
  );
}

/** The climb or descent rate, from the barometer or else GPS. */
export function aircraftVerticalRate(
  flight: Pick<FlightState, "verticalRate" | "geomRate">,
): number | null {
  return flight.verticalRate ?? flight.geomRate ?? null;
}

/** Why no route is shown, in the route's place. */
export function describeMissingRoute(route: {
  loading: boolean;
  mismatch: boolean;
}): string {
  if (route.loading) return "Looking up the route…";
  if (route.mismatch) return "The reported route doesn’t match this aircraft";
  return "No route reported for this flight";
}

export function formatAircraftPosition(
  latitude: number,
  longitude: number,
): string {
  const latitudeDirection = latitude >= 0 ? "N" : "S";
  const longitudeDirection = longitude >= 0 ? "E" : "W";
  return `${Math.abs(latitude).toFixed(2)}° ${latitudeDirection}, ${Math.abs(longitude).toFixed(2)}° ${longitudeDirection}`;
}

export type AircraftDetailKey =
  | "icao"
  | "registration"
  | "country"
  | "manufacturer"
  | "model"
  | "typeCode"
  | "status"
  | "position"
  | "gpsAltitude"
  | "trueAirspeed"
  | "squawk"
  | "positionMethod"
  | "nacp"
  | "nic"
  | "adsbVersion";

export type AircraftDetailRow = {
  key: AircraftDetailKey;
  label: string;
  value: string;
};

function formatDebugNumber(value: number | null | undefined): string | null {
  return isFiniteNumber(value) ? String(value) : null;
}

/**
 * The aircraft's details, in order, leaving out any that are unknown. The
 * desktop sidebar and the phone card both list them, so they stay alike.
 */
export function buildAircraftDetailRows(
  flight: FlightState,
  details: AircraftSidebarViewModel,
  units: UnitSystem,
  showDebugData: boolean,
): AircraftDetailRow[] {
  const country = [details.registrationCountryFlag, details.registrationCountry]
    .filter(Boolean)
    .join(" ");
  const rows: [AircraftDetailKey, string, string | null][] = [
    ["icao", "ICAO address", flight.icao24.toUpperCase()],
    ["registration", "Registration", details.registration],
    ["country", "Registered in", country || null],
    ["manufacturer", "Manufacturer", details.manufacturer],
    ["model", "Model", details.model],
    ["typeCode", "Type code", details.typeCode],
    ["status", "Status", flight.onGround ? "On ground" : "Airborne"],
    [
      "position",
      "Position",
      isFiniteNumber(flight.latitude) && isFiniteNumber(flight.longitude)
        ? formatAircraftPosition(flight.latitude, flight.longitude)
        : null,
    ],
    [
      "gpsAltitude",
      "GPS altitude",
      isFiniteNumber(flight.geoAltitude)
        ? formatAltitude(flight.geoAltitude, units)
        : null,
    ],
    [
      "trueAirspeed",
      "True airspeed",
      isFiniteNumber(flight.tas) ? formatSpeedFromKnots(flight.tas, units) : null,
    ],
    ["squawk", "Squawk", cleanText(flight.squawk)],
    ["positionMethod", "Position method", positionSourceLabel(flight.positionSource)],
  ];
  if (showDebugData) {
    rows.push(
      ["nacp", "NACp", formatDebugNumber(flight.debugData?.nacP)],
      ["nic", "NIC", formatDebugNumber(flight.debugData?.nic)],
      ["adsbVersion", "ADS-B version", formatDebugNumber(flight.debugData?.version)],
    );
  }
  return rows.flatMap(([key, label, value]) =>
    value ? [{ key, label, value }] : [],
  );
}
