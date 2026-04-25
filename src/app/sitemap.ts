import type { MetadataRoute } from "next";
import { CITIES } from "@/lib/cities";

const siteUrl = "https://aeris.edbn.me";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return [
    {
      url: siteUrl,
      lastModified: now,
      changeFrequency: "daily",
      priority: 1,
    },
    ...CITIES.map((city) => ({
      url: `${siteUrl}/city/${city.iata.toLowerCase()}`,
      lastModified: now,
      changeFrequency: "daily" as const,
      priority: 0.8,
    })),
  ];
}
