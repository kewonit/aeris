type AirlineInfo = {
  name: string;
};

const ICAO_AIRLINES: Record<string, AirlineInfo> = {
  AAL: { name: "American Airlines" },
  AAR: { name: "Asiana Airlines" },
  ACA: { name: "Air Canada" },
  AEE: { name: "Aegean Airlines" },
  AFR: { name: "Air France" },
  AIC: { name: "Air India" },
  AIJ: { name: "Interjet" },
  AJT: { name: "Amerijet" },
  ALK: { name: "SriLankan Airlines" },
  AMX: { name: "Aeroméxico" },
  ANA: { name: "All Nippon Airways" },
  ANZ: { name: "Air New Zealand" },
  ASA: { name: "Alaska Airlines" },
  AUA: { name: "Austrian Airlines" },
  AVA: { name: "Avianca" },
  AWE: { name: "US Airways" },
  AZA: { name: "Alitalia / ITA Airways" },
  BAW: { name: "British Airways" },
  BEL: { name: "Brussels Airlines" },
  BER: { name: "Air Berlin" },
  CAL: { name: "China Airlines" },
  CCA: { name: "Air China" },
  CES: { name: "China Eastern" },
  CLH: { name: "Lufthansa CityLine" },
  CMP: { name: "Copa Airlines" },
  CPA: { name: "Cathay Pacific" },
  CSN: { name: "China Southern" },
  CTN: { name: "Croatia Airlines" },
  CXA: { name: "Xiamen Airlines" },
  DAL: { name: "Delta Air Lines" },
  DLH: { name: "Lufthansa" },
  EIN: { name: "Aer Lingus" },
  EJU: { name: "easyJet Europe" },
  ELY: { name: "El Al" },
  ETD: { name: "Etihad Airways" },
  ETH: { name: "Ethiopian Airlines" },
  EVA: { name: "EVA Air" },
  EWG: { name: "Eurowings" },
  EZY: { name: "easyJet" },
  FDX: { name: "FedEx Express" },
  FIN: { name: "Finnair" },
  FJI: { name: "Fiji Airways" },
  GAF: { name: "German Air Force" },
  GIA: { name: "Garuda Indonesia" },
  GTI: { name: "Atlas Air" },
  HAL: { name: "Hawaiian Airlines" },
  HVN: { name: "Vietnam Airlines" },
  IBE: { name: "Iberia" },
  IBK: { name: "Norwegian Air Int'l" },
  ICE: { name: "Icelandair" },
  JAL: { name: "Japan Airlines" },
  JBU: { name: "JetBlue" },
  JST: { name: "Jetstar" },
  KAL: { name: "Korean Air" },
  KLM: { name: "KLM" },
  LAN: { name: "LATAM Airlines" },
  LOT: { name: "LOT Polish Airlines" },
  MAU: { name: "Air Mauritius" },
  MAS: { name: "Malaysia Airlines" },
  MSR: { name: "EgyptAir" },
  NAX: { name: "Norwegian Air Shuttle" },
  NKS: { name: "Spirit Airlines" },
  PAL: { name: "Philippine Airlines" },
  PIA: { name: "Pakistan Int'l Airlines" },
  QFA: { name: "Qantas" },
  QTR: { name: "Qatar Airways" },
  RAM: { name: "Royal Air Maroc" },
  RJA: { name: "Royal Jordanian" },
  ROT: { name: "TAROM" },
  RYR: { name: "Ryanair" },
  SAS: { name: "Scandinavian Airlines" },
  SAA: { name: "South African Airways" },
  SIA: { name: "Singapore Airlines" },
  SKW: { name: "SkyWest Airlines" },
  SVA: { name: "Saudia" },
  SWA: { name: "Southwest Airlines" },
  SWR: { name: "Swiss Int'l Air Lines" },
  TAM: { name: "LATAM Brasil" },
  TAP: { name: "TAP Air Portugal" },
  THA: { name: "Thai Airways" },
  THY: { name: "Turkish Airlines" },
  TUI: { name: "TUI Airways" },
  TVF: { name: "Transavia France" },
  UAE: { name: "Emirates" },
  UAL: { name: "United Airlines" },
  UPS: { name: "UPS Airlines" },
  VIR: { name: "Virgin Atlantic" },
  VOZ: { name: "Virgin Australia" },
  VLG: { name: "Vueling" },
  WJA: { name: "WestJet" },
  WZZ: { name: "Wizz Air" },
};

export function lookupAirline(callsign: string | null): string | null {
  if (!callsign) return null;
  const trimmed = callsign.trim().toUpperCase();
  if (trimmed.length < 3) return null;
  const prefix = trimmed.slice(0, 3);
  return ICAO_AIRLINES[prefix]?.name ?? null;
}

export function parseFlightNumber(callsign: string | null): string | null {
  if (!callsign) return null;
  const trimmed = callsign.trim().toUpperCase();
  if (trimmed.length <= 3) return null;
  const digits = trimmed.slice(3).replace(/^0+/, "");
  if (!digits || !/^\d+[A-Z]?$/.test(digits)) return null;
  return digits;
}
