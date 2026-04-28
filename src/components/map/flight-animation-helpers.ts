// Barrel re-export for backward compatibility.
// This file has been decomposed into focused modules:
//   - ./flight-math.ts          (lerpAngle, smoothStep, distance helpers)
//   - ./trail-base-path.ts      (trail building, smoothing, trimming)
//   - ./flight-interpolation.ts (interpolation, pitch, bank)

export {
  lerpAngle,
  smoothStep,
  horizontalDistanceFromLngLat,
  horizontalDistanceMeters,
} from "./flight-math";

export {
  buildStartupFallbackTrail,
  trimAfterLargeJump,
  smoothElevatedPath,
  smoothAnimationAltitudes,
  trimPathAheadOfAircraft,
  trailBasePathCacheKey,
  buildTrailBasePath,
  buildVisibleTrailPoints,
} from "./trail-base-path";

export {
  FLIGHT_RENDER_STALE_MS,
  MAX_FLIGHT_EXTRAPOLATION_MS,
  computePitchByIcao,
  computeBankByIcao,
  getSafeInterpolationProgress,
  computeInterpolatedFlights,
  updateInterpolatedInPlace,
} from "./flight-interpolation";
