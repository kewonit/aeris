import assert from "node:assert/strict";
import test from "node:test";

import type { FlightState } from "@/lib/opensky";

import { reportAgeSeconds, selectedHeading } from "./fpv-hud-format";

test("a selected heading of 0 counts only for an aircraft flying north", () => {
  assert.equal(selectedHeading({ navHeading: 270.4, trueTrack: 268 }), 270);
  assert.equal(selectedHeading({ navHeading: 0, trueTrack: 262 }), null);
  assert.equal(selectedHeading({ navHeading: 0, trueTrack: 355 }), 0);
  assert.equal(selectedHeading({ navHeading: 359.7, trueTrack: 5 }), 0);
  assert.equal(selectedHeading({ navHeading: null, trueTrack: 90 }), null);
});

test("a report's age runs from when its position was observed", () => {
  const provenance = {
    responseTime: 100_000,
    observationTime: null,
    positionAgeSeconds: 4,
  } as FlightState["provenance"];
  assert.equal(reportAgeSeconds(provenance, 126_000), 30);
  assert.equal(
    reportAgeSeconds({ ...provenance, observationTime: 120_000 }, 126_000),
    6,
  );
});
