import type { AircraftDetails } from "@/hooks/use-aircraft-photos";
import type { FlightState } from "@/lib/opensky";

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
