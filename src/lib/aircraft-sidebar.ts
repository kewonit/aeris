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

function cleanText(value: string | null | undefined): string | null {
  const cleaned = value?.trim();
  return cleaned ? cleaned : null;
}
