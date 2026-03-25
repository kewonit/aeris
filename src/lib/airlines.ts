type AirlineInfo = {
  name: string;
  /** IATA 2-letter code for CDN logo fallback */
  iata?: string;
  /** Direct slug override → `/airline-logos/{logoSlug}.svg|.png` */
  logoSlug?: string;
};

const ICAO_AIRLINES: Record<string, AirlineInfo> = {
  // ── A ────────────────────────────────────────────────────────────────────
  AAL: { name: "American Airlines", iata: "AA" },
  AAR: { name: "Asiana Airlines", iata: "OZ" },
  AAY: { name: "Allegiant Air", iata: "G4" },
  ABD: { name: "Air Atlanta Icelandic", iata: "CC" },
  ABL: { name: "Air Busan", iata: "BX" },
  ABR: { name: "ASL Airlines Belgium", iata: "3V" },
  ABW: { name: "AirBridgeCargo Airlines", iata: "RU" },
  ABX: { name: "ABX Air", iata: "GB" },
  ABY: { name: "Air Arabia", iata: "G9" },
  ACA: { name: "Air Canada", iata: "AC" },
  ADH: { name: "Air One", iata: "AP" },
  ADO: { name: "Air Do", iata: "HD" },
  ADY: { name: "Abu Dhabi Aviation" },
  AEA: { name: "Air Europa", iata: "UX" },
  AEE: { name: "Aegean Airlines", iata: "A3" },
  AFG: { name: "Ariana Afghan Airlines", iata: "FG" },
  AFL: { name: "Aeroflot", iata: "SU" },
  AFR: { name: "Air France", iata: "AF" },
  AHK: { name: "Air Hong Kong", iata: "LD", logoSlug: "cathay-pacific" },
  AHY: { name: "Azerbaijan Airlines", iata: "J2" },
  AIC: { name: "Air India", iata: "AI" },
  AIJ: { name: "Interjet", iata: "4O" },
  AIQ: { name: "Thai AirAsia", iata: "FD", logoSlug: "airasia" },
  AIZ: { name: "Arkia Israeli Airlines", iata: "IZ" },
  AJT: { name: "Amerijet", iata: "M6" },
  AJX: { name: "Air Japan", iata: "NQ", logoSlug: "all-nippon-airways" },
  AKJ: { name: "Akasa Air", iata: "QP" },
  AKX: { name: "ANA Wings", iata: "EH", logoSlug: "all-nippon-airways" },
  ALK: { name: "SriLankan Airlines", iata: "UL" },
  AMC: { name: "Air Malta", iata: "KM" },
  AMF: { name: "Ameriflight", iata: "A8" },
  AMX: { name: "Aeroméxico", iata: "AM" },
  ANA: { name: "All Nippon Airways", iata: "NH" },
  ANE: { name: "Air Nostrum", iata: "YW" },
  ANG: { name: "Air Niugini", iata: "PX" },
  ANZ: { name: "Air New Zealand", iata: "NZ" },
  APJ: { name: "Peach Aviation", iata: "MM" },
  APK: { name: "Air Peace", iata: "P4" },
  ARG: { name: "Aerolíneas Argentinas", iata: "AR" },
  ART: { name: "SmartLynx Airlines", iata: "6Y" },
  ASA: { name: "Alaska Airlines", iata: "AS" },
  ASH: { name: "Mesa Airlines", iata: "YV", logoSlug: "american-airlines" },
  ASL: { name: "Air Serbia", iata: "JU" },
  ATC: { name: "Air Tanzania", iata: "TC" },
  ATN: { name: "Air Transport International", iata: "8C" },
  AUA: { name: "Austrian Airlines", iata: "OS" },
  AUI: { name: "Ukraine International Airlines", iata: "PS" },
  AUR: { name: "Aurigny Air Services", iata: "GR" },
  AVA: { name: "Avianca", iata: "AV" },
  AWC: { name: "Titan Airways", iata: "ZT" },
  AWE: { name: "US Airways", iata: "US" },
  AWQ: { name: "Indonesia AirAsia", iata: "QZ", logoSlug: "airasia" },
  AXB: { name: "Air India Express", iata: "IX" },
  AXM: { name: "AirAsia", iata: "AK", logoSlug: "airasia" },
  AZA: { name: "ITA Airways", iata: "AZ", logoSlug: "ita-airways" },
  AZQ: { name: "Silk Way West Airlines", iata: "7L" },
  AZU: { name: "Azul", iata: "AD" },

  // ── B ────────────────────────────────────────────────────────────────────
  BAV: { name: "Bamboo Airways", iata: "QH" },
  BAW: { name: "British Airways", iata: "BA" },
  BBC: { name: "Biman Bangladesh Airlines", iata: "BG" },
  BCS: { name: "European Air Transport Leipzig", iata: "QY", logoSlug: "dhl" },
  BDA: { name: "Blue Dart Aviation", iata: "BZ", logoSlug: "dhl" },
  BEE: { name: "Flybe", iata: "BE" },
  BEL: { name: "Brussels Airlines", iata: "SN" },
  BER: { name: "Air Berlin", iata: "AB" },
  BGA: { name: "Airbus Beluga Transport" },
  BKP: { name: "Bangkok Airways", iata: "PG" },
  BMS: { name: "Blue Air", iata: "0B" },
  BOV: { name: "Boliviana de Aviación", iata: "OB" },
  BOX: { name: "AeroLogic", iata: "3S", logoSlug: "dhl" },
  BRU: { name: "Belavia", iata: "B2" },
  BTI: { name: "Air Baltic", iata: "BT" },
  BTK: { name: "Batik Air", iata: "ID" },
  BWA: { name: "Caribbean Airlines", iata: "BW" },

  // ── C ────────────────────────────────────────────────────────────────────
  CAI: { name: "Corendon Airlines", iata: "XC" },
  CAL: { name: "China Airlines", iata: "CI" },
  CAO: { name: "Air China Cargo", iata: "CA", logoSlug: "air-china" },
  CBJ: { name: "Beijing Capital Airlines", iata: "JD" },
  CCA: { name: "Air China", iata: "CA" },
  CDG: { name: "Shandong Airlines", iata: "SC" },
  CEB: { name: "Cebu Pacific", iata: "5J" },
  CES: { name: "China Eastern", iata: "MU" },
  CFE: { name: "BA CityFlyer", iata: "CJ", logoSlug: "british-airways" },
  CFG: { name: "Condor", iata: "DE" },
  CHH: { name: "Hainan Airlines", iata: "HU" },
  CJT: { name: "Cargojet Airways", iata: "W8" },
  CKK: { name: "China Cargo Airlines", iata: "CK" },
  CKS: { name: "Kalitta Air", iata: "K4" },
  CLH: { name: "Lufthansa CityLine", iata: "CL", logoSlug: "lufthansa" },
  CLX: { name: "Cargolux", iata: "CV" },
  CLY: { name: "Clay Lacy Aviation" },
  CMP: { name: "Copa Airlines", iata: "CM" },
  CPA: { name: "Cathay Pacific", iata: "CX" },
  CQH: { name: "Spring Airlines", iata: "9C" },
  CRK: { name: "Hong Kong Airlines", iata: "HX" },
  CRN: { name: "Air Corsica", iata: "XK" },
  CSC: { name: "Sichuan Airlines", iata: "3U" },
  CSN: { name: "China Southern", iata: "CZ" },
  CSZ: { name: "Shenzhen Airlines", iata: "ZH" },
  CTN: { name: "Croatia Airlines", iata: "OU" },
  CTV: { name: "Citilink", iata: "QG" },
  CXA: { name: "Xiamen Airlines", iata: "MF" },
  CYP: { name: "Cyprus Airways", iata: "CY" },

  // ── D ────────────────────────────────────────────────────────────────────
  DAE: { name: "DHL Aero Expreso", iata: "D5", logoSlug: "dhl" },
  DAH: { name: "Air Algerie", iata: "AH" },
  DAL: { name: "Delta Air Lines", iata: "DL" },
  DAT: { name: "Brussels Airlines", iata: "SN", logoSlug: "brussels-airlines" },
  DHK: { name: "DHL Air UK", iata: "D0", logoSlug: "dhl" },
  DHX: { name: "DHL International", iata: "ES", logoSlug: "dhl" },
  DKH: { name: "Juneyao Airlines", iata: "HO" },
  DLA: { name: "Air Dolomiti", iata: "EN" },
  DLH: { name: "Lufthansa", iata: "LH" },
  DRK: { name: "Druk Air", iata: "KB" },
  DTA: { name: "TAAG Angola Airlines", iata: "DT" },

  // ── E ────────────────────────────────────────────────────────────────────
  EDV: { name: "Endeavor Air", iata: "9E", logoSlug: "delta-air-lines" },
  EDW: { name: "Edelweiss Air", iata: "WK" },
  EFW: { name: "BA EuroFlyer", logoSlug: "british-airways" },
  EIN: { name: "Aer Lingus", iata: "EI" },
  EJA: { name: "NetJets" },
  EJM: { name: "Executive Jet Management" },
  EJU: { name: "easyJet Europe", iata: "EC" },
  ELY: { name: "El Al", iata: "LY" },
  ENT: { name: "Enter Air", iata: "E4" },
  ENY: { name: "Envoy Air", iata: "MQ", logoSlug: "american-airlines" },
  ESR: { name: "Eastar Jet", iata: "ZE" },
  ETD: { name: "Etihad Airways", iata: "EY" },
  ETH: { name: "Ethiopian Airlines", iata: "ET" },
  EVA: { name: "EVA Air", iata: "BR" },
  EWG: { name: "Eurowings", iata: "EW" },
  EXS: { name: "Jet2", iata: "LS" },
  EZE: { name: "Eastern Airways", iata: "T3" },
  EZY: { name: "easyJet", iata: "U2" },

  // ── F ────────────────────────────────────────────────────────────────────
  FBU: { name: "French Bee", iata: "BF" },
  FDB: { name: "flydubai", iata: "FZ" },
  FDX: { name: "FedEx Express", iata: "FX" },
  FFM: { name: "Firefly", iata: "FY" },
  FFT: { name: "Frontier Airlines", iata: "F9" },
  FHY: { name: "Freebird Airlines", iata: "FH" },
  FIA: { name: "FlyOne", iata: "5F" },
  FIN: { name: "Finnair", iata: "AY" },
  FJI: { name: "Fiji Airways", iata: "FJ" },
  FLR: { name: "Flair Airlines", iata: "F8" },
  FPO: { name: "ASL Airlines France", iata: "5O" },
  FPY: { name: "PLAY", iata: "OG" },
  FUA: { name: "Fuji Dream Airlines", iata: "JH" },

  // ── G ────────────────────────────────────────────────────────────────────
  GAF: { name: "German Air Force" },
  GCR: { name: "Tianjin Airlines", iata: "GS" },
  GEC: { name: "Lufthansa Cargo", iata: "LH", logoSlug: "lufthansa" },
  GFA: { name: "Gulf Air", iata: "GF" },
  GIA: { name: "Garuda Indonesia", iata: "GA" },
  GJS: { name: "GoJet Airlines", logoSlug: "united-airlines" },
  GLO: { name: "GOL", iata: "G3" },
  GRL: { name: "Air Greenland", iata: "GL" },
  GTI: { name: "Atlas Air", iata: "5Y" },

  // ── H ────────────────────────────────────────────────────────────────────
  HAL: { name: "Hawaiian Airlines", iata: "HA" },
  HDA: { name: "Honda Jet" },
  HFY: { name: "Hi Fly", iata: "5K" },
  HKE: { name: "Hong Kong Express", iata: "UO" },
  HOP: { name: "HOP!", iata: "A5", logoSlug: "air-france" },
  HVN: { name: "Vietnam Airlines", iata: "VN" },
  HXA: { name: "China Express Airlines", iata: "G5" },

  // ── I ────────────────────────────────────────────────────────────────────
  IAW: { name: "Iraqi Airways", iata: "IA" },
  IBB: { name: "Binter Canarias", iata: "NT" },
  IBE: { name: "Iberia", iata: "IB" },
  IBK: { name: "Norwegian Air Int'l", iata: "D8", logoSlug: "norwegian" },
  IBS: { name: "Iberia Express", iata: "I2" },
  IBU: { name: "IndiGo", iata: "6E", logoSlug: "indigo" },
  ICE: { name: "Icelandair", iata: "FI" },
  ICV: { name: "Cargolux Italia", iata: "C8", logoSlug: "cargolux" },
  IGO: { name: "IndiGo", iata: "6E" },
  IRA: { name: "Iran Air", iata: "IR" },
  IRM: { name: "Mahan Air", iata: "W5" },
  ISS: { name: "Meridiana", iata: "IG" },
  IWD: { name: "Iberia Express", iata: "I2", logoSlug: "iberia-express" },

  // ── J ────────────────────────────────────────────────────────────────────
  JAC: { name: "Japan Air Commuter", iata: "3X", logoSlug: "japan-airlines" },
  JAF: { name: "TUI fly Belgium", iata: "TB", logoSlug: "tui-airways" },
  JAL: { name: "Japan Airlines", iata: "JL" },
  JBU: { name: "JetBlue", iata: "B6" },
  JIA: { name: "PSA Airlines", logoSlug: "american-airlines" },
  JJA: { name: "Jeju Air", iata: "7C" },
  JJP: { name: "Jetstar", iata: "GK" },
  JLJ: { name: "J-Air", iata: "XM", logoSlug: "japan-airlines" },
  JNA: { name: "Jin Air", iata: "LJ" },
  JSA: { name: "Jetstar Asia", iata: "3K", logoSlug: "jetstar" },
  JST: { name: "Jetstar", iata: "JQ" },
  JZA: { name: "Air Canada Jazz", iata: "QK" },

  // ── K ────────────────────────────────────────────────────────────────────
  KAC: { name: "Kuwait Airways", iata: "KU" },
  KAL: { name: "Korean Air", iata: "KE" },
  KAP: { name: "Cape Air", iata: "9K" },
  KFS: { name: "Kalitta Charters", iata: "K9" },
  KLM: { name: "KLM", iata: "KL" },
  KNE: { name: "flynas", iata: "XY" },
  KOR: { name: "Air Koryo", iata: "JS" },
  KQA: { name: "Kenya Airways", iata: "KQ" },
  KZR: { name: "Air Astana", iata: "KC" },

  // ── L ────────────────────────────────────────────────────────────────────
  LAM: { name: "LAM Mozambique", iata: "TM" },
  LAN: { name: "LATAM Airlines", iata: "LA" },
  LBT: { name: "Nouvelair", iata: "BJ" },
  LCO: { name: "LATAM Cargo Colombia", iata: "L7", logoSlug: "latam-airlines" },
  LDA: { name: "Lauda Europe", iata: "OE", logoSlug: "ryanair" },
  LGL: { name: "Luxair", iata: "LG" },
  LKE: { name: "Lucky Air", iata: "8L" },
  LNI: { name: "Lion Air", iata: "JT" },
  LOG: { name: "Loganair", iata: "LM" },
  LXJ: { name: "Flexjet" },
  LOT: { name: "LOT Polish Airlines", iata: "LO" },
  LPE: { name: "LATAM Perú", iata: "LP", logoSlug: "latam-airlines" },
  LZB: { name: "Bulgaria Air", iata: "FB" },

  // ── M ────────────────────────────────────────────────────────────────────
  MAS: { name: "Malaysia Airlines", iata: "MH" },
  MAU: { name: "Air Mauritius", iata: "MK" },
  MDA: { name: "Mandarin Airlines", iata: "AE" },
  MDG: { name: "Air Madagascar", iata: "MD" },
  MEA: { name: "Middle East Airlines", iata: "ME" },
  MGL: { name: "MIAT Mongolian Airlines", iata: "OM" },
  MMA: { name: "Myanmar Airways International", iata: "8M" },
  MNB: { name: "MNG Airlines", iata: "MB" },
  MPH: { name: "Martinair", iata: "MP", logoSlug: "klm" },
  MSR: { name: "EgyptAir", iata: "MS" },
  MXY: { name: "Breeze Airways", iata: "MX" },

  // ── N ────────────────────────────────────────────────────────────────────
  NAX: { name: "Norwegian Air Shuttle", iata: "DY" },
  NCA: { name: "Nippon Cargo Airlines", iata: "KZ" },
  NJE: { name: "NetJets Europe" },
  NKS: { name: "Spirit Airlines", iata: "NK" },
  NOK: { name: "Nok Air", iata: "DD" },
  NOZ: { name: "Norwegian Air Sweden", iata: "D8", logoSlug: "norwegian" },
  NPT: { name: "Neos", iata: "NO" },
  NSZ: { name: "Norwegian Air Sweden", iata: "D8", logoSlug: "norwegian" },
  NVD: { name: "Avion Express", iata: "X9" },
  NWS: { name: "Nordwind Airlines", iata: "N4" },

  // ── O ────────────────────────────────────────────────────────────────────
  OAE: { name: "Omni Air International", iata: "OY" },
  OAW: { name: "Helvetic Airways", iata: "2L" },
  OCN: { name: "Discover Airlines", iata: "4Y" },
  OKA: { name: "Okay Airways", iata: "BK" },
  OMA: { name: "Oman Air", iata: "WY" },
  OZW: { name: "SkyWest Airlines", logoSlug: "united-airlines" },

  // ── P ────────────────────────────────────────────────────────────────────
  PAC: { name: "Polar Air Cargo", iata: "PO" },
  PAL: { name: "Philippine Airlines", iata: "PR" },
  PBD: { name: "Pobeda", iata: "DP", logoSlug: "aeroflot" },
  PCG: { name: "Precision Air", iata: "PW" },
  PDT: { name: "Piedmont Airlines", logoSlug: "american-airlines" },
  PGT: { name: "Pegasus Airlines", iata: "PC" },
  PIA: { name: "Pakistan Int'l Airlines", iata: "PK" },
  POE: { name: "Porter Airlines", iata: "PD" },

  // ── Q ────────────────────────────────────────────────────────────────────
  QFA: { name: "Qantas", iata: "QF" },
  QTR: { name: "Qatar Airways", iata: "QR" },
  QXE: { name: "Horizon Air", iata: "QX", logoSlug: "alaska-airlines" },

  // ── R ────────────────────────────────────────────────────────────────────
  RAM: { name: "Royal Air Maroc", iata: "AT" },
  RBA: { name: "Royal Brunei Airlines", iata: "BI" },
  RJA: { name: "Royal Jordanian", iata: "RJ" },
  ROT: { name: "TAROM", iata: "RO" },
  ROU: { name: "Air Canada Rouge", iata: "RV", logoSlug: "air-canada" },
  RPA: { name: "Republic Airways", iata: "YX", logoSlug: "united-airlines" },
  RWD: { name: "RwandAir", iata: "WB" },
  RXA: { name: "Rex Airlines", iata: "ZL" },
  RUK: { name: "Ryanair UK", iata: "FR", logoSlug: "ryanair" },
  RYR: { name: "Ryanair", iata: "FR" },
  RZO: { name: "SCAT Airlines", iata: "DV" },

  // ── S ────────────────────────────────────────────────────────────────────
  SAA: { name: "South African Airways", iata: "SA" },
  SAS: { name: "Scandinavian Airlines", iata: "SK" },
  SBI: { name: "S7 Airlines", iata: "S7" },
  SCO: { name: "Scoot", iata: "TR" },
  SCX: { name: "Sun Country Airlines", iata: "SY" },
  SDM: { name: "Rossiya", iata: "FV" },
  SEH: { name: "Sky Express", iata: "GQ" },
  SEJ: { name: "SpiceJet", iata: "SG" },
  SEY: { name: "Air Seychelles", iata: "HM" },
  SFJ: { name: "Starflyer", iata: "7G" },
  SHT: { name: "British Airways", iata: "BA", logoSlug: "british-airways" },
  SHU: { name: "Aurora", iata: "HZ" },
  SIA: { name: "Singapore Airlines", iata: "SQ" },
  SJO: { name: "Spring Airlines Japan", iata: "IJ" },
  SJX: { name: "STARLUX Airlines", iata: "JX", logoSlug: "starlux-airlines" },
  SKU: { name: "Sky Airline", iata: "H2" },
  SKW: { name: "SkyWest Airlines", logoSlug: "united-airlines" },
  SKY: { name: "Skymark Airlines" },
  SLI: { name: "Aeroméxico Connect", iata: "5D", logoSlug: "aeromexico" },
  SNJ: { name: "Solaseed Air", iata: "6J" },
  SOL: { name: "Solomon Airlines", iata: "IE" },
  SQC: {
    name: "Singapore Airlines Cargo",
    iata: "SQ",
    logoSlug: "singapore-airlines",
  },
  SQP: { name: "SkyUp Airlines", iata: "PQ" },
  SRR: { name: "Star Air", iata: "S6" },
  SVA: { name: "Saudia", iata: "SV" },
  SVR: { name: "Ural Airlines", iata: "U6" },
  SWA: { name: "Southwest Airlines", iata: "WN" },
  SWG: { name: "Sunwing Airlines", iata: "WG" },
  SWR: { name: "Swiss Int'l Air Lines", iata: "LX" },
  SWT: { name: "Swiftair", iata: "WT" },
  SXS: { name: "SunExpress", iata: "XQ" },
  SZN: { name: "Air Senegal", iata: "HC" },

  // ── T ────────────────────────────────────────────────────────────────────
  TAM: { name: "LATAM Brasil", iata: "JJ", logoSlug: "latam-airlines" },
  TAP: { name: "TAP Air Portugal", iata: "TP" },
  TAR: { name: "Tunisair", iata: "TU" },
  TFL: { name: "TUI fly Netherlands", iata: "OR", logoSlug: "tui-airways" },
  TGW: { name: "Scoot", iata: "TR" },
  THA: { name: "Thai Airways", iata: "TG" },
  THY: { name: "Turkish Airlines", iata: "TK" },
  TOM: { name: "TUI Airways", iata: "BY", logoSlug: "tui-airways" },
  TRA: { name: "Transavia", iata: "HV" },
  TSC: { name: "Air Transat", iata: "TS" },
  TUA: { name: "Turkmenistan Airlines", iata: "T5" },
  TUI: { name: "TUI Airways", iata: "BY", logoSlug: "tui-airways" },
  TVF: { name: "Transavia France", iata: "TO" },
  TVS: { name: "SmartWings", iata: "QS" },
  TWB: { name: "Tway Airlines", iata: "TW" },
  TZP: { name: "ZIPAIR Tokyo", iata: "ZG", logoSlug: "zipair" },

  // ── U ────────────────────────────────────────────────────────────────────
  UAE: { name: "Emirates", iata: "EK" },
  UAL: { name: "United Airlines", iata: "UA" },
  UBA: { name: "Myanmar National Airlines", iata: "UB" },
  UBG: { name: "US-Bangla Airlines", iata: "BS" },
  UEA: { name: "Urumqi Air", iata: "UQ" },
  UPS: { name: "UPS Airlines", iata: "5X" },
  USA: { name: "US Airways", iata: "US" },
  UZB: { name: "Uzbekistan Airways", iata: "HY" },

  // ── V ────────────────────────────────────────────────────────────────────
  VDA: { name: "Volga-Dnepr Airlines", iata: "VI" },
  VIR: { name: "Virgin Atlantic", iata: "VS" },
  VIV: { name: "Viva Aerobus", iata: "VB" },
  VJC: { name: "VietJet Air", iata: "VJ" },
  VJT: { name: "VistaJet" },
  VKG: { name: "Sunclass Airlines", iata: "DK" },
  VLG: { name: "Vueling", iata: "VY" },
  VOE: { name: "Volotea", iata: "V7" },
  VOI: { name: "Volaris", iata: "Y4" },
  VOZ: { name: "Virgin Australia", iata: "VA" },

  // ── W ────────────────────────────────────────────────────────────────────
  WIF: { name: "Widerøe", iata: "WF" },
  WJA: { name: "WestJet", iata: "WS" },
  WMT: { name: "Wizz Air Malta", iata: "W4", logoSlug: "wizz-air" },
  WUK: { name: "Wizz Air UK", iata: "W9", logoSlug: "wizz-air" },
  WZZ: { name: "Wizz Air", iata: "W6" },

  // ── X ────────────────────────────────────────────────────────────────────
  XAX: { name: "AirAsia X", iata: "D7", logoSlug: "airasia" },
};

export function lookupAirline(callsign: string | null): string | null {
  if (!callsign) return null;
  const trimmed = callsign.trim().toUpperCase();
  if (trimmed.length < 3) return null;
  const prefix = trimmed.slice(0, 3);
  return ICAO_AIRLINES[prefix]?.name ?? null;
}

/** Direct logo slug override for the given callsign, if one is configured. */
export function lookupAirlineLogoSlug(callsign: string | null): string | null {
  if (!callsign) return null;
  const trimmed = callsign.trim().toUpperCase();
  if (trimmed.length < 3) return null;
  return ICAO_AIRLINES[trimmed.slice(0, 3)]?.logoSlug ?? null;
}

/** IATA code for CDN logo fallback. */
export function lookupAirlineIata(callsign: string | null): string | null {
  if (!callsign) return null;
  const trimmed = callsign.trim().toUpperCase();
  if (trimmed.length < 3) return null;
  return ICAO_AIRLINES[trimmed.slice(0, 3)]?.iata ?? null;
}

export function parseFlightNumber(callsign: string | null): string | null {
  if (!callsign) return null;
  const trimmed = callsign.trim().toUpperCase();
  if (trimmed.length <= 3) return null;
  const digits = trimmed.slice(3).replace(/^0+/, "");
  if (!digits || !/^\d+[A-Z]?$/.test(digits)) return null;
  return digits;
}
