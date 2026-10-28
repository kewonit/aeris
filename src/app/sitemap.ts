import type { MetadataRoute } from "next";
import { CITIES } from "@/lib/cities";
import { SITE_URL } from "@/lib/seo";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: SITE_URL },
    { url: `${SITE_URL}/atc` },
    ...CITIES.map((city) => ({
      url: `${SITE_URL}/city/${city.iata.toLowerCase()}`,
    })),
  ];
}
