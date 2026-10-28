import type { AtcFeed } from "@/lib/atc-types";

/** An airport with at least one LiveATC feed, as the /atc page ships it. */
export type AtcAirport = {
  icao: string;
  iata: string;
  name: string;
  city: string;
  /** ISO 3166-1 alpha-2. */
  country: string;
  lat: number;
  lng: number;
  /** Tower first. The stream URL is rebuilt from the mount point. */
  feeds: Pick<AtcFeed, "id" | "name" | "frequency" | "type" | "mountPoint">[];
};

export type AtcCountry = {
  code: string;
  name: string;
  /** "US", "UK"; the full name elsewhere. */
  short: string;
  count: number;
};
