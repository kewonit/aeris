export type City = {
  id: string;
  name: string;
  country: string;
  iata: string;
  coordinates: [longitude: number, latitude: number];
  radius: number;
};

export const CITIES: City[] = [
  {
    id: "nyc",
    name: "New York",
    country: "US",
    iata: "JFK",
    coordinates: [-73.7781, 40.6413],
    radius: 2.5,
  },
  {
    id: "lax",
    name: "Los Angeles",
    country: "US",
    iata: "LAX",
    coordinates: [-118.4085, 33.9416],
    radius: 2.5,
  },
  {
    id: "lhr",
    name: "London",
    country: "GB",
    iata: "LHR",
    coordinates: [-0.4614, 51.47],
    radius: 2.5,
  },
  {
    id: "dxb",
    name: "Dubai",
    country: "AE",
    iata: "DXB",
    coordinates: [55.3644, 25.2532],
    radius: 2.5,
  },
  {
    id: "nrt",
    name: "Tokyo",
    country: "JP",
    iata: "NRT",
    coordinates: [140.3929, 35.772],
    radius: 2.5,
  },
  {
    id: "sin",
    name: "Singapore",
    country: "SG",
    iata: "SIN",
    coordinates: [103.9915, 1.3644],
    radius: 2.5,
  },
  {
    id: "cdg",
    name: "Paris",
    country: "FR",
    iata: "CDG",
    coordinates: [2.5479, 49.0097],
    radius: 2.5,
  },
  {
    id: "sfo",
    name: "San Francisco",
    country: "US",
    iata: "SFO",
    coordinates: [-122.379, 37.6213],
    radius: 2.5,
  },
  {
    id: "ord",
    name: "Chicago",
    country: "US",
    iata: "ORD",
    coordinates: [-87.9073, 41.9742],
    radius: 2.5,
  },
  {
    id: "fra",
    name: "Frankfurt",
    country: "DE",
    iata: "FRA",
    coordinates: [8.5622, 50.0379],
    radius: 2.5,
  },
  {
    id: "bom",
    name: "Mumbai",
    country: "IN",
    iata: "BOM",
    coordinates: [72.8679, 19.0896],
    radius: 2.5,
  },
  {
    id: "mia",
    name: "Miami",
    country: "US",
    iata: "MIA",
    coordinates: [-80.2906, 25.7959],
    radius: 2.5,
  },
];
