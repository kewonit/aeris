import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { FlightTracker } from "@/components/flight-tracker";
import { isAirspaceConfigured } from "@/lib/airspace-config";
import { CITIES } from "@/lib/cities";
import {
  buildCanonicalCityPath,
  canonicalizeCityRequest,
  findCityByCode,
} from "@/lib/city-routing";

const siteUrl = "https://aeris.edbn.me";

/** IATA codes shown in the UI's city switcher — pre-rendered at build time. */
const PRESET_IATAS = CITIES.map((c) => c.iata.toLowerCase());

export async function generateStaticParams() {
  return PRESET_IATAS.map((code) => ({ code }));
}

/** Opt arbitrary (non-preset) IATAs into dynamic rendering on first request. */
export const dynamicParams = true;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ code: string }>;
}): Promise<Metadata> {
  const { code } = await params;
  const city = findCityByCode(code);
  if (!city) {
    return {
      title: "City not found",
      robots: { index: false, follow: false },
    };
  }

  const iataUpper = city.iata.toUpperCase();
  const canonicalPath = buildCanonicalCityPath(city);
  const title = `Live Flights over ${city.name} (${iataUpper}) — 3D Flight Tracker`;
  const description = `Track flights above ${city.name} in real-time 3D. See live ADS-B aircraft around ${iataUpper} with altitude-aware rendering — low altitudes glow cyan, high altitudes shift to gold. Free and open source.`;

  return {
    title,
    description,
    keywords: [
      `${city.name} flight tracker`,
      `${city.name} live flights`,
      `${iataUpper} flight tracker`,
      `${iataUpper} arrivals`,
      `${iataUpper} departures`,
      `flights over ${city.name}`,
      `${city.name} aircraft tracker`,
      `${city.name} plane tracker`,
      `live flights ${city.name}`,
      `${iataUpper} ADS-B`,
      `3D flight tracker ${city.name}`,
    ],
    alternates: { canonical: canonicalPath },
    openGraph: {
      type: "website",
      locale: "en_US",
      url: `${siteUrl}${canonicalPath}`,
      siteName: "Aeris",
      title,
      description,
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
    },
    robots: {
      index: true,
      follow: true,
      googleBot: {
        index: true,
        follow: true,
        "max-video-preview": -1,
        "max-image-preview": "large",
        "max-snippet": -1,
      },
    },
  };
}

export default async function CityPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ code }, resolvedSearchParams] = await Promise.all([
    params,
    searchParams,
  ]);

  // Keep a single canonical city URL: lowercase IATA path and no legacy
  // `?city=` query param. Other query params such as `fpv` are preserved.
  const canonicalTarget = canonicalizeCityRequest(code, resolvedSearchParams);
  if (canonicalTarget) {
    permanentRedirect(canonicalTarget);
  }

  const city = findCityByCode(code);
  if (!city) notFound();

  const airspaceAvailable = isAirspaceConfigured();
  const iataUpper = city.iata.toUpperCase();
  const canonicalUrl = `${siteUrl}${buildCanonicalCityPath(city)}`;

  const jsonLd = [
    {
      "@context": "https://schema.org",
      "@type": "WebPage",
      "@id": `${canonicalUrl}#page`,
      url: canonicalUrl,
      name: `Live Flights over ${city.name} (${iataUpper}) — Aeris`,
      description: `Real-time 3D flight tracking above ${city.name} (${iataUpper}).`,
      isPartOf: { "@id": `${siteUrl}/#website` },
      about: { "@id": `${canonicalUrl}#place` },
      inLanguage: "en",
    },
    {
      "@context": "https://schema.org",
      "@type": "Place",
      "@id": `${canonicalUrl}#place`,
      name: city.name,
      geo: {
        "@type": "GeoCoordinates",
        latitude: city.coordinates[1],
        longitude: city.coordinates[0],
      },
      address: {
        "@type": "PostalAddress",
        addressCountry: city.country,
      },
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        {
          "@type": "ListItem",
          position: 1,
          name: "Aeris",
          item: siteUrl,
        },
        {
          "@type": "ListItem",
          position: 2,
          name: `${city.name} (${iataUpper})`,
          item: canonicalUrl,
        },
      ],
    },
  ];

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c"),
        }}
      />
      <FlightTracker airspaceAvailable={airspaceAvailable} initialCity={city} />
    </>
  );
}
