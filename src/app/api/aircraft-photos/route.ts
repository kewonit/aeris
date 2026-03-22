import { NextRequest, NextResponse } from "next/server";

const FETCH_TIMEOUT_MS = 8_000;
const AIRPORT_DATA_TIMEOUT_MS = 5_000;
const JETAPI_TIMEOUT_MS = 10_000;
const HEX_REGEX = /^[0-9a-f]{6}$/;
const REG_REGEX = /^[A-Z0-9][-A-Z0-9]{1,6}$/;

// ── Upstream types ──────────────────────────────────────────────────────────

type PlanespottersPhoto = {
  id?: string;
  thumbnail?:
    | { src?: string; size?: { width?: number; height?: number } }
    | string;
  thumbnail_large?:
    | { src?: string; size?: { width?: number; height?: number } }
    | string;
  link?: string;
  photographer?: string;
};

type PlanespottersResponse = {
  photos?: PlanespottersPhoto[];
};

type AdsbdbAircraft = {
  type?: string;
  icao_type?: string;
  manufacturer?: string;
  mode_s?: string;
  registration?: string;
  registered_owner_country_iso_name?: string;
  registered_owner_country_name?: string;
  registered_owner_operator_flag_code?: string;
  registered_owner?: string;
  url_photo?: string | null;
  url_photo_thumbnail?: string | null;
};

type AdsbdbResponse = {
  response?: {
    aircraft?: AdsbdbAircraft | null;
  };
};

// ── Output types ────────────────────────────────────────────────────────────

type NormalizedPhoto = {
  id: string;
  url: string;
  thumbnail: string;
  photographer: string | null;
  location: string | null;
  dateTaken: string | null;
  link: string | null;
};

type AircraftDetails = {
  registration: string;
  manufacturer: string | null;
  type: string | null;
  typeCode: string | null;
  owner: string | null;
};

type AircraftPhotosResponse = {
  photos: NormalizedPhoto[];
  aircraft: AircraftDetails | null;
};

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Extract a URL from a value that may be a string or `{ src: string }`. */
function extractSrc(value: unknown): string | null {
  if (typeof value === "string" && value.length > 0) return value;
  if (
    typeof value === "object" &&
    value !== null &&
    "src" in value &&
    typeof (value as { src: unknown }).src === "string"
  ) {
    const src = (value as { src: string }).src;
    return src.length > 0 ? src : null;
  }
  return null;
}

async function fetchWithTimeout(
  url: string,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
  } finally {
    clearTimeout(timer);
  }
}

/** Reject URLs with dangerous schemes (javascript:, data:, vbscript:, etc.).
 *  Only https:// and http:// are allowed. */
function isSafeHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

/** Strip unsafe URLs from a normalized photo. Returns null if
 *  the primary url is unsafe (photo is unusable without an image). */
function sanitizePhoto(photo: NormalizedPhoto): NormalizedPhoto | null {
  if (!isSafeHttpUrl(photo.url)) return null;
  return {
    ...photo,
    thumbnail: isSafeHttpUrl(photo.thumbnail) ? photo.thumbnail : photo.url,
    link: photo.link && isSafeHttpUrl(photo.link) ? photo.link : null,
  };
}

// ── Planespotters.net ───────────────────────────────────────────────────────

async function fetchPlanespotters(hex: string): Promise<NormalizedPhoto[]> {
  try {
    const res = await fetchWithTimeout(
      `https://api.planespotters.net/pub/photos/hex/${encodeURIComponent(hex)}`,
      FETCH_TIMEOUT_MS,
    );
    if (!res.ok) return [];

    const data = (await res.json()) as PlanespottersResponse;
    if (!data?.photos || !Array.isArray(data.photos)) return [];

    const photos: NormalizedPhoto[] = [];
    const seenUrls = new Set<string>();

    for (const p of data.photos) {
      const largeSrc = extractSrc(p.thumbnail_large);
      const thumbSrc = extractSrc(p.thumbnail);
      const src = largeSrc ?? thumbSrc;
      if (!src) continue;

      const fullUrl = largeSrc ?? thumbSrc ?? src;
      if (seenUrls.has(fullUrl)) continue;
      seenUrls.add(fullUrl);

      photos.push({
        id: `ps-${typeof p.id === "string" || typeof p.id === "number" ? p.id : photos.length}`,
        url: fullUrl,
        thumbnail: thumbSrc ?? largeSrc ?? src,
        photographer:
          typeof p.photographer === "string" && p.photographer
            ? p.photographer
            : null,
        location: null,
        dateTaken: null,
        link: typeof p.link === "string" && p.link ? p.link : null,
      });
    }

    return photos;
  } catch {
    return [];
  }
}

// ── adsbdb.com ──────────────────────────────────────────────────────────────

async function fetchAdsbdb(hex: string): Promise<{
  aircraft: AircraftDetails | null;
  photo: NormalizedPhoto | null;
}> {
  try {
    const res = await fetchWithTimeout(
      `https://api.adsbdb.com/v0/aircraft/${encodeURIComponent(hex)}`,
      FETCH_TIMEOUT_MS,
    );
    if (!res.ok) return { aircraft: null, photo: null };

    const data = (await res.json()) as AdsbdbResponse;
    const ac = data?.response?.aircraft;
    if (!ac) return { aircraft: null, photo: null };

    const registration =
      typeof ac.registration === "string" && ac.registration
        ? ac.registration
        : null;
    if (!registration) return { aircraft: null, photo: null };

    const aircraft: AircraftDetails = {
      registration,
      manufacturer:
        typeof ac.manufacturer === "string" && ac.manufacturer
          ? ac.manufacturer
          : null,
      type: typeof ac.type === "string" && ac.type ? ac.type : null,
      typeCode:
        typeof ac.icao_type === "string" && ac.icao_type ? ac.icao_type : null,
      owner:
        typeof ac.registered_owner === "string" && ac.registered_owner
          ? ac.registered_owner
          : null,
    };

    let photo: NormalizedPhoto | null = null;
    if (typeof ac.url_photo === "string" && ac.url_photo) {
      photo = {
        id: `adb-${hex}`,
        url: ac.url_photo,
        thumbnail:
          typeof ac.url_photo_thumbnail === "string" && ac.url_photo_thumbnail
            ? ac.url_photo_thumbnail
            : ac.url_photo,
        photographer: null,
        location: null,
        dateTaken: null,
        link: null,
      };
    }

    return { aircraft, photo };
  } catch {
    return { aircraft: null, photo: null };
  }
}

// ── airport-data.com (additional photos) ────────────────────────────────────

type AirportDataEntry = {
  image?: string;
  thumbnail?: string;
  link?: string;
  photographer?: string;
};

async function fetchAirportData(hex: string): Promise<NormalizedPhoto[]> {
  try {
    const res = await fetchWithTimeout(
      `https://www.airport-data.com/api/ac_thumb.json?m=${encodeURIComponent(hex)}&n=5`,
      AIRPORT_DATA_TIMEOUT_MS,
    );
    if (!res.ok) return [];

    const raw = (await res.json()) as Record<string, unknown>;
    if (!raw || typeof raw !== "object") return [];

    // airport-data.com may return `data` as an array or a single object
    let entries: AirportDataEntry[] = [];
    if (Array.isArray(raw.data)) {
      entries = raw.data as AirportDataEntry[];
    } else if (raw.data && typeof raw.data === "object") {
      entries = [raw.data as AirportDataEntry];
    } else if (typeof raw.image === "string") {
      entries = [raw as unknown as AirportDataEntry];
    }

    if (entries.length === 0) return [];

    const photos: NormalizedPhoto[] = [];
    const seenUrls = new Set<string>();

    for (const entry of entries) {
      const imageUrl =
        typeof entry.image === "string" && entry.image ? entry.image : null;
      if (!imageUrl) continue;
      if (seenUrls.has(imageUrl)) continue;
      seenUrls.add(imageUrl);

      photos.push({
        id: `apd-${photos.length}-${hex}`,
        url: imageUrl,
        thumbnail:
          typeof entry.thumbnail === "string" && entry.thumbnail
            ? entry.thumbnail
            : imageUrl,
        photographer:
          typeof entry.photographer === "string" && entry.photographer
            ? entry.photographer
            : null,
        location: null,
        dateTaken: null,
        link: typeof entry.link === "string" && entry.link ? entry.link : null,
      });
    }

    return photos;
  } catch {
    return [];
  }
}

// ── JetAPI (JetPhotos via jetapi.dev) ────────────────────────────────────────

type JetApiImage = {
  Image?: string;
  Link?: string;
  Thumbnail?: string;
  DateTaken?: string;
  DateUploaded?: string;
  Location?: string;
  Photographer?: string;
  Aircraft?: string;
  Serial?: string;
  Airline?: string;
};

type JetApiResponse = {
  JetPhotos?: {
    Reg?: string;
    Images?: JetApiImage[];
  };
};

async function fetchJetApi(reg: string): Promise<NormalizedPhoto[]> {
  try {
    const res = await fetchWithTimeout(
      `https://www.jetapi.dev/api?reg=${encodeURIComponent(reg)}&photos=10&only_jp=true`,
      JETAPI_TIMEOUT_MS,
    );
    if (!res.ok) return [];

    const data = (await res.json()) as JetApiResponse;
    const images = data?.JetPhotos?.Images;
    if (!images || !Array.isArray(images)) return [];

    const photos: NormalizedPhoto[] = [];
    const seenUrls = new Set<string>();

    for (const img of images) {
      const imageUrl =
        typeof img.Image === "string" && img.Image ? img.Image : null;
      if (!imageUrl) continue;
      if (seenUrls.has(imageUrl)) continue;
      seenUrls.add(imageUrl);

      photos.push({
        id: `jp-${photos.length}`,
        url: imageUrl,
        thumbnail:
          typeof img.Thumbnail === "string" && img.Thumbnail
            ? img.Thumbnail
            : imageUrl,
        photographer:
          typeof img.Photographer === "string" && img.Photographer
            ? img.Photographer.trim()
            : null,
        location:
          typeof img.Location === "string" && img.Location
            ? img.Location.trim()
            : null,
        dateTaken:
          typeof img.DateTaken === "string" && img.DateTaken
            ? img.DateTaken.trim()
            : null,
        link: typeof img.Link === "string" && img.Link ? img.Link : null,
      });
    }

    return photos;
  } catch {
    return [];
  }
}

// ── Route handler ───────────────────────────────────────────────────────────

export async function GET(request: NextRequest): Promise<NextResponse> {
  const hex = request.nextUrl.searchParams.get("hex")?.trim().toLowerCase();
  const reg =
    request.nextUrl.searchParams.get("reg")?.trim().toUpperCase() || null;

  if (!hex || !HEX_REGEX.test(hex)) {
    return NextResponse.json(
      { error: "Missing or invalid 'hex' parameter (6-char ICAO24 hex)" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  // Validate registration — skip JetAPI if invalid
  const validReg = reg && REG_REGEX.test(reg) ? reg : null;

  const [psResult, adbResult, apdResult, jpResult] = await Promise.allSettled([
    fetchPlanespotters(hex),
    fetchAdsbdb(hex),
    fetchAirportData(hex),
    validReg ? fetchJetApi(validReg) : Promise.resolve([] as NormalizedPhoto[]),
  ]);

  const planespottersPhotos =
    psResult.status === "fulfilled" ? psResult.value : [];
  const adsbdb =
    adbResult.status === "fulfilled"
      ? adbResult.value
      : { aircraft: null, photo: null };
  const airportDataPhotos =
    apdResult.status === "fulfilled" ? apdResult.value : [];
  const jetApiPhotos = jpResult.status === "fulfilled" ? jpResult.value : [];

  // Priority: JetAPI (full-res, multiple) → adsbdb (full-res) →
  // airport-data (full-res) → planespotters (low-res fallback).
  // All photos are sanitized to strip dangerous URI schemes (XSS).
  const seenUrls = new Set<string>();
  const photos: NormalizedPhoto[] = [];

  function addPhoto(raw: NormalizedPhoto) {
    if (seenUrls.has(raw.url)) return;
    const safe = sanitizePhoto(raw);
    if (!safe) return;
    seenUrls.add(safe.url);
    photos.push(safe);
  }

  for (const p of jetApiPhotos) addPhoto(p);
  if (adsbdb.photo) addPhoto(adsbdb.photo);
  for (const p of airportDataPhotos) addPhoto(p);
  for (const p of planespottersPhotos) addPhoto(p);

  const response: AircraftPhotosResponse = {
    photos,
    aircraft: adsbdb.aircraft,
  };

  return NextResponse.json(response, {
    status: 200,
    headers: {
      "Cache-Control":
        "public, max-age=1800, s-maxage=1800, stale-while-revalidate=3600",
    },
  });
}
