export type FlightState = {
  icao24: string;
  callsign: string | null;
  originCountry: string;
  longitude: number | null;
  latitude: number | null;
  baroAltitude: number | null;
  onGround: boolean;
  velocity: number | null;
  trueTrack: number | null;
  verticalRate: number | null;
  geoAltitude: number | null;
  squawk: string | null;
  spiFlag: boolean;
  positionSource: number;
};

export type OpenSkyResponse = {
  time: number;
  states: (string | number | boolean | null)[][] | null;
  rateLimited?: boolean;
};

function parseStates(raw: OpenSkyResponse): FlightState[] {
  if (!raw.states) return [];

  return raw.states
    .map((s) => ({
      icao24: s[0] as string,
      callsign: (s[1] as string)?.trim() || null,
      originCountry: s[2] as string,
      longitude: s[5] as number | null,
      latitude: s[6] as number | null,
      baroAltitude: s[7] as number | null,
      onGround: s[8] as boolean,
      velocity: s[9] as number | null,
      trueTrack: s[10] as number | null,
      verticalRate: s[11] as number | null,
      geoAltitude: s[13] as number | null,
      squawk: s[14] as string | null,
      spiFlag: s[15] as boolean,
      positionSource: s[16] as number,
    }))
    .filter(
      (f) =>
        f.longitude !== null &&
        f.latitude !== null &&
        !f.onGround &&
        f.baroAltitude !== null,
    );
}

export type FetchResult = {
  flights: FlightState[];
  rateLimited: boolean;
};

/** Fetch flights via the server-side proxy. */
export async function fetchFlightsByBbox(
  lamin: number,
  lamax: number,
  lomin: number,
  lomax: number,
  signal?: AbortSignal,
): Promise<FetchResult> {
  const url = `/api/flights?lamin=${lamin}&lamax=${lamax}&lomin=${lomin}&lomax=${lomax}`;

  const res = await fetch(url, { cache: "no-store", signal });

  if (!res.ok) {
    // Don't throw — let the hook retry gracefully
    console.warn(`[aeris] Flight API returned ${res.status}`);
    return { flights: [], rateLimited: false };
  }

  const data: OpenSkyResponse = await res.json();

  if (data.rateLimited) {
    console.warn("[aeris] OpenSky rate limit hit, backing off");
    return { flights: [], rateLimited: true };
  }

  const flights = parseStates(data);
  return { flights, rateLimited: false };
}

export function bboxFromCenter(
  lng: number,
  lat: number,
  radiusDeg: number,
): [lamin: number, lamax: number, lomin: number, lomax: number] {
  return [lat - radiusDeg, lat + radiusDeg, lng - radiusDeg, lng + radiusDeg];
}
