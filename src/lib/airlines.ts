type AirlineInfo = {
  name: string;
  callsignPrefix: string;
};

const ICAO_AIRLINES: Record<string, AirlineInfo> = {
  AAL: { name: "American Airlines", callsignPrefix: "AAL" },
  AAR: { name: "Asiana Airlines", callsignPrefix: "AAR" },
  ACA: { name: "Air Canada", callsignPrefix: "ACA" },
  AEE: { name: "Aegean Airlines", callsignPrefix: "AEE" },
  AFR: { name: "Air France", callsignPrefix: "AFR" },
  AIC: { name: "Air India", callsignPrefix: "AIC" },
  AIJ: { name: "Interjet", callsignPrefix: "AIJ" },
  AJT: { name: "Amerijet", callsignPrefix: "AJT" },
  ALK: { name: "SriLankan Airlines", callsignPrefix: "ALK" },
  AMX: { name: "Aeroméxico", callsignPrefix: "AMX" },
  ANA: { name: "All Nippon Airways", callsignPrefix: "ANA" },
  ANZ: { name: "Air New Zealand", callsignPrefix: "ANZ" },
  ASA: { name: "Alaska Airlines", callsignPrefix: "ASA" },
  AUA: { name: "Austrian Airlines", callsignPrefix: "AUA" },
  AVA: { name: "Avianca", callsignPrefix: "AVA" },
  AWE: { name: "US Airways", callsignPrefix: "AWE" },
  AZA: { name: "Alitalia / ITA Airways", callsignPrefix: "AZA" },
  BAW: { name: "British Airways", callsignPrefix: "BAW" },
  BEL: { name: "Brussels Airlines", callsignPrefix: "BEL" },
  BER: { name: "Air Berlin", callsignPrefix: "BER" },
  CAL: { name: "China Airlines", callsignPrefix: "CAL" },
  CCA: { name: "Air China", callsignPrefix: "CCA" },
  CES: { name: "China Eastern", callsignPrefix: "CES" },
  CLH: { name: "Lufthansa CityLine", callsignPrefix: "CLH" },
  CMP: { name: "Copa Airlines", callsignPrefix: "CMP" },
  CPA: { name: "Cathay Pacific", callsignPrefix: "CPA" },
  CSN: { name: "China Southern", callsignPrefix: "CSN" },
  CTN: { name: "Croatia Airlines", callsignPrefix: "CTN" },
  CXA: { name: "Xiamen Airlines", callsignPrefix: "CXA" },
  DAL: { name: "Delta Air Lines", callsignPrefix: "DAL" },
  DLH: { name: "Lufthansa", callsignPrefix: "DLH" },
  EIN: { name: "Aer Lingus", callsignPrefix: "EIN" },
  EJU: { name: "easyJet Europe", callsignPrefix: "EJU" },
  ELY: { name: "El Al", callsignPrefix: "ELY" },
  ETD: { name: "Etihad Airways", callsignPrefix: "ETD" },
  ETH: { name: "Ethiopian Airlines", callsignPrefix: "ETH" },
  EVA: { name: "EVA Air", callsignPrefix: "EVA" },
  EWG: { name: "Eurowings", callsignPrefix: "EWG" },
  EZY: { name: "easyJet", callsignPrefix: "EZY" },
  FDX: { name: "FedEx Express", callsignPrefix: "FDX" },
  FIN: { name: "Finnair", callsignPrefix: "FIN" },
  FJI: { name: "Fiji Airways", callsignPrefix: "FJI" },
  GAF: { name: "German Air Force", callsignPrefix: "GAF" },
  GIA: { name: "Garuda Indonesia", callsignPrefix: "GIA" },
  GTI: { name: "Atlas Air", callsignPrefix: "GTI" },
  HAL: { name: "Hawaiian Airlines", callsignPrefix: "HAL" },
  HVN: { name: "Vietnam Airlines", callsignPrefix: "HVN" },
  IBE: { name: "Iberia", callsignPrefix: "IBE" },
  IBK: { name: "Norwegian Air Int'l", callsignPrefix: "IBK" },
  ICE: { name: "Icelandair", callsignPrefix: "ICE" },
  JAL: { name: "Japan Airlines", callsignPrefix: "JAL" },
  JBU: { name: "JetBlue", callsignPrefix: "JBU" },
  JST: { name: "Jetstar", callsignPrefix: "JST" },
  KAL: { name: "Korean Air", callsignPrefix: "KAL" },
  KLM: { name: "KLM", callsignPrefix: "KLM" },
  LAN: { name: "LATAM Airlines", callsignPrefix: "LAN" },
  LOT: { name: "LOT Polish Airlines", callsignPrefix: "LOT" },
  MAU: { name: "Air Mauritius", callsignPrefix: "MAU" },
  MAS: { name: "Malaysia Airlines", callsignPrefix: "MAS" },
  MSR: { name: "EgyptAir", callsignPrefix: "MSR" },
  NAX: { name: "Norwegian Air Shuttle", callsignPrefix: "NAX" },
  NKS: { name: "Spirit Airlines", callsignPrefix: "NKS" },
  PAL: { name: "Philippine Airlines", callsignPrefix: "PAL" },
  PIA: { name: "Pakistan Int'l Airlines", callsignPrefix: "PIA" },
  QFA: { name: "Qantas", callsignPrefix: "QFA" },
  QTR: { name: "Qatar Airways", callsignPrefix: "QTR" },
  RAM: { name: "Royal Air Maroc", callsignPrefix: "RAM" },
  RJA: { name: "Royal Jordanian", callsignPrefix: "RJA" },
  ROT: { name: "TAROM", callsignPrefix: "ROT" },
  RYR: { name: "Ryanair", callsignPrefix: "RYR" },
  SAS: { name: "Scandinavian Airlines", callsignPrefix: "SAS" },
  SAA: { name: "South African Airways", callsignPrefix: "SAA" },
  SIA: { name: "Singapore Airlines", callsignPrefix: "SIA" },
  SKW: { name: "SkyWest Airlines", callsignPrefix: "SKW" },
  SVA: { name: "Saudia", callsignPrefix: "SVA" },
  SWA: { name: "Southwest Airlines", callsignPrefix: "SWA" },
  SWR: { name: "Swiss Int'l Air Lines", callsignPrefix: "SWR" },
  TAM: { name: "LATAM Brasil", callsignPrefix: "TAM" },
  TAP: { name: "TAP Air Portugal", callsignPrefix: "TAP" },
  THA: { name: "Thai Airways", callsignPrefix: "THA" },
  THY: { name: "Turkish Airlines", callsignPrefix: "THY" },
  TUI: { name: "TUI Airways", callsignPrefix: "TUI" },
  TVF: { name: "Transavia France", callsignPrefix: "TVF" },
  UAE: { name: "Emirates", callsignPrefix: "UAE" },
  UAL: { name: "United Airlines", callsignPrefix: "UAL" },
  UPS: { name: "UPS Airlines", callsignPrefix: "UPS" },
  VIR: { name: "Virgin Atlantic", callsignPrefix: "VIR" },
  VOZ: { name: "Virgin Australia", callsignPrefix: "VOZ" },
  VLG: { name: "Vueling", callsignPrefix: "VLG" },
  WJA: { name: "WestJet", callsignPrefix: "WJA" },
  WZZ: { name: "Wizz Air", callsignPrefix: "WZZ" },
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
