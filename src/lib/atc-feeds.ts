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
