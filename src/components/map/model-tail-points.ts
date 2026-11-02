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
  b737: { back: 0.431, up: 0.012 },
  narrowbody: { back: 0.472, up: -0.043 },
  "widebody-2eng": { back: 0.451, up: -0.039 },
  "widebody-4eng": { back: 0.417, up: -0.055 },
  "regional-jet": { back: 0.421, up: -0.024 },
  "light-prop": { back: 0.333, up: 0.004 },
  turboprop: { back: 0.465, up: -0.037 },
  helicopter: { back: 0.489, up: 0.016 },
  bizjet: { back: 0.398, up: -0.039 },
  glider: { back: 0.236, up: -0.019 },
  fighter: { back: 0.416, up: 0.03 },
  drone: { back: 0.333, up: 0.004 },
  generic: { back: 0.472, up: -0.043 },
};
