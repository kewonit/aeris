import { FlightTracker } from "@/components/flight-tracker";

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: "Aeris Mercosul",
  url: "https://aeris-flight.vercel.app",
  description:
    "Track live flights in 3D over the world's busiest airspaces. Altitude-aware, beautifully rendered, and completely free.",
  applicationCategory: "TravelApplication",
  operatingSystem: "Any",
  offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  author: { "@type": "Person", name: "kewonit" },
};

export default function Home() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c"),
        }}
      />
      <FlightTracker />
    </>
  );
}
