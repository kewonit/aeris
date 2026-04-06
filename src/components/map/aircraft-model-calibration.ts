import {
  MODEL_KEY_WINGSPAN,
  modelDisplayScale,
  modelNormScale,
  modelYawOffset,
  resolveModelFileKey,
  type AircraftModelKey,
} from "./aircraft-model-mapping";
import { MODEL_MESH_METRICS } from "./model-mesh-metrics";

export type AircraftModelCalibration = {
  yawOffset: number;
  baseRoll: number;
  tailAnchorMeters: number;
  physicalReferenceMeters: number;
  meshMaxExtent: number;
  displayScale: number;
  effectiveScale: number;
};

const BASE_MODEL_ROLL = 90;

function tailAnchorForMeters(physicalReferenceMeters: number): number {
  return Math.max(10, Math.min(36, physicalReferenceMeters * 0.45));
}

export function getAircraftModelCalibration(
  key: AircraftModelKey,
): AircraftModelCalibration {
  const fileKey = resolveModelFileKey(key);
  const physicalReferenceMeters = MODEL_KEY_WINGSPAN[key];
  const meshMaxExtent = MODEL_MESH_METRICS[fileKey].maxExtent;
  const displayScale = modelDisplayScale(key);

  return {
    yawOffset: modelYawOffset(key),
    baseRoll: BASE_MODEL_ROLL,
    tailAnchorMeters: tailAnchorForMeters(physicalReferenceMeters),
    physicalReferenceMeters,
    meshMaxExtent,
    displayScale,
    effectiveScale: modelNormScale(key) * displayScale,
  };
}

export function getEffectiveModelScale(key: AircraftModelKey): number {
  return getAircraftModelCalibration(key).effectiveScale;
}