import { lookupAirlineLogoSlug, lookupAirlineIata } from "./airlines";

const DIACRITICS_RE = /[\u0300-\u036f]/g;
const NON_ALNUM_RE = /[^a-z0-9]+/g;
const LEADING_TRAILING_DASH_RE = /^-+|-+$/g;

function normalizeAirlineText(value: string): string {
  return value.normalize("NFD").replace(DIACRITICS_RE, "").toLowerCase().trim();
}

function slugFromNormalized(normalized: string): string {
  return normalized
    .replace(NON_ALNUM_RE, "-")
    .replace(LEADING_TRAILING_DASH_RE, "");
}

function aliasKeyFromNormalized(normalized: string): string {
  return normalized.replace(NON_ALNUM_RE, "");
}

const LOGO_SLUG_ALIASES: Record<string, string> = {
  allnipponairways: "all-nippon-airways",
  ana: "all-nippon-airways",
  jal: "japan-airlines",
  elal: "el-al",
  itaairways: "ita-airways",
  alitaliaitaairways: "ita-airways",
  latam: "latam-airlines",
  latamairlines: "latam-airlines",
  latambrasil: "latam-airlines",
  latamperu: "latam-airlines",
  norwegian: "norwegian-air-shuttle",
  norwegianairinternational: "norwegian",
  norwegianairintl: "norwegian",
  norwegianairsweden: "norwegian",
  swiss: "swiss",
  swissintlairlines: "swiss",
  tapairportugal: "tap-air-portugal",
  vietjetair: "vietjet-air",
  xiamenair: "xiamenair",
  xiamenairlines: "xiamen-airlines",
  pakistaninternationalairlines: "pakistan-international-airlines",
  pakistanintlairlines: "pakistan-int-l-airlines",
  indigo: "indigo",
  indigoairlines: "indigo",
  goindigo: "indigo",
  dhlairuk: "dhl",
  dhlaeroexpreso: "dhl",
  dhlinternational: "dhl",
  dhl: "dhl",
  aerologic: "dhl",
  bluedartaviation: "dhl",
  lufthansacargo: "lufthansa",
  lufthansacityline: "lufthansa",
  singaporeairlinescargo: "singapore-airlines",
  airchinacargo: "air-china",
  britishairways: "british-airways",
  britishairwaysshuttle: "british-airways",
  martinair: "klm",
  pobeda: "aeroflot",
  laudaeurope: "ryanair",
  scandinavianairlines: "scandinavian-airlines",
  sas: "sas",
  egyptair: "egyptair",
  starluxairlines: "starlux-airlines",
  starlux: "starlux-airlines",
  zipair: "zipair",
  zipairtokyo: "zipair",
  gol: "gol",
  klm: "klm",
  tuiairways: "tui-airways",
  tui: "tui-airways",
  tuiflybelgium: "tui-airways",
  tuiflynetherlands: "tui-fly-netherlands",
  tuiflydeutschland: "tui-airways",
  azul: "azul",
  europeanairinternationalleipzig: "dhl",
  europeanairintlleipzig: "dhl",
  europeanairintl: "dhl",
  eatleipzig: "dhl",
  bacityflyer: "british-airways",
  aircanadароuge: "air-canada",
  aircanadaexpress: "air-canada",
  horizonair: "alaska-airlines",
  aeromexicoconnect: "aeromexico",
  anavings: "all-nippon-airways",
  anawings: "all-nippon-airways",
  airjapan: "all-nippon-airways",
  japanaircommuter: "japan-airlines",
  jair: "japan-airlines",
  latamcargocolombia: "latam-airlines",
  cargoluxitalia: "cargolux",
  s7: "s7-airlines",
  s7airlines: "s7-airlines",
  hop: "air-france",
  wizzairuk: "wizz-air",
  netjets: "netjets",
  netjetseurope: "netjets",
  smartwings: "smartwings",
  flynas: "flynas",
  // Subsidiary → parent brand aliases
  deltaconnection: "delta-air-lines",
  americaneagle: "american-airlines",
  unitedexpress: "united-airlines",
  southwestcargo: "southwest-airlines",
  qantaslink: "qantas",
  qantasfreight: "qantas",
  airfrancecargo: "air-france",
  envoyair: "american-airlines",
  mesaairlines: "american-airlines",
  psaairlines: "american-airlines",
  piedmontairlines: "american-airlines",
  skywestairlines: "united-airlines",
  republicairways: "united-airlines",
  endeavorair: "delta-air-lines",
  gojetairlines: "united-airlines",
  compassairlines: "delta-air-lines",
  expressjet: "united-airlines",
  aircanadajazz: "air-canada",
  airnorthcharter: "air-north",
  fedexexpress: "fedex-express",
  fedexcargo: "fedex-express",
  fedex: "fedex-express",
  upsairlines: "ups-airlines",
  ups: "ups-airlines",
  polaraircargo: "atlas-air",
  // Brand unification aliases
  tuifly: "tui-airways",
  airasiax: "airasia",
  airasiaindia: "airasia",
  indonesiaairasia: "airasia",
  thaiairasia: "airasia",
  philippineairasia: "airasia",
  peachaviation: "peach-aviation",
  scoot: "scoot",
  tigerair: "scoot",
  nokscoot: "nok-air",
  westjet: "westjet",
  westjetencore: "westjet",
  flybe: "flybe",
  ryanairsun: "ryanair",
  ryanairuk: "ryanair",
  maltair: "ryanair",
  buzzairlines: "ryanair",
  emirates: "emirates",
  emiratesskycargo: "emirates",
  cathaypacific: "cathay-pacific",
  cathaypacificcargo: "cathay-pacific",
  airhongkong: "cathay-pacific",
  southwest: "southwest-airlines",
  southwestairlines: "southwest-airlines",
  delta: "delta-air-lines",
  deltaairlines: "delta-air-lines",
  united: "united-airlines",
  unitedairlines: "united-airlines",
  american: "american-airlines",
  americanairlines: "american-airlines",
  easyjeteurope: "easyjet",
};

function buildSlugVariants(baseSlug: string): string[] {
  if (!baseSlug) return [];
  const variants = new Set<string>([baseSlug]);

  const suffixes = [
    // Operational suffixes (stripped first, exposes parent brand)
    "-cargo",
    "-freight",
    "-express",
    "-regional",
    "-shuttle",
    "-connect",
    "-connection",
    "-commuter",
    "-charter",
    "-leasing",
    "-services",
    // Branding suffixes
    "-airlines",
    "-airline",
    "-airways",
    "-air",
    "-international",
    "-int-l",
    "-intl",
    "-aviation",
    "-transport",
    // Geographic suffixes
    "-uk",
    "-europe",
    "-asia",
    "-america",
    "-india",
    "-japan",
    "-group",
  ];

  // Iteratively strip suffixes to handle multi‑suffix names
  // e.g. "southwest-airlines-cargo" → "southwest-airlines" → "southwest"
  let changed = true;
  while (changed) {
    changed = false;
    for (const v of [...variants]) {
      for (const suffix of suffixes) {
        if (v.endsWith(suffix)) {
          const stripped = v.slice(0, -suffix.length);
          if (stripped && !variants.has(stripped)) {
            variants.add(stripped);
            changed = true;
          }
        }
      }
    }
  }

  return Array.from(variants).filter(Boolean);
}

/** CDN fallback URL for an IATA code. */
const LOGO_CDN = "https://images.kiwi.com/airlines/64x64";

export function airlineLogoCandidates(
  airlineName: string | null,
  callsign?: string | null,
): string[] {
  const candidates: string[] = [];

  // ── 1. Direct logoSlug from ICAO lookup (highest priority) ──────────
  const directSlug = callsign ? lookupAirlineLogoSlug(callsign) : null;
  if (directSlug) {
    candidates.push(`/airline-logos/${directSlug}.svg`);
    candidates.push(`/airline-logos/${directSlug}.png`);
  }

  // ── 2. Name-based slug candidates ───────────────────────────────────
  if (airlineName) {
    const normalized = normalizeAirlineText(airlineName);
    const slug = slugFromNormalized(normalized);
    const aliasKey = aliasKeyFromNormalized(normalized);
    const aliasSlug = LOGO_SLUG_ALIASES[aliasKey] ?? null;

    const orderedSlugs = Array.from(
      new Set([
        ...buildSlugVariants(slug),
        ...(aliasSlug ? buildSlugVariants(aliasSlug) : []),
      ]),
    );

    for (const s of orderedSlugs) {
      const svgPath = `/airline-logos/${s}.svg`;
      const pngPath = `/airline-logos/${s}.png`;
      if (!candidates.includes(svgPath)) candidates.push(svgPath);
      if (!candidates.includes(pngPath)) candidates.push(pngPath);
    }
  }

  // ── 3. CDN fallback via IATA code ───────────────────────────────────
  const iata = callsign ? lookupAirlineIata(callsign) : null;
  if (iata) {
    candidates.push(`${LOGO_CDN}/${iata}.png`);
  }

  return candidates;
}
