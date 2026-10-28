import type { Airport } from "./airports";
import type { City } from "./cities";

const DEFAULT_RADIUS = 2.5;

/**
 * An airport as a city the map can centre on. Kept apart from the airport
 * database so pages with their own short list of airports, like /atc, can use
 * it without shipping the whole database.
 */
export function airportToCity(
  airport: Pick<Airport, "iata" | "city" | "country" | "lat" | "lng">,
): City {
  return {
    id: airport.iata.toLowerCase(),
    name: airport.city,
    country: airport.country,
    iata: airport.iata,
    coordinates: [airport.lng, airport.lat],
    radius: DEFAULT_RADIUS,
  };
}
