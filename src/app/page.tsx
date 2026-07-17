import { FlightTracker } from "@/components/flight-tracker";
import { isAirspaceConfigured } from "@/lib/airspace-config";
import packageJson from "../../package.json";
import {
  DEFAULT_DESCRIPTION,
  serializeJsonLd,
  SITE_NAME,
  SITE_URL,
} from "@/lib/seo";

const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebSite",
      "@id": `${SITE_URL}/#website`,
      name: SITE_NAME,
      alternateName: "aeris.edbn.me",
      url: SITE_URL,
      description: DEFAULT_DESCRIPTION,
      inLanguage: "en",
      publisher: {
        "@type": "Person",
        "@id": `${SITE_URL}/#publisher`,
        name: "kewonit",
        url: "https://github.com/kewonit",
      },
    },
    {
      "@type": "WebApplication",
      "@id": `${SITE_URL}/#app`,
      name: SITE_NAME,
      url: SITE_URL,
      description: DEFAULT_DESCRIPTION,
      isPartOf: { "@id": `${SITE_URL}/#website` },
      applicationCategory: "TravelApplication",
      operatingSystem: "Any",
      browserRequirements: "Requires WebGL support",
      offers: {
        "@type": "Offer",
        price: "0",
        priceCurrency: "USD",
        availability: "https://schema.org/OnlineOnly",
      },
      author: {
        "@type": "Person",
        "@id": `${SITE_URL}/#publisher`,
        name: "kewonit",
        url: "https://github.com/kewonit",
      },
      featureList: [
        "Real-time 3D flight tracking",
        "Altitude-aware color rendering",
        "Live ADS-B data from multiple sources",
        "3D aircraft models",
        "City-based airspace views",
        "Live ATC audio streaming",
        "Flight trail visualization",
        "Aircraft photo lookup",
        "Dark mode interface",
      ],
      screenshot: `${SITE_URL}/opengraph-image`,
      softwareVersion: packageJson.version,
      isAccessibleForFree: true,
      inLanguage: "en",
    },
  ],
};

export default function Home() {
  const airspaceAvailable = isAirspaceConfigured();

  return (
    <>
      <script
        id="home-jsonld"
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(jsonLd) }}
      />
      <FlightTracker airspaceAvailable={airspaceAvailable} />
    </>
  );
}
