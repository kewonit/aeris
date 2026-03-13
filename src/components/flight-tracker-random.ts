import { AIRPORTS } from "@/lib/airports";
import { airportToCity } from "@/lib/airports";
import type { City } from "@/lib/cities";
import type { FlightState } from "@/lib/opensky";
import { DEFAULT_CITY } from "@/components/flight-tracker-utils";

const HIGH_TRAFFIC_IATA = [
  "ATL",
  "DXB",
  "LHR",
  "HND",
  "DFW",
  "DEN",
  "IST",
  "LAX",
  "CDG",
  "AMS",
  "FRA",
  "MAD",
  "JFK",
  "SIN",
  "ORD",
  "SFO",
  "MIA",
  "LAS",
  "MUC",
  "CLT",
] as const;

const HUB_PICK_PROBABILITY = 0.75;
const HIGH_TRAFFIC_IATA_SET = new Set<string>(HIGH_TRAFFIC_IATA);
const HIGH_TRAFFIC_AIRPORTS = AIRPORTS.filter((airport) =>
  HIGH_TRAFFIC_IATA_SET.has(airport.iata.toUpperCase()),
);

function chooseRandom<T>(items: readonly T[]): T | null {
  if (items.length === 0) return null;
  return items[Math.floor(Math.random() * items.length)] ?? null;
}

export function pickRandomAirportCity(excludeIata?: string): City {
  const exclude = excludeIata?.toUpperCase();
  const filteredHubs = exclude
    ? HIGH_TRAFFIC_AIRPORTS.filter(
        (airport) => airport.iata.toUpperCase() !== exclude,
      )
    : HIGH_TRAFFIC_AIRPORTS;

  const filteredAirports = exclude
    ? AIRPORTS.filter((airport) => airport.iata.toUpperCase() !== exclude)
    : AIRPORTS;

  const useHubs =
    filteredHubs.length > 0 && Math.random() < HUB_PICK_PROBABILITY;
  const source = useHubs ? filteredHubs : filteredAirports;
  const randomAirport = chooseRandom(source);
  if (!randomAirport) return DEFAULT_CITY;
  return airportToCity(randomAirport);
}

export function cityFromFlight(flight: FlightState): City | null {
  if (flight.longitude == null || flight.latitude == null) return null;
  const code = flight.icao24.toUpperCase();
  return {
    id: `trk-${flight.icao24}`,
    name: `Flight ${code}`,
    country: flight.originCountry || "Unknown",
    iata: code,
    coordinates: [flight.longitude, flight.latitude],
    radius: 2,
  };
}
