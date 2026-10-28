import type { Metadata } from "next";
import { AtcRadio } from "@/components/atc/atc-radio";
import type { AtcAirport, AtcCountry } from "@/components/atc/types";
import { ATC_FEEDS } from "@/lib/atc-feeds";
import { FEED_TYPE_PRIORITY } from "@/lib/atc-types";
import { findAirportByIcao } from "@/lib/airports";
import { SITE_NAME, SITE_URL } from "@/lib/seo";

const TITLE = "Live ATC radio";
const DESCRIPTION =
  "Listen to live air traffic control from towers around the world over the live 3D map of the traffic around them. Pick a tower from the map, by country or by search.";
const PAGE_URL = `${SITE_URL}/atc`;
const SOCIAL_IMAGE = {
  url: `${SITE_URL}/opengraph-image`,
  width: 1200,
  height: 630,
  alt: `${TITLE} | ${SITE_NAME}`,
};

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: PAGE_URL },
  openGraph: {
    type: "website",
    locale: "en_US",
    url: PAGE_URL,
    siteName: SITE_NAME,
    title: `${TITLE} | ${SITE_NAME}`,
    description: DESCRIPTION,
    images: [SOCIAL_IMAGE],
  },
  twitter: {
    card: "summary_large_image",
    title: `${TITLE} | ${SITE_NAME}`,
    description: DESCRIPTION,
    images: [SOCIAL_IMAGE],
  },
};

/**
 * Only towers whose airport we can place on the map. The client gets this
 * small list instead of the full airport database.
 */
function towers(): { airports: AtcAirport[]; countries: AtcCountry[] } {
  const regions = new Intl.DisplayNames(["en"], { type: "region" });
  const short = new Intl.DisplayNames(["en"], { type: "region", style: "short" });
  const airports: AtcAirport[] = [];
  for (const [icao, feeds] of Object.entries(ATC_FEEDS)) {
    const airport = findAirportByIcao(icao);
    if (!airport || feeds.length === 0) continue;
    airports.push({
      icao,
      iata: airport.iata,
      name: airport.name,
      city: airport.city,
      country: airport.country,
      lat: Math.round(airport.lat * 1e4) / 1e4,
      lng: Math.round(airport.lng * 1e4) / 1e4,
      feeds: [...feeds]
        .sort((a, b) => FEED_TYPE_PRIORITY[a.type] - FEED_TYPE_PRIORITY[b.type])
        .map(({ id, name, frequency, type, mountPoint }) => ({
          id,
          name,
          frequency,
          type,
          mountPoint,
        })),
    });
  }
  airports.sort((a, b) => a.city.localeCompare(b.city));

  const counts = new Map<string, number>();
  for (const airport of airports) {
    counts.set(airport.country, (counts.get(airport.country) ?? 0) + 1);
  }
  const countries = [...counts]
    .map(([code, count]) => ({
      code,
      name: regions.of(code) ?? code,
      short: short.of(code) ?? code,
      count,
    }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  return { airports, countries };
}

export default function AtcPage() {
  const { airports, countries } = towers();
  return <AtcRadio airports={airports} countries={countries} />;
}
