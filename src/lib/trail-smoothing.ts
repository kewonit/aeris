/**
 * Trail smoothing utilities for historical flight tracks.
 *
 * This barrel re-exports from focused sub-modules:
 * - trail-spline.ts: Centripetal Catmull-Rom spline interpolation
 * - trail-altitude.ts: Altitude smoothing & ground-segment filtering
 * - trail-cleanup.ts: Downsampling, spike removal, corner rounding, loop removal
 */

export { catmullRomSpline3D, catmullRomRespline3D } from "./trail-spline";
export type { ElevatedPoint } from "./trail-spline";
export {
  smoothAltitudeProfile,
  filterGroundSegments,
  trimToLastDeparture,
} from "./trail-altitude";
export type { WaypointLike } from "./trail-altitude";
export {
  adaptiveDownsample,
  removeSpikePoints,
  removeDistanceOutliers,
  roundSharpCorners3D,
  roundSharpCorners2D,
  removePathLoops,
} from "./trail-cleanup";
