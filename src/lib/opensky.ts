/** @see https://openskynetwork.github.io/opensky-api/rest.html */

const OPENSKY_API = "https://opensky-network.org/api";
const FETCH_TIMEOUT_MS = 15_000;

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

type OpenSkyResponse = {
  time: number;
  states: (string | number | boolean | null)[][] | null;
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
  creditsRemaining: number | null;
};

const clamp = (v: number, lo: number, hi: number) =>
  Math.min(Math.max(v, lo), hi);

export async function fetchFlightsByBbox(
  lamin: number,
  lamax: number,
  lomin: number,
  lomax: number,
  signal?: AbortSignal,
): Promise<FetchResult> {
  const la0 = clamp(lamin, -90, 90);
  const la1 = clamp(lamax, -90, 90);
  const lo0 = clamp(lomin, -180, 180);
  const lo1 = clamp(lomax, -180, 180);

  const url = `${OPENSKY_API}/states/all?lamin=${la0}&lamax=${la1}&lomin=${lo0}&lomax=${lo1}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  const onExternalAbort = () => controller.abort();
  signal?.addEventListener("abort", onExternalAbort);

  try {
    const res = await fetch(url, {
      cache: "no-store",
      signal: controller.signal,
    });

    if (res.status === 429) {
      return { flights: [], rateLimited: true, creditsRemaining: null };
    }

    if (!res.ok) {
      return { flights: [], rateLimited: false, creditsRemaining: null };
    }

    const data: OpenSkyResponse = await res.json();
    const creditsRaw = res.headers.get("x-rate-limit-remaining");
    const creditsRemaining =
      creditsRaw !== null ? parseInt(creditsRaw, 10) : null;

    return {
      flights: parseStates(data),
      rateLimited: false,
      creditsRemaining: Number.isNaN(creditsRemaining)
        ? null
        : creditsRemaining,
    };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      if (signal?.aborted) throw err;
      throw new Error("OpenSky request timed out");
    }
    throw err;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onExternalAbort);
  }
}

export function bboxFromCenter(
  lng: number,
  lat: number,
  radiusDeg: number,
): [lamin: number, lamax: number, lomin: number, lomax: number] {
  return [lat - radiusDeg, lat + radiusDeg, lng - radiusDeg, lng + radiusDeg];
}
