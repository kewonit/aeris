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
import { serializeJsonLd, SITE_NAME, SITE_URL } from "@/lib/seo";

/** IATA codes shown in the UI's city switcher - pre-rendered at build time. */
const PRESET_IATAS = CITIES.map((c) => c.iata.toLowerCase());

export async function generateStaticParams() {
  return PRESET_IATAS.map((code) => ({ code }));
}

/** Opt arbitrary (non-preset) IATAs into dynamic rendering on first request. */
export const dynamicParams = true;

function getCityTitle(city: { name: string; iata: string }) {
  return `Live Flights over ${city.name} (${city.iata.toUpperCase()}) - 3D Flight Tracker`;
}

function getCityDescription(city: { name: string; iata: string }) {
  return `Track flights above ${city.name} in real-time 3D. See live ADS-B aircraft around ${city.iata.toUpperCase()} with altitude-aware rendering - low altitudes glow cyan, high altitudes shift to gold. Free and open source.`;
}

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
      robots: { index: false, follow: true },
    };
  }

  const canonicalPath = buildCanonicalCityPath(city);
  const title = getCityTitle(city);
  const description = getCityDescription(city);
  const socialImage = {
    url: `${SITE_URL}/opengraph-image`,
    width: 1200,
    height: 630,
    alt: title,
  };

  return {
    title,
    description,
    keywords: [
      `${city.name} flight tracker`,
      `${city.name} live flights`,
      `${city.iata.toUpperCase()} flight tracker`,
      `${city.iata.toUpperCase()} arrivals`,
      `${city.iata.toUpperCase()} departures`,
      `flights over ${city.name}`,
      `${city.name} aircraft tracker`,
      `${city.name} plane tracker`,
      `live flights ${city.name}`,
      `${city.iata.toUpperCase()} ADS-B`,
      `3D flight tracker ${city.name}`,
    ],
    alternates: { canonical: canonicalPath },
    openGraph: {
      type: "website",
      locale: "en_US",
      url: `${SITE_URL}${canonicalPath}`,
      siteName: SITE_NAME,
      title,
      description,
      images: [socialImage],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [socialImage],
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
  const canonicalUrl = `${SITE_URL}${buildCanonicalCityPath(city)}`;

  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebPage",
        "@id": `${canonicalUrl}#page`,
        url: canonicalUrl,
        name: `${getCityTitle(city)} | ${SITE_NAME}`,
        description: getCityDescription(city),
        isPartOf: { "@id": `${SITE_URL}/#website` },
        about: { "@id": `${canonicalUrl}#place` },
        breadcrumb: { "@id": `${canonicalUrl}#breadcrumb` },
        inLanguage: "en",
      },
      {
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
        "@type": "BreadcrumbList",
        "@id": `${canonicalUrl}#breadcrumb`,
        itemListElement: [
          {
            "@type": "ListItem",
            position: 1,
            name: SITE_NAME,
            item: SITE_URL,
          },
          {
            "@type": "ListItem",
            position: 2,
            name: `${city.name} (${iataUpper})`,
            item: canonicalUrl,
          },
        ],
      },
    ],
  };

  return (
    <>
      <script
        id="city-jsonld"
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(jsonLd) }}
      />
      <FlightTracker airspaceAvailable={airspaceAvailable} initialCity={city} />
    </>
  );
}
