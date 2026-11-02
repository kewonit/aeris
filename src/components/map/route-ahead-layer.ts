import { LayerExtension } from "@deck.gl/core";
import { PathLayer } from "@deck.gl/layers";

import type { AltitudeDisplayMode } from "@/lib/altitude-display-mode";
import type { RoutePoint } from "@/lib/route-ahead";
import { aircraftElevationMeters } from "./altitude-projection";

/** Dash and gap, in multiples of the line's width. */
const DASH = 3;
const GAP = 2.5;
const WIDTH_PX = 2;

/**
 * Cuts a path into dashes. `geometry.uv.y` runs along each segment in
 * widths, so the pattern restarts at each joint, which on a densely
 * sampled great circle no one can see.
 */
class DashExtension extends LayerExtension {
  static extensionName = "RouteDashExtension";

  getShaders() {
    return {
      inject: {
        "fs:DECKGL_FILTER_COLOR": `
          if (mod(geometry.uv.y, ${(DASH + GAP).toFixed(1)}) > ${DASH.toFixed(1)}) discard;
        `,
      },
    };
  }
}

// One shared instance: a new one each frame would rebuild the shaders.
const DASHED = [new DashExtension()];

type RouteAheadDatum = { path: [number, number, number][] };

/**
 * The selected aircraft's way ahead, as a thin dashed line in the map's
 * neutral ink. It starts where the aircraft is drawn this frame and is
 * drawn at the same exaggerated heights, so it leaves the aircraft's nose.
 */
export function buildRouteAheadLayer(
  route: RoutePoint[],
  start: { lng: number; lat: number; altitudeMeters: number | null } | null,
  options: { altitudeDisplayMode: AltitudeDisplayMode; dark: boolean },
) {
  const points = start
    ? ([[start.lng, start.lat, start.altitudeMeters ?? 0], ...route.slice(1)] as RoutePoint[])
    : route;
  const data: RouteAheadDatum[] = [
    {
      path: points.map(([lng, lat, altitude]) => [
        lng,
        lat,
        aircraftElevationMeters(altitude, options.altitudeDisplayMode),
      ]),
    },
  ];
  return new PathLayer<RouteAheadDatum>({
    id: "route-ahead",
    data,
    getPath: (datum) => datum.path,
    getColor: options.dark ? [245, 245, 243, 150] : [18, 18, 20, 140],
    getWidth: WIDTH_PX,
    widthUnits: "pixels",
    billboard: true,
    capRounded: false,
    jointRounded: false,
    pickable: false,
    parameters: { depthWriteEnabled: false },
    extensions: DASHED,
  });
}
