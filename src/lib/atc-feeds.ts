import type { AtcFeed } from "./atc-types";

/**
 * Static ATC feed database mapping ICAO codes to LiveATC feed entries.
 *
 * ── Data Sources & Verification ──────────────────────────────────────
 *
 * Mount points verified against three independent sources:
 *
 * 1. Direct HTTP testing against d.liveatc.net (confirmed 200 responses):
 *    ksfo_twr, ksfo_gnd, kjfk_twr, kjfk_gnd, klax_twr, klax_gnd,
 *    katl_twr, katl_gnd
 *
 * 2. LiveATC feed database (RoMinjun/lofiatc.ps1 atc_sources.csv):
 *    Comprehensive CSV scraped from LiveATC website pages containing
 *    all publicly listed feed mount points.
 *
 * 3. amsterdam-flight-vibe (frankwiersma) verified feeds:
 *    Feed names explicitly verified against liveatc.net hlisten.php
 *    mount= URLs by the project author.
 *
 * ── Important Notes ──────────────────────────────────────────────────
 *
 * - Airports NOT covered by LiveATC have been removed.
 *   Many major European airports (CDG, Frankfurt, Munich,
 *   Madrid, Barcelona, Rome, etc.) have NO LiveATC feeds — ATC radio
 *   broadcasting is restricted or illegal in those countries.
 *
 * - LiveATC mount point naming is NOT standardized. It varies wildly
 *   per airport (e.g., KORD uses kord1n2_twr_n, not kord_twr).
 *
 * - Stream URLs use the .pls playlist format which resolves to Icecast
 *   endpoints (d.liveatc.net / d2.liveatc.net).
 *
 * Coverage: 633 airports across all continents with documented LiveATC feeds.
 * Last verified: March 2026
 */

function feed(
  icao: string,
  type: AtcFeed["type"],
  name: string,
  frequency: string,
  mountPoint: string,
): AtcFeed {
  return {
    id: `${icao.toLowerCase()}-${type}`,
    icao,
    name,
    frequency,
    type,
    mountPoint,
    streamUrl: `https://www.liveatc.net/play/${mountPoint}.pls`,
  };
}

// Helper for airports with multiple feeds of the same type
function feedN(
  icao: string,
  type: AtcFeed["type"],
  name: string,
  frequency: string,
  mountPoint: string,
  suffix: string,
): AtcFeed {
  return {
    id: `${icao.toLowerCase()}-${type}-${suffix}`,
    icao,
    name,
    frequency,
    type,
    mountPoint,
    streamUrl: `https://www.liveatc.net/play/${mountPoint}.pls`,
  };
}

/**
 * ATC feed database indexed by ICAO code.
 * Only includes airports with verified LiveATC mount points.
 */
export const ATC_FEEDS: Record<string, AtcFeed[]> = {
  // ── United States ────────────────────────────────────────────────
  // Sources: direct HTTP 200 testing + lofiatc CSV + amsterdam-flight-vibe

  KJFK: [
    // HTTP 200 confirmed; CSV; amsterdam-flight-vibe verified
    feed("KJFK", "tower", "JFK Tower", "119.100", "kjfk_twr"),
    feed("KJFK", "ground", "JFK Ground", "121.900", "kjfk_gnd"),
    feedN(
      "KJFK",
      "approach",
      "NY Approach (Final)",
      "128.125",
      "kjfk_bw_app_final",
      "final",
    ),
    feed("KJFK", "departure", "NY Departure", "135.900", "kjfk_dep"),
    feed("KJFK", "atis", "JFK D-ATIS", "128.725", "kjfk_atis"),
  ],

  KLAX: [
    // HTTP 200 confirmed; CSV verified
    feed("KLAX", "tower", "LAX Tower N/S", "133.900", "klax_twr"),
    feed("KLAX", "ground", "LAX Ground N/S", "121.650", "klax_gnd"),
    feedN("KLAX", "tower", "LAX Tower South", "120.950", "klax4", "south"),
    feedN("KLAX", "approach", "LAX Final App N/S", "124.500", "klax6", "final"),
    feedN("KLAX", "departure", "LAX Dep/West App", "125.200", "klax7", "west"),
    feed("KLAX", "atis", "LAX ATIS (Arrival)", "133.800", "klax4n_atis_arr"),
  ],

  KORD: [
    // amsterdam-flight-vibe verified; CSV confirmed
    feed("KORD", "tower", "O'Hare Tower North", "132.700", "kord1n2_twr_n"),
    feedN(
      "KORD",
      "tower",
      "O'Hare Towers S Side",
      "120.750",
      "kord1s1_twr_s",
      "south",
    ),
    feed(
      "KORD",
      "ground",
      "O'Hare Ground Outbound",
      "121.750",
      "kord1n2_gnd_out",
    ),
    feedN(
      "KORD",
      "approach",
      "Chicago App 10R/28C",
      "133.625",
      "kord1n2_app_133625",
      "28c",
    ),
    feedN(
      "KORD",
      "approach",
      "Chicago App 27L/09R",
      "119.000",
      "kord1n2_app_119000",
      "27l",
    ),
    feed("KORD", "atis", "O'Hare ATIS", "135.400", "kord1s1_atis"),
  ],

  KATL: [
    // HTTP 200 confirmed; CSV; amsterdam-flight-vibe verified
    feed("KATL", "tower", "Atlanta Tower", "119.100", "katl_twr"),
    feedN(
      "KATL",
      "tower",
      "Atlanta Tower 8R/26L",
      "119.500",
      "katl_twr_08r26l",
      "08r26l",
    ),
    feed("KATL", "ground", "Atlanta Ground", "121.900", "katl_gnd"),
    feed(
      "KATL",
      "approach",
      "Atlanta Final 28/10",
      "127.250",
      "katl_app_fin_a",
    ),
    feed("KATL", "atis", "Atlanta ATIS (Arrival)", "127.900", "katl_atis_arr"),
    feed("KATL", "departure", "Atlanta Departure N", "125.325", "katl_dep_n"),
  ],

  KDFW: [
    // CSV verified
    feed("KDFW", "tower", "DFW Tower East", "126.550", "kdfw1_twr1_e"),
    feed("KDFW", "ground", "DFW Ground East", "121.650", "kdfw1_gnd_e_12165"),
    feedN(
      "KDFW",
      "ground",
      "DFW Ground West",
      "121.800",
      "kdfw1_gnd_w",
      "west",
    ),
    feed(
      "KDFW",
      "approach",
      "DFW Final 17C/35C",
      "118.050",
      "kdfw1_app_fin_17c",
    ),
    feed(
      "KDFW",
      "departure",
      "DFW Departure East",
      "126.925",
      "kdfw1_dep_east",
    ),
    feed("KDFW", "atis", "DFW ATIS (Arrival)", "134.900", "kdfw1_atis_arr"),
  ],

  KSFO: [
    // HTTP 200 confirmed; CSV verified
    feed("KSFO", "tower", "SFO Tower", "120.500", "ksfo_twr"),
    feed("KSFO", "ground", "SFO Ground", "121.800", "ksfo_gnd"),
    feed("KSFO", "approach", "NORCAL App 28L/R", "135.650", "ksfo_app2"),
    feed("KSFO", "departure", "NORCAL Departure", "120.900", "ksfo_dep1"),
    feed("KSFO", "atis", "SFO D-ATIS", "118.850", "ksfo_atis"),
  ],

  KMIA: [
    // CSV verified
    feed("KMIA", "tower", "Miami Tower", "118.300", "kmia3_twr"),
    feedN(
      "KMIA",
      "tower",
      "Miami Tower North",
      "118.300",
      "kmia3_twr_1183",
      "north",
    ),
    feed("KMIA", "ground", "Miami Ground", "121.800", "kmia3_gnd"),
    feed("KMIA", "departure", "Miami Departure S", "125.500", "kmia3_dep_1255"),
    feed("KMIA", "atis", "Miami ATIS (Arrival)", "128.175", "kmia3_atis_arr"),
  ],

  KEWR: [
    // CSV verified
    feed("KEWR", "tower", "Newark Tower", "118.300", "kewr_twr"),
    feed("KEWR", "ground", "Newark Ground", "121.800", "kewr_gnd_pri"),
    feed("KEWR", "approach", "Newark App (Final)", "124.350", "kewr_app_final"),
    feed("KEWR", "departure", "Newark Departure", "129.425", "kewr_dep"),
    feed("KEWR", "atis", "Newark ATIS", "115.500", "kewr_atis"),
  ],

  KSEA: [
    // CSV verified
    feed("KSEA", "tower", "Seattle Tower East", "119.900", "ksea3_twr_east"),
    feedN(
      "KSEA",
      "tower",
      "Seattle Tower West",
      "120.400",
      "ksea3_twr_west",
      "west",
    ),
    feed("KSEA", "ground", "Seattle Ground", "121.700", "ksea3_gnd"),
    feed("KSEA", "approach", "Seattle Approach E", "124.200", "ksea3_app_e"),
    feed(
      "KSEA",
      "departure",
      "Seattle Departure E",
      "120.200",
      "ksea3_dep_east",
    ),
  ],

  KBOS: [
    // CSV verified
    feed("KBOS", "tower", "Boston Tower", "128.800", "kbos_twr"),
    feed("KBOS", "ground", "Boston Del/Gnd", "121.900", "kbos_gnd"),
    feedN(
      "KBOS",
      "approach",
      "Boston App (Final)",
      "120.600",
      "kbos_final",
      "final",
    ),
    feedN(
      "KBOS",
      "approach",
      "Boston App North",
      "124.400",
      "kbos_app_north",
      "north",
    ),
    feed("KBOS", "departure", "Boston Departure", "133.000", "kbos_dep"),
  ],

  KMSP: [
    // CSV verified
    feed("KMSP", "tower", "Minneapolis Tower 12L", "126.700", "kmsp3_twr_12l"),
    feedN(
      "KMSP",
      "tower",
      "Minneapolis Tower 17/35",
      "119.300",
      "kmsp3_twr_1735",
      "1735",
    ),
    feed("KMSP", "approach", "Minneapolis App NE", "119.350", "kmsp3_app_ne"),
    feedN(
      "KMSP",
      "approach",
      "Minneapolis App SW",
      "123.825",
      "kmsp3_app_sw",
      "sw",
    ),
    feed("KMSP", "departure", "Minneapolis Dep NE", "135.350", "kmsp3_dep_ne"),
  ],

  KPHX: [
    // CSV verified
    feed("KPHX", "tower", "Phoenix Tower N/S", "118.700", "kphx_twr_both"),
    feed("KPHX", "ground", "Phoenix Ground N", "119.750", "kphx_gnd_n1"),
    feed(
      "KPHX",
      "approach",
      "Phoenix App Pima/Willy",
      "123.700",
      "kphx4_app_pima_willy",
    ),
    feedN(
      "KPHX",
      "approach",
      "Phoenix App SDL/West",
      "120.700",
      "kphx_app_sat",
      "sat",
    ),
    feed("KPHX", "departure", "Phoenix Departure", "132.550", "kphx_dep"),
  ],

  KDTW: [
    // CSV verified
    feed("KDTW", "tower", "Detroit Tower", "135.000", "kdtw_twr"),
    feed("KDTW", "ground", "Detroit Ground", "121.800", "kdtw_gnd"),
    feed("KDTW", "approach", "Detroit Approach", "118.400", "kdtw_app"),
  ],

  KIAD: [
    // CSV verified
    feed("KIAD", "tower", "Dulles Tower Combined", "120.100", "kiad1_3_4"),
    feed("KIAD", "ground", "Dulles Del/Gnd", "121.900", "kiad1_1"),
    feed("KIAD", "approach", "Dulles App South", "120.450", "kiad1_6"),
    feedN(
      "KIAD",
      "approach",
      "Dulles App North",
      "127.325",
      "kiad2_1",
      "north",
    ),
    feed("KIAD", "departure", "Dulles Departure", "128.475", "kiad2_2"),
    feed("KIAD", "atis", "Dulles ATIS", "134.850", "kiad1_8"),
  ],

  KCLT: [
    // CSV verified
    feed("KCLT", "tower", "Charlotte Tower 18R/36L", "118.100", "kclt6_twr"),
    feedN(
      "KCLT",
      "tower",
      "Charlotte Tower 18L/36R",
      "118.100",
      "kclt7_twr_118100",
      "18l",
    ),
    feed(
      "KCLT",
      "approach",
      "Charlotte App (Final)",
      "120.050",
      "kclt6_app_final",
    ),
    feedN(
      "KCLT",
      "approach",
      "Charlotte App (Arrival)",
      "126.500",
      "kclt4_arr",
      "arrival",
    ),
    feed(
      "KCLT",
      "departure",
      "Charlotte Departure",
      "119.000",
      "kclt7_dep_119000",
    ),
  ],

  PHNL: [
    // CSV verified
    feed("PHNL", "tower", "Honolulu Tower", "118.100", "phnl1_twr"),
    feed("PHNL", "ground", "Honolulu Ground", "121.900", "phnl1_gnd"),
    feed("PHNL", "approach", "Honolulu HCF App/Dep", "118.300", "phnl1_app"),
    feed("PHNL", "atis", "Honolulu ATIS", "127.900", "phnl1_atis"),
  ],

  PANC: [
    // CSV verified
    feed("PANC", "tower", "Anchorage Tower", "118.300", "panc_twr"),
    feed(
      "PANC",
      "combined",
      "Anchorage Del/Gnd/App",
      "118.600",
      "panc_del_gnd_app",
    ),
  ],

  KIAH: [
    // CSV verified
    feed("KIAH", "tower", "Houston IAH Tower", "118.700", "kiah1_1"),
    feed("KIAH", "ground", "Houston IAH Ground N", "121.700", "kiah2_gnd_n"),
    feed("KIAH", "approach", "Houston IAH Approach", "120.050", "kiah1_2"),
    feed("KIAH", "atis", "Houston IAH ATIS", "124.050", "kiah2_atis_main"),
  ],

  KMCO: [
    // CSV verified (via korl_ prefix feeds)
    feed(
      "KMCO",
      "approach",
      "Orlando App (Final)",
      "124.800",
      "korl_kmco_app_final",
    ),
    feedN(
      "KMCO",
      "tower",
      "Orlando Tower West",
      "124.300",
      "korl_kmco_twr_west",
      "west",
    ),
  ],

  KSAN: [
    // CSV verified
    feed("KSAN", "tower", "San Diego Tower", "118.300", "ksan1_twr"),
    feed("KSAN", "ground", "San Diego Ground", "123.900", "ksan1_gnd"),
    feed("KSAN", "approach", "SOCAL App West", "119.600", "ksan_app_west"),
    feed("KSAN", "atis", "San Diego ATIS", "134.800", "ksan_atis"),
  ],

  KLGA: [
    // CSV verified
    feed("KLGA", "tower", "LaGuardia Tower", "118.700", "klga_twr"),
    feed("KLGA", "ground", "LaGuardia Ground", "121.700", "klga_gnd"),
    feed("KLGA", "approach", "LaGuardia NY App", "125.700", "klga_ny_app"),
    feed("KLGA", "departure", "LaGuardia NY Dep", "120.400", "klga_ny_dep"),
  ],

  KPHL: [
    // CSV verified
    feed("KPHL", "tower", "Philadelphia Tower", "118.500", "kphl_twr_both"),
    feed("KPHL", "ground", "Philadelphia Ground", "121.900", "kphl_gnd"),
    feed(
      "KPHL",
      "approach",
      "Philadelphia App (Final)",
      "124.350",
      "kphl_final",
    ),
    feed("KPHL", "departure", "Philadelphia Departure", "128.400", "kphl_dep"),
  ],

  KPDX: [
    // CSV verified
    feed("KPDX", "tower", "Portland Tower", "123.775", "kpdx3_twr"),
    feed("KPDX", "ground", "Portland Ground", "121.900", "kpdx3_gnd"),
    feed(
      "KPDX",
      "approach",
      "Portland App (Final)",
      "119.000",
      "kpdx_app_final",
    ),
    feed("KPDX", "atis", "Portland ATIS", "128.350", "kpdx3_atis"),
  ],

  KMDW: [
    // CSV verified
    feed("KMDW", "tower", "Midway Tower", "120.650", "kmdw_1"),
    feed("KMDW", "combined", "Midway Gnd/Twr", "121.650", "kmdw_gnd_twr"),
  ],

  KAUS: [
    // CSV verified
    feed("KAUS", "tower", "Austin Tower", "121.000", "kaus3_twr"),
    feed("KAUS", "ground", "Austin Ground", "121.900", "kaus3_gnd"),
    feed(
      "KAUS",
      "approach",
      "Austin App (Final)",
      "119.950",
      "kaus3_app_final",
    ),
    feed("KAUS", "combined", "Austin App/Dep", "120.900", "kaus3_app_dep"),
  ],

  KMSY: [
    // CSV verified
    feed("KMSY", "tower", "New Orleans Tower", "119.450", "kmsy2_twr"),
    feed("KMSY", "ground", "New Orleans Del/Gnd", "121.900", "kmsy2_del_gnd"),
    feed("KMSY", "approach", "New Orleans App/Dep", "128.200", "kmsy2_app"),
  ],

  // ── Canada ──────────────────────────────────────────────────────

  CYYZ: [
    // CSV verified
    feed("CYYZ", "tower", "Toronto Pearson Tower", "118.700", "cyyz7"),
    feed("CYYZ", "ground", "Toronto Pearson Ground", "121.900", "cyyz5"),
    feed("CYYZ", "approach", "Toronto Arrival", "119.350", "cyyz6"),
    feed("CYYZ", "departure", "Toronto Departure", "128.925", "cyyz8"),
    feed("CYYZ", "atis", "Toronto ATIS", "120.025", "cyyz3"),
  ],

  CYVR: [
    // CSV verified
    feed("CYVR", "tower", "Vancouver Tower", "118.700", "cyvr1_gnd_twr"),
    feed("CYVR", "ground", "Vancouver Del/Gnd", "121.900", "cyvr1_gnd"),
    feed("CYVR", "approach", "Vancouver App/Dep", "119.550", "cyvr1_app"),
  ],

  CYUL: [
    // CSV verified
    feed("CYUL", "approach", "Montreal App/Dep", "119.100", "cyul_app"),
  ],

  // ── Europe ───────────────────────────────────────────────────────
  // NOTE: Many major European airports (CDG, Frankfurt, Munich, Madrid,
  // Barcelona, Rome, Gatwick, Vienna, Copenhagen, Stockholm, Warsaw)
  // do NOT have LiveATC feeds — ATC radio reception/broadcasting is
  // restricted or illegal in France, Germany, Spain, Italy, Austria,
  // Denmark, Sweden, Poland, and others.

  EGLL: [
    // CSV verified — single combined Tower/Approach feed
    feed("EGLL", "combined", "Heathrow Tower/Approach", "118.700", "egll_twr"),
  ],

  EHAM: [
    // amsterdam-flight-vibe verified
    feed("EHAM", "approach", "Schiphol Approach", "119.055", "eham_app_119055"),
    feedN(
      "EHAM",
      "tower",
      "Schiphol Tower 18C/36C",
      "118.100",
      "eham_twr_18c36c",
      "18c36c",
    ),
    feedN(
      "EHAM",
      "tower",
      "Schiphol Tower 06/24",
      "119.225",
      "eham_twr_0624",
      "0624",
    ),
  ],

  LSZH: [
    // CSV + amsterdam-flight-vibe verified
    feed("LSZH", "tower", "Zurich Tower", "118.100", "lszh1_twr"),
    feed(
      "LSZH",
      "approach",
      "Zurich Approach East",
      "118.000",
      "lszh1_app_east",
    ),
    feedN(
      "LSZH",
      "approach",
      "Zurich Approach Final",
      "120.225",
      "lszh1_app_fin2",
      "final",
    ),
    feed("LSZH", "atis", "Zurich ATIS (Arrival)", "128.525", "lszh1_atis_arr"),
  ],

  EIDW: [
    // CSV + amsterdam-flight-vibe verified
    feed("EIDW", "combined", "Dublin Gnd/Twr/App", "118.600", "eidw3"),
    feedN(
      "EIDW",
      "combined",
      "Dublin Gnd/Twr/App/Centre",
      "121.100",
      "eidw8",
      "centre",
    ),
    feedN("EIDW", "tower", "Dublin Tower N/S App", "124.650", "eidw82", "ns"),
  ],

  ENGM: [
    // amsterdam-flight-vibe verified
    feed("ENGM", "combined", "Oslo Gardermoen", "119.200", "engm4"),
  ],

  LKPR: [
    // amsterdam-flight-vibe verified
    feed("LKPR", "tower", "Prague Tower", "118.100", "lkpr_twr"),
    feed("LKPR", "approach", "Prague Approach", "119.050", "lkpr_app"),
    feedN("LKPR", "approach", "Prague Director", "120.525", "lkpr_dir", "dir"),
  ],

  LPPT: [
    // amsterdam-flight-vibe verified
    feed("LPPT", "approach", "Lisbon Approach", "119.100", "lppt_app"),
  ],

  EBBR: [
    // amsterdam-flight-vibe verified
    feed("EBBR", "tower", "Brussels Tower East", "118.600", "ebbr_twr_e"),
    feed("EBBR", "approach", "Brussels Arrival", "120.600", "ebbr_arr"),
    feed("EBBR", "center", "Brussels EBBU Control", "129.075", "ebbr_ebbu"),
  ],

  LTFJ: [
    // CSV verified — Sabiha Gokcen (NOT Istanbul IST/LTFM main)
    feed("LTFJ", "combined", "Sabiha Gokcen Del/Gnd/Twr", "118.100", "ltfj2"),
  ],

  LHBP: [
    // CSV verified
    feed("LHBP", "combined", "Budapest Gnd/Twr/App", "118.100", "lhbp1"),
    feedN(
      "LHBP",
      "approach",
      "Budapest Approach",
      "119.700",
      "lhbp_app2",
      "app",
    ),
  ],

  LSGG: [
    // CSV verified
    feed("LSGG", "approach", "Geneva Arrival", "131.325", "lsgg_arr"),
    feed("LSGG", "departure", "Geneva Departure", "129.100", "lsgg_dep"),
  ],

  // ── Middle East ──────────────────────────────────────────────────

  OBBI: [
    // CSV verified
    feed("OBBI", "combined", "Bahrain Gnd/Twr/App", "118.000", "obbi"),
  ],

  // ── Asia Pacific ─────────────────────────────────────────────────

  RJTT: [
    // CSV verified
    feed("RJTT", "tower", "Haneda Tower/TCA", "118.100", "rjtt_twr"),
    feed("RJTT", "approach", "Tokyo Approach", "119.100", "rjtt_app"),
    feed("RJTT", "departure", "Haneda Departure", "126.000", "rjtt_dep"),
    feed("RJTT", "ground", "Haneda Ground", "121.700", "rjtt_gnd"),
  ],

  RJAA: [
    // CSV + amsterdam-flight-vibe verified
    feed("RJAA", "tower", "Narita Tower (Both)", "118.350", "rjaa_twr"),
    feedN("RJAA", "tower", "Narita Tower #1", "118.350", "rjaa_twr1", "1"),
    feed("RJAA", "approach", "Narita Approach", "119.600", "rjaa_app_s"),
    feed("RJAA", "ground", "Narita Ground #1", "121.850", "rjaa_gnd1"),
    feed("RJAA", "atis", "Narita ATIS", "128.250", "rjaa_atis"),
  ],

  WSSS: [
    // CSV verified — single combined feed
    feed("WSSS", "combined", "Changi Del/Gnd/App/Radar", "119.800", "wsss3"),
  ],

  VHHH: [
    // CSV verified
    feed("VHHH", "combined", "Hong Kong App/Dep/Dir/Zone", "119.100", "vhhh5"),
  ],

  RPLL: [
    // CSV verified
    feed("RPLL", "tower", "Manila Tower", "118.100", "rpll"),
    feed("RPLL", "ground", "Manila Ground", "121.800", "rpll_gnd"),
    feedN(
      "RPLL",
      "approach",
      "Manila App/Dep 119.9",
      "119.900",
      "rpll_app_119900",
      "119900",
    ),
  ],

  OPKC: [
    // CSV verified
    feed("OPKC", "combined", "Karachi Gnd/Twr/Radar", "118.300", "opkc"),
  ],

  RCKH: [
    // CSV verified
    feed("RCKH", "combined", "Kaohsiung Del/Gnd/Twr/App", "118.700", "rckh2"),
  ],

  // ── Australia / Oceania ──────────────────────────────────────────

  YSSY: [
    // CSV verified
    feed("YSSY", "tower", "Sydney Tower (Both)", "120.500", "yssy1_twr"),
    feed("YSSY", "ground", "Sydney Del/Gnd", "121.700", "yssy1_del_gnd"),
    feed("YSSY", "departure", "Sydney Departure NE", "129.700", "yssy1_dep_ne"),
    feedN(
      "YSSY",
      "approach",
      "Sydney Director East",
      "124.400",
      "yssy1_dir_e",
      "director",
    ),
    feed("YSSY", "center", "Sydney Center South", "129.300", "yssy1_ctr_s"),
  ],

  YMML: [
    // CSV verified — single combined feed
    feed("YMML", "combined", "Melbourne Tower/App/Center", "120.500", "ymml3"),
  ],

  YPPH: [
    // CSV verified
    feed("YPPH", "tower", "Perth Tower", "127.400", "ypph_twr"),
    feed("YPPH", "ground", "Perth Ground", "121.700", "ypph_gnd"),
    feed("YPPH", "approach", "Perth Approach", "123.600", "ypph_app"),
    feed("YPPH", "departure", "Perth Departure", "118.700", "ypph_dep"),
  ],

  // ── Americas (non-US) ───────────────────────────────────────────

  MMMX: [
    // CSV verified
    feed("MMMX", "tower", "Mexico City Tower", "118.100", "mmmx1_twr"),
    feed("MMMX", "ground", "Mexico City Ground N/S", "121.900", "mmmx1_gnd"),
    feed("MMMX", "approach", "Mexico City Approach", "119.900", "mmmx1_app"),
    feedN(
      "MMMX",
      "approach",
      "Mexico City App (Final)",
      "121.200",
      "mmmx1_app_final",
      "final",
    ),
    feed("MMMX", "atis", "Mexico City ATIS", "118.750", "mmmx1_atis"),
  ],

  MPTO: [
    // CSV verified
    feed(
      "MPTO",
      "combined",
      "Panama Tocumen Del/Gnd/Twr/App/Ctr",
      "118.100",
      "mpto2_misc",
    ),
  ],

  SBPA: [
    // CSV verified
    feed(
      "SBPA",
      "combined",
      "Porto Alegre Gnd/Twr/App/Center",
      "118.200",
      "sbpa2",
    ),
  ],

  // ── Africa ───────────────────────────────────────────────────────

  FIMP: [
    // CSV verified
    feed("FIMP", "combined", "Mauritius Tower/App/Control", "118.400", "fimp"),
  ],
  // ── North America (additional) ──────────────────────────────


  // -- Anguilla --
  // Clayton J. Lloyd International Airport (The Valley, Anguilla) — CSV verified
  TQPF: [
    feed("TQPF", "tower", "Tower", "", "tncs_tqpf_twr"),
  ],


  // -- Bahamas --
  // Deadman\'s Cay Airport (Deadman's Cay, Bahamas) — CSV verified
  MYLD: [
    feed("MYLD", "approach", "Nassau Approach", "", "myld1_app"),
    feed("MYLD", "center", "Miami Center/FSS (Bahamas Area)", "", "myld1_zma"),
    feedN(
      "MYLD",
      "center",
      "Emergency/Guard",
      "",
      "myld1_guard",
      "2",
    ),
    feedN(
      "MYLD",
      "center",
      "MYLD/MYLS CTAF",
      "",
      "myld1_ctaf",
      "3",
    ),
  ],

  // Exuma International Airport (Exuma, Bahamas) — CSV verified
  MYEF: [
    feed("MYEF", "tower", "Tower/CTAF", "", "myld1_twr"),
  ],


  // -- Barbados --
  // Grantley Adams International Airport (Bridgetown, Barbados) — CSV verified
  TBPB: [
    feed("TBPB", "combined", "Gnd/Twr/Radar/Center", "", "tbpb"),
  ],


  // -- Bermuda --
  // L F Wade International Airport (Hamilton, Bermuda) — CSV verified
  TXKF: [
    feed("TXKF", "tower", "Tower", "", "txkf2_twr"),
    feed("TXKF", "atis", "ATIS", "", "txkf2_atis"),
    feed("TXKF", "center", "ZNY Sector 81 (Bermuda)/App", "", "txkf2_app_ctr"),
    feed("TXKF", "combined", "Del/Gnd/Twr/CTAF", "", "txkf2_local"),
  ],


  // -- Canada --
  // Abbotsford International Airport (Abbotsford, British Columbia, Canada) — CSV verified
  CYXX: [
    feed("CYXX", "tower", "Tower", "", "cyxx"),
  ],

  // Boundary Bay Airport (Boundary Bay, British Columbia, Canada) — CSV verified
  CZBB: [
    feed("CZBB", "tower", "Tower (Inner)", "", "czbb2"),
  ],

  // Brantford Airport (Brantford, Ontario, Canada) — CSV verified
  CYFD: [
    feed("CYFD", "center", "ATF (CTAF)", "", "cyfd"),
    feedN(
      "CYFD",
      "center",
      "ATF (CTAF)/App",
      "",
      "cyfd2",
      "ctaf",
    ),
  ],

  // Springbank Airport (Calgary, Alberta, Canada) — CSV verified
  CYBW: [
    feed("CYBW", "tower", "Tower (Outer)", "", "cybw3_twr_outer"),
  ],

  // Calgary International Airport (Calgary, Alberta, Canada) — CSV verified
  CYYC: [
    feed("CYYC", "tower", "Tower #1", "", "cyyc2_twr"),
    feed("CYYC", "approach", "App/Dep", "", "cyyc2_app"),
    feed("CYYC", "combined", "Twr/App/Dep", "", "cyyc2_1"),
  ],

  // Charlottetown Airport (Charlottetown, Prince Edward Island, Canada) — CSV verified
  CYYG: [
    feed("CYYG", "combined", "Twr/App/Dep", "", "cyyg2"),
  ],

  // Edmonton International Airport (Edmonton, Alberta, Canada) — CSV verified
  CYEG: [
    feed("CYEG", "tower", "Tower", "", "cyeg_twr"),
    feed("CYEG", "ground", "Del/Gnd/Misc", "", "cyeg_gnd_misc"),
    feed("CYEG", "approach", "Approach", "", "cyeg_app"),
    feed("CYEG", "departure", "Departure", "", "cyeg_dep"),
    feed("CYEG", "center", "CZEG Edmonton Center (FL280/below)", "", "czeg_yeg_1"),
    feedN(
      "CYEG",
      "center",
      "CZEG Edmonton Center (Lloydminster Sector)",
      "",
      "czeg_yeg_2",
      "lloydminst",
    ),
    feed("CYEG", "combined", "VFR Advisory", "", "cyeg_vfr"),
  ],

  // Fredericton International Airport (Fredericton, New Brunswick, Canada) — CSV verified
  CYFC: [
    feed("CYFC", "combined", "Ground/Tower", "", "cyfc2"),
  ],

  // Gander International Airport (Gander, Newfoundland, Canada) — CSV verified
  CYQX: [
    feed("CYQX", "combined", "Ground/Tower", "", "cyqx1_gnd_twr"),
  ],

  // Goose Bay Airport/CFB Goose Bay (Goose Bay, Newfoundland, Canada) — CSV verified
  CYYR: [
    feed("CYYR", "center", "Gander Center", "", "cyyr_center"),
    feed("CYYR", "combined", "Del/Gnd/Twr/App #1", "", "cyyr_local"),
    feedN(
      "CYYR",
      "combined",
      "Del/Gnd/Twr/App #2",
      "",
      "cyyr2",
      "2",
    ),
    feedN(
      "CYYR",
      "combined",
      "Del/Gnd/Twr/App/Center",
      "",
      "cyyr_s",
      "3",
    ),
  ],

  // CFB Greenwood Airport (Greenwood, Nova Scotia, Canada) — CSV verified
  CYZX: [
    feed("CYZX", "approach", "App/Dep/PAR", "", "cyzx1_app"),
    feed("CYZX", "combined", "Ground/Tower", "", "cyzx1_twr"),
  ],

  // CFB Shearwater Airport (Halifax, Nova Scotia, Canada) — CSV verified
  CYAW: [
    feed("CYAW", "atis", "ATIS", "", "cyaw_atis"),
    feed("CYAW", "combined", "Gnd/Twr", "", "cyaw1_gnd_twr"),
    feedN(
      "CYAW",
      "combined",
      "Gnd/Twr/Ops",
      "",
      "cyaw",
      "2",
    ),
  ],

  // Halifax International Airport (Halifax, Nova Scotia, Canada) — CSV verified
  CYHZ: [
    feed("CYHZ", "combined", "Delivery/Ground/Tower/Approach", "", "cyhz3"),
  ],

  // Iqaluit Airport (Iqaluit, Nunavut, Canada) — CSV verified
  CYFB: [
    feed("CYFB", "center", "CTAF/RDO", "", "cyfb_ctaf"),
    feedN(
      "CYFB",
      "center",
      "Montreal Center",
      "",
      "cyfb_zul",
      "2",
    ),
    feedN(
      "CYFB",
      "center",
      "RDO/FIC/Edmonton Ctr",
      "",
      "cyfb_rdo",
      "3",
    ),
  ],

  // Langley Regional Airport (Langley, British Columbia, Canada) — CSV verified
  CYNJ: [
    feed("CYNJ", "tower", "Tower", "", "cynj2"),
    feed("CYNJ", "ground", "Ground", "", "cynj2_gnd"),
  ],

  // London International Airport (London, Ontario, Canada) — CSV verified
  CYXU: [
    feed("CYXU", "tower", "Tower (Both)", "", "cyxu1_twr"),
    feedN(
      "CYXU",
      "tower",
      "Tower 119.4",
      "",
      "cyxu1_twr_119400",
      "2",
    ),
    feedN(
      "CYXU",
      "tower",
      "Tower 125.65",
      "",
      "cyxu1_twr_125650",
      "3",
    ),
    feed("CYXU", "ground", "Ground", "", "cyxu1_gnd"),
    feed("CYXU", "approach", "App/Dep (London Sector)", "", "cyxu1_ctr_135300"),
    feed("CYXU", "atis", "ATIS", "", "cyxu1_atis"),
    feed("CYXU", "center", "Area Guard 121.5", "", "cyxu1_guard"),
    feedN(
      "CYXU",
      "center",
      "CZYZ Toronto Center (Kitchener Sector)",
      "",
      "cyxu1_ctr_135625",
      "kitchener",
    ),
    feedN(
      "CYXU",
      "center",
      "CZYZ Toronto Center (Lucan Sector)",
      "",
      "cyxu1_ctr_135825",
      "lucan",
    ),
  ],

  // Saint-Hubert Airport (Montreal, Quebec, Canada) — CSV verified
  CYHU: [
    feed("CYHU", "tower", "Tower", "", "cyhu"),
  ],

  // Montreal-Mirabel International Airport (Montreal, Quebec, Canada) — CSV verified
  CYMX: [
    feed("CYMX", "combined", "Gnd/Twr/Radio", "", "cymx2"),
  ],

  // Oshawa Municipal Airport (Oshawa, Ontario, Canada) — CSV verified
  CYOO: [
    feed("CYOO", "tower", "Tower", "", "cyoo5_twr"),
    feed("CYOO", "ground", "Ground", "", "cyoo5_gnd"),
  ],

  // Ottawa MacDonald Cartier International Airport (Ottawa, Ontario, Canada) — CSV verified
  CYOW: [
    feed("CYOW", "combined", "Gnd/Twr/App", "", "cyow3"),
  ],

  // Ottawa/Rockcliffe Airport (Ottawa, Ontario, Canada) — CSV verified
  CYRO: [
    feed("CYRO", "center", "Area Guard", "", "cyro1_guard"),
    feedN(
      "CYRO",
      "center",
      "CTAF",
      "",
      "cyro1_ctaf",
      "2",
    ),
    feedN(
      "CYRO",
      "center",
      "Gatineau Radio",
      "",
      "cyro1_radio",
      "ne",
    ),
  ],

  // Peterborough Airport (Peterborough, Ontario, Canada) — CSV verified
  CYPQ: [
    feed("CYPQ", "approach", "Regional/Radar", "", "cypq6_app"),
    feed("CYPQ", "atis", "AWOS", "", "cypq6_awos"),
    feed("CYPQ", "center", "Dispatch/UNICOM", "", "cypq6_dispatch"),
    feedN(
      "CYPQ",
      "center",
      "UNICOM/Guard",
      "",
      "cypq6_unicom",
      "2",
    ),
  ],

  // Pitt Meadows Airport (Pitt Meadows, British Columbia, Canada) — CSV verified
  CYPK: [
    feed("CYPK", "tower", "Tower", "", "cypk2"),
  ],

  // Quebec Jean Lesage International Airport (Quebec, Quebec, Canada) — CSV verified
  CYQB: [
    feed("CYQB", "approach", "App/Dep (Terminal/124.0)", "", "cyqb1_app_124000"),
    feedN(
      "CYQB",
      "approach",
      "App/Dep (Terminal/127.85)",
      "",
      "cyqb1_app_127850",
      "terminal",
    ),
    feed("CYQB", "atis", "ATIS (English)", "", "cyqb1_atis_en"),
    feedN(
      "CYQB",
      "atis",
      "ATIS (French)",
      "",
      "cyqb1_atis_fr",
      "french",
    ),
    feed("CYQB", "center", "Flight Service (FIS)", "", "cyqb1_fis"),
    feedN(
      "CYQB",
      "center",
      "Montreal Center (Drummond/133.225)",
      "133.225",
      "cyqb1_ctr_133225",
      "drummond",
    ),
    feedN(
      "CYQB",
      "center",
      "Montreal Center (Drummond/135.025)",
      "135.025",
      "cyqb1_ctr_135025",
      "135025",
    ),
    feedN(
      "CYQB",
      "center",
      "Montreal Center (Levis/123.925)",
      "123.925",
      "cyqb1_ctr_123925",
      "levis",
    ),
    feed("CYQB", "combined", "Flight Service", "", "cyqb1_fs"),
    feedN(
      "CYQB",
      "combined",
      "Ground/Tower",
      "",
      "cyqb1_gnd_twr",
      "2",
    ),
  ],

  // Regina International Airport (Regina, Saskatchewan, Canada) — CSV verified
  CYQR: [
    feed("CYQR", "combined", "Gnd/Twr/Center", "", "cyqr3"),
  ],

  // Rocky Mountain House Airport (Rocky Mountain House, Alberta, Canada) — CSV verified
  CYRM: [
    feed("CYRM", "center", "CTAF", "", "cyrm2"),
  ],

  // John G. Diefenbaker International Airport (Saskatoon, Saskatchewan, Canada) — CSV verified
  CYXE: [
    feed("CYXE", "approach", "App/Dep/Center", "", "cyxe2_cywg"),
    feed("CYXE", "combined", "Area VFR/Misc", "", "cyxe2_vfr_misc"),
    feedN(
      "CYXE",
      "combined",
      "Gnd/Twr",
      "",
      "cyxe2_twr",
      "2",
    ),
  ],

  // Sault Ste. Marie Airport (Sault Ste. Marie, Ontario, Canada) — CSV verified
  CYAM: [
    feed("CYAM", "tower", "Tower", "", "cyam_twr"),
    feed("CYAM", "ground", "Ground/Misc", "", "cyam_gnd_misc"),
    feed("CYAM", "atis", "ATIS", "", "cyam_atis"),
    feed("CYAM", "center", "Toronto Center (Sault High)", "", "czyz_yam_high"),
    feedN(
      "CYAM",
      "center",
      "Toronto Center (Sault Low)",
      "",
      "czyz_yam_low",
      "sault",
    ),
  ],

  // Sherbrooke Airport (Sherbrooke, Quebec, Canada) — CSV verified
  CYSC: [
    feed("CYSC", "center", "CTAF", "", "cysc1_ctaf"),
    feedN(
      "CYSC",
      "center",
      "Emergency/Guard",
      "",
      "cysc1_guard",
      "2",
    ),
    feed("CYSC", "combined", "RCO/GCO", "", "cysc1_rco"),
    feedN(
      "CYSC",
      "combined",
      "ZUL 132.55",
      "",
      "cysc1_zul_132550",
      "2",
    ),
    feedN(
      "CYSC",
      "combined",
      "ZUL 133.225",
      "133.225",
      "cysc1_zul_133225",
      "3",
    ),
  ],

  // St. Jean Airport (St. Jean, Quebec, Canada) — CSV verified
  CYJN: [
    feed("CYJN", "combined", "Ground/Tower", "", "cyjn"),
  ],

  // St. John\'s International Airport (St. John's, Newfoundland, Canada) — CSV verified
  CYYT: [
    feed("CYYT", "tower", "Tower", "", "cyyt1_twr"),
    feed("CYYT", "ground", "Ground", "", "cyyt1_gnd"),
    feed("CYYT", "atis", "ATIS", "", "cyyt1_atis"),
    feed("CYYT", "center", "Gander Center 133.150", "133.150", "cyyt1_ctr_133150"),
    feedN(
      "CYYT",
      "center",
      "Gander Radio 122.375",
      "122.375",
      "cyyt1_iar_122375",
      "2",
    ),
    feed("CYYT", "combined", "Ground/Tower", "", "cyyt1_gnd_twr"),
  ],

  // Sudbury Airport (Sudbury, Ontario, Canada) — CSV verified
  CYSB: [
    feed("CYSB", "combined", "Gnd/Twr/Center", "", "cysb"),
  ],

  // Summerside Airport (Summerside, Prince Edward Island, Canada) — CSV verified
  CYSU: [
    feed("CYSU", "center", "CTAF/Unicom", "", "cysu2"),
  ],

  // Thunder Bay Airport (Thunder Bay, Ontario, Canada) — CSV verified
  CYQT: [
    feed("CYQT", "combined", "Ground/Tower", "", "cyqt"),
  ],

  // Timmins/Victor M. Power Airport (Timmins, Ontario, Canada) — CSV verified
  CYTS: [
    feed("CYTS", "center", "FSS/Misc", "", "cyts_misc"),
    feedN(
      "CYTS",
      "center",
      "CZUL ACC (Noranda Sector)",
      "",
      "cyul_timmins",
      "noranda",
    ),
    feedN(
      "CYTS",
      "center",
      "Toronto Center (Timmins)",
      "",
      "czyz_timmins",
      "timmins",
    ),
  ],

  // Billy Bishop Toronto City Airport (Toronto, Ontario, Canada) — CSV verified
  CYTZ: [
    feed("CYTZ", "tower", "Tower", "", "cytz4"),
    feed("CYTZ", "approach", "Approach", "", "cytz_app"),
  ],

  // Trois Rivieres Airport (Trois-Rivieres, Quebec, Canada) — CSV verified
  CYRQ: [
    feed("CYRQ", "center", "CTAF", "", "cyrq"),
    feedN(
      "CYRQ",
      "center",
      "CYRQ/CSR3 CTAF",
      "",
      "cyrq_s",
      "2",
    ),
  ],

  // Val-D\'Or Airport (Val-D'Or, Quebec, Canada) — CSV verified
  CYVO: [
    feed("CYVO", "ground", "Gnd/RDO/Center", "", "cyvo"),
  ],

  // Vancouver Harbour Airport (Vancouver, British Columbia, Canada) — CSV verified
  CYHC: [
    feed("CYHC", "combined", "Del/Twr/App", "", "cyhc2"),
  ],

  // Victoria Inner Harbour Airport (Victoria, British Columbia, Canada) — CSV verified
  CYWH: [
    feed("CYWH", "center", "FISE/Terminal", "", "cywh2_misc"),
  ],

  // Victoria International Airport (Victoria, British Columbia, Canada) — CSV verified
  CYYJ: [
    feed("CYYJ", "tower", "Tower (Inner)", "", "cyyj2_twr_inner"),
  ],

  // Waterloo Airport (Waterloo, Ontario, Canada) — CSV verified
  CYKF: [
    feed("CYKF", "tower", "Tower", "", "cykf3_twr"),
    feed("CYKF", "ground", "Ground", "", "cykf3_gnd"),
    feed("CYKF", "center", "Area Traffic Advisory", "", "cykf3_ta"),
    feedN(
      "CYKF",
      "center",
      "Toronto Center (West Sat)",
      "",
      "cykf3_ctr",
      "west",
    ),
  ],

  // Winnipeg James Armstrong Richardson International Airport (Winnipeg, Manitoba, Canada) — CSV verified
  CYWG: [
    feed("CYWG", "approach", "App/Dep", "", "cywg2_misc1"),
    feed("CYWG", "atis", "ATIS", "", "cywg2_misc3"),
    feed("CYWG", "center", "Center", "", "cywg2_misc2"),
    feed("CYWG", "combined", "Del/Gnd/Twr", "", "cywg2_misc"),
  ],

  // Yarmouth Airport (Yarmouth, Nova Scotia, Canada) — CSV verified
  CYQI: [
    feed("CYQI", "center", "CTAF/UNICOM", "", "cyqi3"),
    feedN(
      "CYQI",
      "center",
      "Halifax FIC",
      "",
      "cyqi5",
      "2",
    ),
    feedN(
      "CYQI",
      "center",
      "Moncton Center (TUSKY/BRADD High)",
      "",
      "cyqi8",
      "tusky",
    ),
    feedN(
      "CYQI",
      "center",
      "Moncton Center (TUSKY/BRADD/WHALE/KANNNI)",
      "",
      "cyqi_moncton",
      "bradd",
    ),
    feedN(
      "CYQI",
      "center",
      "Moncton Center (VITOL/High)",
      "",
      "cyqi6",
      "vitol",
    ),
    feedN(
      "CYQI",
      "center",
      "Moncton Center (WHALE/KANNI High)",
      "",
      "cyqi9",
      "whale",
    ),
    feedN(
      "CYQI",
      "center",
      "Moncton Center Low",
      "",
      "cyqi2",
      "3",
    ),
    feed("CYQI", "combined", "Wildfire/SAR Aircraft", "", "cyqi4"),
  ],

  // Yellowknife Airport (Yellowknife, Northwest Territories, Canada) — CSV verified
  CYZF: [
    feed("CYZF", "combined", "Gnd/Twr/Center", "", "cyzf"),
  ],


  // -- Costa Rica --
  // Tobias Bolanos International Airport (San Jose, Costa Rica) — CSV verified
  MRPV: [
    feed("MRPV", "combined", "Ground/Tower", "", "mrpv_gnd_twr"),
  ],


  // -- Guatemala --
  // La Aurora International Airport (Guatemala City, Guatemala) — CSV verified
  MGGT: [
    feed("MGGT", "combined", "Gnd/Twr/App/Center", "", "mggt3_all"),
  ],

  // Quetzaltenango Airport (Quezaltenango, Guatemala) — CSV verified
  MGQZ: [
    feed("MGQZ", "center", "CTAF", "", "mgqz2_ctaf"),
  ],


  // -- Honduras --
  // Palmerola International Airport (Comayagua, Honduras) — CSV verified
  MHPR: [
    feed("MHPR", "combined", "Gnd/Twr/App", "", "mhsc2"),
  ],

  // Goloson International Airport (La Ceiba, Honduras) — CSV verified
  MHLC: [
    feed("MHLC", "combined", "Gnd/Twr/Center", "", "mhlc"),
  ],

  // Ramon Villeda Morales International Airport (San Pedro Sula, Honduras) — CSV verified
  MHLM: [
    feed("MHLM", "combined", "Gnd/Twr/App", "", "mhlm"),
  ],

  // Toncontin International Airport (Tegucigalpa, Honduras) — CSV verified
  MHTG: [
    feed("MHTG", "atis", "ATIS", "", "mhtg_atis"),
    feed("MHTG", "combined", "Gnd/Twr/App/Ctr/Ops", "", "mhtg"),
  ],


  // -- Mexico --
  // Matamoros International Airport (Brownsville-Matamoros, Mexico) — CSV verified
  MMMA: [
    feed("MMMA", "combined", "Twr/App", "", "kbro2_mmma_app"),
  ],

  // Cuernavaca Airport (Cuernavaca, Mexico) — CSV verified
  MMCB: [
    feed("MMCB", "tower", "Tower", "", "mmcb2"),
  ],

  // Don Miguel Hidalgo y Costilla International (Guadalajara, Mexico) — CSV verified
  MMGL: [
    feed("MMGL", "combined", "Tower/Approach", "", "mmgl"),
  ],

  // Hermosillo International Airport (Hermosillo, Mexico) — CSV verified
  MMHO: [
    feed("MMHO", "tower", "Tower", "", "mmho_twr"),
    feed("MMHO", "approach", "App/Dep", "", "mmho_app"),
    feed("MMHO", "combined", "Twr/App", "", "mmho_twr_app"),
  ],

  // Gen Manuel Marquez Airport (La Paz, Mexico) — CSV verified
  MMLP: [
    feed("MMLP", "combined", "Twr/App", "", "mmlp"),
  ],

  // Licenciado Manuel Crescencio Rejon International Airport (Merida, Mexico) — CSV verified
  MMMD: [
    feed("MMMD", "tower", "Tower", "", "mmmd1_twr"),
    feed("MMMD", "approach", "App/Dep", "", "mmmd1_app"),
    feed("MMMD", "center", "Merida Center 125.8/123.75", "", "mmmd1_ctr"),
  ],

  // General Mariano Escobedo International Airport (Monterrey, Mexico) — CSV verified
  MMMY: [
    feed("MMMY", "approach", "Approach", "", "mmmy3_app"),
    feed("MMMY", "combined", "Tower/Approach", "", "mmmy"),
  ],

  // Queretaro Intercontinental Airport (Queretaro, Mexico) — CSV verified
  MMQT: [
    feed("MMQT", "combined", "Tower/App", "", "mmqt3"),
  ],

  // Ponciano Arriaga International Airport (San Luis Potosi, Mexico) — CSV verified
  MMSP: [
    feed("MMSP", "combined", "Twr/App/Center", "", "mmsp3"),
  ],

  // Felipe Angeles International Airport (Santa Lucia, Mexico) — CSV verified
  MMSM: [
    feed("MMSM", "tower", "Tower 118.25", "", "mmmx1_mmsm_twr_118250"),
    feedN(
      "MMSM",
      "tower",
      "Tower 118.3",
      "",
      "mmmx1_mmsm_twr",
      "2",
    ),
    feed("MMSM", "ground", "Clearance Delivery", "", "mmmx1_mmsm_del"),
    feedN(
      "MMSM",
      "ground",
      "Ground",
      "",
      "mmmx1_mmsm_gnd",
      "2",
    ),
    feed("MMSM", "approach", "Approach (119.0)", "", "mmmx1_mmsm_app1"),
    feedN(
      "MMSM",
      "approach",
      "Approach (128.85)",
      "128.85",
      "mmmx1_mmsm_app2",
      "2",
    ),
    feed("MMSM", "atis", "ATIS", "", "mmmx1_mmsm_atis"),
  ],

  // Bahias de Huatulco International Airport (Santa Maria Huatulco, Mexico) — CSV verified
  MMBT: [
    feed("MMBT", "tower", "Twr/Center", "", "mmbt_misc"),
  ],

  // Tijuana International Airport (Tijuana, Mexico) — CSV verified
  MMTJ: [
    feed("MMTJ", "approach", "Approach", "", "mmtj_app"),
    feed("MMTJ", "combined", "Twr/Ramp", "", "mmtj"),
  ],

  // Toluca International Airport (Toluca, Mexico) — CSV verified
  MMTO: [
    feed("MMTO", "tower", "Tower", "", "mmto3_twr"),
    feed("MMTO", "ground", "Ground", "", "mmto3_gnd"),
    feed("MMTO", "approach", "App/Dep", "", "mmto3_app"),
  ],

  // Torreon International Airport (Torreon, Mexico) — CSV verified
  MMTC: [
    feed("MMTC", "combined", "Twr/App/Center #1", "", "mmtc"),
  ],


  // -- Panama --
  // Marcos A Gelabert International Airport (Panama City, Panama) — CSV verified
  MPMG: [
    feed("MPMG", "approach", "Panama App/Dep #2", "", "mppa2_app_dep"),
    feed("MPMG", "center", "Panama Center #2", "", "mppa2_ctr"),
  ],

  // Panama Pacifico International Airport (Panama City, Panama) — CSV verified
  MPPA: [
    feed("MPPA", "tower", "Tower", "", "mppa2_twr"),
    feed("MPPA", "approach", "Approach/Departure", "", "mppa2_app_dep"),
    feed("MPPA", "center", "Center", "", "mppa2_ctr"),
  ],


  // -- Saba --
  // Juancho E. Yrausquin Airport (Hell's Gate, Saba) — CSV verified
  TNCS: [
    feed("TNCS", "tower", "Info/TFFJ Twr", "", "tncs2"),
  ],


  // -- Sint Maarten --
  // Princess Juliana International Airport (Philipsburg, Sint Maarten) — CSV verified
  TNCM: [
    feed("TNCM", "tower", "Tower", "", "tncm_twr2"),
    feed("TNCM", "combined", "Tower/Approach/Departure", "", "tncm1_app"),
  ],


  // -- United States --
  // Abilene Regional Airport (Abilene, Texas, United States) — CSV verified
  KABI: [
    feed("KABI", "tower", "Tower", "", "kabi4_twr"),
    feed("KABI", "ground", "Ground", "", "kabi4_gnd"),
    feed("KABI", "approach", "Approach", "", "kabi4_app"),
    feed("KABI", "departure", "Departure", "", "kabi4_dep"),
    feed("KABI", "center", "Emergency/Guard", "", "kabi4_guard"),
    feed("KABI", "combined", "ZFW 63 (Abilene Low)", "", "kabi4_zfw_127450"),
  ],

  // Albany International Airport (Albany, New York, United States) — CSV verified
  KALB: [
    feed("KALB", "tower", "Tower", "", "kalb2_twr"),
    feed("KALB", "ground", "Ground", "", "kalb2_gnd"),
    feed("KALB", "approach", "Approach/Departure", "", "kalb2_app"),
    feed("KALB", "atis", "ATIS", "", "kalb2_atis"),
  ],

  // Albuquerque International Sunport Airport (Albuquerque, New Mexico, United States) — CSV verified
  KABQ: [
    feed("KABQ", "tower", "Tower", "", "kabq2_2"),
    feedN(
      "KABQ",
      "tower",
      "Tower #2",
      "",
      "kabq2_twr2",
      "2",
    ),
    feed("KABQ", "ground", "Del/Gnd", "", "kabq2_1"),
    feed("KABQ", "approach", "App/Dep (Main)", "", "kabq2_3"),
    feedN(
      "KABQ",
      "approach",
      "App/Dep (Other)",
      "",
      "kabq2_4",
      "other",
    ),
    feed("KABQ", "center", "ZAB Sector 17 Lava (Low)", "", "kabq2_zab17"),
    feed("KABQ", "combined", "Twr/App/ZAB", "", "kabq1_1"),
  ],

  // Double Eagle II Airport (Albuquerque, New Mexico, United States) — CSV verified
  KAEG: [
    feed("KAEG", "combined", "Twr/App", "", "kabq1_2"),
  ],

  // Elmendorf Air Force Base (Anchorage, Alaska, United States) — CSV verified
  PAED: [
    feed("PAED", "tower", "Tower", "", "pamr2_paed_twr"),
  ],

  // Lake Hood Seaplane Base (Anchorage, Alaska, United States) — CSV verified
  PALH: [
    feed("PALH", "tower", "Tower", "", "panc3_palh"),
  ],

  // Merrill Field Airport (Anchorage, Alaska, United States) — CSV verified
  PAMR: [
    feed("PAMR", "tower", "Tower", "", "pamr2_twr"),
    feedN(
      "PAMR",
      "tower",
      "Tower (Backup)",
      "",
      "pamr2_twr2",
      "backup",
    ),
    feed("PAMR", "ground", "Ground", "", "pamr2_gnd"),
    feed("PAMR", "center", "Anchorage Area CTAF 122.9", "", "pamr2_area_ctaf"),
  ],

  // Ankeny Regional Airport (Ankeny, Iowa, United States) — CSV verified
  KIKV: [
    feed("KIKV", "ground", "Del/CTAF", "", "kikv2"),
  ],

  // Ann Arbor Municipal Airport (Ann Arbor, Michigan, United States) — CSV verified
  KARB: [
    feed("KARB", "ground", "Ground", "", "karb2_gnd"),
    feed("KARB", "atis", "ATIS", "", "karb2_atis"),
    feed("KARB", "combined", "Gnd/Twr", "", "karb2_gnd_twr"),
  ],

  // Appleton International Airport (Appleton, Wisconsin, United States) — CSV verified
  KATW: [
    feed("KATW", "tower", "Tower", "", "katw2"),
  ],

  // Arlington Municipal Airport (Arlington, Washington, United States) — CSV verified
  KAWO: [
    feed("KAWO", "center", "CTAF/Clearance", "", "kawo3"),
  ],

  // Asheville Regional Airport (Asheville, North Carolina, United States) — CSV verified
  KAVL: [
    feed("KAVL", "tower", "Tower", "", "kavl2_twr"),
    feed("KAVL", "ground", "Ground", "", "kavl2_gnd"),
    feed("KAVL", "approach", "Approach/Departure", "", "kavl2_app_dep"),
    feed("KAVL", "atis", "ATIS", "", "kavl2_atis"),
    feed("KAVL", "center", "Guard", "", "kavl2_guard"),
    feedN(
      "KAVL",
      "center",
      "ZTL Sector 44 (Shine Low)",
      "",
      "kavl2_ztl44",
      "shine",
    ),
    feed("KAVL", "combined", "Gnd/Twr", "", "kavl2_gnd_twr"),
    feedN(
      "KAVL",
      "combined",
      "Gnd/Twr/App",
      "",
      "kavl2",
      "2",
    ),
  ],

  // Aspen-Pitkin County Airport/Sardy Field (Aspen, Colorado, United States) — CSV verified
  KASE: [
    feed("KASE", "tower", "Tower", "", "kase2_twr2"),
    feed("KASE", "approach", "Approach/Denver Center", "", "kase2_app_ctr"),
    feed("KASE", "atis", "ATIS", "", "kase2_atis"),
    feed("KASE", "center", "ZDV Sector 26 POWDR Low", "", "kase2_zdv"),
    feed("KASE", "combined", "Gnd/Twr/App/Center", "", "kase2_s"),
    feedN(
      "KASE",
      "combined",
      "Ground/Tower",
      "",
      "kase2_gnd_twr",
      "se",
    ),
  ],

  // Atlantic City International Airport (Atlantic City, New Jersey, United States) — CSV verified
  KACY: [
    feed("KACY", "tower", "Tower", "", "kacy_a_twr"),
    feed("KACY", "ground", "Clearance Delivery", "", "kacy_a_del"),
    feedN(
      "KACY",
      "ground",
      "Ground",
      "",
      "kacy_a_gnd",
      "2",
    ),
    feed("KACY", "approach", "App/Dep", "", "kacy_a_app"),
    feed("KACY", "atis", "ATIS", "", "kacy_a_atis"),
    feed("KACY", "combined", "GIANT KILLER", "", "kacy_gk"),
    feedN(
      "KACY",
      "combined",
      "Ground/Tower",
      "",
      "kacy_a_gnd_twr",
      "2",
    ),
    feedN(
      "KACY",
      "combined",
      "ZDC SIE54/CASINO51",
      "",
      "kacy_zdc_sie",
      "3",
    ),
    feedN(
      "KACY",
      "combined",
      "ZNY ATL86/ZDC SIE54",
      "",
      "zdc59_zny86_acy",
      "4",
    ),
  ],

  // Auburn University Regional Airport (Auburn, Alabama, United States) — CSV verified
  KAUO: [
    feed("KAUO", "approach", "Del/App", "", "kauo1_del_app"),
    feed("KAUO", "atis", "ATIS", "", "kauo1_atis"),
    feed("KAUO", "combined", "Gnd/Twr/CTAF #1", "", "kauo1_gnd_twr"),
    feedN(
      "KAUO",
      "combined",
      "Gnd/Twr/CTAF #2",
      "",
      "kauo1_gnd_twr2",
      "2",
    ),
  ],

  // Baltimore/Washington International Thurgood Marshall Airport (Baltimore, Maryland, United States) — CSV verified
  KBWI: [
    feed("KBWI", "tower", "Tower #1", "", "kbwi_es_twr"),
    feed("KBWI", "ground", "Clearance Delivery", "", "kbwi_es_del"),
    feedN(
      "KBWI",
      "ground",
      "Ground",
      "",
      "kbwi_es_gnd",
      "2",
    ),
    feed("KBWI", "approach", "Potomac Approach (GRACO Sector) #1", "", "kbwi_es_app_124550"),
    feedN(
      "KBWI",
      "approach",
      "Potomac App (BWI Final) #2",
      "",
      "kbwi_es_final",
      "bwi",
    ),
    feedN(
      "KBWI",
      "approach",
      "Potomac App/Dep (BUFFR)",
      "",
      "kmrb1_app_buffr",
      "buffr",
    ),
    feed("KBWI", "combined", "Potomac App (BELAY) #1", "", "kdmw2_app_125525"),
    feedN(
      "KBWI",
      "combined",
      "Potomac App (BELAY) #3",
      "",
      "kmrb1_app_belay",
      "belay",
    ),
    feedN(
      "KBWI",
      "combined",
      "Potomac App (BELAY) #4",
      "",
      "kbwi_es_app_125525",
      "4",
    ),
  ],

  // Martin State Airport (Baltimore, Maryland, United States) — CSV verified
  KMTN: [
    feed("KMTN", "tower", "Tower", "", "kmtn1_twr"),
    feed("KMTN", "ground", "Ground", "", "kmtn1_gnd"),
    feed("KMTN", "atis", "ATIS", "", "kmtn1_atis"),
    feed("KMTN", "center", "Area Emergency/Guard", "", "kmtn1_guard"),
    feed("KMTN", "combined", "Ground/Tower", "", "kmtn1_gnd_twr"),
  ],

  // Bangor International Airport (Bangor, Maine, United States) — CSV verified
  KBGR: [
    feed("KBGR", "approach", "App/Dep", "", "kbgr_app"),
    feed("KBGR", "atis", "ATIS", "", "kbgr_atis"),
    feed("KBGR", "combined", "Del/Gnd/Twr", "", "kbgr"),
    feedN(
      "KBGR",
      "combined",
      "Tower/Approach (UHF)",
      "",
      "kbgr_uhf",
      "uhf",
    ),
  ],

  // Bartow Executive Airport (Bartow, Florida, United States) — CSV verified
  KBOW: [
    feed("KBOW", "tower", "Tower/CTAF #1", "", "kbow1_twr"),
    feedN(
      "KBOW",
      "tower",
      "Tower/CTAF #2",
      "",
      "klal8_kbow_twr",
      "2",
    ),
    feed("KBOW", "ground", "Gnd/UNICOM/Guard", "", "kbow1_gnd"),
    feed("KBOW", "atis", "AWOS", "", "kbow1_awos"),
    feed("KBOW", "combined", "Gnd/Twr/Misc", "", "kbow1_s"),
  ],

  // Baton Rouge Metropolitan Airport - Ryan Field (Baton Rouge, Louisiana, United States) — CSV verified
  KBTR: [
    feed("KBTR", "tower", "Tower", "", "kbtr2_twr"),
    feed("KBTR", "ground", "Ground", "", "kbtr2_gnd"),
    feed("KBTR", "approach", "App/Dep", "", "kbtr2_app"),
    feed("KBTR", "atis", "ATIS", "", "kbtr2_atis"),
  ],

  // Laurence G Hanscom Field Airport (Bedford, Massachusetts, United States) — CSV verified
  KBED: [
    feed("KBED", "tower", "Tower", "", "kbed1_twr"),
    feed("KBED", "ground", "Clearance Delivery", "", "kbed1_del"),
    feedN(
      "KBED",
      "ground",
      "Del/Gnd",
      "",
      "kbed1_del_gnd",
      "2",
    ),
    feedN(
      "KBED",
      "ground",
      "Ground",
      "",
      "kbed1_gnd",
      "3",
    ),
    feed("KBED", "approach", "Boston App/Dep (North Sat) #1", "", "kbed1_app"),
    feedN(
      "KBED",
      "approach",
      "Boston App/Dep (North Sat) #2",
      "",
      "kbed_murp_app",
      "north",
    ),
    feed("KBED", "atis", "ATIS #1", "", "kbed1_atis"),
    feedN(
      "KBED",
      "atis",
      "ATIS #2",
      "",
      "kbed_murp_atis2",
      "2",
    ),
    feed("KBED", "combined", "Gnd/Twr", "", "kbed1_gnd_twr"),
  ],

  // Bellingham International Airport (Bellingham, Washington, United States) — CSV verified
  KBLI: [
    feed("KBLI", "tower", "Tower", "", "kbli2"),
  ],

  // Monmouth Executive Airport (Belmar/Farmingdale, New Jersey, United States) — CSV verified
  KBLM: [
    feed("KBLM", "combined", "KBLM/N12/3N6/KMJX", "", "kblm2"),
  ],

  // Bemidji Regional Airport (Bemidji, Minnesota, United States) — CSV verified
  KBJI: [
    feed("KBJI", "center", "CTAF/ZMP", "", "kbji"),
  ],

  // Bend Municipal Airport (Bend, Oregon, United States) — CSV verified
  KBDN: [
    feed("KBDN", "center", "CTAF", "", "kbdn2_ctaf"),
    feedN(
      "KBDN",
      "center",
      "ZSE Seattle Center (Sector 05)",
      "",
      "kbdn2_zse05",
      "sector",
    ),
    feedN(
      "KBDN",
      "center",
      "ZSE Seattle Center (Sector 35)",
      "",
      "kbdn2_zse35",
      "35",
    ),
  ],

  // Bentonville Municipal Airport/Louise M Thaden Field (Bentonville, Arkansas, United States) — CSV verified
  KVBT: [
    feed("KVBT", "combined", "KROG/KXNA/KVBT/Misc", "", "krog"),
  ],

  // Bethel Airport (Bethel, Alaska, United States) — CSV verified
  PABE: [
    feed("PABE", "atis", "ATIS", "", "pabe1_atis"),
    feed("PABE", "center", "ZAN Anchorage Center (Bethel)", "", "pabe1_zan"),
    feed("PABE", "combined", "Ground/Tower", "", "pabe1_gnd_twr"),
  ],

  // Beverly Municipal Airport (Beverly, Massachusetts, United States) — CSV verified
  KBVY: [
    feed("KBVY", "tower", "Tower #1", "", "kbvy"),
    feedN(
      "KBVY",
      "tower",
      "Tower #2",
      "",
      "kbvy_twr2",
      "2",
    ),
    feed("KBVY", "ground", "Ground", "", "kbvy_gnd"),
    feed("KBVY", "atis", "ATIS", "", "kbvy_atis"),
  ],

  // Billings Logan International Airport (Billings, Montana, United States) — CSV verified
  KBIL: [
    feed("KBIL", "tower", "Tower", "", "kbil_twr"),
    feed("KBIL", "ground", "Ground", "", "kbil_gnd"),
    feed("KBIL", "approach", "Approach (West)", "", "kbil_app_w"),
    feed("KBIL", "center", "ZLC Salt Lake Center (Sector 15)", "", "zlc_bil"),
  ],

  // Greater Binghamton Airport/Edwin A Link Field (Binghamton, New York, United States) — CSV verified
  KBGM: [
    feed("KBGM", "tower", "Tower", "", "kbgm1_twr"),
    feed("KBGM", "ground", "Ground", "", "kbgm1_gnd"),
    feed("KBGM", "approach", "Approach/Departure", "", "kbgm1_app"),
    feed("KBGM", "atis", "ATIS", "", "kbgm1_atis"),
    feed("KBGM", "center", "ZBW Sector 23 Hancock Low", "", "kbgm1_zbw23"),
    feedN(
      "KBGM",
      "center",
      "ZNY Sector 34 Elmira High",
      "",
      "kbgm1_zny34",
      "se",
    ),
    feedN(
      "KBGM",
      "center",
      "ZNY Sector 35 Huguenot Low",
      "",
      "kbgm1_zny35",
      "2",
    ),
    feedN(
      "KBGM",
      "center",
      "ZNY Sector 36 Sparta Low",
      "",
      "kbgm1_zny36",
      "3",
    ),
    feedN(
      "KBGM",
      "center",
      "ZNY Sector 50 Binghamton Low",
      "",
      "kbgm1_zny50",
      "4",
    ),
    feedN(
      "KBGM",
      "center",
      "ZNY Sector 51 Lake Henry Low",
      "",
      "kbgm1_zny51",
      "5",
    ),
  ],

  // Birmingham-Shuttlesworth International Airport (Birmingham, Alabama, United States) — CSV verified
  KBHM: [
    feed("KBHM", "combined", "Del/Gnd/Twr/App", "", "kbhm"),
  ],

  // Bismarck Municipal Airport (Bismarck, North Dakota, United States) — CSV verified
  KBIS: [
    feed("KBIS", "approach", "App/Dep", "", "kbis3_app"),
    feed("KBIS", "combined", "Gnd/Twr", "", "kbis3_gnd_twr"),
  ],

  // Virginia Tech/Montgomery Executive Airport (Blacksburg, Virginia, United States) — CSV verified
  KBCB: [
    feed("KBCB", "atis", "AWOS", "", "kbcb2_awos"),
    feed("KBCB", "center", "CTAF", "", "kbcb2_ctaf"),
  ],

  // Boca Raton Airport (Boca Raton, Florida, United States) — CSV verified
  KBCT: [
    feed("KBCT", "tower", "Tower", "", "kbct1_twr"),
    feed("KBCT", "ground", "Ground", "", "kbct1_gnd"),
    feed("KBCT", "approach", "Palm Beach Approach/Departure (BCT)", "", "kbct1_dep"),
    feed("KBCT", "atis", "ATIS", "", "kbct1_atis"),
    feed("KBCT", "center", "Emergency/Guard", "", "kbct1_guard"),
    feed("KBCT", "combined", "Ground/Tower", "", "kbct1_gnd_twr"),
  ],

  // Boise Air Terminal/Gowen Field (Boise, Idaho, United States) — CSV verified
  KBOI: [
    feed("KBOI", "ground", "Del/Gnd", "", "kboi_gnd"),
    feed("KBOI", "combined", "Twr/App", "", "kboi"),
  ],

  // Bozeman Yellowstone International Airport (Bozeman, Montana, United States) — CSV verified
  KBZN: [
    feed("KBZN", "tower", "Tower", "", "kbzn1_twr2"),
    feed("KBZN", "ground", "Ground", "", "kbzn1_gnd"),
    feed("KBZN", "approach", "App/Dep", "", "kbzn1_app"),
    feed("KBZN", "atis", "ATIS", "", "kbzn1_atis"),
    feed("KBZN", "center", "Emergency/Guard", "", "kbzn1_guard"),
    feedN(
      "KBZN",
      "center",
      "ZLC Sector 06 (BZN)",
      "",
      "kbzn1_zlc",
      "bzn",
    ),
    feed("KBZN", "combined", "Area Flight Service", "", "kbzn1_rdo"),
    feedN(
      "KBZN",
      "combined",
      "Gnd/Twr",
      "",
      "kbzn1_gnd_twr",
      "2",
    ),
    feedN(
      "KBZN",
      "combined",
      "Gnd/Twr/App",
      "",
      "kbzn1_gta",
      "3",
    ),
  ],

  // Bremerton National Airport (Bremerton, Washington, United States) — CSV verified
  KPWT: [
    feed("KPWT", "center", "CTAF", "", "kpwt"),
  ],

  // Igor I Sikorsky Memorial Airport (Bridgeport, Connecticut, United States) — CSV verified
  KBDR: [
    feed("KBDR", "approach", "New York Approach (LOVES Sector)", "", "kbdr_app"),
    feed("KBDR", "combined", "Del/Gnd/Twr", "", "kbdr_twr"),
    feedN(
      "KBDR",
      "combined",
      "Del/Gnd/Twr/App",
      "",
      "kbdr1",
      "2",
    ),
  ],

  // Tri-Cities Regional Airport (Bristol/Johnson/Kingsport, Tennessee, United States) — CSV verified
  KTRI: [
    feed("KTRI", "combined", "Gnd/Twr/App", "", "ktri"),
  ],

  // Brownsville/South Padre Island International Airport (Brownsville, Texas, United States) — CSV verified
  KBRO: [
    feed("KBRO", "tower", "Tower", "", "kbro2_twr"),
    feed("KBRO", "approach", "App/Dep", "", "kbro2_app"),
  ],

  // Brunswick Executive Airport (Brunswick, Maine, United States) — CSV verified
  KBXM: [
    feed("KBXM", "atis", "CTAF/AWOS", "", "kbxm2"),
  ],

  // Buckeye Municipal Airport (Buckeye, Arizona, United States) — CSV verified
  KBXK: [
    feed("KBXK", "atis", "AWOS", "", "kbxk1_awos"),
    feed("KBXK", "center", "CTAF", "", "kbxk1_ctaf"),
  ],

  // Buffalo Niagara International Airport (Buffalo, New York, United States) — CSV verified
  KBUF: [
    feed("KBUF", "combined", "Gnd/Twr/App", "", "kbuf1_dgta"),
  ],

  // Bob Hope Airport (Burbank, California, United States) — CSV verified
  KBUR: [
    feed("KBUR", "tower", "Tower", "", "kbur3_gnd_twr"),
    feed("KBUR", "approach", "SOCAL Approach (Moorpark Sector) #1", "", "kbur3_gnd_twr_128_750"),
    feedN(
      "KBUR",
      "approach",
      "SOCAL Approach (Pasadena VHF)",
      "",
      "kbur3_gnd_twr_119_85",
      "pasadena",
    ),
    feedN(
      "KBUR",
      "approach",
      "SOCAL Approach (Valley Sector) #1",
      "",
      "kbur3_gnd_twr_124_6",
      "valley",
    ),
    feedN(
      "KBUR",
      "approach",
      "SOCAL Approach (Woodland VHF)",
      "",
      "kbur3_gnd_twr_134_2",
      "woodland",
    ),
  ],

  // Patrick Leahy Burlington International Airport (Burlington, Vermont, United States) — CSV verified
  KBTV: [
    feed("KBTV", "approach", "App/Dep", "", "kbtv_app"),
    feed("KBTV", "atis", "ATIS", "", "kbtv_atis"),
    feed("KBTV", "combined", "Del/Gnd/Twr", "", "kbtv_del_gnd_twr"),
    feedN(
      "KBTV",
      "combined",
      "Del/Gnd/Twr/App #1",
      "",
      "kbtv",
      "1",
    ),
    feedN(
      "KBTV",
      "combined",
      "Del/Gnd/Twr/App #2",
      "",
      "kbtv2",
      "2",
    ),
  ],

  // Burlington-Alamance Regional Airport (Burlington, North Carolina, United States) — CSV verified
  KBUY: [
    feed("KBUY", "center", "CTAF", "", "kbuy2"),
  ],

  // Essex County Airport (Caldwell, New Jersey, United States) — CSV verified
  KCDW: [
    feed("KCDW", "combined", "Del/Gnd/Twr #1", "", "kcdw1"),
    feedN(
      "KCDW",
      "combined",
      "Del/Gnd/Twr #2",
      "",
      "kcdw2_del_gnd_twr",
      "2",
    ),
  ],

  // Volk Field (Camp Douglas, Wisconsin, United States) — CSV verified
  KVOK: [
    feed("KVOK", "tower", "Tower", "", "kvok2_twr"),
    feedN(
      "KVOK",
      "tower",
      "Tower (UHF)",
      "",
      "kvok2_twr_uhf",
      "uhf",
    ),
    feed("KVOK", "ground", "Ground", "", "kvok2_gnd"),
    feedN(
      "KVOK",
      "ground",
      "Ground (UHF)",
      "",
      "kvok2_gnd_uhf",
      "uhf",
    ),
    feed("KVOK", "approach", "Volk Approach/Departure", "", "kvok2_app"),
    feedN(
      "KVOK",
      "approach",
      "Volk Approach/Departure (UHF)",
      "",
      "kvok2_app_uhf",
      "uhf",
    ),
    feed("KVOK", "atis", "ATIS", "", "kvok2_atis"),
  ],

  // Joint Base Andrews (Camp Springs, Maryland, United States) — CSV verified
  KADW: [
    feed("KADW", "tower", "KDAA/KADW Tower", "", "kdaa2_twr"),
  ],

  // Canandaigua Airport (Canandaigua, New York, United States) — CSV verified
  KIUA: [
    feed("KIUA", "center", "CTAF", "", "kiua1_ctaf"),
  ],

  // Carson Airport (Carson City, Nevada, United States) — CSV verified
  KCXP: [
    feed("KCXP", "center", "CTAF", "", "kcxp1"),
  ],

  // Casa Grande Municipal Airport (Casa Grande, Arizona, United States) — CSV verified
  KCGZ: [
    feed("KCGZ", "atis", "AWOS", "", "kcgz1_awos"),
    feed("KCGZ", "center", "CTAF", "", "kcgz1_ctaf"),
    feedN(
      "KCGZ",
      "center",
      "ZAB Sector 46 (Tucson Low)",
      "",
      "zab46",
      "tucson",
    ),
    feed("KCGZ", "combined", "SE/SW Practice Area", "", "kcgz1_se_pract"),
  ],

  // Casper/Natrona County International Airport (Casper, Wyoming, United States) — CSV verified
  KCPR: [
    feed("KCPR", "combined", "Gnd/Twr/App", "", "kcpr2"),
    feedN(
      "KCPR",
      "combined",
      "Twr/App/ZDV/Radio",
      "",
      "kcpr",
      "2",
    ),
  ],

  // The Eastern Iowa Airport (Cedar Rapids, Iowa, United States) — CSV verified
  KCID: [
    feed("KCID", "combined", "Gnd/Twr/App", "", "kcid3"),
    feedN(
      "KCID",
      "combined",
      "Gnd/Twr/App/KIOW",
      "",
      "kcid",
      "2",
    ),
  ],

  // Chandler Municipal Airport (Chandler, Arizona, United States) — CSV verified
  KCHD: [
    feed("KCHD", "tower", "Tower (North)", "", "kchd_twr1"),
    feedN(
      "KCHD",
      "tower",
      "Tower (South)",
      "",
      "kchd_twr2",
      "south",
    ),
    feed("KCHD", "approach", "KPHX Approach (East Tempe Sector)", "", "kphx4_app_123700"),
    feedN(
      "KCHD",
      "approach",
      "KPHX Approach (Pima/Willy Sectors)",
      "",
      "kphx4_app_pima_willy",
      "pima",
    ),
  ],

  // Charleston Air Force Base/International Airport (Charleston, South Carolina, United States) — CSV verified
  KCHS: [
    feed("KCHS", "combined", "Gnd/Twr/App", "", "kchs"),
  ],

  // Yeager Airport (Charleston, West Virginia, United States) — CSV verified
  KCRW: [
    feed("KCRW", "combined", "Tower/Approach", "", "kcrw"),
  ],

  // Charleston Executive Airport (Charleston, South Carolina, United States) — CSV verified
  KJZI: [
    feed("KJZI", "center", "CTAF", "", "kjzi2"),
  ],

  // Charlottesville-Albemarle Airport (Charlottesville, Virginia, United States) — CSV verified
  KCHO: [
    feed("KCHO", "tower", "Tower", "", "kcho3_ctf"),
    feed("KCHO", "approach", "App/Dep", "", "kcho3_app"),
    feed("KCHO", "center", "ZDC Sector 01", "", "kcho3_zdc_128600"),
    feedN(
      "KCHO",
      "center",
      "ZDC Sector 01/02/05",
      "",
      "kcho3_zdc_125",
      "se",
    ),
    feedN(
      "KCHO",
      "center",
      "ZDC Sector 2",
      "",
      "kcho3_zdc_133200",
      "2",
    ),
    feedN(
      "KCHO",
      "center",
      "ZDC Sector 30/72",
      "",
      "kcho3_zdc_127925",
      "3",
    ),
    feedN(
      "KCHO",
      "center",
      "ZDC Sector 37",
      "",
      "kcho3_zdc_133025",
      "4",
    ),
    feedN(
      "KCHO",
      "center",
      "ZDC Sector 60 #2",
      "",
      "kcho3_zdc_121675",
      "5",
    ),
  ],

  // Chatham Municipal Airport (Chatham, Massachusetts, United States) — CSV verified
  KCQX: [
    feed("KCQX", "center", "5B6/KCQX/KPVC CTAF", "", "khya2_122800"),
  ],

  // Lovell Field Airport (Chattanooga, Tennessee, United States) — CSV verified
  KCHA: [
    feed("KCHA", "combined", "Twr/App", "", "kcha2"),
  ],

  // Chehalis-Centralia Airport (Chehalis, Washington, United States) — CSV verified
  KCLS: [
    feed("KCLS", "approach", "Seattle Approach (KCLS Area)", "", "kcls2_app"),
    feed("KCLS", "center", "CTAF", "", "kcls2_ctaf"),
  ],

  // Cherry Point Marine Corps Air Station (Cunningham Field) (Cherry Point, North Carolina, United States) — CSV verified
  KNKT: [
    feed("KNKT", "combined", "Aerial Refueling Ops", "", "knkt1_ar"),
    feedN(
      "KNKT",
      "combined",
      "Twr/App/Dep",
      "",
      "knkt1_app",
      "2",
    ),
  ],

  // Cheyenne Regional Airport/Jerry Olson Field (Cheyenne, Wyoming, United States) — CSV verified
  KCYS: [
    feed("KCYS", "combined", "Gnd/Twr/App/Center", "", "kcys"),
  ],

  // Chino Airport (Chino, California, United States) — CSV verified
  KCNO: [
    feed("KCNO", "tower", "Tower #1", "", "kcno1_twr"),
    feedN(
      "KCNO",
      "tower",
      "Tower #2",
      "",
      "kont1_kcno_twr",
      "2",
    ),
    feed("KCNO", "ground", "Ground #1", "", "kcno1_gnd"),
    feedN(
      "KCNO",
      "ground",
      "Ground #2",
      "",
      "kont1_kcno_gnd",
      "2",
    ),
    feed("KCNO", "atis", "ATIS", "", "kont1_kcno_atis"),
    feed("KCNO", "combined", "Ground/Tower", "", "kcno1_gnd_twr"),
  ],

  // North Central West Virginia Airport (Clarksburg, West Virginia, United States) — CSV verified
  KCKB: [
    feed("KCKB", "tower", "Tower", "", "kckb_twr"),
    feed("KCKB", "ground", "Ground", "", "kckb_gnd"),
    feed("KCKB", "approach", "App/Dep", "", "kckb_app"),
    feedN(
      "KCKB",
      "approach",
      "App/Dep (East)",
      "",
      "kckb_app_east",
      "east",
    ),
    feedN(
      "KCKB",
      "approach",
      "App/Dep (West)",
      "",
      "kckb_app_west",
      "west",
    ),
    feed("KCKB", "atis", "ATIS", "", "kckb_atis"),
    feed("KCKB", "center", "Emergency/Guard", "", "kckb_guard"),
    feedN(
      "KCKB",
      "center",
      "ZOB Sector 61 Morgantown Low",
      "",
      "zob_ckb",
      "se",
    ),
    feed("KCKB", "combined", "Ground/Tower", "", "kckb_gnd_twr"),
  ],

  // Clearwater Air Park (Clearwater, Florida, United States) — CSV verified
  KCLW: [
    feed("KCLW", "center", "CTAF", "", "kpie1_kclw_ctaf"),
  ],

  // Heritage Field Airport (Coatesville, Pennsylvania, United States) — CSV verified
  KPTW: [
    feed("KPTW", "center", "CTAF", "", "kptw3_ctaf"),
  ],

  // Coeur d\'Alene Airport - Pappy Boyington Field (Coeur d'Alene, Idaho, United States) — CSV verified
  KCOE: [
    feed("KCOE", "center", "CTAF", "", "kcoe2_ctaf"),
    feedN(
      "KCOE",
      "center",
      "FSS",
      "",
      "kcoe2_fss",
      "2",
    ),
    feedN(
      "KCOE",
      "center",
      "Seattle Center (Sector 8)",
      "",
      "kcoe2_zse8",
      "sector",
    ),
  ],

  // Columbia Metropolitan Airport (Columbia, South Carolina, United States) — CSV verified
  KCAE: [
    feed("KCAE", "combined", "Twr/App", "", "kcae2"),
  ],

  // Concord Municipal Airport (Concord, New Hampshire, United States) — CSV verified
  KCON: [
    feed("KCON", "center", "KCON/KDAW/KFIT CTAF", "", "kmht_murp_122700"),
  ],

  // Concord Regional Airport (Concord, North Carolina, United States) — CSV verified
  KJQF: [
    feed("KJQF", "combined", "Ground/Tower", "", "kjqf"),
  ],

  // Danbury Municipal Airport (Danbury, Connecticut, United States) — CSV verified
  KDXR: [
    feed("KDXR", "atis", "ATIS", "", "kdxr_atis"),
    feed("KDXR", "combined", "Ground/Tower", "", "kdxr"),
  ],

  // Daytona Beach International Airport (Daytona Beach, Florida, United States) — CSV verified
  KDAB: [
    feed("KDAB", "tower", "Tower (118.1) #1", "", "kdab_twr_sec_radio"),
    feedN(
      "KDAB",
      "tower",
      "Tower (118.1) #2",
      "",
      "kdab_twr_sec",
      "2",
    ),
    feedN(
      "KDAB",
      "tower",
      "Tower (120.7) #1",
      "",
      "kdab_twr_pri_radio",
      "1",
    ),
    feedN(
      "KDAB",
      "tower",
      "Tower (120.7) #2",
      "",
      "kdab_twr_pri",
      "3",
    ),
    feedN(
      "KDAB",
      "tower",
      "Tower (Both)",
      "",
      "kdab_twr",
      "both",
    ),
    feed("KDAB", "ground", "Clearance Delivery", "", "kdab_del"),
    feedN(
      "KDAB",
      "ground",
      "Clearance/Ground",
      "",
      "kdab_del_gnd",
      "2",
    ),
    feedN(
      "KDAB",
      "ground",
      "Ground",
      "",
      "kdab_gnd_121900",
      "3",
    ),
    feed("KDAB", "approach", "App/Dep", "", "kdab_app_all"),
    feedN(
      "KDAB",
      "approach",
      "App/Dep (East/Low)",
      "",
      "kdab_app_123900",
      "east",
    ),
    feedN(
      "KDAB",
      "approach",
      "App/Dep (North/High)",
      "",
      "kdab_app_118850",
      "north",
    ),
    feedN(
      "KDAB",
      "approach",
      "App/Dep (North/Low)",
      "",
      "kdab_app_125800",
      "low",
    ),
    feedN(
      "KDAB",
      "approach",
      "App/Dep (South)",
      "",
      "kdab_app_125350",
      "south",
    ),
    feedN(
      "KDAB",
      "approach",
      "App/Dep (South/High)",
      "",
      "kdab_app_127075",
      "high",
    ),
    feed("KDAB", "atis", "ATIS", "", "kdab_atis2"),
    feed("KDAB", "combined", "ZJX Daytona Beach", "", "zjx_dab"),
  ],

  // DeLand Municipal Airport-Sidney H Taylor Field (DeLand, Florida, United States) — CSV verified
  KDED: [
    feed("KDED", "center", "CTAF", "", "kded_ctaf"),
    feedN(
      "KDED",
      "center",
      "CTAF/Misc",
      "",
      "kded2",
      "2",
    ),
    feedN(
      "KDED",
      "center",
      "Emergency/Guard",
      "",
      "kded_guard",
      "3",
    ),
  ],

  // Deadhorse Airport (Deadhorse, Alaska, United States) — CSV verified
  PASC: [
    feed("PASC", "center", "CTAF/Unicom/AFIS/App", "", "pasc"),
  ],

  // Centennial Airport (Denver, Colorado, United States) — CSV verified
  KAPA: [
    feed("KAPA", "tower", "Tower (Primary)", "", "kapa2_twr1"),
    feedN(
      "KAPA",
      "tower",
      "Tower (Secondary #1)",
      "",
      "kapa2_twr2",
      "secondary",
    ),
    feedN(
      "KAPA",
      "tower",
      "Tower (Secondary #2)",
      "",
      "kapa2_twr3",
      "se",
    ),
    feed("KAPA", "ground", "Del/Gnd", "", "kapa2_gnd"),
    feed("KAPA", "approach", "App/Dep", "", "kapa2_app"),
  ],

  // Rocky Mountain Metropolitan Airport (Denver, Colorado, United States) — CSV verified
  KBJC: [
    feed("KBJC", "atis", "ATIS", "", "kden1_kbjc_atis"),
    feed("KBJC", "combined", "Ground/Tower", "", "kbjc3"),
  ],

  // Des Moines International Airport (Des Moines, Iowa, United States) — CSV verified
  KDSM: [
    feed("KDSM", "tower", "Tower", "", "kdsm3_twr"),
    feed("KDSM", "atis", "ATIS", "", "kdsm3_atis"),
  ],

  // Dover Air Force Base (Dover, Delaware, United States) — CSV verified
  KDOV: [
    feed("KDOV", "tower", "Tower", "", "kdov2_twr"),
    feed("KDOV", "approach", "Gnd/App", "", "kdov2_gnd_app"),
    feed("KDOV", "atis", "ATIS", "", "kdov2_atis"),
    feed("KDOV", "combined", "Del/Gnd/Twr/App", "", "kdov_del_gnd_twr"),
    feedN(
      "KDOV",
      "combined",
      "ZDC19/53 Kenton/Woodstown",
      "",
      "kdov_zdc",
      "2",
    ),
  ],

  // Dubuque Regional Airport (Dubuque, Iowa, United States) — CSV verified
  KDBQ: [
    feed("KDBQ", "center", "ZAU Sector 63 #2", "", "zau_dbq_63"),
    feedN(
      "KDBQ",
      "center",
      "ZAU Sector 75 #2",
      "",
      "zau_dbq_75",
      "se",
    ),
    feedN(
      "KDBQ",
      "center",
      "ZAU Sector 75/76",
      "",
      "zau_dbq_75_76",
      "2",
    ),
    feedN(
      "KDBQ",
      "center",
      "ZAU Sector 76 #2",
      "",
      "zau_dbq_76",
      "3",
    ),
  ],

  // Duluth International Airport (Duluth, Minnesota, United States) — CSV verified
  KDLH: [
    feed("KDLH", "center", "ZMP Sector 25/DLH ANG", "", "kdlh2"),
    feed("KDLH", "combined", "Gnd/Twr/App", "", "kdlh1"),
  ],

  // Eagle River Union Airport (Eagle River, Wisconsin, United States) — CSV verified
  KEGV: [
    feed("KEGV", "center", "CTAF", "", "ksbm3"),
  ],

  // East Hampton Town Airport (East Hampton, New York, United States) — CSV verified
  KJPX: [
    feed("KJPX", "tower", "CTAF/Tower", "", "khto2"),
  ],

  // Easton/Newnam Field Airport (Easton, Maryland, United States) — CSV verified
  KESN: [
    feed("KESN", "combined", "Ground/Tower", "", "kesn2"),
  ],

  // Chippewa Valley Regional Airport (Eau Claire, Wisconsin, United States) — CSV verified
  KEAU: [
    feed("KEAU", "combined", "Ground/Tower", "", "keau2_gnd_twr"),
  ],

  // El Paso International Airport (El Paso, Texas, United States) — CSV verified
  KELP: [
    feed("KELP", "tower", "Tower", "", "kelp1_twr"),
    feed("KELP", "ground", "Ground", "", "kelp1_gnd"),
    feed("KELP", "approach", "App/Dep (North)", "", "kelp1_app_n"),
    feedN(
      "KELP",
      "approach",
      "Approach",
      "",
      "kelp1_app_e",
      "2",
    ),
    feed("KELP", "combined", "Gnd/Twr/App/Dep", "", "kelp1"),
  ],

  // Elmira/Corning Regional Airport (Elmira, New York, United States) — CSV verified
  KELM: [
    feed("KELM", "tower", "Tower", "", "kelm1_twr"),
    feed("KELM", "ground", "Del/Ground", "", "kelm1_del_gnd"),
    feed("KELM", "approach", "App/Dep", "", "kelm1_app"),
    feed("KELM", "atis", "ATIS", "", "kelm1_atis"),
    feed("KELM", "center", "Emergency/Guard", "", "kelm1_guard"),
    feed("KELM", "combined", "Del/Gnd/Twr/App", "", "kelm1_all"),
  ],

  // Snohomish County Airport (Paine Field) (Everett, Washington, United States) — CSV verified
  KPAE: [
    feed("KPAE", "combined", "Ground/Tower", "", "kpae"),
  ],

  // Fairbanks International Airport (Fairbanks, Alaska, United States) — CSV verified
  PAFA: [
    feed("PAFA", "tower", "Tower", "", "pafa1_twr"),
    feed("PAFA", "ground", "Del/Gnd", "", "pafa1_del_gnd"),
    feed("PAFA", "approach", "App/Dep", "", "pafa1_app"),
    feed("PAFA", "center", "Anchorage Center (PAFA Area)", "", "pafa1_ctr"),
  ],

  // H L Sonny Callahan Airport (Fairhope, Alabama, United States) — CSV verified
  KCQF: [
    feed("KCQF", "center", "CTAF/Misc", "", "kcqf"),
  ],

  // Cape Cod Coast Guard Air Station (Falmouth, Massachusetts, United States) — CSV verified
  KFMH: [
    feed("KFMH", "tower", "Tower", "", "kfmh1_twr"),
    feed("KFMH", "ground", "Ground", "", "kfmh1_gnd"),
    feed("KFMH", "approach", "Boston Approach (Cape North) #1", "", "kfmh1_app"),
    feedN(
      "KFMH",
      "approach",
      "Boston Approach (OTIS Arrival)",
      "",
      "kfmh1_app2",
      "otis",
    ),
    feed("KFMH", "atis", "ATIS", "", "kfmh1_atis"),
    feed("KFMH", "center", "ZBW Cape Sector #1", "", "kfmh1_zbw_cape"),
    feedN(
      "KFMH",
      "center",
      "ZNY JOBOC Sector",
      "",
      "kfmh1_zny_joboc",
      "se",
    ),
  ],

  // Hector International Airport (Fargo, North Dakota, United States) — CSV verified
  KFAR: [
    feed("KFAR", "tower", "Tower", "", "kfar2"),
  ],

  // Republic Airport (Farmingdale, New York, United States) — CSV verified
  KFRG: [
    feed("KFRG", "tower", "Tower #1", "", "kfrg_twr1"),
    feedN(
      "KFRG",
      "tower",
      "Tower #2",
      "",
      "kfrg9_twr",
      "2",
    ),
    feed("KFRG", "ground", "Delivery/Ground", "", "kfrg_del_gnd1"),
    feedN(
      "KFRG",
      "ground",
      "Ground #2",
      "",
      "kfrg9_gnd",
      "2",
    ),
    feed("KFRG", "atis", "ATIS", "", "kfrg_atis1"),
    feed("KFRG", "combined", "Ground/Tower #2", "", "kfrg9_gnd_twr"),
  ],

  // Northwest Arkansas Regional Airport (Fayetteville/Springdale/Rogers, Arkansas, United States) — CSV verified
  KXNA: [
    feed("KXNA", "combined", "KROG/KXNA/KVBT/Misc", "", "krog"),
  ],

  // Fitchburg Municipal Airport (Fitchburg, Massachusetts, United States) — CSV verified
  KFIT: [
    feed("KFIT", "center", "KCON/KDAW/KFIT CTAF", "", "kmht_murp_122700"),
  ],

  // Flagstaff Pulliam Airport (Flagstaff, Arizona, United States) — CSV verified
  KFLG: [
    feed("KFLG", "combined", "Ground/Tower", "", "kflg"),
  ],

  // Bishop International Airport (Flint, Michigan, United States) — CSV verified
  KFNT: [
    feed("KFNT", "tower", "Tower", "", "kfnt2_twr"),
    feed("KFNT", "approach", "App/Dep", "", "kfnt2_app"),
    feed("KFNT", "center", "ZOB Sector 12", "", "kfnt2_zob12"),
  ],

  // Florence Regional Airport (Florence, South Carolina, United States) — CSV verified
  KFLO: [
    feed("KFLO", "combined", "Gnd/Twr/App", "", "kflo2"),
  ],

  // Fond Du Lac County Airport (Fond du Lac, Wisconsin, United States) — CSV verified
  KFLD: [
    feed("KFLD", "tower", "Tower (Temp Tower for EAA)", "", "kfld_twr"),
    feed("KFLD", "ground", "Ground (Temp Ground for EAA)", "", "kfld_gnd"),
    feed("KFLD", "center", "Green Bay Radio (KFLD)", "", "kfld_rdio"),
    feedN(
      "KFLD",
      "center",
      "CTAF",
      "",
      "kfld_ctaf",
      "2",
    ),
  ],

  // Davison Army Airfield (Fort Belvoir, Virginia, United States) — CSV verified
  KDAA: [
    feed("KDAA", "tower", "KDAA/KADW Tower", "", "kdaa2_twr"),
  ],

  // Sierra Vista Municipal Airport-Libby Army Airfield (Fort Huachuca/Sierra Vista, Arizona, United States) — CSV verified
  KFHU: [
    feed("KFHU", "combined", "Gnd/Twr/Radar", "", "kfhu"),
  ],

  // Fort Lauderdale Executive Airport (Fort Lauderdale, Florida, United States) — CSV verified
  KFXE: [
    feed("KFXE", "tower", "Tower #2", "", "kfxe3_twr2"),
    feed("KFXE", "ground", "Ground", "", "kfxe3_gnd"),
    feed("KFXE", "approach", "Miami App/Dep (FXE)", "", "kfxe3_app"),
    feed("KFXE", "atis", "ATIS", "", "kfxe3_atis"),
  ],

  // Page Field Airport (Fort Myers, Florida, United States) — CSV verified
  KFMY: [
    feed("KFMY", "tower", "Tower", "", "kfmy_twr"),
    feed("KFMY", "ground", "Ground #1", "", "kfmy_gnd"),
    feed("KFMY", "atis", "ATIS", "", "kfmy_atis"),
    feed("KFMY", "center", "ZMA Miami Center (Sector 08)", "", "zma_fmy_133900"),
    feedN(
      "KFMY",
      "center",
      "ZMA Miami Center (Sector 24 Both)",
      "",
      "zma24_fmy",
      "sector",
    ),
    feedN(
      "KFMY",
      "center",
      "ZMA Miami Center (Sector 24/132.4)",
      "",
      "zma_fmy_132400",
      "24",
    ),
    feedN(
      "KFMY",
      "center",
      "ZMA Miami Center (Sector 24/134.75)",
      "",
      "zma_fmy_134750",
      "13475",
    ),
    feedN(
      "KFMY",
      "center",
      "ZMA Miami Center (Sector 25 Both)",
      "",
      "zma25_fmy",
      "25",
    ),
    feedN(
      "KFMY",
      "center",
      "ZMA Miami Center (Sector 25/128.225)",
      "128.225",
      "zma_fmy_128225",
      "128225",
    ),
    feedN(
      "KFMY",
      "center",
      "ZMA Miami Center (Sector 25/133.275)",
      "133.275",
      "zma_fmy_133275",
      "133275",
    ),
    feedN(
      "KFMY",
      "center",
      "ZMA Miami Center (Sector 7/8 Both)",
      "",
      "zma08_fmy",
      "both",
    ),
    feed("KFMY", "combined", "Ground/Tower", "", "kfmy_gnd_twr"),
  ],

  // Southwest Florida International Airport (Fort Myers, Florida, United States) — CSV verified
  KRSW: [
    feed("KRSW", "combined", "Gnd/Twr/App/Dep", "", "krsw2"),
  ],

  // St Lucie County International Airport (Fort Pierce, Florida, United States) — CSV verified
  KFPR: [
    feed("KFPR", "tower", "Tower", "", "kfpr3_twr"),
    feed("KFPR", "ground", "Ground", "", "kfpr3_gnd"),
    feed("KFPR", "atis", "ATIS", "", "kfpr3_atis"),
    feed("KFPR", "combined", "Ground/Tower", "", "kfpr3_gnd_twr"),
  ],

  // Fort Smith Regional Airport (Fort Smith, Arkansas, United States) — CSV verified
  KFSM: [
    feed("KFSM", "combined", "Gnd/Twr/App", "", "kfsm1"),
  ],

  // Frederick Municipal Airport (Frederick, Maryland, United States) — CSV verified
  KFDK: [
    feed("KFDK", "atis", "ATIS", "", "kfdk2_atis"),
    feed("KFDK", "combined", "Del/Gnd/Twr/CTAF #1", "", "kfdk2"),
  ],

  // Potomac Airfield (Friendly, Maryland, United States) — CSV verified
  KVKX: [
    feed("KVKX", "center", "Area Guard", "", "kvkx1_guard"),
    feedN(
      "KVKX",
      "center",
      "Area Guard",
      "",
      "kvkx1_guard",
      "2",
    ),
    feedN(
      "KVKX",
      "center",
      "CTAF",
      "",
      "kvkx1_ctaf",
      "3",
    ),
    feedN(
      "KVKX",
      "center",
      "CTAF",
      "",
      "kvkx1_ctaf",
      "4",
    ),
  ],

  // Gainesville Regional Airport (Gainesville, Florida, United States) — CSV verified
  KGNV: [
    feed("KGNV", "combined", "Ground/Tower", "", "kgnv"),
  ],

  // Montgomery County Airpark (Gaithersburg, Maryland, United States) — CSV verified
  KGAI: [
    feed("KGAI", "center", "CTAF/UNICOM", "", "kgai"),
  ],

  // Delaware Coastal Airport (Georgetown, Delaware, United States) — CSV verified
  KGED: [
    feed("KGED", "ground", "Clearance Delivery", "", "kged2_del"),
    feed("KGED", "atis", "ASOS", "", "kged2_asos"),
    feed("KGED", "center", "CTAF", "", "kged2_ctaf"),
    feedN(
      "KGED",
      "center",
      "Emergency/Guard",
      "",
      "kged2_guard",
      "2",
    ),
  ],

  // Georgetown County Airport (Georgetown, South Carolina, United States) — CSV verified
  KGGE: [
    feed("KGGE", "center", "CTAF", "", "kgge2"),
  ],

  // Glendale Municipal Airport (Glendale, Arizona, United States) — CSV verified
  KGEU: [
    feed("KGEU", "tower", "Tower", "", "kgeu1_twr"),
    feed("KGEU", "ground", "Ground", "", "kgeu1_gnd"),
    feed("KGEU", "approach", "App/Dep", "", "kgeu1_app"),
    feed("KGEU", "atis", "ATIS", "", "kgeu1_atis"),
  ],

  // Luke Air Force Base (Glendale, Arizona, United States) — CSV verified
  KLUF: [
    feed("KLUF", "approach", "App/Dep", "", "kphx5_kluf_app"),
    feed("KLUF", "combined", "Del/Gnd/Twr/Misc", "", "kphx5_kluf_gnd_twr"),
  ],

  // Floyd Bennett Memorial Airport (Glens Falls, New York, United States) — CSV verified
  KGFL: [
    feed("KGFL", "center", "Area CTAF", "", "kgfl1_ctaf"),
  ],

  // Glenwood Springs Municipal Airport (Glenwood Springs, Colorado, United States) — CSV verified
  KGWS: [
    feed("KGWS", "center", "CTAF/Guard", "", "kgws2"),
    feed("KGWS", "combined", "Aerial Firefighting (Temporary)", "", "kgws_fire"),
  ],

  // Phoenix Goodyear Airport (Goodyear, Arizona, United States) — CSV verified
  KGYR: [
    feed("KGYR", "tower", "Tower", "", "kgyr2_twr"),
    feed("KGYR", "ground", "Ground", "", "kgyr2_gnd"),
    feed("KGYR", "combined", "Ground/Tower", "", "kgyr2_gnd_twr"),
  ],

  // Grand Forks International Airport (Grand Forks, North Dakota, United States) — CSV verified
  KGFK: [
    feed("KGFK", "tower", "Tower (Both)", "", "kgfk3_twr"),
    feedN(
      "KGFK",
      "tower",
      "Tower 1 (118.4/IFR/VFR)",
      "",
      "kgfk3_twr1",
      "2",
    ),
    feed("KGFK", "ground", "Ground", "", "kgfk3_gnd"),
    feed("KGFK", "approach", "Approach", "", "kgfk3_app"),
  ],

  // Gerald R. Ford International Airport (Grand Rapids, Michigan, United States) — CSV verified
  KGRR: [
    feed("KGRR", "tower", "Tower", "", "kgrr2_2_twr"),
    feed("KGRR", "ground", "Clearance Delivery", "", "kgrr2_2_del"),
    feedN(
      "KGRR",
      "ground",
      "Ground",
      "",
      "kgrr2_2_gnd",
      "2",
    ),
    feed("KGRR", "approach", "App/Dep", "", "kgrr2_2_app"),
    feedN(
      "KGRR",
      "approach",
      "App/Dep (South)",
      "",
      "kgrr2_2_app_s",
      "south",
    ),
    feed("KGRR", "center", "Emergency/Guard", "", "kgrr2_2_guard"),
    feedN(
      "KGRR",
      "center",
      "ZAU Sector 22",
      "",
      "kgrr2_2_zau22",
      "se",
    ),
    feedN(
      "KGRR",
      "center",
      "ZAU Sector 25",
      "",
      "kgrr2_2_zau25",
      "2",
    ),
    feed("KGRR", "combined", "Del/Gnd/Twr", "", "kgrr2_2_del_gnd_twr"),
    feedN(
      "KGRR",
      "combined",
      "Gnd/Twr/App",
      "",
      "kgrr2_2_gnd_twr_app",
      "2",
    ),
  ],

  // Austin Straubel International Airport (Green Bay, Wisconsin, United States) — CSV verified
  KGRB: [
    feed("KGRB", "approach", "App/Dep", "", "kgrb1_app"),
    feed("KGRB", "center", "ZMP Sector 04/14", "", "kgrb1_zmp"),
    feed("KGRB", "combined", "Gnd/Twr", "", "kgrb1_gnd_twr"),
  ],

  // Piedmont Triad International Airport (Greensboro, North Carolina, United States) — CSV verified
  KGSO: [
    feed("KGSO", "tower", "Tower", "", "kgso1_twr"),
    feed("KGSO", "ground", "Del/Gnd", "", "kgso1_del_gnd"),
    feed("KGSO", "approach", "Approach/Departure", "", "kgso1_app"),
    feedN(
      "KGSO",
      "approach",
      "Approach/Departure (South)",
      "",
      "kgso1_app_south",
      "south",
    ),
    feedN(
      "KGSO",
      "approach",
      "Approach/Departure (West)",
      "",
      "kgso1_app_west",
      "west",
    ),
    feed("KGSO", "atis", "ATIS", "", "kgso1_atis"),
    feed("KGSO", "center", "ZTL Sector 29", "", "kgso1_ztl29"),
    feedN(
      "KGSO",
      "center",
      "ZTL Sector 29/33",
      "",
      "kgso1_ztl2933",
      "se",
    ),
    feedN(
      "KGSO",
      "center",
      "ZTL Sector 33",
      "",
      "kgso1_ztl33",
      "2",
    ),
  ],

  // Greenville Downtown Airport (Greenville, South Carolina, United States) — CSV verified
  KGMU: [
    feed("KGMU", "tower", "Tower", "", "kgmu_twr"),
    feed("KGMU", "ground", "Ground", "", "kgmu_gnd"),
    feed("KGMU", "atis", "ATIS", "", "kgmu_atis"),
    feed("KGMU", "combined", "Ground/Tower", "", "kgmu"),
  ],

  // Donaldson Field Airport (Greenville, South Carolina, United States) — CSV verified
  KGYH: [
    feed("KGYH", "tower", "Tower", "", "kgmu_kgyh_twr"),
    feed("KGYH", "combined", "Ground/Tower", "", "kgyh2"),
  ],

  // Pitt-Greenville Airport (Greenville, North Carolina, United States) — CSV verified
  KPGV: [
    feed("KPGV", "center", "CTAF", "", "kpgv"),
  ],

  // Greenville Spartanburg International Airport (Greer, South Carolina, United States) — CSV verified
  KGSP: [
    feed("KGSP", "tower", "Tower", "", "kgmu_kgsp_twr"),
    feed("KGSP", "approach", "App/Dep (East)", "", "kgmu_kgsp_app_e"),
    feedN(
      "KGSP",
      "approach",
      "App/Dep (West)",
      "",
      "kgmu_kgsp_app_w",
      "west",
    ),
    feed("KGSP", "atis", "ATIS", "", "kgmu_kgsp_atis"),
    feed("KGSP", "center", "ZTL Atlanta Center (Sector 31)", "", "kgmu_ztl31"),
    feedN(
      "KGSP",
      "center",
      "ZTL Atlanta Center (Sector 32)",
      "",
      "kgmu_ztl32",
      "sector",
    ),
  ],

  // Jack Edwards National Airport (Gulf Shores, Alabama, United States) — CSV verified
  KJKA: [
    feed("KJKA", "tower", "Tower", "", "kjka2_twr"),
  ],

  // Gulfport-Biloxi International Airport (Gulfport, Mississippi, United States) — CSV verified
  KGPT: [
    feed("KGPT", "combined", "Gnd/Twr/App", "", "kgpt2"),
  ],

  // Hagerstown Regional Airport-Richard A Henson Field (Hagerstown, Maryland, United States) — CSV verified
  KHGR: [
    feed("KHGR", "tower", "Tower", "", "kmrb1_khgr_twr"),
    feed("KHGR", "center", "ZDC Sector 06 (HGR)", "", "kmrb1_zdc_hgr"),
  ],

  // Friedman Memorial Airport (Hailey, Idaho, United States) — CSV verified
  KSUN: [
    feed("KSUN", "atis", "ATIS", "", "ksun1_atis"),
    feed("KSUN", "combined", "Ground/Tower", "", "ksun1_gnd_twr"),
  ],

  // Langley Air Force Base (Hampton, Virginia, United States) — CSV verified
  KLFI: [
    feed("KLFI", "combined", "Del/Gnd/Twr", "", "klfi"),
  ],

  // Boone County Airport (Harrison, Arkansas, United States) — CSV verified
  KHRO: [
    feed("KHRO", "center", "CTAF/ZME/Misc", "", "khro"),
  ],

  // Hartford-Brainard Airport (Hartford, Connecticut, United States) — CSV verified
  KHFD: [
    feed("KHFD", "combined", "Ground/Tower", "", "khfd"),
  ],

  // Helena Regional Airport (Helena, Montana, United States) — CSV verified
  KHLN: [
    feed("KHLN", "tower", "Tower", "", "khln2_twr"),
    feed("KHLN", "ground", "Ground", "", "khln2_gnd"),
    feed("KHLN", "approach", "Approach/Departure", "", "khln2_app"),
    feed("KHLN", "atis", "ATIS", "", "khln2_atis"),
  ],

  // Hickory Regional Airport (Hickory, North Carolina, United States) — CSV verified
  KHKY: [
    feed("KHKY", "tower", "Tower", "", "khky2_twr"),
    feed("KHKY", "ground", "Clearance Delivery (ZTL)", "", "khky2_del"),
    feedN(
      "KHKY",
      "ground",
      "Ground",
      "",
      "khky2_gnd",
      "2",
    ),
    feed("KHKY", "atis", "ASOS", "", "khky2_asos"),
    feed("KHKY", "center", "Emergency/Guard", "", "khky2_guard"),
    feedN(
      "KHKY",
      "center",
      "ZTL48 Wilkes Sector",
      "",
      "khky2_ztl48",
      "se",
    ),
  ],

  // Hilton Head Airport (Hilton Head Island, South Carolina, United States) — CSV verified
  KHXD: [
    feed("KHXD", "combined", "Ground/Tower", "", "khxd"),
  ],

  // Lea County Regional Airport (Hobbs, New Mexico, United States) — CSV verified
  KHOB: [
    feed("KHOB", "tower", "Tower", "", "khob2_twr"),
    feed("KHOB", "ground", "Ground", "", "khob2_gnd"),
    feed("KHOB", "atis", "ATIS", "", "khob2_atis"),
    feed("KHOB", "center", "Area Emergency/Guard", "", "khob2_guard"),
  ],

  // North Perry Airport (Hollywood, Florida, United States) — CSV verified
  KHWO: [
    feed("KHWO", "tower", "Tower (Both) #1", "", "khwo2_twr"),
    feedN(
      "KHWO",
      "tower",
      "Tower (Primary) #1",
      "",
      "khwo2_twr1",
      "primary",
    ),
    feedN(
      "KHWO",
      "tower",
      "Tower (Secondary) #1",
      "",
      "khwo2_twr2",
      "secondary",
    ),
    feed("KHWO", "ground", "Ground", "", "khwo2_gnd"),
    feed("KHWO", "atis", "ATIS", "", "khwo2_atis"),
  ],

  // Kalaeloa Airport (John Rodgers Field) (Honolulu, Hawaii, United States) — CSV verified
  PHJR: [
    feed("PHJR", "atis", "ATIS", "", "phnl1_phjr_atis"),
  ],

  // Houlton International Airport (Houlton, Maine, United States) — CSV verified
  KHUL: [
    feed("KHUL", "atis", "ASOS", "", "khul_asos"),
    feed("KHUL", "combined", "KHUL/KPQI/ZBW01/15", "", "khul"),
  ],

  // Huntsville International Airport-Carl T Jones Field (Huntsville, Alabama, United States) — CSV verified
  KHSV: [
    feed("KHSV", "tower", "Tower (VHF)", "", "khsv_twr2"),
    feed("KHSV", "ground", "Del/Gnd (VHF)", "", "khsv_del_gnd"),
    feed("KHSV", "atis", "ATIS", "", "khsv_atis"),
    feed("KHSV", "center", "Emergency/Guard", "", "khsv3_guard"),
    feedN(
      "KHSV",
      "center",
      "ZME Memphis Center (Hamilton)",
      "",
      "zme_hsv_120800",
      "hamilton",
    ),
    feedN(
      "KHSV",
      "center",
      "ZTL Atlanta Center (HSV/Sector 02)",
      "",
      "khsv_ztl_126825",
      "hsv",
    ),
    feed("KHSV", "combined", "Gnd/Twr/App/Dep", "", "khsv3"),
  ],

  // Hutchinson Municipal Airport (Hutchinson, Kansas, United States) — CSV verified
  KHUT: [
    feed("KHUT", "combined", "Ground/Twr", "", "khut"),
  ],

  // Cape Cod Gateway Airport (Hyannis, Massachusetts, United States) — CSV verified
  KHYA: [
    feed("KHYA", "tower", "Tower", "", "khya2_twr"),
    feed("KHYA", "ground", "Ground", "", "khya2_gnd"),
    feed("KHYA", "approach", "Boston Approach (Cape North) #1", "", "kfmh1_app"),
    feedN(
      "KHYA",
      "approach",
      "Boston Approach (Cape North) #2",
      "",
      "khya2_app",
      "cape",
    ),
    feed("KHYA", "atis", "ATIS", "", "khya2_atis"),
    feed("KHYA", "center", "Emergency/Guard", "", "khya2_121500"),
    feedN(
      "KHYA",
      "center",
      "ZBW Boston Center (ACK17)",
      "",
      "khya2_zbw",
      "ack17",
    ),
    feed("KHYA", "combined", "Gnd/Twr", "", "khya2_gnd_twr"),
  ],

  // Falls International Airport-Einarson Field (International Falls, Minnesota, United States) — CSV verified
  KINL: [
    feed("KINL", "center", "CTAF/FSS/Center", "", "kinl1_all"),
    feedN(
      "KINL",
      "center",
      "Princeton Radio FSS",
      "",
      "kinl1_radio",
      "2",
    ),
    feedN(
      "KINL",
      "center",
      "KINL/CYAG CTAF",
      "",
      "kinl1_ctaf",
      "3",
    ),
  ],

  // Inverness Airport (Inverness, Florida, United States) — CSV verified
  KINF: [
    feed("KINF", "center", "CTAF", "", "kinf2"),
  ],

  // Iowa City Municipal Airport (Iowa City, Iowa, United States) — CSV verified
  KIOW: [
    feed("KIOW", "combined", "KCID Gnd/Twr/App/KIOW", "", "kcid"),
  ],

  // Long Island Mac Arthur Airport (Islip, New York, United States) — CSV verified
  KISP: [
    feed("KISP", "tower", "Tower", "", "kisp_gnd_twr"),
    feed("KISP", "approach", "(NY Approach)", "", "kisp2"),
    feedN(
      "KISP",
      "approach",
      "New York Approach (VIKKY Sector)",
      "",
      "zbw_ccc_n90_vikky",
      "vikky",
    ),
    feed("KISP", "combined", "Tower/Approach", "", "kisp_s"),
  ],

  // Jackson-Medgar Wiley Evers International Airport (Jackson, Mississippi, United States) — CSV verified
  KJAN: [
    feed("KJAN", "combined", "Gnd/Twr/App/Dep", "", "kjan"),
  ],

  // Westover Field / Amador County Airport (Jackson, California, United States) — CSV verified
  KJAQ: [
    feed("KJAQ", "atis", "AWOS", "", "kjaq2_awos"),
    feed("KJAQ", "center", "CTAF", "", "kjaq2_ctaf"),
    feedN(
      "KJAQ",
      "center",
      "Guard",
      "",
      "kjaq2_guard",
      "2",
    ),
  ],

  // Jackson County Airport-Reynolds Field (Jackson, Michigan, United States) — CSV verified
  KJXN: [
    feed("KJXN", "combined", "Gnd/Twr/UNICOM", "", "kjxn2_twrgnd"),
  ],

  // Craig Municipal Airport (Jacksonville, Florida, United States) — CSV verified
  KCRG: [
    feed("KCRG", "tower", "Tower", "", "kcrg1_twr"),
    feed("KCRG", "ground", "Ground", "", "kcrg1_gnd"),
    feed("KCRG", "atis", "ATIS", "", "kcrg1_atis"),
    feed("KCRG", "center", "Area Guard", "", "kcrg1_guard"),
    feedN(
      "KCRG",
      "center",
      "UNICOM",
      "",
      "kcrg1_unicom",
      "2",
    ),
    feed("KCRG", "combined", "Ground/Tower", "", "kcrg1_gnd_twr"),
  ],

  // Jaffrey Airport-Silver Ranch (Jaffrey, New Hampshire, United States) — CSV verified
  KAFN: [
    feed("KAFN", "center", "MA/NH CTAF 122.8", "", "kmht_murp_122800"),
  ],

  // Southern Wisconsin Regional Airport (Janesville, Wisconsin, United States) — CSV verified
  KJVL: [
    feed("KJVL", "tower", "Tower", "", "kjvl1_twr"),
    feed("KJVL", "ground", "Ground", "", "kjvl1_gnd"),
    feed("KJVL", "approach", "Rockford App/Dep", "", "krfd2_app"),
    feed("KJVL", "atis", "ATIS", "", "kjvl1_atis"),
    feed("KJVL", "center", "Area Emergency/Guard", "", "kjvl1_guard"),
    feed("KJVL", "combined", "Ground/Tower", "", "kjvl1_gnd_twr"),
  ],

  // Kahului Airport (Maui) (Kahului, Hawaii, United States) — CSV verified
  PHOG: [
    feed("PHOG", "tower", "Tower", "", "phog3"),
    feed("PHOG", "ground", "Clearance Delivery", "", "phog2_del"),
    feedN(
      "PHOG",
      "ground",
      "Ground",
      "",
      "phog2_gnd",
      "2",
    ),
    feed("PHOG", "atis", "ATIS", "", "phog2_atis"),
    feed("PHOG", "center", "HCF Center (127.6)", "", "phog2_hcf_127600"),
    feedN(
      "PHOG",
      "center",
      "HCF Center (Big Island/Maui)",
      "",
      "phog2_hcf_126000",
      "big",
    ),
    feedN(
      "PHOG",
      "center",
      "HCF Center (Lanai/Molokai/PHKO)",
      "",
      "phog2_hcf_11931241",
      "lanai",
    ),
    feedN(
      "PHOG",
      "center",
      "HCF Center (PHOG/All)",
      "",
      "phog2_hcf",
      "phog",
    ),
    feed("PHOG", "combined", "Del/Gnd/Twr/App", "", "phog2"),
    feedN(
      "PHOG",
      "combined",
      "HCF App (N/S)",
      "",
      "phog2_app",
      "2",
    ),
    feedN(
      "PHOG",
      "combined",
      "HCF App (North)",
      "",
      "phog2_app_n",
      "north",
    ),
    feedN(
      "PHOG",
      "combined",
      "HCF App (South)",
      "",
      "phog2_app_s",
      "south",
    ),
  ],

  // Kona International Airport at Keahole (Kailua/Kona, Hawaii, United States) — CSV verified
  PHKO: [
    feed("PHKO", "center", "HCF Center (Northeast/Hamakua)", "", "phko2_hcf"),
    feed("PHKO", "combined", "Kona Gnd/Twr", "", "phko"),
  ],

  // Glacier Park International Airport (Kalispell, Montana, United States) — CSV verified
  KGPI: [
    feed("KGPI", "tower", "Tower", "", "kgpi2_twr"),
    feed("KGPI", "ground", "Ground", "", "kgpi2_gnd"),
    feed("KGPI", "approach", "Salt Lake Center (KGPI App/Dep)", "", "kgpi2_app"),
    feed("KGPI", "center", "Great Falls Radio", "", "kgpi2_rdo"),
  ],

  // Kansas City International Airport (Kansas City, Missouri, United States) — CSV verified
  KMCI: [
    feed("KMCI", "approach", "App/Dep", "", "kmci1_app"),
    feed("KMCI", "center", "ZKC Kansas City Center (26)", "", "zkc_mci"),
    feed("KMCI", "combined", "Del/Gnd/Twr", "", "kmci1_local"),
    feedN(
      "KMCI",
      "combined",
      "Del/Gnd/Twr/App",
      "",
      "kmci1",
      "2",
    ),
  ],

  // Charles B. Wheeler Downtown Airport (Kansas City, Missouri, United States) — CSV verified
  KMKC: [
    feed("KMKC", "tower", "Tower", "", "kmkc_twr"),
    feed("KMKC", "ground", "Ground", "", "kmkc_gnd"),
    feed("KMKC", "atis", "ATIS", "", "kmkc_atis"),
  ],

  // Kearney Regional Airport (Kearney, Nebraska, United States) — CSV verified
  KEAR: [
    feed("KEAR", "atis", "AWOS", "", "kear_awos"),
    feed("KEAR", "center", "Columbus Radio", "", "kear_olu"),
    feedN(
      "KEAR",
      "center",
      "CTAF",
      "",
      "kear_ctaf",
      "2",
    ),
    feed("KEAR", "combined", "ZDV/ZMP Kearney NE", "", "kear_center"),
  ],

  // Dillant-Hopkins Airport (Keene, New Hampshire, United States) — CSV verified
  KEEN: [
    feed("KEEN", "center", "CTAF", "", "kmht_murp_123000"),
  ],

  // Kenai Municipal Airport (Kenai, Alaska, United States) — CSV verified
  PAEN: [
    feed("PAEN", "tower", "Tower", "", "paen_twr"),
  ],

  // Kenosha Regional Airport (Kenosha, Wisconsin, United States) — CSV verified
  KENW: [
    feed("KENW", "combined", "Ground/Tower", "", "kenw"),
  ],

  // McGhee Tyson Airport (Knoxville, Tennessee, United States) — CSV verified
  KTYS: [
    feed("KTYS", "combined", "Del/Gnd/Twr/App", "", "ktys"),
  ],

  // Kodiak Airport (Kodiak, Alaska, United States) — CSV verified
  PADQ: [
    feed("PADQ", "combined", "Gnd/Twr/ZAN", "", "padq"),
  ],

  // La Crosse Municipal Airport (La Crosse, Wisconsin, United States) — CSV verified
  KLSE: [
    feed("KLSE", "tower", "Tower", "", "klse2_twr"),
    feed("KLSE", "ground", "Ground", "", "klse2_gnd"),
    feed("KLSE", "center", "Minneapolis Center (Sector 05 LSE Area)", "", "klse2_zmp_128600"),
  ],

  // Laconia Municipal Airport (Laconia, New Hampshire, United States) — CSV verified
  KLCI: [
    feed("KLCI", "ground", "CTAF/Del", "", "klci_del_ctaf"),
    feed("KLCI", "atis", "AWOS", "", "klci_awos"),
    feed("KLCI", "center", "CTAF", "", "klci"),
    feed("KLCI", "combined", "Del", "", "klci_del"),
  ],

  // Lakehurst Maxfield Field Joint Base McGuire (Lakehurst, New Jersey, United States) — CSV verified
  KNEL: [
    feed("KNEL", "combined", "KNEL/KWRI/ZNY", "", "kblm1"),
  ],

  // Lakeland Linder International Airport (Lakeland, Florida, United States) — CSV verified
  KLAL: [
    feed("KLAL", "tower", "Tower", "", "klal_twr"),
    feedN(
      "KLAL",
      "tower",
      "Tower (North)",
      "",
      "klal_twr_north",
      "north",
    ),
    feedN(
      "KLAL",
      "tower",
      "Tower (North/South)",
      "",
      "klal_twr_ns",
      "south",
    ),
    feedN(
      "KLAL",
      "tower",
      "Tower (South)",
      "",
      "klal_twr_south",
      "2",
    ),
    feed("KLAL", "ground", "Ground/Advisory", "", "klal_gnd"),
    feed("KLAL", "approach", "Lake Parker Arrival", "", "klal8_twr"),
    feedN(
      "KLAL",
      "approach",
      "Tampa App/Dep (KLAL Area) # 1",
      "",
      "klal_app_dep",
      "klal",
    ),
    feed("KLAL", "atis", "ATIS", "", "klal_atis"),
    feed("KLAL", "center", "* Sun &#039;n Fun Radio", "", "sunfunlive1"),
    feed("KLAL", "combined", "Sun &#039;n Fun Air Show", "", "klal_air"),
    feedN(
      "KLAL",
      "combined",
      "Sun &#039;n Fun Military Performers",
      "",
      "klal_mil",
      "039",
    ),
  ],

  // Capital Region International Airport (Lansing, Michigan, United States) — CSV verified
  KLAN: [
    feed("KLAN", "combined", "Del/Gnd/Twr/App", "", "klan"),
  ],

  // Henderson Executive Airport (Las Vegas, Nevada, United States) — CSV verified
  KHND: [
    feed("KHND", "atis", "ATIS", "", "khnd_atis"),
    feed("KHND", "combined", "Ground/Tower", "", "khnd"),
  ],

  // Harry Reid International Airport (Las Vegas, Nevada, United States) — CSV verified
  KLAS: [
    feed("KLAS", "tower", "Tower (Both)", "", "klas4_twr"),
    feedN(
      "KLAS",
      "tower",
      "Tower (Emergency/Discrete)",
      "",
      "klas4_twr_emerg",
      "emergency",
    ),
    feedN(
      "KLAS",
      "tower",
      "Tower (Rwys 01/19)",
      "",
      "klas4_twr_0119",
      "rwys",
    ),
    feedN(
      "KLAS",
      "tower",
      "Tower (Rwys 08/26)",
      "",
      "klas4_twr_0826",
      "08",
    ),
    feed("KLAS", "ground", "Clearance Delivery", "", "klas4_del"),
    feedN(
      "KLAS",
      "ground",
      "Ground (East)",
      "",
      "klas4_gnd_e",
      "east",
    ),
    feedN(
      "KLAS",
      "ground",
      "Ground (East/West)",
      "",
      "klas4_gnd",
      "west",
    ),
    feedN(
      "KLAS",
      "ground",
      "Ground (West)",
      "",
      "klas4_gnd_w",
      "2",
    ),
    feedN(
      "KLAS",
      "ground",
      "Ramp Control",
      "",
      "klas4_ramp",
      "3",
    ),
    feed("KLAS", "approach", "Approach (Final)", "", "klas5_app_final"),
    feedN(
      "KLAS",
      "approach",
      "Approach (NE)",
      "",
      "klas4_app_ne",
      "ne",
    ),
    feedN(
      "KLAS",
      "approach",
      "Approach (NW)",
      "",
      "klas4_app_nw",
      "nw",
    ),
    feedN(
      "KLAS",
      "approach",
      "Approach (SE)",
      "",
      "klas4_app_se",
      "se",
    ),
    feedN(
      "KLAS",
      "approach",
      "Approach (SW)",
      "",
      "klas4_app_sw",
      "sw",
    ),
    feedN(
      "KLAS",
      "approach",
      "Approach (VFR)",
      "",
      "klas4_app_vfr",
      "vfr",
    ),
    feed("KLAS", "departure", "Departure (Rwys 01/08)", "", "klas5_dep_0108"),
    feedN(
      "KLAS",
      "departure",
      "Departure (Rwys 19/26)",
      "",
      "klas4_dep_1926",
      "rwys",
    ),
    feed("KLAS", "atis", "ATIS", "", "klas5_atis"),
    feed("KLAS", "center", "Helicopter Control", "", "klas4_heli"),
    feedN(
      "KLAS",
      "center",
      "ZLA Sector 16 (Low/High)",
      "",
      "klas4_zla16",
      "low",
    ),
    feedN(
      "KLAS",
      "center",
      "ZLA Sector 34 (High)",
      "",
      "klas5_zla34",
      "high",
    ),
  ],

  // North Las Vegas Airport (Las Vegas, Nevada, United States) — CSV verified
  KVGT: [
    feed("KVGT", "tower", "Tower", "", "klas4_kvgt_twr"),
  ],

  // Lawrence Municipal Airport (Lawrence, Massachusetts, United States) — CSV verified
  KLWM: [
    feed("KLWM", "tower", "Tower", "", "klwm_twr"),
    feed("KLWM", "ground", "Clearance Delivery (Night)", "", "klwm_del"),
    feedN(
      "KLWM",
      "ground",
      "Ground",
      "",
      "klwm_gnd",
      "2",
    ),
    feed("KLWM", "atis", "ATIS", "", "klwm_atis"),
    feed("KLWM", "combined", "Ground/Tower", "", "klwm"),
  ],

  // Leesburg Executive Airport (Leesburg, Virginia, United States) — CSV verified
  KJYO: [
    feed("KJYO", "tower", "Tower", "", "kjyo3_twr"),
    feed("KJYO", "ground", "Ground", "", "kjyo3_gnd"),
    feed("KJYO", "atis", "AWOS", "", "kjyo3_awos"),
    feed("KJYO", "center", "ZDC Guard Dog", "", "kiad2_9"),
    feedN(
      "KJYO",
      "center",
      "ZDC Sectors 04",
      "",
      "kiad2_8",
      "se",
    ),
    feedN(
      "KJYO",
      "center",
      "ZDC Sectors 12",
      "",
      "kiad2_5",
      "2",
    ),
  ],

  // Leesburg International Airport (Leesburg, Florida, United States) — CSV verified
  KLEE: [
    feed("KLEE", "tower", "Tower", "", "klee1_twr"),
    feed("KLEE", "ground", "Ground", "", "klee1_gnd"),
    feed("KLEE", "approach", "App/Dep", "", "klee1_app"),
    feed("KLEE", "atis", "ASOS", "", "klee1_asos"),
  ],

  // Lincoln Airport (Lincoln, Nebraska, United States) — CSV verified
  KLNK: [
    feed("KLNK", "tower", "Tower", "", "klnk3_twr"),
    feed("KLNK", "ground", "Ground", "", "klnk3_gnd"),
    feed("KLNK", "approach", "Approach", "", "klnk3_app"),
    feed("KLNK", "atis", "ATIS", "", "klnk3_atis"),
    feed("KLNK", "combined", "Twr/App", "", "klnk3_twr_app"),
  ],

  // Lincolnton-Lincoln County Regional Airport (Lincolnton, North Carolina, United States) — CSV verified
  KIPJ: [
    feed("KIPJ", "ground", "CTAF/Del", "", "kipj"),
  ],

  // Mission Field Airport (Livingston, Montana, United States) — CSV verified
  KLVM: [
    feed("KLVM", "center", "CTAF", "", "kbzn1_123000"),
  ],

  // Long Beach Airport (Daugherty Field) (Long Beach, California, United States) — CSV verified
  KLGB: [
    feed("KLGB", "tower", "Tower", "", "klgb_twr"),
    feed("KLGB", "ground", "Clearance Delivery", "", "klgb_del"),
    feedN(
      "KLGB",
      "ground",
      "Ground",
      "",
      "klgb_gnd",
      "2",
    ),
  ],

  // Los Alamitos Army Airfield (Los Alamitos, California, United States) — CSV verified
  KSLI: [
    feed("KSLI", "tower", "Tower", "", "klgb1_ksli_twr"),
    feed("KSLI", "ground", "Ground", "", "klgb1_ksli_gnd"),
    feed("KSLI", "atis", "ATIS", "", "klgb1_ksli_atis"),
  ],

  // Louisa County Airport/Freeman Field (Louisa, Virginia, United States) — CSV verified
  KLKU: [
    feed("KLKU", "center", "CTAF #1", "", "klku2"),
    feedN(
      "KLKU",
      "center",
      "Emergency/Guard",
      "",
      "klku2_guard",
      "2",
    ),
    feed("KLKU", "combined", "Air to Air", "", "klku2_a2a"),
  ],

  // Triangle North Executive Airport (Louisburg, North Carolina, United States) — CSV verified
  KLHZ: [
    feed("KLHZ", "center", "CTAF", "", "klhz"),
  ],

  // Lynchburg Regional Airport/Preston Glenn Field (Lynchburg, Virginia, United States) — CSV verified
  KLYH: [
    feed("KLYH", "tower", "Tower", "", "klyh2_twr"),
    feed("KLYH", "ground", "Ground", "", "klyh2_gnd"),
    feed("KLYH", "approach", "Roanoke Approach", "", "klyh_roa_app"),
  ],

  // Manassas Regional Airport/Harry P. Davis Field (Manassas, Virginia, United States) — CSV verified
  KHEF: [
    feed("KHEF", "combined", "Del/Gnd/Twr", "", "khef"),
  ],

  // Manchester Airport (Manchester, New Hampshire, United States) — CSV verified
  KMHT: [
    feed("KMHT", "tower", "Tower #1", "", "kmht_murp_twr_both"),
    feed("KMHT", "ground", "Ground", "", "kmht_gnd"),
    feed("KMHT", "approach", "Boston App/Dep (MHT/Low) #1", "", "kash_app_124900"),
    feedN(
      "KMHT",
      "approach",
      "Boston App/Dep (MHT/Low) #2",
      "",
      "kmht_murp_fitzy",
      "mht",
    ),
    feedN(
      "KMHT",
      "approach",
      "Boston App/Dep (MHT/Low/High) #1",
      "",
      "kmht_app",
      "low",
    ),
    feedN(
      "KMHT",
      "approach",
      "Boston App/Dep (MHT/Low/High) #2",
      "",
      "kmht_app3",
      "high",
    ),
    feed("KMHT", "atis", "ATIS #1", "", "kmht_atis"),
    feedN(
      "KMHT",
      "atis",
      "ATIS #2",
      "",
      "kmht_atis2",
      "2",
    ),
    feed("KMHT", "combined", "Del/Gnd/Twr", "", "kmht"),
    feedN(
      "KMHT",
      "combined",
      "Del/Gnd/Twr/App",
      "",
      "kmht2",
      "2",
    ),
  ],

  // Marana Regional Airport (Marana, Arizona, United States) — CSV verified
  KAVQ: [
    feed("KAVQ", "center", "CTAF", "", "kavq2_ctaf"),
    feedN(
      "KAVQ",
      "center",
      "Emergency/Guard",
      "",
      "kavq2_guard",
      "2",
    ),
  ],

  // Marco Island Executive Airport (Marco Island, Florida, United States) — CSV verified
  KMKY: [
    feed("KMKY", "center", "CTAF", "", "kmky2"),
  ],

  // Eastern WV Regional Airport/Shepherd Field (Martinsburg, West Virginia, United States) — CSV verified
  KMRB: [
    feed("KMRB", "tower", "Tower/CTAF", "", "kmrb1_twr"),
    feed("KMRB", "ground", "Del/Gnd", "", "kmrb1_gnd"),
    feed("KMRB", "approach", "Potomac App/Dep (LUCKE)", "", "kmrb1_app_lucke"),
    feedN(
      "KMRB",
      "approach",
      "Potomac App/Dep (BUFFR)",
      "",
      "kmrb1_app_buffr",
      "buffr",
    ),
    feed("KMRB", "atis", "ATIS", "", "kmrb1_atis"),
    feed("KMRB", "center", "Emergency/Guard", "", "kmrb1_guard"),
    feedN(
      "KMRB",
      "center",
      "ZDC Washington Ctr (Bay Sector)",
      "",
      "kmrb1_zdc_bay",
      "bay",
    ),
    feedN(
      "KMRB",
      "center",
      "ZDC Washington Ctr (Bay/Brooke Sectors)",
      "",
      "kmrb1_zdc_bay_brooke",
      "brooke",
    ),
    feedN(
      "KMRB",
      "center",
      "ZDC Washington Ctr (Bay/Pinion Sectors)",
      "",
      "kmrb1_zdc_pin_bay",
      "pinion",
    ),
    feedN(
      "KMRB",
      "center",
      "ZDC Washington Ctr (Brooke Sector)",
      "",
      "kmrb1_zdc_brooke",
      "sector",
    ),
    feedN(
      "KMRB",
      "center",
      "ZDC Washington Ctr (Linden Sector)",
      "",
      "kmrb1_zdc_linden",
      "linden",
    ),
    feedN(
      "KMRB",
      "center",
      "ZDC Washington Ctr (Pinion Sector)",
      "",
      "kmrb1_zdc_pin",
      "se",
    ),
  ],

  // Melbourne International Airport (Melbourne, Florida, United States) — CSV verified
  KMLB: [
    feed("KMLB", "tower", "Tower", "", "kmlb1_twr"),
    feedN(
      "KMLB",
      "tower",
      "Tower (North)",
      "",
      "kmlb1_twr_n",
      "north",
    ),
    feedN(
      "KMLB",
      "tower",
      "Tower (South)",
      "",
      "kmlb1_twr_s",
      "south",
    ),
    feed("KMLB", "ground", "Ground", "", "kmlb1_gnd"),
    feed("KMLB", "approach", "Orlando App/Dep", "", "kmlb1_app"),
    feed("KMLB", "atis", "ATIS", "", "kmlb1_atis"),
    feed("KMLB", "center", "Emergency/Guard", "", "kmlb1_guard"),
    feedN(
      "KMLB",
      "center",
      "Miami Center (Sector 02)",
      "",
      "kmlb1_zma02",
      "sector",
    ),
    feedN(
      "KMLB",
      "center",
      "Miami Center (Sector 04)",
      "",
      "kmlb1_zma04",
      "04",
    ),
    feedN(
      "KMLB",
      "center",
      "Miami Center (Sector 18)",
      "",
      "kmlb1_zma18",
      "18",
    ),
    feedN(
      "KMLB",
      "center",
      "Miami Center (Sector 22)",
      "",
      "kmlb1_zma22",
      "22",
    ),
    feed("KMLB", "combined", "Gnd/Twr", "", "kmlb1_gnd_twr"),
    feedN(
      "KMLB",
      "combined",
      "Tower/Approach",
      "",
      "kmlb1_twr_app",
      "2",
    ),
  ],

  // Memphis International Airport (Memphis, Tennessee, United States) — CSV verified
  KMEM: [
    feed("KMEM", "combined", "Gnd/Twr/App/Dep", "", "kmem4_test"),
  ],

  // Falcon Field Airport (Mesa, Arizona, United States) — CSV verified
  KFFZ: [
    feed("KFFZ", "tower", "Twr (North)", "", "kffz_twr_n"),
    feedN(
      "KFFZ",
      "tower",
      "Twr (South)/CTAF",
      "",
      "kffz_twr_s",
      "south",
    ),
    feedN(
      "KFFZ",
      "tower",
      "Twr #1",
      "",
      "kffz_twr_b",
      "1",
    ),
    feed("KFFZ", "ground", "Ground", "", "kffz_gnd"),
    feed("KFFZ", "atis", "ATIS", "", "kffz_atis"),
  ],

  // Opa Locka Airport (Miami, Florida, United States) — CSV verified
  KOPF: [
    feed("KOPF", "tower", "Tower", "", "kopf5_twr"),
    feed("KOPF", "ground", "Ground", "", "kopf5_gnd"),
    feed("KOPF", "approach", "Miami App/Dep", "", "kopf5_app_128600"),
    feed("KOPF", "atis", "ATIS", "", "kopf5_atis"),
    feed("KOPF", "combined", "Ground/Tower", "", "kopf5_gnd_twr"),
  ],

  // Kendall-Tamiami Executive Airport (Miami, Florida, United States) — CSV verified
  KTMB: [
    feed("KTMB", "tower", "Tower (Main)", "", "ktmb1_twr1"),
    feedN(
      "KTMB",
      "tower",
      "Tower (North)",
      "",
      "ktmb1_twr2",
      "north",
    ),
    feed("KTMB", "ground", "Ground", "", "ktmb1_gnd"),
    feed("KTMB", "atis", "ATIS", "", "ktmb1_atis"),
  ],

  // Anoka County-Blaine Airport (Janes Field) (Minneapolis, Minnesota, United States) — CSV verified
  KANE: [
    feed("KANE", "tower", "Twr/CTAF", "", "kane"),
  ],

  // Flying Cloud Airport (Minneapolis, Minnesota, United States) — CSV verified
  KFCM: [
    feed("KFCM", "tower", "Tower", "", "kfcm2"),
    feed("KFCM", "approach", "KMSP Approach (FCM Satellite)", "", "kmsp4_app_134700"),
  ],

  // Crystal Airport (Minneapolis, Minnesota, United States) — CSV verified
  KMIC: [
    feed("KMIC", "tower", "Tower/CTAF", "", "kmic2_twr"),
    feed("KMIC", "ground", "Ground", "", "kmic2_gnd"),
    feed("KMIC", "atis", "ATIS", "", "kmic2_atis"),
    feed("KMIC", "center", "Emergency/Guard", "", "kmic2_guard"),
    feed("KMIC", "combined", "Ground/Tower", "", "kmic2_gnd_twr"),
  ],

  // Missoula International Airport (Missoula, Montana, United States) — CSV verified
  KMSO: [
    feed("KMSO", "combined", "Gnd/Twr/App/ZLC/ZSE", "", "kmso"),
  ],

  // Canyonlands Regional Airport (Moab, Utah, United States) — CSV verified
  KCNY: [
    feed("KCNY", "center", "CTAF/Misc", "", "kcny2"),
  ],

  // Mobile Downtown Airport (Mobile, Alabama, United States) — CSV verified
  KBFM: [
    feed("KBFM", "tower", "Tower", "", "kbfm2"),
  ],

  // Monroe Regional Airport (Monroe, North Carolina, United States) — CSV verified
  KEQY: [
    feed("KEQY", "center", "CTAF", "", "keqy3"),
  ],

  // Montgomery Regional Airport (Dannelly Field) (Montgomery, Alabama, United States) — CSV verified
  KMGM: [
    feed("KMGM", "tower", "Tower", "", "kmgm1_twr"),
    feed("KMGM", "ground", "Ground", "", "kmgm1_gnd"),
    feed("KMGM", "approach", "App/Dep", "", "kmgm1_app"),
    feed("KMGM", "atis", "ATIS", "", "kmgm1_atis"),
    feed("KMGM", "center", "Emergency/Guard", "", "kmgm1_guard"),
    feedN(
      "KMGM",
      "center",
      "ZTL Atlanta Center (Sector 08)",
      "",
      "kmgm1_ztl08",
      "sector",
    ),
    feedN(
      "KMGM",
      "center",
      "ZTL Atlanta Center (Sector 11)",
      "",
      "kmgm1_ztl11",
      "11",
    ),
    feedN(
      "KMGM",
      "center",
      "ZTL Atlanta Center (Sector 13)",
      "",
      "kmgm1_ztl13",
      "13",
    ),
    feed("KMGM", "combined", "Ground/Tower", "", "kmgm1_gnd_twr"),
    feedN(
      "KMGM",
      "combined",
      "Tower/Approach",
      "",
      "kmgm1_twr_app",
      "2",
    ),
  ],

  // Foothills Regional Airport (Morganton, North Carolina, United States) — CSV verified
  KMRN: [
    feed("KMRN", "center", "CTAF", "", "khky2_kmrn"),
  ],

  // Morgantown Municipal Airport (Morgantown, West Virginia, United States) — CSV verified
  KMGW: [
    feed("KMGW", "combined", "Ground/Tower", "", "kmgw2"),
  ],

  // Morristown Municipal Airport (Morristown, New Jersey, United States) — CSV verified
  KMMU: [
    feed("KMMU", "tower", "Tower #1", "", "kmmu3"),
    feedN(
      "KMMU",
      "tower",
      "Tower #2",
      "",
      "kmmu4_twr",
      "2",
    ),
    feed("KMMU", "ground", "Ground", "", "kmmu4_gnd"),
    feed("KMMU", "atis", "ATIS", "", "kmmu4_atis"),
  ],

  // Moore-Murrell Airport (Morristown, Tennessee, United States) — CSV verified
  KMOR: [
    feed("KMOR", "center", "CTAF/App", "", "kmor2"),
  ],

  // Selfridge Air National Guard Base (Mount Clemens, Michigan, United States) — CSV verified
  KMTC: [
    feed("KMTC", "approach", "App/Dep", "", "kmtc1_app"),
    feed("KMTC", "atis", "ATIS", "", "kmtc1_atis"),
    feed("KMTC", "combined", "Ground/Tower", "", "kmtc1_gnd_twr"),
  ],

  // South Jersey Regional Airport (Mount Holly, New Jersey, United States) — CSV verified
  KVAY: [
    feed("KVAY", "center", "SNJ Area CTAF 122.8", "", "kpne1_122800"),
  ],

  // Mount Pleasant Regional Airport-Faison Field (Mount Pleasant, South Carolina, United States) — CSV verified
  KLRO: [
    feed("KLRO", "center", "CTAF", "", "klro2"),
  ],

  // Myrtle Beach International Airport (Myrtle Beach, South Carolina, United States) — CSV verified
  KMYR: [
    feed("KMYR", "atis", "ATIS", "", "kmyr_atis"),
    feed("KMYR", "combined", "Gnd/Twr/App", "", "kmyr"),
    feedN(
      "KMYR",
      "combined",
      "Gnd/Twr/App (UHF)",
      "",
      "kmyr_mil",
      "uhf",
    ),
  ],

  // Nampa Municipal Airport (Nampa, Idaho, United States) — CSV verified
  KMAN: [
    feed("KMAN", "center", "CTAF", "", "kman2_ctaf"),
  ],

  // Nantucket Memorial Airport (Nantucket, Massachusetts, United States) — CSV verified
  KACK: [
    feed("KACK", "tower", "Tower", "", "kack"),
    feed("KACK", "approach", "App/Dep", "", "kack_app"),
    feed("KACK", "atis", "ATIS", "", "kack_atis"),
    feed("KACK", "combined", "Del/Gnd/Twr", "", "kack_del_gnd"),
  ],

  // Naples Municipal Airport (Naples, Florida, United States) — CSV verified
  KAPF: [
    feed("KAPF", "tower", "Tower", "", "kapf1_twr"),
    feed("KAPF", "ground", "Del/Gnd", "", "kapf1_del_gnd"),
    feed("KAPF", "approach", "Ft Myers App/Dep", "", "kapf1_app"),
    feed("KAPF", "atis", "ATIS", "", "kapf1_atis"),
    feed("KAPF", "combined", "Del/Gnd/Twr", "", "kapf1_del_gnd_twr"),
  ],

  // Boire Field Airport (Nashua, New Hampshire, United States) — CSV verified
  KASH: [
    feed("KASH", "tower", "Tower #1", "", "kash1_twr"),
    feedN(
      "KASH",
      "tower",
      "Tower #2",
      "",
      "kash4_twr",
      "2",
    ),
    feedN(
      "KASH",
      "tower",
      "Tower #3",
      "",
      "kmht_murp_kash_twr",
      "3",
    ),
    feed("KASH", "ground", "Ground", "", "kash1_gnd"),
    feedN(
      "KASH",
      "ground",
      "Ground/FBO #1",
      "",
      "kash1_gnd_fbo",
      "1",
    ),
    feedN(
      "KASH",
      "ground",
      "Ground/FBO #2",
      "",
      "kash4_gnd",
      "2",
    ),
    feed("KASH", "approach", "Boston App/Dep (MHT) #1", "", "kmht_app"),
    feed("KASH", "atis", "ATIS #1", "", "kash1_atis"),
    feedN(
      "KASH",
      "atis",
      "ATIS #2",
      "",
      "kash_atis",
      "2",
    ),
    feedN(
      "KASH",
      "atis",
      "ATIS #3",
      "",
      "kash_murp_atis2",
      "3",
    ),
    feed("KASH", "combined", "Gnd/Twr/FBO #1", "", "kash1_gnd_twr"),
    feedN(
      "KASH",
      "combined",
      "Gnd/Twr/FBO #2",
      "",
      "kash4_gnd_twr",
      "2",
    ),
  ],

  // Nashville International Airport (Nashville, Tennessee, United States) — CSV verified
  KBNA: [
    feed("KBNA", "tower", "Tower", "", "kbna_twr"),
    feed("KBNA", "ground", "Ground", "", "kbna_gnd"),
    feed("KBNA", "approach", "App/Dep", "", "kbna_app"),
    feedN(
      "KBNA",
      "approach",
      "App/Dep (East)",
      "",
      "kbna_app_east",
      "east",
    ),
    feedN(
      "KBNA",
      "approach",
      "App/Dep (West)",
      "",
      "kbna_app_west",
      "west",
    ),
    feedN(
      "KBNA",
      "approach",
      "Approach (Final)",
      "",
      "kbna_app_final",
      "final",
    ),
    feed("KBNA", "center", "Nashville Area Helicopter CTAF (BNA)", "", "kbna_heli"),
    feed("KBNA", "combined", "Ground/Tower", "", "kbna_gnd_twr"),
  ],

  // John C Tune Airport (Nashville, Tennessee, United States) — CSV verified
  KJWN: [
    feed("KJWN", "tower", "Tower", "", "kjwn1_twr"),
    feed("KJWN", "ground", "Ground", "", "kjwn1_gnd"),
    feed("KJWN", "atis", "ATIS", "", "kjwn1_atis"),
    feed("KJWN", "center", "Nashville Area Helicopter CTAF (JWN)", "", "kjwn1_heli"),
    feed("KJWN", "combined", "Gnd/Twr", "", "kjwn1_gnd_twr"),
  ],

  // Tweed-New Haven Airport (New Haven, Connecticut, United States) — CSV verified
  KHVN: [
    feed("KHVN", "tower", "Tower", "", "khvn1_twr"),
    feed("KHVN", "ground", "Ground", "", "khvn1_gnd"),
    feed("KHVN", "atis", "ATIS", "", "khvn1_atis"),
    feed("KHVN", "center", "Area Emergency/Guard", "", "khvn1_guard"),
    feed("KHVN", "combined", "Ground/Tower #1", "", "khvn1_gnd_twr"),
    feedN(
      "KHVN",
      "combined",
      "Ground/Tower #2",
      "",
      "khvn1_gnd_twr2",
      "2",
    ),
  ],

  // New Richmond Regional Airport (New Richmond, Wisconsin, United States) — CSV verified
  KRNH: [
    feed("KRNH", "center", "CTAF/Clearance", "", "krnh"),
  ],

  // West 30th St. Heliport (New York, New York, United States) — CSV verified
  KJRA: [
    feed("KJRA", "center", "KJRA/KJRB CTAF #3", "", "jfk118_kjra"),
    feedN(
      "KJRA",
      "center",
      "KJRA/KJRB CTAF #3",
      "",
      "jfk118_kjra",
      "3",
    ),
  ],

  // Newport State Airport (Newport, Rhode Island, United States) — CSV verified
  KUUU: [
    feed("KUUU", "ground", "CTAF/Del", "", "kuuu"),
  ],

  // Newport News/Williamsburg International Airport (Newport News, Virginia, United States) — CSV verified
  KPHF: [
    feed("KPHF", "combined", "Ground/Tower", "", "kphf"),
  ],

  // Norfolk Naval Station (Chambers Field) (Norfolk, Virginia, United States) — CSV verified
  KNGU: [
    feed("KNGU", "combined", "Del/Gnd/Twr", "", "kngu1"),
  ],

  // Norfolk International Airport (Norfolk, Virginia, United States) — CSV verified
  KORF: [
    feed("KORF", "tower", "Tower #1", "", "korf1_twr"),
    feedN(
      "KORF",
      "tower",
      "Tower #2",
      "",
      "korf3_twr",
      "2",
    ),
    feed("KORF", "ground", "Ground #1", "", "korf1_gnd"),
    feedN(
      "KORF",
      "ground",
      "Ground #2",
      "",
      "korf3_gnd",
      "2",
    ),
    feed("KORF", "approach", "Norfolk Approach (Arrival) #1", "", "korf1_app_118900"),
    feedN(
      "KORF",
      "approach",
      "Norfolk Approach (Arrival) #2",
      "",
      "korf3_app_118900",
      "arrival",
    ),
    feedN(
      "KORF",
      "approach",
      "Norfolk Approach (East Feeder)",
      "",
      "korf1_app_126050",
      "east",
    ),
    feedN(
      "KORF",
      "approach",
      "Norfolk Approach (West Feeder)",
      "",
      "korf1_app_119450",
      "west",
    ),
    feed("KORF", "departure", "Norfolk Departure #1", "", "korf1_app_125200"),
    feed("KORF", "atis", "ATIS", "", "korf1_atis"),
    feed("KORF", "combined", "Gnd/Twr", "", "korf1_gnd_twr"),
    feedN(
      "KORF",
      "combined",
      "Gnd/Twr/App/Radar",
      "",
      "korf1",
      "2",
    ),
  ],

  // Grand Strand Airport (North Myrtle Beach, South Carolina, United States) — CSV verified
  KCRE: [
    feed("KCRE", "atis", "ATIS", "", "kcre2_atis"),
    feed("KCRE", "center", "Guard", "", "kcre2_guard"),
    feed("KCRE", "combined", "Ground/Tower", "", "kcre2"),
  ],

  // Norwood Municipal Airport (Norwood, Massachusetts, United States) — CSV verified
  KOWD: [
    feed("KOWD", "combined", "Ground/Tower", "", "kowd2"),
  ],

  // Ocean City Municipal Airport (Ocean City, Maryland, United States) — CSV verified
  KOXB: [
    feed("KOXB", "center", "CTAF", "", "koxb_ctaf"),
  ],

  // Ogden-Hinckley Airport (Ogden, Utah, United States) — CSV verified
  KOGD: [
    feed("KOGD", "combined", "Ogden Ground/Tower", "", "kogd"),
  ],

  // Johnson County Executive Airport (Olathe, Kansas, United States) — CSV verified
  KOJC: [
    feed("KOJC", "approach", "App/Dep", "", "kojc1_app"),
    feed("KOJC", "atis", "ATIS", "", "kojc1_atis"),
    feed("KOJC", "combined", "Gnd/Twr", "", "kojc1"),
  ],

  // Offutt Air Force Base (Omaha, Nebraska, United States) — CSV verified
  KOFF: [
    feed("KOFF", "combined", "Tower/Approach", "", "koff3_twr_app"),
  ],

  // Orange Municipal Airport (Orange, Massachusetts, United States) — CSV verified
  KORE: [
    feed("KORE", "center", "MA/NH CTAF 122.8", "", "kmht_murp_122800"),
  ],

  // Kissimmee Gateway Airport (Orlando, Florida, United States) — CSV verified
  KISM: [
    feed("KISM", "tower", "Tower", "", "kjsm_twr"),
    feed("KISM", "ground", "Ground", "", "kjsm_gnd"),
    feed("KISM", "atis", "ATIS", "", "kjsm_atis"),
    feed("KISM", "combined", "Ground/Tower", "", "kjsm_gnd_twr"),
  ],

  // Orlando Executive Airport (Orlando, Florida, United States) — CSV verified
  KORL: [
    feed("KORL", "tower", "Tower", "", "korl_twr"),
    feed("KORL", "ground", "Del/Gnd", "", "korl_gnd"),
    feed("KORL", "approach", "KMCO App/Dep (Disney Sector)", "", "korl_app_119400"),
    feedN(
      "KORL",
      "approach",
      "KMCO App/Dep (Disney/OVIDO Sectors) #1",
      "",
      "korl_app_dep",
      "disney",
    ),
    feedN(
      "KORL",
      "approach",
      "KMCO App/Dep (Disney/OVIDO Sectors) #2",
      "",
      "korl_app_dis_ovi",
      "ovido",
    ),
    feedN(
      "KORL",
      "approach",
      "KMCO App/Dep (North Satellite)",
      "",
      "korl_kmco_app_135300",
      "north",
    ),
    feedN(
      "KORL",
      "approach",
      "KMCO App/Dep (OVIDO Sector)",
      "",
      "korl_app_119775",
      "sector",
    ),
    feed("KORL", "atis", "ATIS", "", "korl_atis"),
    feed("KORL", "combined", "Del/Gnd/Twr", "", "korl_del_gnd_twr"),
  ],

  // Orlando Sanford International Airport (Orlando, Florida, United States) — CSV verified
  KSFB: [
    feed("KSFB", "tower", "Tower (Both)", "", "ksfb3_s"),
    feedN(
      "KSFB",
      "tower",
      "Tower (Main)",
      "",
      "ksfb3_twr1",
      "main",
    ),
    feedN(
      "KSFB",
      "tower",
      "Tower (South)",
      "",
      "ksfb3_twr2",
      "south",
    ),
    feed("KSFB", "ground", "Clearance Delivery", "", "ksfb4_del"),
    feedN(
      "KSFB",
      "ground",
      "Del/Gnd",
      "",
      "ksfb4_s",
      "2",
    ),
    feedN(
      "KSFB",
      "ground",
      "Ground",
      "",
      "ksfb4_gnd",
      "3",
    ),
    feed("KSFB", "approach", "KMCO App/Dep (North Satellite)", "", "korl_kmco_app_135300"),
    feed("KSFB", "atis", "ATIS", "", "ksfb3_atis"),
  ],

  // Wittman Regional Airport (Oshkosh, Wisconsin, United States) — CSV verified
  KOSH: [
    feed("KOSH", "tower", "Air Show/Twr", "", "kosh_as_twr"),
    feedN(
      "KOSH",
      "tower",
      "North Tower (09/27) #1",
      "",
      "kosh",
      "09",
    ),
    feedN(
      "KOSH",
      "tower",
      "North Tower (09/27) #2",
      "",
      "kosh_s_twr1",
      "27",
    ),
    feedN(
      "KOSH",
      "tower",
      "South Tower (18/36) #1",
      "",
      "kosh2",
      "18",
    ),
    feedN(
      "KOSH",
      "tower",
      "South Tower (18/36) #2",
      "",
      "kosh_s_twr2",
      "36",
    ),
    feedN(
      "KOSH",
      "tower",
      "Tower (North+South) #1",
      "",
      "kosh_twr",
      "northsouth",
    ),
    feed("KOSH", "ground", "Del/Gnd/Misc", "", "kosh7"),
    feed("KOSH", "approach", "Fisk VFR Approach #1", "", "kosh8_fisk"),
    feedN(
      "KOSH",
      "approach",
      "Fisk VFR Approach #2",
      "",
      "kosh_s_fisk",
      "2",
    ),
    feedN(
      "KOSH",
      "approach",
      "Fisk VFR Approach #4",
      "",
      "kosh_n_fisk3",
      "4",
    ),
    feed("KOSH", "departure", "Departure ATIS", "", "kosh_dep_atis"),
    feedN(
      "KOSH",
      "departure",
      "Departure Monitor (09/27) #1",
      "",
      "kosh_depmon_0927",
      "09",
    ),
    feedN(
      "KOSH",
      "departure",
      "Departure Monitor (18/36) #1",
      "",
      "kosh_depmon_1836",
      "18",
    ),
    feedN(
      "KOSH",
      "departure",
      "Departure Monitor (All)",
      "",
      "kosh_depmon2",
      "all",
    ),
    feedN(
      "KOSH",
      "departure",
      "Departure Monitor #2",
      "",
      "kosh_depmon",
      "2",
    ),
    feed("KOSH", "atis", "ATIS", "", "kosh6"),
    feed("KOSH", "center", "Emergency/Guard", "", "kosh_guard"),
    feedN(
      "KOSH",
      "center",
      "Green Bay Radio",
      "",
      "kosh_gbr",
      "2",
    ),
    feedN(
      "KOSH",
      "center",
      "ZAU Chicago Center (Lone Rock, Low)",
      "",
      "zau_osh",
      "lone",
    ),
    feed("KOSH", "combined", "Air Show", "", "kosh4"),
    feedN(
      "KOSH",
      "combined",
      "Gnd/Twr/App #1",
      "",
      "kosh_perm",
      "1",
    ),
    feedN(
      "KOSH",
      "combined",
      "Milwaukee App (OSH) #1",
      "",
      "kosh8",
      "osh",
    ),
    feedN(
      "KOSH",
      "combined",
      "Oshkosh Seaplane Base (EAA)",
      "",
      "kosh_spb",
      "eaa",
    ),
  ],

  // Ottumwa Regional Airport (Ottumwa, Iowa, United States) — CSV verified
  KOTM: [
    feed("KOTM", "combined", "Del/Twr/App/Center", "", "kotm"),
  ],

  // Waterbury-Oxford Airport (Oxford, Connecticut, United States) — CSV verified
  KOXC: [
    feed("KOXC", "atis", "ATIS", "", "koxc2_atis"),
    feed("KOXC", "combined", "Ground/Tower", "", "koxc2"),
  ],

  // Tri-Cities Airport (Pasco, Washington, United States) — CSV verified
  KPSC: [
    feed("KPSC", "tower", "Tower", "", "kpsc2_twr"),
    feed("KPSC", "ground", "Ground", "", "kpsc2_gnd"),
  ],

  // North Central State Airport (Pawtucket, Rhode Island, United States) — CSV verified
  KSFZ: [
    feed("KSFZ", "center", "Clearance/CTAF", "", "ksfz2_del_ctaf"),
    feedN(
      "KSFZ",
      "center",
      "CTAF",
      "",
      "ksfz2",
      "2",
    ),
  ],

  // Penn Yan Airport (Penn Yan, New York, United States) — CSV verified
  KPEO: [
    feed("KPEO", "center", "CTAF", "", "kpeo2"),
  ],

  // Pensacola International Airport (Pensacola, Florida, United States) — CSV verified
  KPNS: [
    feed("KPNS", "tower", "Tower #3", "", "kpns2_twr3"),
    feed("KPNS", "approach", "App/Dep 127.35/278.8", "", "kpns2_app_127350"),
  ],

  // Phoenix Deer Valley Airport (Phoenix, Arizona, United States) — CSV verified
  KDVT: [
    feed("KDVT", "tower", "Tower (Both)", "", "kdvt3_twr"),
    feedN(
      "KDVT",
      "tower",
      "Tower (North)",
      "",
      "kdvt3_twr2",
      "north",
    ),
    feedN(
      "KDVT",
      "tower",
      "Tower (South)",
      "",
      "kdvt3_twr1",
      "south",
    ),
    feed("KDVT", "ground", "Clearance Delivery", "", "kdvt3_del"),
    feedN(
      "KDVT",
      "ground",
      "Delivery/Ground",
      "",
      "kdvt3_del_gnd",
      "2",
    ),
    feedN(
      "KDVT",
      "ground",
      "Ground",
      "",
      "kdvt3_gnd",
      "3",
    ),
    feed("KDVT", "atis", "ATIS", "", "kdvt3_atis"),
  ],

  // Phoenix-Mesa Gateway Airport (Phoenix, Arizona, United States) — CSV verified
  KIWA: [
    feed("KIWA", "tower", "Tower", "", "kiwa1_twr"),
    feed("KIWA", "ground", "Clearance Delivery", "", "kiwa1_del"),
    feedN(
      "KIWA",
      "ground",
      "Ground",
      "",
      "kiwa1_gnd",
      "2",
    ),
    feed("KIWA", "approach", "KPHX Approach (Pima/Willy Sectors)", "", "kphx4_app_pima_willy"),
    feed("KIWA", "atis", "ATIS", "", "kiwa1_atis"),
  ],

  // Moore County Airport (Pinehurst/Southern Pines, North Carolina, United States) — CSV verified
  KSOP: [
    feed("KSOP", "ground", "Clearance Delivery (RCO)", "", "ksop1_del"),
    feed("KSOP", "atis", "AWOS", "", "ksop1_awos"),
    feed("KSOP", "center", "CTAF", "", "ksop1_ctaf"),
  ],

  // Plant City Airport (Plant City, Florida, United States) — CSV verified
  KPCM: [
    feed("KPCM", "center", "KPCM/KGIF CTAF", "", "klal8_ctaf_123050"),
  ],

  // Platteville Municipal Airport (Platteville, Wisconsin, United States) — CSV verified
  KPVB: [
    feed("KPVB", "atis", "AWOS", "", "kpvb1_awos"),
    feed("KPVB", "center", "KPVB/KSFY CTAF", "", "kpvb1_122700"),
  ],

  // Pompano Beach Airpark (Pompano Beach, Florida, United States) — CSV verified
  KPMP: [
    feed("KPMP", "tower", "Tower", "", "kpmp"),
    feed("KPMP", "ground", "Ground", "", "kpmp_gnd"),
  ],

  // Mercedita Airport (Ponce, Puerto Rico, United States) — CSV verified
  TJPS: [
    feed("TJPS", "ground", "Clearance Delivery", "", "tjps1_del"),
    feed("TJPS", "atis", "AWOS", "", "tjps1_awos"),
    feed("TJPS", "center", "Clearance/San Juan Center", "", "tjps1_del_ctr"),
    feedN(
      "TJPS",
      "center",
      "CTAF",
      "",
      "tjps1_ctaf",
      "2",
    ),
  ],

  // Oakland County International Airport (Pontiac, Michigan, United States) — CSV verified
  KPTK: [
    feed("KPTK", "tower", "Tower #1", "", "kptk1_twr"),
    feed("KPTK", "approach", "App/Dep", "", "kptk1_app"),
    feedN(
      "KPTK",
      "approach",
      "Del/Gnd/App",
      "",
      "kptk1_del_gnd",
      "2",
    ),
    feed("KPTK", "atis", "ATIS", "", "kptk1_atis"),
    feed("KPTK", "combined", "Del/Gnd/Twr/App", "", "kptk1_gnd_twr"),
  ],

  // William R Fairchild International Airport (Port Angeles, Washington, United States) — CSV verified
  KCLM: [
    feed("KCLM", "approach", "Del/CTAF/App", "", "kclm"),
  ],

  // Portland International Jetport (Portland, Maine, United States) — CSV verified
  KPWM: [
    feed("KPWM", "tower", "Tower #1", "", "kpwm2_twr"),
    feedN(
      "KPWM",
      "tower",
      "Tower #2",
      "",
      "kpwm3_twr",
      "2",
    ),
    feed("KPWM", "ground", "Ground", "", "kpwm2_gnd"),
    feed("KPWM", "approach", "App/Dep #1", "", "kpwm2_app"),
    feedN(
      "KPWM",
      "approach",
      "App/Dep #2",
      "",
      "kpwm3_app",
      "2",
    ),
    feed("KPWM", "atis", "ATIS", "", "kpwm2_atis"),
    feed("KPWM", "center", "Emergency/Guard", "", "kpwm2_guard"),
    feed("KPWM", "combined", "Gnd/Tower", "", "kpwm2_gnd_twr"),
    feedN(
      "KPWM",
      "combined",
      "Gnd/Twr/App",
      "",
      "kpwm2_gnd_twr_app",
      "2",
    ),
    feedN(
      "KPWM",
      "combined",
      "Twr/App",
      "",
      "kpwm2_twr_app",
      "3",
    ),
  ],

  // Dutchess County Airport (Poughkeepsie, New York, United States) — CSV verified
  KPOU: [
    feed("KPOU", "combined", "Ground/Tower", "", "kpou1"),
  ],

  // Ernest A. Love Field Airport (Prescott, Arizona, United States) — CSV verified
  KPRC: [
    feed("KPRC", "tower", "Tower (1/2)", "", "kprc1_twr"),
    feedN(
      "KPRC",
      "tower",
      "Tower 1",
      "",
      "kprc1_twr1",
      "2",
    ),
    feedN(
      "KPRC",
      "tower",
      "Tower 2",
      "",
      "kprc1_twr2",
      "3",
    ),
    feed("KPRC", "ground", "Ground", "", "kprc1_gnd"),
    feed("KPRC", "approach", "Phoenix Approach (Jerome Sector/PRC/SEZ Area)", "", "kprc1_app_133575"),
    feedN(
      "KPRC",
      "approach",
      "Phoenix Approach (Jerome/Kachina Sectors)",
      "",
      "kprc1_app",
      "jerome",
    ),
    feedN(
      "KPRC",
      "approach",
      "Phoenix Approach (Kachina Sector/FLG Area)",
      "",
      "kprc1_app_126375",
      "kachina",
    ),
    feed("KPRC", "atis", "ATIS", "", "kprc1_atis"),
    feed("KPRC", "center", "Area Emergency/Guard", "", "kprc1_guard"),
    feedN(
      "KPRC",
      "center",
      "ZAB Sector 43",
      "",
      "kprc1_zab_128450",
      "se",
    ),
    feedN(
      "KPRC",
      "center",
      "ZAB Sector 45",
      "",
      "kprc1_zab_127675",
      "2",
    ),
    feedN(
      "KPRC",
      "center",
      "ZAB Sector 92",
      "",
      "kprc1_zab_135325",
      "3",
    ),
    feed("KPRC", "combined", "Ground/Tower", "", "kprc1_gnd_twr"),
    feedN(
      "KPRC",
      "combined",
      "Practice Area",
      "",
      "kprc1_pa",
      "2",
    ),
  ],

  // Northern Maine Regional Airport at Presque Isle (Presque Isle, Maine, United States) — CSV verified
  KPQI: [
    feed("KPQI", "combined", "KHUL/KPQI/ZBW01/15", "", "khul"),
  ],

  // Fillmore County Airport (Preston, Minnesota, United States) — CSV verified
  KFKA: [
    feed("KFKA", "center", "CTAF", "", "kfka"),
  ],

  // Provincetown Municipal Airport (Provincetown, Massachusetts, United States) — CSV verified
  KPVC: [
    feed("KPVC", "center", "5B6/KCQX/KPVC CTAF", "", "khya2_122800"),
  ],

  // Provo Municipal Airport (Provo, Utah, United States) — CSV verified
  KPVU: [
    feed("KPVU", "tower", "Tower", "", "kpvu2"),
  ],

  // Charlotte County Airport (Punta Gorda, Florida, United States) — CSV verified
  KPGD: [
    feed("KPGD", "tower", "Tower", "", "kpgd_twr"),
    feed("KPGD", "ground", "Ground", "", "kpgd_gnd"),
  ],

  // Pierce County Airport - Thun Field (Puyallup, Washington, United States) — CSV verified
  KPLU: [
    feed("KPLU", "approach", "Del/CTAF/App", "", "kplu2"),
  ],

  // Raleigh-Durham International Airport (Raleigh/Durham, North Carolina, United States) — CSV verified
  KRDU: [
    feed("KRDU", "tower", "Tower", "", "krdu_twr"),
    feed("KRDU", "ground", "Ground", "", "krdu_gnd"),
    feed("KRDU", "approach", "Approach", "", "krdu_app"),
    feedN(
      "KRDU",
      "approach",
      "Approach/Departure",
      "",
      "krdu_app2",
      "2",
    ),
    feed("KRDU", "departure", "Departure", "", "krdu_dep"),
    feed("KRDU", "center", "ZDC Sector 38 (Tar River Hi)", "", "zdc38_dk"),
    feed("KRDU", "combined", "Ground/Tower", "", "krdu_gnd_twr"),
  ],

  // Reno/Tahoe International Airport (Reno, Nevada, United States) — CSV verified
  KRNO: [
    feed("KRNO", "tower", "Tower", "", "krno1_twr"),
    feed("KRNO", "ground", "Clearance Delivery", "", "krno1_del"),
    feedN(
      "KRNO",
      "ground",
      "Ground",
      "",
      "krno1_gnd",
      "2",
    ),
    feed("KRNO", "approach", "NORCAL App/Dep", "", "krno1_app"),
    feedN(
      "KRNO",
      "approach",
      "NORCAL App/Dep (North)",
      "",
      "krno1_app_north",
      "north",
    ),
    feedN(
      "KRNO",
      "approach",
      "NORCAL App/Dep (South)",
      "",
      "krno1_app_south",
      "south",
    ),
    feed("KRNO", "center", "Emergency/Guard", "", "krno1_guard"),
    feed("KRNO", "combined", "Del/Gnd/Twr", "", "krno1_gnd_twr"),
    feedN(
      "KRNO",
      "combined",
      "Del/Gnd/Twr/App/ZOA",
      "",
      "krno",
      "2",
    ),
  ],

  // Renton Municipal Airport (Renton, Washington, United States) — CSV verified
  KRNT: [
    feed("KRNT", "tower", "Tower", "", "ksea3_krnt_twr"),
    feed("KRNT", "ground", "Ground", "", "ksea3_krnt_gnd"),
    feed("KRNT", "combined", "Gnd/Twr/Unicom", "", "krnt"),
  ],

  // Richmond International Airport (Richmond, Virginia, United States) — CSV verified
  KRIC: [
    feed("KRIC", "tower", "Tower", "", "kric2_twr"),
    feed("KRIC", "ground", "Ground", "", "kric2_gnd"),
    feed("KRIC", "center", "Area Guard", "", "kric2_guard"),
  ],

  // Hanover County Municipal Airport (Richmond/Ashland, Virginia, United States) — CSV verified
  KOFP: [
    feed("KOFP", "center", "CTAF", "", "kofp2_ctaf"),
  ],

  // Roanoke Regional Airport/Woodrum Field (Roanoke, Virginia, United States) — CSV verified
  KROA: [
    feed("KROA", "tower", "Tower", "", "kroa_twr"),
    feed("KROA", "ground", "Clearance Delivery", "", "kroa_del"),
    feedN(
      "KROA",
      "ground",
      "Del/Gnd",
      "",
      "kroa_del_gnd",
      "2",
    ),
    feedN(
      "KROA",
      "ground",
      "Ground",
      "",
      "kroa_gnd",
      "3",
    ),
    feed("KROA", "approach", "KLYH Roanoke Approach", "", "klyh_roa_app"),
    feedN(
      "KROA",
      "approach",
      "App/Dep (133.225)",
      "133.225",
      "kroa_app_133225",
      "2",
    ),
    feedN(
      "KROA",
      "approach",
      "App/Dep #1",
      "",
      "kroa2_app",
      "1",
    ),
    feedN(
      "KROA",
      "approach",
      "App/Dep #2",
      "",
      "kroa_app",
      "3",
    ),
    feedN(
      "KROA",
      "approach",
      "App/Dep #3",
      "",
      "kroa4_app",
      "4",
    ),
    feed("KROA", "atis", "ATIS", "", "kroa_atis"),
    feed("KROA", "combined", "Gnd/Twr #1", "", "kroa2_twr"),
    feedN(
      "KROA",
      "combined",
      "Gnd/Twr #2",
      "",
      "kroa4_gnd_twr",
      "2",
    ),
    feedN(
      "KROA",
      "combined",
      "Gnd/Twr/App #1",
      "",
      "kroa2",
      "1",
    ),
    feedN(
      "KROA",
      "combined",
      "Gnd/Twr/App #2",
      "",
      "kroa4_gnd_twr_app",
      "3",
    ),
  ],

  // Skyhaven Airport (Rochester, New Hampshire, United States) — CSV verified
  KDAW: [
    feed("KDAW", "center", "KCON/KDAW/KFIT CTAF", "", "kmht_murp_122700"),
  ],

  // Greater Rochester International Airport (Rochester, New York, United States) — CSV verified
  KROC: [
    feed("KROC", "approach", "Approach", "", "kroc"),
    feed("KROC", "combined", "Del/Gnd/Twr", "", "kroc_s"),
  ],

  // Rogers Executive Airport - Carter Field (Rogers, Arkansas, United States) — CSV verified
  KROG: [
    feed("KROG", "combined", "KROG/KXNA/KVBT/Misc", "", "krog"),
  ],

  // Salina Regional Airport (Salina, Kansas, United States) — CSV verified
  KSLN: [
    feed("KSLN", "tower", "Tower", "", "ksln_twr"),
    feed("KSLN", "ground", "Ground", "", "ksln_gnd"),
    feed("KSLN", "atis", "ATIS", "", "ksln_atis"),
    feed("KSLN", "center", "ZKC KC Center (Salina Low/High)", "", "zkc_sln"),
    feed("KSLN", "combined", "Ground/Tower", "", "ksln"),
  ],

  // Salt Lake City International Airport (Salt Lake City, Utah, United States) — CSV verified
  KSLC: [
    feed("KSLC", "tower", "Tower", "", "kslc1_twr"),
    feed("KSLC", "ground", "Del/Ground", "", "kslc1_del_gnd"),
    feed("KSLC", "approach", "Approach/Departure", "", "kslc1_app1"),
    feed("KSLC", "center", "ZLC Sectors 03/04/07/11/32", "", "kslc1_zlc"),
  ],

  // Fernando Luis Ribas Dominicci Airport (San Juan, Puerto Rico, United States) — CSV verified
  TJIG: [
    feed("TJIG", "tower", "Tower", "", "tjig2_twr"),
    feed("TJIG", "ground", "Ground", "", "tjig2_gnd"),
    feed("TJIG", "atis", "ATIS", "", "tjig2_atis"),
    feed("TJIG", "combined", "Ground/Tower", "", "tjig2_gnd_twr"),
  ],

  // Luis Munoz Marin International Airport (San Juan, Puerto Rico, United States) — CSV verified
  TJSJ: [
    feed("TJSJ", "center", "Center/Oceanic", "", "tjsj4_app_ctr"),
  ],

  // Sandpoint Airport (Sandpoint, Idaho, United States) — CSV verified
  KSZT: [
    feed("KSZT", "center", "CTAF #1", "", "kszt_ctaf"),
    feedN(
      "KSZT",
      "center",
      "CTAF #2",
      "",
      "kszt2",
      "2",
    ),
  ],

  // Sanford Seacoast Regional Airport (Sanford, Maine, United States) — CSV verified
  KSFM: [
    feed("KSFM", "center", "CTAF", "", "kmht_murp_123075"),
  ],

  // Raleigh Executive Jetport at Sanford-Lee County Airport (Sanford, North Carolina, United States) — CSV verified
  KTTA: [
    feed("KTTA", "atis", "AWOS", "", "ktta_awos"),
    feed("KTTA", "center", "CTAF", "", "ktta"),
  ],

  // John Wayne-Orange County Airport (Santa Ana, California, United States) — CSV verified
  KSNA: [
    feed("KSNA", "tower", "Tower (Backup/Discrete)", "", "ksna1_twr_128350"),
    feedN(
      "KSNA",
      "tower",
      "Tower (Rwy 02L/20R)",
      "",
      "ksna1_twr_126800",
      "rwy",
    ),
    feedN(
      "KSNA",
      "tower",
      "Tower (Rwy 02R/20L)",
      "",
      "ksna1_twr_119900",
      "02r",
    ),
    feed("KSNA", "ground", "Clearance Delivery", "", "ksna1_del"),
    feedN(
      "KSNA",
      "ground",
      "Clearance Delivery (Backup)",
      "",
      "ksna1_del2",
      "backup",
    ),
    feedN(
      "KSNA",
      "ground",
      "Ground (Backup/West)",
      "",
      "ksna1_gnd_132250",
      "west",
    ),
    feedN(
      "KSNA",
      "ground",
      "Ground (Primary/East)",
      "",
      "ksna1_gnd_120800",
      "primary",
    ),
    feed("KSNA", "approach", "SOCAL Approach (Beach Sector)", "", "ksna1_app_125350"),
    feedN(
      "KSNA",
      "approach",
      "SOCAL Approach (Harbor Sector)",
      "",
      "ksna1_app_127200",
      "harbor",
    ),
    feedN(
      "KSNA",
      "approach",
      "SOCAL Approach (Shore Sector)",
      "",
      "ksna1_app_124100",
      "shore",
    ),
    feedN(
      "KSNA",
      "approach",
      "SOCAL Approach (Tustin Sector)",
      "",
      "ksna1_app_121300",
      "tustin",
    ),
    feed("KSNA", "departure", "SOCAL Departure (Pacific Sector)", "", "ksna1_dep_128100"),
    feed("KSNA", "atis", "ATIS", "", "ksna1_atis"),
    feed("KSNA", "center", "ZLA LA Center (Sector 18 Low)", "", "ksna1_zla_125275"),
    feedN(
      "KSNA",
      "center",
      "ZLA LA Center (Sector 21 Low)",
      "",
      "ksna1_zla_132850",
      "sector",
    ),
    feedN(
      "KSNA",
      "center",
      "ZLA LA Center (Sector 30 Oceanic) #5",
      "",
      "ksna1_zla_119950",
      "30",
    ),
  ],

  // Santa Fe Municipal Airport (Santa Fe, New Mexico, United States) — CSV verified
  KSAF: [
    feed("KSAF", "tower", "Tower", "", "ksaf"),
  ],

  // Sarasota/Bradenton International Airport (Sarasota/Bradenton, Florida, United States) — CSV verified
  KSRQ: [
    feed("KSRQ", "tower", "Tower", "", "ksrq1_twr"),
    feed("KSRQ", "ground", "Del/Gnd", "", "ksrq1_del_gnd"),
    feed("KSRQ", "approach", "App/Dep", "", "ksrq1_app_dep"),
    feed("KSRQ", "center", "ZMA Miami Center (07)", "", "ksrq2_zma_132350"),
    feedN(
      "KSRQ",
      "center",
      "ZMA Miami Center (07/08/25)",
      "",
      "ksrq1_zma",
      "07",
    ),
    feedN(
      "KSRQ",
      "center",
      "ZMA Miami Center (08)",
      "",
      "ksrq2_zma_133900",
      "08",
    ),
    feedN(
      "KSRQ",
      "center",
      "ZMA Miami Center (25)",
      "",
      "ksrq2_zma_128225",
      "25",
    ),
  ],

  // Schenectady County Airport (Schenectady, New York, United States) — CSV verified
  KSCH: [
    feed("KSCH", "tower", "Tower", "", "kalb2_ksch_twr"),
    feed("KSCH", "ground", "Ground", "", "kalb2_ksch_gnd"),
  ],

  // Scottsdale Airport (Scottsdale, Arizona, United States) — CSV verified
  KSDL: [
    feed("KSDL", "tower", "Tower #2", "", "ksdl2_twr"),
    feed("KSDL", "ground", "Ground", "", "ksdl2_gnd"),
    feed("KSDL", "approach", "KPHX Approach (Biltmore Sector)", "", "kphx4_app_sdl"),
    feed("KSDL", "atis", "ATIS", "", "ksdl2_atis"),
    feed("KSDL", "center", "Emergency/Guard", "", "ksdl2_guard"),
  ],

  // Sheboygan County Memorial Airport (Sheboygan, Wisconsin, United States) — CSV verified
  KSBM: [
    feed("KSBM", "approach", "Milwaukee Approach (SBM)", "", "ksbm1_app"),
    feed("KSBM", "center", "Area Guard (Emergency)", "", "ksbm1_guard"),
    feedN(
      "KSBM",
      "center",
      "CTAF",
      "",
      "ksbm1_ctaf",
      "2",
    ),
  ],

  // Sioux Gateway Airport/Col. Bud Day Field (Sioux City, Iowa, United States) — CSV verified
  KSUX: [
    feed("KSUX", "combined", "Twr/App/ZMP", "", "ksux2"),
  ],

  // Joe Foss Field Airport (Sioux Falls, South Dakota, United States) — CSV verified
  KFSD: [
    feed("KFSD", "combined", "Twr/App/Dep/ZMP", "", "kfsd1"),
  ],

  // Johnston Regional Airport (Smithfield, North Carolina, United States) — CSV verified
  KJNX: [
    feed("KJNX", "atis", "AWOS", "", "kjnx2"),
    feed("KJNX", "center", "CTAF", "", "kjnx"),
  ],

  // Smyrna Airport (Smyrna, Tennessee, United States) — CSV verified
  KMQY: [
    feed("KMQY", "tower", "Tower", "", "kmqy1_twr"),
    feed("KMQY", "ground", "Clearance Delivery", "", "kmqy1_del"),
    feedN(
      "KMQY",
      "ground",
      "Ground",
      "",
      "kmqy1_gnd",
      "2",
    ),
    feed("KMQY", "center", "Emergency/Guard", "", "kmqy1_guard"),
    feed("KMQY", "combined", "Ground/Tower", "", "kmqy1_gnd_twr"),
  ],

  // Solon Springs Municipal Airport (Solon Springs, Wisconsin, United States) — CSV verified
  KOLG: [
    feed("KOLG", "center", "CTAF", "", "3cu_kolg_ctaf"),
  ],

  // Spanish Fork Municipal Airport/Woodhouse Field (Spanish Fork, Utah, United States) — CSV verified
  KSPK: [
    feed("KSPK", "center", "CTAF", "", "kspk2"),
  ],

  // Upper Cumberland Regional Airport (Sparta, Tennessee, United States) — CSV verified
  KSRB: [
    feed("KSRB", "center", "CTAF", "", "ksrb2"),
  ],

  // Spokane International Airport (Spokane, Washington, United States) — CSV verified
  KGEG: [
    feed("KGEG", "combined", "Del/Gnd/Twr/App", "", "kgeg"),
  ],

  // Felts Field Airport (Spokane, Washington, United States) — CSV verified
  KSFF: [
    feed("KSFF", "tower", "Tower", "", "ksff2_twr"),
    feed("KSFF", "ground", "Ground", "", "ksff2_gnd"),
    feed("KSFF", "approach", "Spokane Approach/Departure", "", "ksff2_app"),
    feed("KSFF", "atis", "ATIS", "", "ksff2_atis"),
  ],

  // Fairchild Air Force Base (Spokane, Washington, United States) — CSV verified
  KSKA: [
    feed("KSKA", "tower", "Tower", "", "kska2"),
  ],

  // Springdale Municipal Airport (Springdale, Arkansas, United States) — CSV verified
  KASG: [
    feed("KASG", "approach", "App/Dep", "", "kasg1_app"),
    feed("KASG", "combined", "Gnd/Twr", "", "kasg1_twr"),
    feedN(
      "KASG",
      "combined",
      "Gnd/Twr/App",
      "",
      "kasg1",
      "2",
    ),
  ],

  // Westover Air Reserve Base/Metropolitan Airport (Springfield/Chicopee, Massachusetts, United States) — CSV verified
  KCEF: [
    feed("KCEF", "tower", "KBAF/KCEF Tower", "", "kbaf1_twr"),
  ],

  // Rosecrans Memorial Airport (St Joseph, Missouri, United States) — CSV verified
  KSTJ: [
    feed("KSTJ", "tower", "Tower", "", "kstj2_twr"),
    feed("KSTJ", "ground", "Ground", "", "kstj2_gnd"),
    feed("KSTJ", "approach", "App/Dep", "", "kstj2_app"),
    feed("KSTJ", "atis", "ATIS", "", "kstj2_atis"),
  ],

  // St Petersburg-Clearwater International Airport (St Petersburg-Clearwater, Florida, United States) — CSV verified
  KPIE: [
    feed("KPIE", "tower", "Tower", "", "kpie1_twr"),
    feed("KPIE", "ground", "Ground", "", "kpie1_gnd"),
    feed("KPIE", "approach", "Tampa Approach (West/High)", "", "kpie1_app_118800"),
    feed("KPIE", "center", "Area Emergency/Guard", "", "kpie1_guard"),
    feed("KPIE", "combined", "Del/Gnd/Twr", "", "kpie1_del_gnd_twr"),
  ],

  // Albert Whitted Airport (St. Petersburg, Florida, United States) — CSV verified
  KSPG: [
    feed("KSPG", "tower", "Tower", "", "kspg3_twr"),
    feed("KSPG", "ground", "Ground", "", "kspg3_gnd"),
    feed("KSPG", "combined", "Ground/Tower", "", "kspg3_gnd_twr"),
  ],

  // Witham Field Airport (Stuart, Florida, United States) — CSV verified
  KSUA: [
    feed("KSUA", "combined", "Ground/Tower", "", "ksua1"),
  ],

  // Summerville Airport (Summerville, South Carolina, United States) — CSV verified
  KDYB: [
    feed("KDYB", "center", "CTAF", "", "kdyb2"),
  ],

  // Syracuse Hancock International Airport (Syracuse, New York, United States) — CSV verified
  KSYR: [
    feed("KSYR", "tower", "Tower", "", "ksyr_twr"),
    feed("KSYR", "ground", "Clearance Delivery", "", "ksyr_del"),
    feedN(
      "KSYR",
      "ground",
      "Ground",
      "",
      "ksyr_gnd",
      "2",
    ),
    feed("KSYR", "approach", "App/Dep", "", "ksyr_app"),
    feed("KSYR", "atis", "ATIS", "", "ksyr_atis"),
    feed("KSYR", "combined", "Ground/Tower", "", "ksyr_gnd_twr"),
    feedN(
      "KSYR",
      "combined",
      "Tower/Approach",
      "",
      "ksyr",
      "2",
    ),
  ],

  // Tacoma Narrows Airport (Tacoma, Washington, United States) — CSV verified
  KTIW: [
    feed("KTIW", "tower", "Tower", "", "ktiw3"),
  ],

  // Tallahassee Regional Airport (Tallahassee, Florida, United States) — CSV verified
  KTLH: [
    feed("KTLH", "combined", "Del/Gnd/Twr/App", "", "ktlh"),
  ],

  // MacDill Air Force Base (Tampa, Florida, United States) — CSV verified
  KMCF: [
    feed("KMCF", "tower", "Tower", "", "ktpa5_kmcf_twr"),
  ],

  // Tampa International Airport (Tampa, Florida, United States) — CSV verified
  KTPA: [
    feed("KTPA", "tower", "Tower #1", "", "ktpa2"),
    feedN(
      "KTPA",
      "tower",
      "Tower #2",
      "",
      "ktpa5_twr",
      "2",
    ),
    feed("KTPA", "approach", "Tampa Approach (West/High)", "", "kpie1_app_118800"),
  ],

  // Peter O Knight Airport (Tampa, Florida, United States) — CSV verified
  KTPF: [
    feed("KTPF", "center", "CTAF", "", "ktpa5_ktpf_ctaf"),
  ],

  // Tampa Executive Airport (Tampa, Florida, United States) — CSV verified
  KVDF: [
    feed("KVDF", "center", "CTAF", "", "ktpa5_kvdf_ctaf"),
  ],

  // Teterboro Airport (Teterboro, New Jersey, United States) — CSV verified
  KTEB: [
    feed("KTEB", "tower", "Tower (Secondary)", "", "kteb_es_twr2"),
    feedN(
      "KTEB",
      "tower",
      "Tower #1",
      "",
      "kteb_es_twr_r",
      "1",
    ),
    feedN(
      "KTEB",
      "tower",
      "Tower #2",
      "",
      "kteb_es_twr",
      "2",
    ),
    feed("KTEB", "ground", "Clearance Delivery #1", "", "kteb_es_del"),
    feedN(
      "KTEB",
      "ground",
      "Clearance Delivery #2",
      "",
      "kteb_es_del_r",
      "2",
    ),
    feedN(
      "KTEB",
      "ground",
      "Del/Gnd/Ramp",
      "",
      "kteb1",
      "3",
    ),
    feedN(
      "KTEB",
      "ground",
      "Ground #1",
      "",
      "kteb_es_gnd_r",
      "1",
    ),
    feedN(
      "KTEB",
      "ground",
      "Ground #2",
      "",
      "kteb_es_gnd",
      "4",
    ),
    feedN(
      "KTEB",
      "ground",
      "Ramp Control",
      "",
      "kteb_es_ramp",
      "5",
    ),
    feed("KTEB", "atis", "ATIS", "", "kteb_es_atis"),
    feed("KTEB", "combined", "FBOs", "", "kteb_es_fbos"),
    feedN(
      "KTEB",
      "combined",
      "Ops",
      "",
      "kteb_es_ops",
      "2",
    ),
  ],

  // Ocean County Airport (Toms River, New Jersey, United States) — CSV verified
  KMJX: [
    feed("KMJX", "combined", "KBLM/N12/3N6/KMJX", "", "kblm2"),
  ],

  // Topeka Regional Airport (Topeka, Kansas, United States) — CSV verified
  KFOE: [
    feed("KFOE", "combined", "Gnd/Twr/CTAF", "", "ktop3"),
  ],

  // Philip Billard Municipal Airport (Topeka, Kansas, United States) — CSV verified
  KTOP: [
    feed("KTOP", "combined", "Ground/Tower", "", "ktop2_twrgnd"),
  ],

  // Cherry Capital Airport (Traverse City, Michigan, United States) — CSV verified
  KTVC: [
    feed("KTVC", "combined", "Ground/Tower/Center", "", "ktvc2_all"),
  ],

  // Trenton Mercer Airport (Trenton, New Jersey, United States) — CSV verified
  KTTN: [
    feed("KTTN", "tower", "Tower", "", "kttn_twr"),
    feed("KTTN", "ground", "Ground", "", "kttn_gnd"),
    feed("KTTN", "atis", "ATIS", "", "kttn_atis"),
    feed("KTTN", "center", "Area Guard", "", "kttn_guard"),
    feed("KTTN", "combined", "Ground/Tower #1", "", "kttn"),
    feedN(
      "KTTN",
      "combined",
      "Ground/Tower #2",
      "",
      "kttn_gnd_twr",
      "2",
    ),
  ],

  // Oakland/Troy Airport (Troy, Michigan, United States) — CSV verified
  KVLL: [
    feed("KVLL", "center", "KMTC Area CTAF", "", "kmtc1_area_ctaf"),
  ],

  // Truckee-Tahoe Airport (Truckee, California, United States) — CSV verified
  KTRK: [
    feed("KTRK", "tower", "Tower/CTAF #1", "", "ktrk_twr1"),
    feedN(
      "KTRK",
      "tower",
      "Tower/CTAF #2",
      "",
      "ktrk_twr",
      "2",
    ),
    feed("KTRK", "ground", "Ground", "", "ktrk_gnd"),
    feed("KTRK", "atis", "ATIS/AWOS", "", "ktrk_atis"),
    feed("KTRK", "center", "Emergency/Guard", "", "ktrk_guard"),
    feedN(
      "KTRK",
      "center",
      "UNICOM",
      "",
      "ktrk",
      "2",
    ),
    feedN(
      "KTRK",
      "center",
      "ZOA Oakland Center (44)",
      "",
      "ktrk_zoa44",
      "44",
    ),
    feed("KTRK", "combined", "Gnd/Twr/CTAF", "", "ktrk_gnd_twr"),
  ],

  // Tucson International Airport (Tucson, Arizona, United States) — CSV verified
  KTUS: [
    feed("KTUS", "center", "ZAB Sector 46 (Tucson Low)", "", "zab46"),
    feedN(
      "KTUS",
      "center",
      "ZAB Sector 91 (Gila Bend High)",
      "",
      "kphx4_zab91",
      "gila",
    ),
    feed("KTUS", "combined", "Del/Gnd/Twr/App/KDMA", "", "ktus2"),
  ],

  // Tyler Pounds Regional Airport (Tyler, Texas, United States) — CSV verified
  KTYR: [
    feed("KTYR", "tower", "Tower", "", "ktyr2_twr"),
    feed("KTYR", "ground", "Ground", "", "ktyr2_gnd"),
    feed("KTYR", "approach", "App/Dep", "", "ktyr2_app"),
    feed("KTYR", "atis", "ATIS", "", "ktyr2_atis"),
    feed("KTYR", "center", "UNICOM", "", "ktyr2_unicom"),
    feedN(
      "KTYR",
      "center",
      "ZFW Sector 25",
      "",
      "ktyr2_ctr",
      "se",
    ),
    feed("KTYR", "combined", "Ground/Tower", "", "ktyr2_gnd_twr"),
  ],

  // Pearson Field Airport (Vancouver, Washington, United States) — CSV verified
  KVUO: [
    feed("KVUO", "center", "CTAF/Guard", "", "kpdx_pearson"),
  ],

  // Venice Municipal Airport (Venice, Florida, United States) — CSV verified
  KVNC: [
    feed("KVNC", "center", "CTAF", "", "kvnc1"),
    feedN(
      "KVNC",
      "center",
      "Emergency/Guard",
      "",
      "kvnc1_guard",
      "2",
    ),
  ],

  // Vero Beach Municipal Airport (Vero Beach, Florida, United States) — CSV verified
  KVRB: [
    feed("KVRB", "tower", "Tower", "", "kvrb_twr"),
    feed("KVRB", "ground", "Ground", "", "kvrb_gnd"),
    feed("KVRB", "approach", "App/Dep", "", "kvrb_app"),
    feed("KVRB", "atis", "ATIS", "", "kvrb_atis"),
    feed("KVRB", "center", "ZMA Sector 04", "", "kvrb_zma04"),
    feedN(
      "KVRB",
      "center",
      "ZMA Sector 23",
      "",
      "kvrb_zma23",
      "se",
    ),
  ],

  // Martha\'s Vineyard Airport (Vineyard Haven, Massachusetts, United States) — CSV verified
  KMVY: [
    feed("KMVY", "combined", "Twr/App", "", "kmvy_twrapp"),
  ],

  // Oceana Naval Air Station (Apollo Soucek Field) (Virginia Beach, Virginia, United States) — CSV verified
  KNTU: [
    feed("KNTU", "combined", "Giant Killer", "", "korf_gk"),
    feedN(
      "KNTU",
      "combined",
      "Gnd/Twr/App",
      "",
      "kntu3_uhf",
      "2",
    ),
    feedN(
      "KNTU",
      "combined",
      "Gnd/Twr/App/Radar",
      "",
      "kntu1",
      "3",
    ),
  ],

  // Walnut Ridge Regional Airport (Walnut Ridge, Arkansas, United States) — CSV verified
  KARG: [
    feed("KARG", "center", "CTAF/Memphis Center", "", "karg1"),
  ],

  // Ronald Reagan Washington National Airport (Washington, District of Columbia, United States) — CSV verified
  KDCA: [
    feed("KDCA", "tower", "Tower", "", "kdca1_twr"),
    feedN(
      "KDCA",
      "tower",
      "Tower/KJPN Helicopter",
      "",
      "kdca4_heli",
      "2",
    ),
    feed("KDCA", "ground", "Ground", "", "kdca1_gnd"),
    feed("KDCA", "approach", "Potomac App/Dep (FLUKY)", "", "kdca1_dep_121050"),
    feedN(
      "KDCA",
      "approach",
      "Potomac App/Dep (KRANT)",
      "",
      "kdca1_dep_e",
      "krant",
    ),
    feedN(
      "KDCA",
      "approach",
      "Potomac Approach (DCA Final)",
      "",
      "kdca1_app_final",
      "dca",
    ),
    feedN(
      "KDCA",
      "approach",
      "Potomac Approach (OJAAY Sector)",
      "",
      "kdca1_app_119850",
      "ojaay",
    ),
    feed("KDCA", "departure", "Potomac Departure", "", "kdca1_dep"),
    feed("KDCA", "combined", "Potomac App (LURAY)", "", "kmrb1_app_luray"),
    feedN(
      "KDCA",
      "combined",
      "Tower/Approach",
      "",
      "kdca",
      "2",
    ),
  ],

  // Pentagon Army Heliport (Washington, District of Columbia, United States) — CSV verified
  KJPN: [
    feed("KJPN", "tower", "KDCA Tower/KJPN Helicopter", "", "kdca4_heli"),
    feedN(
      "KJPN",
      "tower",
      "KDCA Tower/KJPN Helicopter",
      "",
      "kdca4_heli",
      "2",
    ),
  ],

  // Waukesha County Airport (Waukesha, Wisconsin, United States) — CSV verified
  KUES: [
    feed("KUES", "combined", "Gnd/Twr", "", "kues4"),
  ],

  // Waupaca Municipal Airport (Waupaca, Wisconsin, United States) — CSV verified
  KPCZ: [
    feed("KPCZ", "center", "KPCZ/KCLI/Y50/W23/KEZS CTAF", "", "kpcz2"),
  ],

  // Palm Beach County Park Airport (West Palm Beach, Florida, United States) — CSV verified
  KLNA: [
    feed("KLNA", "center", "CTAF", "", "kpbi2_klna"),
    feedN(
      "KLNA",
      "center",
      "West Palm Beach Area CTAFs",
      "",
      "kpbi1_misc",
      "west",
    ),
  ],

  // Palm Beach International Airport (West Palm Beach, Florida, United States) — CSV verified
  KPBI: [
    feed("KPBI", "tower", "Tower", "", "kpbi2_twr"),
    feed("KPBI", "ground", "Clearance Delivery", "", "kpbi2_del"),
    feedN(
      "KPBI",
      "ground",
      "Ground",
      "",
      "kpbi2_gnd",
      "2",
    ),
    feed("KPBI", "approach", "App (Final)", "", "kpbi2_final"),
    feed("KPBI", "atis", "ATIS", "", "kpbi2_atis"),
    feed("KPBI", "center", "Emergency/Guard", "", "kpbi2_guard"),
    feedN(
      "KPBI",
      "center",
      "ZMA Sector 01",
      "",
      "kpbi1_zma01",
      "se",
    ),
    feedN(
      "KPBI",
      "center",
      "ZMA Sector 20",
      "",
      "kpbi1_zma20",
      "2",
    ),
    feedN(
      "KPBI",
      "center",
      "ZMA Sector 21",
      "",
      "kpbi1_zma21",
      "3",
    ),
    feedN(
      "KPBI",
      "center",
      "ZMA Sector 46",
      "",
      "kpbi1_zma46",
      "4",
    ),
    feed("KPBI", "combined", "App (North)", "", "kpbi2_app_n"),
    feedN(
      "KPBI",
      "combined",
      "App (North/South)",
      "",
      "kpbi2_app",
      "north",
    ),
    feedN(
      "KPBI",
      "combined",
      "App (South)",
      "",
      "kpbi2_app_s",
      "south",
    ),
    feedN(
      "KPBI",
      "combined",
      "Dep (North)",
      "",
      "kpbi2_dep_n",
      "2",
    ),
    feedN(
      "KPBI",
      "combined",
      "Dep (North/South)",
      "",
      "kpbi2_dep",
      "3",
    ),
    feedN(
      "KPBI",
      "combined",
      "Dep (South)",
      "",
      "kpbi2_dep_s",
      "4",
    ),
    feedN(
      "KPBI",
      "combined",
      "GA Gate Hold",
      "",
      "kpbi2_gate_ga",
      "5",
    ),
    feedN(
      "KPBI",
      "combined",
      "Gnd/Twr",
      "",
      "kpbi2_gnd_twr",
      "6",
    ),
  ],

  // Barnes Municipal Airport (Westfield/Springfield, Massachusetts, United States) — CSV verified
  KBAF: [
    feed("KBAF", "tower", "KBAF/KCEF Tower", "", "kbaf1_twr"),
    feed("KBAF", "ground", "Ground", "", "kbaf1_gnd"),
    feed("KBAF", "atis", "ATIS", "", "kbaf1_atis"),
    feed("KBAF", "combined", "Ground/Tower", "", "kbaf1_gnd_twr"),
  ],

  // Carroll County Regional Airport/Jack B Poage Field (Westminster, Maryland, United States) — CSV verified
  KDMW: [
    feed("KDMW", "atis", "AWOS #2", "", "kdmw2_awos"),
    feed("KDMW", "center", "CTAF #2", "", "kdmw2_122700"),
    feedN(
      "KDMW",
      "center",
      "Emergency/Guard #2",
      "",
      "kdmw2_guard",
      "2",
    ),
  ],

  // Westchester County Airport (White Plains, New York, United States) — CSV verified
  KHPN: [
    feed("KHPN", "tower", "Tower", "", "khpn_twr"),
    feed("KHPN", "ground", "Delivery/Ground", "", "khpn_del_gnd"),
    feed("KHPN", "approach", "NY Approach (NOBBI/NYACK/HAARP)", "", "khpn2"),
    feed("KHPN", "atis", "ATIS", "", "khpn_atis2"),
    feed("KHPN", "combined", "Del/Gnd/Tower #1", "", "khpn2_del_gnd_twr"),
  ],

  // Colonel James Jabara Airport (Wichita, Kansas, United States) — CSV verified
  KAAO: [
    feed("KAAO", "approach", "Wichita Approach (Both)", "", "kaao3_app_both"),
    feedN(
      "KAAO",
      "approach",
      "Wichita Approach (East Satellite)",
      "",
      "kaao3_app_134800",
      "east",
    ),
    feedN(
      "KAAO",
      "approach",
      "Wichita Approach (East)",
      "",
      "kaao3_app_134850",
      "2",
    ),
    feedN(
      "KAAO",
      "approach",
      "Wichita Approach (HUT Satellite)",
      "",
      "kaao3_app_125500",
      "hut",
    ),
    feedN(
      "KAAO",
      "approach",
      "Wichita Approach (West)",
      "",
      "kaao3_app_126700",
      "west",
    ),
    feed("KAAO", "atis", "ASOS", "", "kaao3_asos"),
    feed("KAAO", "center", "CTAF", "", "kaao3_122700"),
  ],

  // Beech Factory Airport (Wichita, Kansas, United States) — CSV verified
  KBEC: [
    feed("KBEC", "tower", "Tower", "", "kaao3_kbec_twr"),
  ],

  // Cessna Aircraft Field Airport (Wichita, Kansas, United States) — CSV verified
  KCEA: [
    feed("KCEA", "center", "CTAF", "", "kaao3_122900"),
  ],

  // Mc Connell Air Force Base (Wichita, Kansas, United States) — CSV verified
  KIAB: [
    feed("KIAB", "tower", "Tower", "", "kaao3_kiab_twr"),
  ],

  // Wichita Falls Municipal Airport / Sheppard Air Force Base (Wichita Falls, Texas, United States) — CSV verified
  KSPS: [
    feed("KSPS", "center", "ZFW Sector 75", "", "zfw_ksps_127950"),
  ],

  // Williston Basin International Airport (Williston, North Dakota, United States) — CSV verified
  KXWA: [
    feed("KXWA", "center", "Area Guard", "", "kxwa2_guard"),
    feedN(
      "KXWA",
      "center",
      "CTAF",
      "",
      "kxwa2_ctaf",
      "2",
    ),
  ],

  // Wilmington International Airport (Wilmington, North Carolina, United States) — CSV verified
  KILM: [
    feed("KILM", "center", "ZDC Sector 35 Wilmington", "", "zdc_kilm2"),
    feedN(
      "KILM",
      "center",
      "ZNY Sector 83 HANRI",
      "",
      "zny_ilm_hanri",
      "se",
    ),
    feed("KILM", "combined", "Gnd/Twr/App", "", "kilm2_gnd_twr_app"),
    feedN(
      "KILM",
      "combined",
      "Gnd/Twr/App/ZDC",
      "",
      "kilm2_s",
      "2",
    ),
  ],

  // Bradley International Airport (Windsor Locks, Connecticut, United States) — CSV verified
  KBDL: [
    feed("KBDL", "tower", "Tower", "", "kbdl2_twr"),
    feed("KBDL", "ground", "Del/Gnd", "", "kbdl2_del_gnd"),
    feed("KBDL", "approach", "Approach/ANG", "", "kbdl2_app"),
    feed("KBDL", "atis", "ATIS", "", "kbdl2_atis"),
    feed("KBDL", "combined", "Twr/App", "", "kbdl2_twr_app"),
  ],

  // Winter Haven&#039;s Gilbert Airport (Winter Haven, Florida, United States) — CSV verified
  KGIF: [
    feed("KGIF", "atis", "ASOS", "", "kgif_awos"),
    feed("KGIF", "center", "CTAF/GCO/Guard", "", "kgif_s"),
    feedN(
      "KGIF",
      "center",
      "GCO/Guard",
      "",
      "kgif_gco_guard",
      "2",
    ),
    feedN(
      "KGIF",
      "center",
      "KGIF/F57 CTAF",
      "",
      "kgif_ctaf",
      "3",
    ),
    feedN(
      "KGIF",
      "center",
      "KPCM/KGIF CTAF",
      "",
      "klal8_ctaf_123050",
      "4",
    ),
  ],

  // Worcester Regional Airport (Worcester, Massachusetts, United States) — CSV verified
  KORH: [
    feed("KORH", "tower", "Tower", "", "korh_murp_twr"),
    feed("KORH", "approach", "Bradley App/Dep", "", "korh_murp_app"),
    feed("KORH", "atis", "ATIS", "", "korh_murp_atis"),
  ],

  // McGuire Field (Joint Base Mc Guire Dix Lakehurst) Airport (Wrightstown, New Jersey, United States) — CSV verified
  KWRI: [
    feed("KWRI", "combined", "KNEL/KWRI/ZNY", "", "kblm1"),
  ],

  // Yakima Air Terminal/McAllister Field (Yakima, Washington, United States) — CSV verified
  KYKM: [
    feed("KYKM", "tower", "Tower", "", "kykm1_twr"),
    feed("KYKM", "ground", "Ground", "", "kykm1_gnd"),
    feed("KYKM", "center", "Seattle Center (Sector 09 Low)", "", "kykm1_zse_132600"),
    feed("KYKM", "combined", "App/Dep", "", "kykm1_app"),
  ],

  // Yuma MCAS/International Airport (Yuma, Arizona, United States) — CSV verified
  KNYL: [
    feed("KNYL", "combined", "Del/Gnd/Twr/App/ZLA", "", "knyl1_local"),
  ],

  // Zelienople Municipal Airport (Zelienople, Pennsylvania, United States) — CSV verified
  KPJC: [
    feed("KPJC", "center", "Area Emergency/Guard", "", "kpjc3_guard"),
    feedN(
      "KPJC",
      "center",
      "CTAF",
      "",
      "kpjc3_ctaf",
      "2",
    ),
  ],

  // Zephyrhills Municipal Airport (Zephyrhills, Florida, United States) — CSV verified
  KZPH: [
    feed("KZPH", "center", "CTAF #1", "", "kzph2"),
  ],


  // ── Europe (additional) ──────────────────────────────────────


  // -- Bulgaria --
  // Burgas International Airport (Burgas, Bulgaria) — CSV verified
  LBBG: [
    feed("LBBG", "combined", "Twr/App", "", "lbbg2"),
  ],

  // Plovdiv International Airport (Plovdiv, Bulgaria) — CSV verified
  LBPD: [
    feed("LBPD", "tower", "Tower", "", "lbsf2_lbpd_twr"),
  ],

  // Sofia International Airport (Sofia, Bulgaria) — CSV verified
  LBSF: [
    feed("LBSF", "combined", "Tower/Approach #2", "", "lbsf1"),
  ],


  // -- Estonia --
  // Tallinn Airport (Tallinn, Estonia) — CSV verified
  EETN: [
    feed("EETN", "combined", "Tower/Approach", "", "eetn2_twr"),
  ],


  // -- Finland --
  // Helsinki-Vantaa Airport (Helsinki, Finland) — CSV verified
  EFHK: [
    feed("EFHK", "tower", "Tower (22L/04R 15/33)", "", "efhk2_twr1"),
  ],


  // -- Greece --
  // Skiathos International Airport (Skiathos, Greece) — CSV verified
  LGSK: [
    feed("LGSK", "combined", "Twr/App/ACC", "", "lgav2"),
  ],


  // -- Hungary --
  // Debrecen Airport (Debrecen, Hungary) — CSV verified
  LHDC: [
    feed("LHDC", "tower", "Info/Tower", "", "lhdc"),
  ],


  // -- Ireland --
  // Ireland West Airport Knock (Charlestown, Ireland) — CSV verified
  EIKN: [
    feed("EIKN", "combined", "Gnd/Twr/App", "", "eikn2"),
  ],

  // Cork Airport (Cork, Ireland) — CSV verified
  EICK: [
    feed("EICK", "combined", "Gnd/Twr/App/Dep", "", "eick4_gta"),
  ],

  // Shannon Airport (Shannon, Ireland) — CSV verified
  EINN: [
    feed("EINN", "center", "Shannon Control High (East)", "", "einn2_high1"),
    feedN(
      "EINN",
      "center",
      "Shannon Control High (West/Coastal)",
      "",
      "einn2_high2",
      "west",
    ),
    feedN(
      "EINN",
      "center",
      "Shannon Control Low",
      "",
      "einn2_low1",
      "2",
    ),
    feed("EINN", "combined", "Twr/App #1", "", "einn2"),
  ],


  // -- Latvia --
  // Riga International Airport (Riga, Latvia) — CSV verified
  EVRA: [
    feed("EVRA", "tower", "Tower/Guard", "", "evra1"),
    feed("EVRA", "approach", "Approach", "", "evra2"),
    feed("EVRA", "center", "CTAF", "", "evra3"),
    feedN(
      "EVRA",
      "center",
      "FIC",
      "",
      "evra4",
      "2",
    ),
  ],


  // -- Lithuania --
  // Vilnius International Airport (Vilnius, Lithuania) — CSV verified
  EYVI: [
    feed("EYVI", "combined", "Tower/Approach/Misc", "", "eyvi"),
  ],


  // -- Netherlands --
  // Gilze-Rijen Air Base (Breda, Netherlands) — CSV verified
  EHGR: [
    feed("EHGR", "tower", "Tower", "", "ehgr4_twr"),
    feed("EHGR", "combined", "Area Gliders", "", "ehgr4_gliders"),
  ],

  // Eindhoven Airport (Eindhoven, Netherlands) — CSV verified
  EHEH: [
    feed("EHEH", "tower", "Tower #1", "", "eheh3_twr"),
    feedN(
      "EHEH",
      "tower",
      "Tower #2",
      "",
      "eheh7_twr2",
      "2",
    ),
    feedN(
      "EHEH",
      "tower",
      "Tower 122.1",
      "",
      "eheh7_twr1",
      "3",
    ),
    feed("EHEH", "ground", "Ground #3", "", "eheh7_gnd"),
    feed("EHEH", "approach", "Approach #1", "", "eheh3_app"),
  ],

  // Groningen Airport Eelde (Groningen, Netherlands) — CSV verified
  EHGG: [
    feed("EHGG", "tower", "Tower", "", "ehgg1_twr"),
    feed("EHGG", "ground", "Ground", "", "ehgg1_gnd"),
    feed("EHGG", "approach", "Approach", "", "ehgg1_app"),
    feed("EHGG", "atis", "ATIS", "", "ehgg1_atis"),
    feed("EHGG", "center", "Guard/Emergency", "", "ehgg1_guard"),
    feedN(
      "EHGG",
      "center",
      "MUAC/Eurocontrol (EHGG Area)",
      "",
      "ehgg1_muac",
      "ehgg",
    ),
    feed("EHGG", "combined", "Twr/App (Secondary)", "", "ehgg1_bu"),
  ],

  // Lelystad Airport (Lelystad, Netherlands) — CSV verified
  EHLE: [
    feed("EHLE", "tower", "Tower", "", "ehle_twr"),
    feed("EHLE", "ground", "Clearance Delivery", "", "ehle_del"),
    feed("EHLE", "approach", "Approach/Dutch Mil Radar", "", "ehle_dutchmil"),
    feedN(
      "EHLE",
      "approach",
      "App/Dep",
      "",
      "ehle_app",
      "2",
    ),
    feed("EHLE", "center", "FIC", "", "ehle_fic"),
  ],

  // Rotterdam The Hague Airport (Rotterdam, Netherlands) — CSV verified
  EHRD: [
    feed("EHRD", "tower", "Tower", "", "ehrd1_twr"),
    feedN(
      "EHRD",
      "tower",
      "Tower (Regional Guard)",
      "",
      "ehrd1_twr2",
      "regional",
    ),
    feed("EHRD", "ground", "Ground/Clearance", "", "ehrd1_gnd"),
    feed("EHRD", "approach", "Rotterdam Approach 127.025", "127.025", "ehrd1_app2"),
    feedN(
      "EHRD",
      "approach",
      "Schiphol Approach (EHRD Area)",
      "",
      "ehrd1_eham_app",
      "ehrd",
    ),
    feed("EHRD", "atis", "Adam Info 124.3", "", "ehrd1_info"),
    feedN(
      "EHRD",
      "atis",
      "Rotterdam ATIS",
      "",
      "ehrd1_atis",
      "2",
    ),
  ],


  // -- North Macedonia, Republic of --
  // Skopje Airport (Petrovec, North Macedonia, Republic of) — CSV verified
  LWSK: [
    feed("LWSK", "tower", "Tower", "", "lwsk2_2"),
    feed("LWSK", "approach", "Approach", "", "lwsk2_3"),
    feed("LWSK", "atis", "ATIS", "", "lwsk2_atis"),
    feed("LWSK", "center", "ACC (Lower)", "", "lwsk2_4"),
    feedN(
      "LWSK",
      "center",
      "ACC (Upper)",
      "",
      "lwsk2_1",
      "upper",
    ),
  ],


  // -- Norway --
  // Alesund Airport, Vigra (Alesund, Norway) — CSV verified
  ENAL: [
    feed("ENAL", "tower", "Tower", "", "enal4"),
  ],

  // Alta Airport (Alta, Norway) — CSV verified
  ENAT: [
    feed("ENAT", "combined", "Twr/App/Control", "", "enat2"),
  ],

  // Bergen Airport - Flesland (Bergen, Norway) — CSV verified
  ENBR: [
    feed("ENBR", "tower", "Tower", "", "enbr4_twr"),
    feed("ENBR", "approach", "Approach", "", "enbr4_app"),
    feed("ENBR", "center", "Area Emergency/Guard", "", "enbr4_guard"),
  ],

  // Bodo Airport (Bodo, Norway) — CSV verified
  ENBO: [
    feed("ENBO", "tower", "Tower", "", "enbo_twr"),
    feed("ENBO", "approach", "Approach", "", "enbo_app"),
  ],

  // Harstad/Narvik Airport (Evenes, Norway) — CSV verified
  ENEV: [
    feed("ENEV", "combined", "Twr/App/ACC", "", "enev"),
  ],

  // Farsund Airport, Lista (Farsund, Norway) — CSV verified
  ENLI: [
    feed("ENLI", "center", "CTAF", "", "enli3_ctaf"),
    feedN(
      "ENLI",
      "center",
      "Polaris FIR Sector 09/12",
      "",
      "enli3_pol9",
      "se",
    ),
    feedN(
      "ENLI",
      "center",
      "Polaris FIR Sector 10/11",
      "",
      "enli3_pol10",
      "2",
    ),
    feed("ENLI", "combined", "GA", "", "enli3_ga"),
  ],

  // Kirkenes Airport (Kirkenes, Norway) — CSV verified
  ENKR: [
    feed("ENKR", "combined", "ENKR/ENVD Twr/App", "", "enkr2"),
  ],

  // Kristiansand Airport - Kjevik (Kristiansand, Norway) — CSV verified
  ENCN: [
    feed("ENCN", "combined", "Tower/Approach", "", "encn"),
  ],

  // Tromso Airport (Langnes, Norway) — CSV verified
  ENTC: [
    feed("ENTC", "combined", "Tower/Approach", "", "entc"),
  ],

  // Moss Airport - Rygge (Moss, Norway) — CSV verified
  ENRY: [
    feed("ENRY", "tower", "Tower", "", "enry_twr"),
    feed("ENRY", "center", "ENOR Sector 8", "", "enor_sector8"),
  ],

  // Sandefjord Airport - Torp (Sandefjord, Norway) — CSV verified
  ENTO: [
    feed("ENTO", "tower", "Tower", "", "ento_twr"),
    feed("ENTO", "approach", "App/Dep", "", "ento_tma"),
    feed("ENTO", "center", "Control Sector 4", "", "ento_ctl_4"),
    feed("ENTO", "combined", "Tower/App", "", "ento"),
    feedN(
      "ENTO",
      "combined",
      "Twr/App",
      "",
      "ento_twr_tma",
      "2",
    ),
  ],

  // Stavanger Sola Airport (Stavanger, Norway) — CSV verified
  ENZV: [
    feed("ENZV", "combined", "Gnd/Twr/App", "", "enzv2"),
  ],

  // Vaernes Airport (Trondheim, Norway) — CSV verified
  ENVA: [
    feed("ENVA", "combined", "Ground/Tower/Approach", "", "enva"),
  ],

  // Vadso Airport (Vadso, Norway) — CSV verified
  ENVD: [
    feed("ENVD", "combined", "ENKR/ENVD Twr/App", "", "enkr2"),
  ],


  // -- Poland --
  // Bydgoszcz Ignacy Jan Paderewski Airport (Bydgoszcz, Poland) — CSV verified
  EPBY: [
    feed("EPBY", "tower", "Tower", "", "epby3_twr"),
    feed("EPBY", "atis", "ATIS", "", "epby3_atis"),
  ],

  // Katowice International Airport (Katowice, Poland) — CSV verified
  EPKT: [
    feed("EPKT", "approach", "Delivery/Approach", "", "epkt_gnd"),
    feed("EPKT", "combined", "Del/Twr/App", "", "epkt"),
    feedN(
      "EPKT",
      "combined",
      "Tower/Approach",
      "",
      "epkt_twr_app",
      "2",
    ),
  ],

  // John Paul II Balice International Airport (Krakow, Poland) — CSV verified
  EPKK: [
    feed("EPKK", "combined", "Tower/Approach", "", "epkk_app"),
  ],

  // Lublinek Airport (Lodz, Poland) — CSV verified
  EPLL: [
    feed("EPLL", "tower", "Tower", "", "epll"),
  ],

  // Lublin Airport (Lublin, Poland) — CSV verified
  EPLB: [
    feed("EPLB", "tower", "Tower/Misc", "", "eplb2"),
  ],

  // Poznan-Lawica Henryk Wieniawski Airport (Poznan, Poland) — CSV verified
  EPPO: [
    feed("EPPO", "combined", "Twr/App/FIS", "", "eppo2"),
  ],

  // Fredric Chopin Warsaw Airport (Warsaw, Poland) — CSV verified
  EPWA: [
    feed("EPWA", "tower", "Tower", "", "epwa_twr2"),
    feed("EPWA", "ground", "Ground", "", "epwa_gnd"),
    feed("EPWA", "approach", "Approach #1", "", "epwa_app"),
    feedN(
      "EPWA",
      "approach",
      "Approach #2",
      "",
      "epwa_app2",
      "2",
    ),
  ],

  // Strachowice Airport (Wroclaw, Poland) — CSV verified
  EPWR: [
    feed("EPWR", "tower", "Tower", "", "epwr4_twr"),
    feed("EPWR", "ground", "Clearance Delivery", "", "epwr4_del"),
    feed("EPWR", "approach", "Approach #2", "", "epwr4_app2"),
    feed("EPWR", "center", "Area Emergency/Guard", "", "epwr4_guard"),
    feedN(
      "EPWR",
      "center",
      "FIS (South)",
      "",
      "epwr4_fis_s",
      "south",
    ),
  ],


  // -- Portugal --
  // Beja Airport (Beja, Portugal) — CSV verified
  LPBJ: [
    feed("LPBJ", "tower", "Tower", "", "lpbj2_twr"),
    feed("LPBJ", "approach", "App/Dep", "", "lpbj2_app"),
  ],

  // Faro Airport (Faro, Portugal) — CSV verified
  LPFR: [
    feed("LPFR", "tower", "Tower", "", "lpfr_twr"),
    feed("LPFR", "ground", "Ground", "", "lpfr_gnd"),
    feed("LPFR", "approach", "Approach", "", "lpfr_app"),
  ],

  // Madeira International Airport (Madeira, Portugal) — CSV verified
  LPMA: [
    feed("LPMA", "approach", "Approach", "", "lpma2"),
    feedN(
      "LPMA",
      "approach",
      "Approach/LPPC Center",
      "",
      "lppc2",
      "2",
    ),
  ],

  // Porto Airport (Porto, Portugal) — CSV verified
  LPPR: [
    feed("LPPR", "approach", "Approach #1", "", "lppr2"),
  ],


  // -- Romania --
  // Brasov-Ghimbav International Airport (Brasov, Romania) — CSV verified
  LRBV: [
    feed("LRBV", "tower", "Tower", "", "lrbv2"),
  ],

  // Otopeni International Airport (Bucharest, Romania) — CSV verified
  LROP: [
    feed("LROP", "ground", "Ground", "", "lrop2"),
    feed("LROP", "approach", "Radar", "", "lrop_rdr"),
    feed("LROP", "combined", "Tower/Approach", "", "lrop_twr"),
    feedN(
      "LROP",
      "combined",
      "Twr/App/Radar",
      "",
      "lrop",
      "2",
    ),
  ],

  // Cluj-Napoca International Airport (Cluj-Napoca, Romania) — CSV verified
  LRCL: [
    feed("LRCL", "combined", "Twr/App #1", "", "lrcl"),
  ],

  // Sibiu International Airport (Sibiu, Romania) — CSV verified
  LRSB: [
    feed("LRSB", "tower", "Tower/CTAF", "", "lrsb2"),
  ],

  // Traian Vuia International Airport (Timisoara, Romania) — CSV verified
  LRTR: [
    feed("LRTR", "tower", "Tower", "", "lrtr"),
  ],


  // -- Russia --
  // Salekhard Airport (Salekhard, Russia) — CSV verified
  USDD: [
    feed("USDD", "combined", "Gnd/Twr/App/Control", "", "usdd1"),
  ],

  // Sochi International Airport (Sochi, Russia) — CSV verified
  URSS: [
    feed("URSS", "combined", "Gnd/Twr/App", "", "urss"),
  ],


  // -- Serbia --
  // Belgrade Nikola Tesla Airport (Belgrade, Serbia) — CSV verified
  LYBE: [
    feed("LYBE", "tower", "Tower", "", "lybe2_twr_118100"),
  ],

  // Constantine the Great Airport (Nis, Serbia) — CSV verified
  LYNI: [
    feed("LYNI", "combined", "Twr/App", "", "lyni2"),
  ],


  // -- Slovakia --
  // Milan Rastislav Stefanik Airport (Bratislava, Slovakia) — CSV verified
  LZIB: [
    feed("LZIB", "combined", "Ground/Tower/Approach", "", "lzib2"),
  ],

  // Kosice International Airport (Kosice, Slovakia) — CSV verified
  LZKZ: [
    feed("LZKZ", "combined", "Gnd/Twr/App", "", "lzkz"),
  ],

  // Piestany Airport (Piestany, Slovakia) — CSV verified
  LZPP: [
    feed("LZPP", "combined", "Ground/Tower", "", "lzpp2"),
  ],

  // Poprad-Tatry Airport (Poprad, Slovakia) — CSV verified
  LZTT: [
    feed("LZTT", "tower", "Tower", "", "lztt2_twr"),
  ],


  // -- Slovenia --
  // Ljubljana Joze Pucnik Airport (Ljubljana, Slovenia) — CSV verified
  LJLJ: [
    feed("LJLJ", "tower", "Tower", "", "ljlj_twr"),
    feed("LJLJ", "approach", "Radar", "", "ljlj_app"),
    feed("LJLJ", "atis", "Info", "", "ljlj_info"),
  ],

  // Maribor Edvard Rusjan Airport (Maribor, Slovenia) — CSV verified
  LJMB: [
    feed("LJMB", "tower", "Tower", "", "ljmb3"),
  ],


  // -- Sweden --
  // Dala Airport (Borlange, Sweden) — CSV verified
  ESSD: [
    feed("ESSD", "tower", "Tower/Control", "", "essd2"),
  ],

  // Landvetter Airport (Gothenburg, Sweden) — CSV verified
  ESGG: [
    feed("ESGG", "tower", "Tower", "", "esgg2_twr"),
    feed("ESGG", "approach", "Approach", "", "esgg2_app"),
    feed("ESGG", "combined", "Twr/App", "", "esgg2_twr_app"),
  ],

  // Kalmar Airport (Kalmar, Sweden) — CSV verified
  ESMQ: [
    feed("ESMQ", "tower", "Tower", "", "esmq2"),
  ],

  // Linkoping City (Saab) Airport (Linkoping, Sweden) — CSV verified
  ESSL: [
    feed("ESSL", "combined", "Twr/App/Control", "", "essl"),
  ],

  // Lulea Airport (Lulea, Sweden) — CSV verified
  ESPA: [
    feed("ESPA", "tower", "Tower/Control", "", "espa"),
  ],

  // Kungsangen Airport (Norrkoping, Sweden) — CSV verified
  ESSP: [
    feed("ESSP", "combined", "Twr/App/Control", "", "essp2_twr_app_ctrl"),
  ],

  // Orebro Airport (Orebro, Sweden) — CSV verified
  ESOE: [
    feed("ESOE", "tower", "Tower/Control", "", "esoe2"),
  ],

  // Stockholm-Bromma Airport (Stockholm, Sweden) — CSV verified
  ESSB: [
    feed("ESSB", "tower", "Tower", "", "essb4"),
  ],

  // Malmo Airport (Svedala, Sweden) — CSV verified
  ESMS: [
    feed("ESMS", "approach", "Radar", "", "esms3_app"),
  ],


  // -- Switzerland --
  // Lugano Airport (Agno, Switzerland) — CSV verified
  LSZA: [
    feed("LSZA", "tower", "Tower", "", "lsza"),
  ],

  // St. Gallen-Altenrhein Airport (Altenrhein, Switzerland) — CSV verified
  LSZR: [
    feed("LSZR", "tower", "Tower", "", "lszr"),
  ],

  // Bern-Belp Airport (Bern, Switzerland) — CSV verified
  LSZB: [
    feed("LSZB", "tower", "Tower", "", "lszb2_twr"),
    feed("LSZB", "ground", "Clearance Delivery", "", "lszb2_del"),
    feed("LSZB", "approach", "App/Dep", "", "lszb2_app_dep"),
    feed("LSZB", "atis", "ATIS", "", "lszb2_atis"),
    feed("LSZB", "combined", "Del/Twr/App/Dep", "", "lszb2_del_twr_app"),
    feedN(
      "LSZB",
      "combined",
      "Twr/App/Dep",
      "",
      "lszb2_twr_app",
      "2",
    ),
  ],

  // Mollis Airfield (Glarus, Switzerland) — CSV verified
  LSZM: [
    feed("LSZM", "center", "AFIS", "", "lszm_afis"),
  ],

  // Grenchen Airport (Grenchen, Switzerland) — CSV verified
  LSZG: [
    feed("LSZG", "tower", "Tower", "", "lszg"),
  ],

  // Sion International Airport (Sion, Switzerland) — CSV verified
  LSGS: [
    feed("LSGS", "combined", "Gnd/Twr/App", "", "lsgs"),
  ],


  // -- Turkey --
  // Ataturk Airport (Istanbul, Turkey) — CSV verified
  LTBA: [
    feed("LTBA", "combined", "Gnd/Twr/App", "", "ltba_s"),
  ],


  // ── Asia Pacific (additional) ────────────────────────────────


  // -- Japan --
  // Fukuoka Airport (Fukuoka, Japan) — CSV verified
  RJFF: [
    feed("RJFF", "tower", "Tower", "", "rjff3_twr"),
    feed("RJFF", "ground", "Del/Gnd/TCA", "", "rjff3_app2"),
    feed("RJFF", "approach", "App/Radar", "", "rjff3_app1"),
    feed("RJFF", "departure", "Departure", "", "rjff3_dep"),
    feed("RJFF", "center", "Control (Misc)", "", "rjff3_ctl"),
  ],

  // Osaka International Airport (Osaka, Japan) — CSV verified
  RJOO: [
    feed("RJOO", "tower", "Tower", "", "rjoo1"),
  ],

  // Sapporo Okadama Airport (Sapporo, Japan) — CSV verified
  RJCO: [
    feed("RJCO", "tower", "Tower", "", "rjco2_twr"),
    feed("RJCO", "approach", "Approach", "", "rjco2_app"),
  ],

  // Fukushima Airport (Sukagawa, Japan) — CSV verified
  RJSF: [
    feed("RJSF", "combined", "RDO", "", "rjsf"),
  ],

  // Yokota Air Base (Tokyo, Japan) — CSV verified
  RJTY: [
    feed("RJTY", "tower", "Tower", "", "rjty1_twr"),
    feed("RJTY", "ground", "Ground", "", "rjty1_gnd"),
    feed("RJTY", "approach", "Approach", "", "rjty1_app"),
    feed("RJTY", "atis", "ATIS", "", "rjty1_atis"),
    feed("RJTY", "combined", "Ground/Tower", "", "rjty1_gnd_twr"),
  ],


  // -- Kuwait --
  // Kuwait International Airport (Kuwait City, Kuwait) — CSV verified
  OKKK: [
    feed("OKKK", "combined", "Gnd/Twr/App/Radar", "", "okbk2"),
  ],


  // -- Malaysia --
  // Kota Kinabalu International Airport (Kota Kinabalu, Malaysia) — CSV verified
  WBKK: [
    feed("WBKK", "combined", "Ground/Tower/Radar/Control", "", "wbkk2"),
  ],

  // Butterworth Airport (Panang, Malaysia) — CSV verified
  WMKB: [
    feed("WMKB", "tower", "Tower", "", "wmkb"),
  ],


  // -- Pakistan --
  // Allama Iqbal International Airport (Lahore, Pakistan) — CSV verified
  OPLA: [
    feed("OPLA", "atis", "ATIS", "", "opla_atis"),
    feed("OPLA", "combined", "OPLA/OPLH Gnd/Twr/App", "", "opla"),
  ],


  // -- Russia --
  // Khabarovsk Novy Airport (Khabarovsk, Russia) — CSV verified
  UHHH: [
    feed("UHHH", "combined", "Gnd/Twr/App/Radar/Control", "", "uhhh2"),
  ],

  // Tolmachevo Airport (Novosibirsk, Russia) — CSV verified
  UNNT: [
    feed("UNNT", "combined", "Ground/Tower/Approach/Radar/Misc", "", "unnt"),
  ],

  // Roshchino International Airport (Tyumen, Russia) — CSV verified
  USTR: [
    feed("USTR", "combined", "Gnd/Twr/App", "", "ustr"),
  ],


  // -- Taiwan --
  // Taipei Songshan Airport (Taipei, Taiwan) — CSV verified
  RCSS: [
    feed("RCSS", "combined", "Tower/Approach/Departure", "", "rcss2"),
  ],


  // ── Oceania (additional) ──────────────────────────────────────


  // -- Australia --
  // Adelaide International Airport (Adelaide, South Australia, Australia) — CSV verified
  YPAD: [
    feed("YPAD", "combined", "Del/Gnd/Twr/App", "", "ypad_misc"),
    feedN(
      "YPAD",
      "combined",
      "Gnd/Twr/App/Center",
      "",
      "ypad",
      "2",
    ),
  ],

  // Alice Springs Airport (Alice Springs, Northern Territory, Australia) — CSV verified
  YBAS: [
    feed("YBAS", "tower", "Tower/Center", "", "ybas"),
  ],

  // Avalon Airport (Avalon, Victoria, Australia) — CSV verified
  YMAV: [
    feed("YMAV", "approach", "Del/App", "", "ymav2"),
  ],

  // Sydney Bankstown Airport (Bankstown, New South Wales, Australia) — CSV verified
  YSBK: [
    feed("YSBK", "tower", "Tower", "", "ysbk_atis"),
    feed("YSBK", "atis", "ATIS", "", "ysbk_twr"),
  ],

  // Brisbane International Airport (Brisbane, Queensland, Australia) — CSV verified
  YBBN: [
    feed("YBBN", "tower", "Tower (North/South)", "", "ybbn7_twr"),
    feed("YBBN", "center", "Brisbane Center (129.000)", "129.000", "ybbn9_ctr"),
  ],

  // Cairns International Airport (Cairns, Queensland, Australia) — CSV verified
  YBCS: [
    feed("YBCS", "tower", "Tower", "", "ybcs_twr"),
    feed("YBCS", "ground", "Ground", "", "ybcs_gnd"),
    feed("YBCS", "approach", "App/Dep (all)", "", "ybcs_app_dep_both"),
    feedN(
      "YBCS",
      "approach",
      "App/Dep #1",
      "",
      "ybcs_app_dep",
      "1",
    ),
    feedN(
      "YBCS",
      "approach",
      "App/Dep #2",
      "",
      "ybcs_dep",
      "2",
    ),
    feed("YBCS", "center", "Brisbane Centre", "", "ybcs_centre"),
    feedN(
      "YBCS",
      "center",
      "Emergency/Guard",
      "",
      "ybcs_guard",
      "2",
    ),
    feed("YBCS", "combined", "Ground/Tower", "", "ybcs_gnd_twr"),
  ],

  // Hobart International Airport (Cambridge, Tasmania, Australia) — CSV verified
  YMHB: [
    feed("YMHB", "tower", "Twr/Centre/Misc", "", "ymhb2"),
  ],

  // Camden General Airport (Camden, New South Wales, Australia) — CSV verified
  YSCN: [
    feed("YSCN", "tower", "Tower/CTAF", "", "yscn3"),
  ],

  // Canberra International Airport (Canberra, Australian Capital Territory, Australia) — CSV verified
  YSCB: [
    feed("YSCB", "tower", "Tower", "", "yscb2_twr"),
    feed("YSCB", "approach", "App/Dep", "", "yscb2_app"),
    feedN(
      "YSCB",
      "approach",
      "App/Dep (East)",
      "",
      "yscb2_app_e",
      "east",
    ),
    feedN(
      "YSCB",
      "approach",
      "App/Dep (West)",
      "",
      "yscb2_app_w",
      "west",
    ),
    feed("YSCB", "atis", "ATIS", "", "yscb2_atis"),
    feed("YSCB", "center", "Melbourne Center (124.1)", "", "yscb2_ctr_124100"),
    feedN(
      "YSCB",
      "center",
      "Melbourne Center (128.4)",
      "",
      "yscb2_ctr_128400",
      "ne",
    ),
    feed("YSCB", "combined", "Twr/App/Dep", "", "yscb2_all"),
  ],

  // Charleville Airport (Charleville, Queensland, Australia) — CSV verified
  YBCV: [
    feed("YBCV", "center", "CTAF/Brisbane Center", "", "ybcv"),
  ],

  // Darwin International Airport (Darwin, Northern Territory, Australia) — CSV verified
  YPDN: [
    feed("YPDN", "combined", "Gnd/Twr/App/Dep", "", "ypdn"),
  ],

  // Gold Coast Airport (Gold Coast City, Queensland, Australia) — CSV verified
  YBCG: [
    feed("YBCG", "tower", "Tower #1", "", "ybcg3_twr"),
    feed("YBCG", "ground", "Ground", "", "ybcg3_gnd"),
    feed("YBCG", "approach", "Approach", "", "ybcg3_app"),
    feed("YBCG", "center", "Area CTAF", "", "ybcg3_area_ctaf"),
    feedN(
      "YBCG",
      "center",
      "Brisbane Centre",
      "",
      "ybcg3_centre",
      "ne",
    ),
    feed("YBCG", "combined", "Ground/Tower", "", "ybcg3_gnd_twr"),
  ],

  // Oakey Airport (Oakey, Queensland, Australia) — CSV verified
  YBOK: [
    feed("YBOK", "combined", "Del/Gnd/Twr/App", "", "ybok"),
  ],

  // Perth Jandakot Airport (Perth, Western Australia, Australia) — CSV verified
  YPJT: [
    feed("YPJT", "tower", "Tower", "", "ypjt3_twr"),
    feed("YPJT", "ground", "Ground", "", "ypjt3_gnd"),
    feed("YPJT", "center", "Melbourne Center", "", "ypjt2_melb_ctr"),
    feedN(
      "YPJT",
      "center",
      "Perth Center",
      "",
      "ypjt2_ctr",
      "2",
    ),
    feed("YPJT", "combined", "Gnd/Twr", "", "ypjt2_misc"),
  ],

  // Port Macquarie Airport (Port Macquarie, New South Wales, Australia) — CSV verified
  YPMQ: [
    feed("YPMQ", "center", "CTAF", "", "ypmq2"),
  ],

  // RAAF Base Richmond (Richmond, New South Wales, Australia) — CSV verified
  YSRI: [
    feed("YSRI", "tower", "Tower", "", "ysri2_twr"),
  ],

  // Southport Airfield (Southport, Queensland, Australia) — CSV verified
  YSPT: [
    feed("YSPT", "center", "CTAF", "", "yspt2"),
  ],

  // Tamworth Regional Airport (Tamworth, New South Wales, Australia) — CSV verified
  YSTW: [
    feed("YSTW", "combined", "Gnd/Twr/Center", "", "ystw3"),
  ],

  // Townsville Airport (Townsville, Queensland, Australia) — CSV verified
  YBTL: [
    feed("YBTL", "tower", "Tower", "", "ybtl1_twr"),
    feed("YBTL", "ground", "Clearance Delivery", "", "ybtl1_del"),
    feedN(
      "YBTL",
      "ground",
      "Ground",
      "",
      "ybtl1_gnd",
      "2",
    ),
    feed("YBTL", "approach", "Approach/Departure", "", "ybtl1_app"),
    feed("YBTL", "atis", "ATIS", "", "ybtl1_atis"),
    feed("YBTL", "center", "Brisbane Center", "", "ybtl1_ctr"),
  ],

  // Toowoomba Wellcamp Airport (Wellcamp, Queensland, Australia) — CSV verified
  YBWW: [
    feed("YBWW", "center", "CTAF", "", "ybww_ctaf"),
  ],


  // ── South America (additional) ─────────────────────────────


  // -- Argentina --
  // Ing A L V Tarravella International Airport (Cordoba, Argentina) — CSV verified
  SACO: [
    feed("SACO", "tower", "Tower", "", "saco2_twr"),
    feedN(
      "SACO",
      "tower",
      "Tower (Aux 1)",
      "",
      "saco2_twr_aux1",
      "aux",
    ),
    feedN(
      "SACO",
      "tower",
      "Tower (Aux 2)",
      "",
      "saco2_twr_aux2",
      "2",
    ),
    feed("SACO", "combined", "TMA", "", "saco2_tma"),
  ],

  // La Plata Airport (La Plata, Argentina) — CSV verified
  SADL: [
    feed("SADL", "combined", "Misc", "", "sadl2"),
  ],

  // Presidente Peron International Airport (Neuquen, Argentina) — CSV verified
  SAZN: [
    feed("SAZN", "tower", "Tower", "", "sazn_twr"),
  ],

  // San Carlos de Bariloche Airport (Rio Negro, Argentina) — CSV verified
  SAZS: [
    feed("SAZS", "combined", "Gnd/Twr/App", "", "sazs"),
  ],

  // Martin Miguel de Guemes International Airport (Salta, Argentina) — CSV verified
  SASA: [
    feed("SASA", "combined", "Twr/App", "", "sasa"),
  ],

  // Teniente Benjamin Matienzo Airport (Tucuman, Argentina) — CSV verified
  SANT: [
    feed("SANT", "combined", "Tower/Apps", "", "sant"),
  ],


  // -- Aruba --
  // Queen Beatrix International Airport (Oranjestad, Aruba) — CSV verified
  TNCA: [
    feed("TNCA", "combined", "Tower/Approach/Ground", "", "tnca"),
  ],


  // -- Bonaire --
  // Flamingo International Airport (Kralendijk, Bonaire) — CSV verified
  TNCB: [
    feed("TNCB", "tower", "Tower", "", "tncb"),
    feed("TNCB", "atis", "ATIS", "", "tncb_atis"),
  ],


  // -- Brazil --
  // Santa Maria Airport (Aracaju, Brazil) — CSV verified
  SBAR: [
    feed("SBAR", "combined", "Twr/App", "", "sbar2"),
  ],

  // Val de Cans International Airport (Belem, Brazil) — CSV verified
  SBBE: [
    feed("SBBE", "combined", "Twr/App/SBAZ", "", "sbbe"),
  ],

  // Boa Vista International Airport (Boa Vista, Brazil) — CSV verified
  SBBV: [
    feed("SBBV", "combined", "Tower/Approach", "", "sbbv3"),
  ],

  // Presidente Juscelino Kubitschek International Airport (Brasilia, Brazil) — CSV verified
  SBBR: [
    feed("SBBR", "approach", "Approach", "", "sbbr3_app"),
  ],

  // Campina Grande/Presidente Joao Suassuna Airport (Campina Grande, Brazil) — CSV verified
  SBKG: [
    feed("SBKG", "tower", "Tower", "", "sbkg3"),
  ],

  // Viracopos International Airport (Campinas, Brazil) — CSV verified
  SBKP: [
    feed("SBKP", "tower", "Tower #2", "", "sbkp3_twr"),
  ],

  // Afonso Pena Airport (Curitiba, Brazil) — CSV verified
  SBCT: [
    feed("SBCT", "combined", "Gnd/Twr/App", "", "sbct2"),
  ],

  // Pinto Martins International Airport (Fortaleza, Brazil) — CSV verified
  SBFZ: [
    feed("SBFZ", "combined", "Gnd/Twr/App", "", "sbfz4"),
    feedN(
      "SBFZ",
      "combined",
      "Gnd/Twr/App",
      "",
      "sbfz6",
      "2",
    ),
  ],

  // Jorge Amado Airport (Ilheus, Brazil) — CSV verified
  SBIL: [
    feed("SBIL", "center", "Ilheus Control/Misc", "", "sbil2"),
    feedN(
      "SBIL",
      "center",
      "Recife Center (Sectors 11/13/14)",
      "",
      "sbil2_ctr",
      "sectors",
    ),
  ],

  // Presidente Castro Pinto International Airport (Joao Pessoa, Brazil) — CSV verified
  SBJP: [
    feed("SBJP", "tower", "Tower", "", "sbjp2"),
  ],

  // Juazeiro do Norte Airport (Juazeiro do Norte, Brazil) — CSV verified
  SBJU: [
    feed("SBJU", "tower", "Tower/Center", "", "sbju"),
  ],

  // Londrina Airport (Londrina, Brazil) — CSV verified
  SBLO: [
    feed("SBLO", "combined", "Twr/App/Center", "", "sblo"),
  ],

  // Regional de Maringa Silvio Name Junior Airport (Maringa, Brazil) — CSV verified
  SBMG: [
    feed("SBMG", "combined", "Twr/App", "", "sbmg"),
  ],

  // Montes Claros Airport (Montes Claros, Brazil) — CSV verified
  SBMK: [
    feed("SBMK", "center", "RDO/Center", "", "sbmk"),
  ],

  // Joao Silva Filho International Airport (Parnaiba, Brazil) — CSV verified
  SBPB: [
    feed("SBPB", "atis", "Info", "", "sbpb2"),
  ],

  // Paulo Afonso Airport (Paulo Afonso, Brazil) — CSV verified
  SBUF: [
    feed("SBUF", "center", "SBRE Recife ACC", "", "sbre1"),
    feedN(
      "SBUF",
      "center",
      "AFIS/Center",
      "",
      "sbuf",
      "2",
    ),
  ],

  // Petrolina Airport (Petrolina, Brazil) — CSV verified
  SBPL: [
    feed("SBPL", "center", "RDO/ACC", "", "sbpl"),
  ],

  // Guararapes International (Gilberto Freyre International) (Recife, Brazil) — CSV verified
  SBRF: [
    feed("SBRF", "tower", "Tower", "", "sbrf_11835"),
    feed("SBRF", "ground", "Ground", "", "sbrf_gnd"),
    feed("SBRF", "center", "Recife ACC", "", "sbrf_acc"),
    feed("SBRF", "combined", "App 129.60", "", "sbrf_12960"),
    feedN(
      "SBRF",
      "combined",
      "Gol Ops",
      "",
      "sbrf_gol",
      "2",
    ),
    feedN(
      "SBRF",
      "combined",
      "LATAM Ops",
      "",
      "sbrf_latam",
      "3",
    ),
  ],

  // Santarem-Maestro Wilson Fonseca Airport (Santarem, Brazil) — CSV verified
  SBSN: [
    feed("SBSN", "combined", "Twr/App/ACC", "", "sbsn"),
  ],

  // Greater Natal International Airport (Sao Goncalo do Amarante, Brazil) — CSV verified
  SBSG: [
    feed("SBSG", "combined", "Gnd/Twr/App", "", "sbsg3"),
  ],

  // Sao Jose do Rio Preto Airport (Sao Jose do Rio Preto, Brazil) — CSV verified
  SBSR: [
    feed("SBSR", "center", "AFIS/App/Center", "", "sbsr"),
  ],

  // Teresina-Senador Petronio Portella Airport (Teresina, Brazil) — CSV verified
  SBTE: [
    feed("SBTE", "combined", "Tower/Approach", "", "sbte2"),
  ],

  // Torres Airport (Torres, Brazil) — CSV verified
  SSTE: [
    feed("SSTE", "combined", "FCA/Air to Air", "", "sste2"),
  ],


  // -- Chile --
  // Arturo Merino Benitez International Airport (Santiago, Chile) — CSV verified
  SCEL: [
    feed("SCEL", "combined", "Ground/Tower/Radar", "", "scel"),
  ],


  // -- Costa Rica --
  // Juan Santamaria International Airport (San Jose, Costa Rica) — CSV verified
  MROC: [
    feed("MROC", "combined", "Delivery/Ground/Tower/Approach/Center/Misc", "", "mroc"),
  ],


  // -- Curacao --
  // Aeropuerto Hato (Willemstad, Curacao) — CSV verified
  TNCC: [
    feed("TNCC", "tower", "Tower", "", "tncc3_twr"),
    feed("TNCC", "center", "Control", "", "tncc"),
  ],


  // -- Ecuador --
  // Jose Joaquin de Olmedo International Airport (Guayaquil, Ecuador) — CSV verified
  SEGU: [
    feed("SEGU", "approach", "App/Dep/Info", "", "segu1_app"),
    feed("SEGU", "center", "Guayaquil Center", "", "segu1_acc"),
    feed("SEGU", "combined", "Gnd/Twr", "", "segu1_gnd_twr"),
    feedN(
      "SEGU",
      "combined",
      "Gnd/Twr/App",
      "",
      "segu",
      "se",
    ),
  ],


  // -- El Salvador --
  // Ilopango International Airport (San Salvador, El Salvador) — CSV verified
  MSSS: [
    feed("MSSS", "combined", "Ground/Tower/Approach", "", "msss4"),
  ],


  // -- Peru --
  // Rodriguez Ballon International Airport (Arequipa, Peru) — CSV verified
  SPQU: [
    feed("SPQU", "combined", "Ground/Tower", "", "spqu2_gta"),
    feedN(
      "SPQU",
      "combined",
      "Misc",
      "",
      "spqu2_rdr",
      "2",
    ),
  ],

  // Alejandro Velasco Astete International Airport (Cusco, Peru) — CSV verified
  SPZO: [
    feed("SPZO", "tower", "Tower", "", "spzo2_twr"),
    feed("SPZO", "ground", "Ground", "", "spzo2_gnd"),
    feed("SPZO", "combined", "Misc", "", "spzo2_misc"),
  ],

  // Jorge Chavez International Airport (Lima, Peru) — CSV verified
  SPJC: [
    feed("SPJC", "tower", "Tower", "", "spjc1_twr"),
    feed("SPJC", "ground", "Ground", "", "spjc1_gnd"),
    feed("SPJC", "approach", "Approach", "", "spjc1_app"),
  ],

  // Capitan FAP Renan Elias Olivera Airport (Pisco, Peru) — CSV verified
  SPSO: [
    feed("SPSO", "tower", "Tower", "", "spso2_twr"),
    feed("SPSO", "ground", "Ground", "", "spso2_gnd"),
    feed("SPSO", "combined", "Misc", "", "spso2_misc"),
  ],

  // Cadete FAP Guillermo del Castillo Paredes Airport (Tarapoto, Peru) — CSV verified
  SPST: [
    feed("SPST", "tower", "Tower", "", "spst2"),
  ],


  // -- Suriname --
  // Zorg en Hoop Airport (Paramaribo, Suriname) — CSV verified
  SMZO: [
    feed("SMZO", "tower", "Tower", "", "smzo2"),
  ],


  // -- Trinidad and Tobago --
  // Piarco International Airport (Port of Spain, Trinidad and Tobago) — CSV verified
  TTPP: [
    feed("TTPP", "approach", "Approach/Center", "", "ttpp_app"),
    feed("TTPP", "combined", "Ground/Tower", "", "ttpp_twr"),
  ],

  // A. N. R. Robinson International Airport (Scarborough, Trinidad and Tobago) — CSV verified
  TTCP: [
    feed("TTCP", "combined", "Gnd/Twr/App", "", "ttcp2"),
  ],


  // -- Uruguay --
  // Santa Bernardina International Airport (Durazno, Uruguay) — CSV verified
  SUDU: [
    feed("SUDU", "combined", "Twr/App/FIR", "", "sudu1_twr_app"),
  ],

  // Carrasco General Cesareo L. Berisso International Airport (Montevideo, Uruguay) — CSV verified
  SUMU: [
    feed("SUMU", "tower", "Twr/Info", "", "sumu_twr_info"),
    feed("SUMU", "approach", "App/Dep", "", "sumu_app_ctr"),
    feed("SUMU", "center", "Montevideo Control (Antena Este)", "", "sumu3_ctl"),
  ],

  // Paysandu Airport (Paysandu, Uruguay) — CSV verified
  SUPU: [
    feed("SUPU", "center", "AFIS", "", "supu1_afis"),
  ],

  // Capitan Corbeta C A Curbelo International Airport (Punta del Este, Uruguay) — CSV verified
  SULS: [
    feed("SULS", "tower", "Tower", "", "suls2_twr"),
  ],

  // Nueva Hesperides International Airport (Salto, Uruguay) — CSV verified
  SUSO: [
    feed("SUSO", "combined", "Tower/Ramp", "", "suso1"),
  ],


  // -- Venezuela --
  // Manuel Carlos Piar Guayana Airport (Ciudad Guayana, Venezuela) — CSV verified
  SVPR: [
    feed("SVPR", "combined", "Twr/App/FIR", "", "svpr2"),
  ],


  // ── Africa (additional) ────────────────────────────────────────


  // -- Ethiopia --
  // Bole International Airport (Addis Ababa, Ethiopia) — CSV verified
  HAAB: [
    feed("HAAB", "tower", "Tower", "", "haab2_twr"),
    feed("HAAB", "approach", "Approach", "", "haab2_app"),
  ],


  // -- Madagascar --
  // Ivato International Airport (Antananarivo, Madagascar) — CSV verified
  FMMI: [
    feed("FMMI", "combined", "Twr/App/Center", "", "fmmi"),
  ],


  // -- Reunion --
  // Rolland Garros Airport (Sainte-Marie, Reunion) — CSV verified
  FMEE: [
    feed("FMEE", "approach", "Approach/Departure", "", "fmee3"),
  ],


  // -- Zambia --
  // Kenneth Kaunda International Airport (Lusaka, Zambia) — CSV verified
  FLKK: [
    feed("FLKK", "combined", "Twr/App", "", "flkk2"),
  ],

};

/**
 * Set of all valid mount points for SSRF prevention.
 * Only mount points in this set can be proxied.
 */
export const VALID_MOUNT_POINTS: ReadonlySet<string> = new Set(
  Object.values(ATC_FEEDS)
    .flat()
    .map((f) => f.mountPoint),
);

/**
 * Get feeds for a specific ICAO code.
 */
export function getFeedsByIcao(icao: string): AtcFeed[] {
  return ATC_FEEDS[icao.toUpperCase()] ?? [];
}

/**
 * Get all ICAO codes that have ATC feeds.
 */
export function getIcaoCodesWithFeeds(): string[] {
  return Object.keys(ATC_FEEDS);
}
