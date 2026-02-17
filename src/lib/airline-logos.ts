function normalizeAirlineText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function toAirlineLogoSlug(airlineName: string): string {
  return normalizeAirlineText(airlineName)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function toAirlineAliasKey(airlineName: string): string {
  return normalizeAirlineText(airlineName).replace(/[^a-z0-9]+/g, "");
}

const LOGO_SLUG_ALIASES: Record<string, string> = {
  allnipponairways: "all-nippon-airways",
  ana: "all-nippon-airways",
  jal: "japan-airlines",
  elal: "el-al",
  itaairways: "ita-airways",
  latam: "latam-airlines",
  latamairlines: "latam-airlines",
  norwegian: "norwegian-air-shuttle",
  swiss: "swiss",
  tapairportugal: "tap-air-portugal",
  vietjetair: "vietjet-air",
  xiamenair: "xiamenair",
  pakistaninternationalairlines: "pakistan-international-airlines",
  pakistanintlairlines: "pakistan-int-l-airlines",
  indigo: "indigo",
  indigoairlines: "indigo",
  goindigo: "indigo",
};

function buildSlugVariants(baseSlug: string): string[] {
  if (!baseSlug) return [];

  const variants = new Set<string>([baseSlug]);
  variants.add(baseSlug.replace(/-airlines$/, ""));
  variants.add(baseSlug.replace(/-airline$/, ""));
  variants.add(baseSlug.replace(/-airways$/, ""));
  variants.add(baseSlug.replace(/-air$/, ""));
  variants.add(baseSlug.replace(/-international$/, ""));
  variants.add(baseSlug.replace(/-int-l$/, ""));
  variants.add(baseSlug.replace(/-intl$/, ""));

  return Array.from(variants).filter(Boolean);
}

export function airlineLogoCandidates(airlineName: string | null): string[] {
  if (!airlineName) return [];

  const slug = toAirlineLogoSlug(airlineName);
  const aliasKey = toAirlineAliasKey(airlineName);
  const aliasSlug = LOGO_SLUG_ALIASES[aliasKey] ?? null;

  const orderedSlugs = Array.from(
    new Set([
      ...buildSlugVariants(slug),
      ...(aliasSlug ? buildSlugVariants(aliasSlug) : []),
    ]),
  );

  if (orderedSlugs.length === 0) return [];

  const candidates: string[] = [];
  for (const s of orderedSlugs) {
    candidates.push(`/airline-logos/${s}.svg`);
    candidates.push(`/airline-logos/${s}.png`);
  }

  return candidates;
}
