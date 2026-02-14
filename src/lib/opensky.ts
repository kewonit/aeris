/**
 * OpenSky Network — browser-side client
 *
 * Calls the REST API directly from the browser (CORS is supported)
 * so requests come from the user's IP, not a cloud provider IP that
 * OpenSky may block.
 *
 * Anonymous limits: 400 credits / day, 10 s resolution.
 * Authenticated (OAuth2): 4 000 credits / day, 5 s resolution.
 *
 * @see https://openskynetwork.github.io/opensky-api/rest.html
 */

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

/**
 * Fetch flights directly from the OpenSky REST API (browser-side).
 *
 * Because the request originates from the user's browser, it uses the
 * user's residential/mobile IP — not a cloud-provider IP that OpenSky
 * blocks.  CORS is supported (`Access-Control-Allow-Origin: *`).
 *
 * Custom response headers (X-Rate-Limit-Remaining) are not accessible
 * via CORS unless the server exposes them, so we detect rate-limits
 * from HTTP 429 status or network errors instead.
 */
export async function fetchFlightsByBbox(
  lamin: number,
  lamax: number,
  lomin: number,
  lomax: number,
  signal?: AbortSignal,
): Promise<FetchResult> {
  const url = `${OPENSKY_API}/states/all?lamin=${lamin}&lamax=${lamax}&lomin=${lomin}&lomax=${lomax}`;

  // Create a timeout that works alongside any caller-provided signal
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  // If the caller aborts, abort our controller too
  const onExternalAbort = () => controller.abort();
  signal?.addEventListener("abort", onExternalAbort);

  try {
    const res = await fetch(url, {
      cache: "no-store",
      signal: controller.signal,
    });

    if (res.status === 429) {
      console.warn("[aeris] OpenSky rate limit hit (429), backing off");
      return { flights: [], rateLimited: true, creditsRemaining: null };
    }

    if (!res.ok) {
      console.warn(`[aeris] OpenSky returned ${res.status}`);
      return { flights: [], rateLimited: false, creditsRemaining: null };
    }

    const data: OpenSkyResponse = await res.json();

    // Try reading credits header (may be null due to CORS restrictions)
    const creditsRaw = res.headers.get("x-rate-limit-remaining");
    const creditsRemaining =
      creditsRaw !== null ? parseInt(creditsRaw, 10) : null;

    const flights = parseStates(data);
    return {
      flights,
      rateLimited: false,
      creditsRemaining: Number.isNaN(creditsRemaining)
        ? null
        : creditsRemaining,
    };
  } catch (err) {
    // Re-throw abort errors so the hook can distinguish them
    if (err instanceof Error && err.name === "AbortError") {
      // If external signal triggered the abort, propagate it
      if (signal?.aborted) throw err;
      // Otherwise it was our timeout
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
