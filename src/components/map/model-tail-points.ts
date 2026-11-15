// Written by tools/model-tails.ts from public/models/aircraft. Do not edit.

import type { AircraftModelKey } from "./aircraft-model-mapping";

/**
 * Where each model's tail cone ends, a little inside it, in the frame the
 * map draws the model in: how far behind its centre and how far above it,
 * as shares of its footprint, the larger of its wingspan and length.
 */
export const MODEL_TAIL_POINTS: Readonly<
  Record<AircraftModelKey, { back: number; up: number }>
> = {
  a380: { back: 0.417, up: -0.055 },
  b737: { back: 0.444, up: -0.063 },
  narrowbody: { back: 0.472, up: -0.041 },
  "widebody-2eng": { back: 0.451, up: -0.039 },
  "widebody-4eng": { back: 0.417, up: -0.055 },
  "regional-jet": { back: 0.421, up: -0.024 },
  "light-prop": { back: 0.333, up: 0.004 },
  turboprop: { back: 0.465, up: -0.037 },
  helicopter: { back: 0.489, up: 0.015 },
  bizjet: { back: 0.398, up: -0.037 },
  glider: { back: 0.236, up: -0.019 },
  fighter: { back: 0.416, up: 0.028 },
  drone: { back: 0.333, up: 0.004 },
  generic: { back: 0.472, up: -0.041 },
  a318: { back: 0.458, up: -0.045 },
  a319: { back: 0.488, up: -0.045 },
  a320: { back: 0.472, up: -0.04 },
  a321: { back: 0.49, up: -0.028 },
  a332: { back: 0.455, up: -0.022 },
  a333: { back: 0.469, up: -0.016 },
  a343: { back: 0.476, up: -0.024 },
  a346: { back: 0.464, up: -0.016 },
  a359: { back: 0.465, up: -0.031 },
  b738: { back: 0.456, up: -0.057 },
  b739: { back: 0.488, up: -0.06 },
  b744: { back: 0.456, up: -0.027 },
  b748: { back: 0.459, up: -0.026 },
  b752: { back: 0.479, up: -0.048 },
  b753: { back: 0.48, up: -0.041 },
  b762: { back: 0.453, up: -0.056 },
  b763: { back: 0.462, up: -0.051 },
  b764: { back: 0.49, up: -0.049 },
  b772: { back: 0.466, up: -0.038 },
  b773: { back: 0.469, up: -0.033 },
  b788: { back: 0.453, up: -0.043 },
  b789: { back: 0.466, up: -0.04 },
  e170: { back: 0.49, up: -0.041 },
  e190: { back: 0.49, up: -0.045 },
  crj700: { back: 0.412, up: -0.03 },
  crj900: { back: 0.421, up: -0.026 },
  cs100: { back: 0.49, up: -0.043 },
  cs300: { back: 0.49, up: -0.036 },
  q400: { back: 0.44, up: -0.033 },
  atr42: { back: 0.401, up: -0.048 },
  atr72: { back: 0.401, up: -0.048 },
  bae146: { back: 0.397, up: -0.04 },
  citation: { back: 0.396, up: -0.05 },
  pa28: { back: 0.302, up: -0.004 },
};
