import { densifyGreatCircle2D, haversineDistanceRad, unwrapLngPath } from "@/lib/geo";

const EARTH_RADIUS_NM = 3_440.065;
/** A 3° approach loses about 97 m of height for every nautical mile. */
const GLIDE_METERS_PER_NM = 97;
/** Close enough points for the curve to look smooth at any zoom. */
const DENSIFY_DEG = 0.25;
const MAX_POINTS = 128;

export type RoutePoint = [lng: number, lat: number, altitudeMeters: number];

/**
 * The way an aircraft has left to fly: the great circle from where it is
 * to its destination, holding its height until a 3° descent would bring
 * it down at the runway. Heights are real; the map exaggerates them as it
 * does the aircraft.
 */
export function routeAheadPath(
  from: { lng: number; lat: number; altitudeMeters: number | null },
  to: { lng: number; lat: number },
): RoutePoint[] {
  const flat = unwrapLngPath(
    densifyGreatCircle2D(
      [
        [from.lng, from.lat],
        [to.lng, to.lat],
      ],
      DENSIFY_DEG,
      MAX_POINTS,
    ),
  );
  const cruise = Math.max(0, from.altitudeMeters ?? 0);
  return flat.map(([lng, lat]) => {
    const remainingNm =
      haversineDistanceRad(lng, lat, to.lng, to.lat) * EARTH_RADIUS_NM;
    return [lng, lat, Math.min(cruise, remainingNm * GLIDE_METERS_PER_NM)];
  });
}
