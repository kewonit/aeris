/**
 * Comprehensive country name → ISO 3166-1 alpha-2 mapping.
 *
 * Covers all ICAO / OpenSky originCountry values, common aliases,
 * and historical names. Optimised for lookup speed (single pass,
 * normalised keys, early return).
 */

const COUNTRY_NAME_TO_ISO: Record<string, string> = {
  // ── A ──────────────────────────────────────────────────────────────────
  afghanistan: "AF",
  "aland islands": "AX",
  aland: "AX",
  albania: "AL",
  algeria: "DZ",
  "american samoa": "AS",
  andorra: "AD",
  angola: "AO",
  anguilla: "AI",
  antarctica: "AQ",
  "antigua and barbuda": "AG",
  antigua: "AG",
  argentina: "AR",
  armenia: "AM",
  aruba: "AW",
  australia: "AU",
  austria: "AT",
  azerbaijan: "AZ",

  // ── B ──────────────────────────────────────────────────────────────────
  bahamas: "BS",
  "the bahamas": "BS",
  bahrain: "BH",
  bangladesh: "BD",
  barbados: "BB",
  belarus: "BY",
  belgium: "BE",
  belize: "BZ",
  benin: "BJ",
  bermuda: "BM",
  bhutan: "BT",
  bolivia: "BO",
  "bolivia (plurinational state of)": "BO",
  "plurinational state of bolivia": "BO",
  "bonaire, sint eustatius and saba": "BQ",
  bonaire: "BQ",
  "sint eustatius": "BQ",
  saba: "BQ",
  bosnia: "BA",
  "bosnia and herzegovina": "BA",
  botswana: "BW",
  "bouvet island": "BV",
  brazil: "BR",
  "british indian ocean territory": "IO",
  "brunei darussalam": "BN",
  brunei: "BN",
  bulgaria: "BG",
  "burkina faso": "BF",
  burundi: "BI",

  // ── C ──────────────────────────────────────────────────────────────────
  "cabo verde": "CV",
  "cape verde": "CV",
  cambodia: "KH",
  cameroon: "CM",
  canada: "CA",
  "cayman islands": "KY",
  "central african republic": "CF",
  chad: "TD",
  chile: "CL",
  china: "CN",
  "christmas island": "CX",
  "cocos (keeling) islands": "CC",
  "cocos islands": "CC",
  colombia: "CO",
  comoros: "KM",
  congo: "CG",
  "congo (brazzaville)": "CG",
  "congo, republic of the": "CG",
  "congo (kinshasa)": "CD",
  "congo, democratic republic of the": "CD",
  "democratic republic of the congo": "CD",
  "dr congo": "CD",
  "cook islands": "CK",
  "costa rica": "CR",
  croatia: "HR",
  cuba: "CU",
  curacao: "CW",
  cyprus: "CY",
  czechia: "CZ",
  "czech republic": "CZ",
  "cote d'ivoire": "CI",
  "côte d'ivoire": "CI",
  "ivory coast": "CI",

  // ── D ──────────────────────────────────────────────────────────────────
  denmark: "DK",
  djibouti: "DJ",
  dominica: "DM",
  "dominican republic": "DO",

  // ── E ──────────────────────────────────────────────────────────────────
  ecuador: "EC",
  egypt: "EG",
  "el salvador": "SV",
  "equatorial guinea": "GQ",
  eritrea: "ER",
  estonia: "EE",
  eswatini: "SZ",
  swaziland: "SZ",
  ethiopia: "ET",

  // ── F ──────────────────────────────────────────────────────────────────
  "falkland islands (malvinas)": "FK",
  "falkland islands": "FK",
  malvinas: "FK",
  "faroe islands": "FO",
  fiji: "FJ",
  finland: "FI",
  france: "FR",
  "french guiana": "GF",
  "french polynesia": "PF",
  "french southern territories": "TF",

  // ── G ──────────────────────────────────────────────────────────────────
  gabon: "GA",
  gambia: "GM",
  "the gambia": "GM",
  georgia: "GE",
  germany: "DE",
  ghana: "GH",
  gibraltar: "GI",
  greece: "GR",
  greenland: "GL",
  grenada: "GD",
  guadeloupe: "GP",
  guam: "GU",
  guatemala: "GT",
  guernsey: "GG",
  guinea: "GN",
  "guinea-bissau": "GW",
  "guinea bissau": "GW",
  guyana: "GY",

  // ── H ──────────────────────────────────────────────────────────────────
  haiti: "HT",
  "heard island and mcdonald islands": "HM",
  "holy see": "VA",
  vatican: "VA",
  honduras: "HN",
  "hong kong": "HK",
  hungary: "HU",

  // ── I ──────────────────────────────────────────────────────────────────
  iceland: "IS",
  india: "IN",
  indonesia: "ID",
  iran: "IR",
  "iran (islamic republic of)": "IR",
  iraq: "IQ",
  ireland: "IE",
  "isle of man": "IM",
  israel: "IL",
  italy: "IT",

  // ── J ──────────────────────────────────────────────────────────────────
  jamaica: "JM",
  japan: "JP",
  jersey: "JE",
  jordan: "JO",

  // ── K ──────────────────────────────────────────────────────────────────
  kazakhstan: "KZ",
  kenya: "KE",
  kiribati: "KI",
  "korea (democratic people's republic of)": "KP",
  "north korea": "KP",
  "democratic people's republic of korea": "KP",
  "korea, republic of": "KR",
  "south korea": "KR",
  "republic of korea": "KR",
  kosovo: "XK",
  kuwait: "KW",
  kyrgyzstan: "KG",

  // ── L ──────────────────────────────────────────────────────────────────
  laos: "LA",
  "lao people's democratic republic": "LA",
  latvia: "LV",
  lebanon: "LB",
  lesotho: "LS",
  liberia: "LR",
  libya: "LY",
  liechtenstein: "LI",
  lithuania: "LT",
  luxembourg: "LU",

  // ── M ──────────────────────────────────────────────────────────────────
  macao: "MO",
  macau: "MO",
  madagascar: "MG",
  malawi: "MW",
  malaysia: "MY",
  maldives: "MV",
  mali: "ML",
  malta: "MT",
  "marshall islands": "MH",
  martinique: "MQ",
  mauritania: "MR",
  mauritius: "MU",
  mayotte: "YT",
  mexico: "MX",
  micronesia: "FM",
  "micronesia (federated states of)": "FM",
  "federated states of micronesia": "FM",
  moldova: "MD",
  "republic of moldova": "MD",
  monaco: "MC",
  mongolia: "MN",
  montenegro: "ME",
  montserrat: "MS",
  morocco: "MA",
  mozambique: "MZ",
  myanmar: "MM",
  burma: "MM",

  // ── N ──────────────────────────────────────────────────────────────────
  namibia: "NA",
  nauru: "NR",
  nepal: "NP",
  netherlands: "NL",
  "the netherlands": "NL",
  "new caledonia": "NC",
  "new zealand": "NZ",
  nicaragua: "NI",
  niger: "NE",
  nigeria: "NG",
  niue: "NU",
  "norfolk island": "NF",
  "north macedonia": "MK",
  macedonia: "MK",
  "northern mariana islands": "MP",
  norway: "NO",

  // ── O ──────────────────────────────────────────────────────────────────
  oman: "OM",

  // ── P ──────────────────────────────────────────────────────────────────
  pakistan: "PK",
  palau: "PW",
  "palestine, state of": "PS",
  palestine: "PS",
  panama: "PA",
  "papua new guinea": "PG",
  paraguay: "PY",
  peru: "PE",
  philippines: "PH",
  pitcairn: "PN",
  poland: "PL",
  portugal: "PT",
  "puerto rico": "PR",

  // ── Q ──────────────────────────────────────────────────────────────────
  qatar: "QA",

  // ── R ──────────────────────────────────────────────────────────────────
  reunion: "RE",
  réunion: "RE",
  romania: "RO",
  "russian federation": "RU",
  russia: "RU",
  rwanda: "RW",

  // ── S ──────────────────────────────────────────────────────────────────
  "saint barthelemy": "BL",
  "saint barthélemy": "BL",
  "saint helena, ascension and tristan da cunha": "SH",
  "saint helena": "SH",
  "saint kitts and nevis": "KN",
  "saint lucia": "LC",
  "saint martin (french part)": "MF",
  "saint martin": "MF",
  "saint pierre and miquelon": "PM",
  "saint vincent and the grenadines": "VC",
  samoa: "WS",
  "san marino": "SM",
  "sao tome and principe": "ST",
  "são tomé and príncipe": "ST",
  "saudi arabia": "SA",
  senegal: "SN",
  serbia: "RS",
  seychelles: "SC",
  "sierra leone": "SL",
  singapore: "SG",
  "sint maarten (dutch part)": "SX",
  "sint maarten": "SX",
  slovakia: "SK",
  slovenia: "SI",
  "solomon islands": "SB",
  somalia: "SO",
  "south africa": "ZA",
  "south georgia and the south sandwich islands": "GS",
  "south sudan": "SS",
  spain: "ES",
  "sri lanka": "LK",
  sudan: "SD",
  suriname: "SR",
  "svalbard and jan mayen": "SJ",
  sweden: "SE",
  switzerland: "CH",
  "syrian arab republic": "SY",
  syria: "SY",

  // ── T ──────────────────────────────────────────────────────────────────
  taiwan: "TW",
  "taiwan, province of china": "TW",
  tajikistan: "TJ",
  "tanzania, united republic of": "TZ",
  tanzania: "TZ",
  thailand: "TH",
  "timor-leste": "TL",
  "timor leste": "TL",
  "east timor": "TL",
  togo: "TG",
  tokelau: "TK",
  tonga: "TO",
  "trinidad and tobago": "TT",
  tunisia: "TN",
  turkey: "TR",
  turkiye: "TR",
  turkmenistan: "TM",
  "turks and caicos islands": "TC",
  tuvalu: "TV",

  // ── U ──────────────────────────────────────────────────────────────────
  uganda: "UG",
  ukraine: "UA",
  "united arab emirates": "AE",
  uae: "AE",
  "united kingdom of great britain and northern ireland": "GB",
  "united kingdom": "GB",
  uk: "GB",
  "great britain": "GB",
  "united states of america": "US",
  "united states": "US",
  usa: "US",
  "united states minor outlying islands": "UM",
  uruguay: "UY",
  uzbekistan: "UZ",

  // ── V ──────────────────────────────────────────────────────────────────
  vanuatu: "VU",
  "venezuela (bolivarian republic of)": "VE",
  venezuela: "VE",
  "bolivarian republic of venezuela": "VE",
  "viet nam": "VN",
  vietnam: "VN",
  "virgin islands (british)": "VG",
  "british virgin islands": "VG",
  "virgin islands (u.s.)": "VI",
  "u.s. virgin islands": "VI",
  "united states virgin islands": "VI",

  // ── W ──────────────────────────────────────────────────────────────────
  "wallis and futuna": "WF",
  "western sahara": "EH",

  // ── Y ──────────────────────────────────────────────────────────────────
  yemen: "YE",

  // ── Z ──────────────────────────────────────────────────────────────────
  zambia: "ZM",
  zimbabwe: "ZW",
};

/**
 * Convert a country name (as returned by OpenSky / ICAO) to an ISO 3166-1
 * alpha-2 code.  Handles normalisation, trimming, and common aliases.
 *
 * @param name  Raw country name, e.g. "United States", "Russian Federation"
 * @returns     Two-letter ISO code, or `null` if unknown.
 */
export function countryNameToIso(name: string | null | undefined): string | null {
  if (!name) return null;
  const key = name.trim().toLowerCase().replace(/[\s\-]+/g, " ");
  if (!key) return null;
  return COUNTRY_NAME_TO_ISO[key] ?? null;
}

/**
 * Fast check: does the given string look like a 2-letter ISO code?
 */
export function looksLikeIsoCode(value: string | null | undefined): boolean {
  if (!value) return false;
  return /^[A-Z]{2}$/i.test(value.trim());
}
