import { greatCircleIntermediate } from "@/lib/geo";

import {
  CONNECT_BRIDGE_DEG,
  HARD_DISCONNECT_BASE_DEG,
  LOW_ALTITUDE_THRESHOLD_M,
  MAX_GAP_HIGH_ALT_DEG,
  MAX_GAP_LOW_ALT_DEG,
  MODERATE_DISCONNECT_AGE_SEC,
  MODERATE_DISCONNECT_GAP_DEG,
  SNAP_JOIN_DEG,
  STALE_DISCONNECT_AGE_SEC,
  STALE_DISCONNECT_GAP_DEG,
  TRIM_AND_BRIDGE_DEG,
} from "../constants";
import type { TrailOutcome, TrailSegment, TrailSnapshot } from "../types";

const OVERLAP_SEARCH_WINDOW = 150;
const TAIL_JOIN_MAX_POINTS = 24;
const TAIL_SNAP_MAX_PATH_DEG = 0.35;
const TAIL_BRIDGE_MAX_PATH_DEG = CONNECT_BRIDGE_DEG;
const BRIDGE_MAX_STEPS = 36;
const BRIDGE_MIN_STEPS = 6;
const BRIDGE_STEP_SIZE_DEG = 0.12;
const DEFAULT_SPEED_MPS = 220;
const MIN_SPEED_MPS = 30;

export type MergeSegmentsResult = {
  historyBody: TrailSnapshot[];
  bridge: TrailSnapshot[];
  liveContinuation: TrailSnapshot[];
  samples: TrailSnapshot[];
  outcome: TrailOutcome;
};

function distanceSq(a: TrailSnapshot, b: TrailSnapshot): number {
  const dx = a.lng - b.lng;
  const dy = a.lat - b.lat;
  const result = dx * dx + dy * dy;
  return Number.isFinite(result) ? result : 0;
}

function bridgeAltitude(
  startAltitude: number | null,
  endAltitude: number | null,
  t: number,
): number | null {
  if (startAltitude == null && endAltitude == null) {
    return null;
  }

  const from = startAltitude ?? endAltitude ?? null;
  const to = endAltitude ?? startAltitude ?? null;
  if (from == null || to == null) {
    return null;
  }

  return from + (to - from) * t;
}

function buildBridge(
  start: TrailSnapshot,
  end: TrailSnapshot,
): TrailSnapshot[] {
  const gap = Math.sqrt(distanceSq(start, end));
  const steps = Math.max(
    BRIDGE_MIN_STEPS,
    Math.min(BRIDGE_MAX_STEPS, Math.ceil(gap / BRIDGE_STEP_SIZE_DEG)),
  );

  const bridge: TrailSnapshot[] = [];
  for (let step = 1; step < steps; step += 1) {
    const t = step / steps;
    const [lng, lat] = greatCircleIntermediate(
      start.lng,
      start.lat,
      end.lng,
      end.lat,
      t,
    );

    bridge.push({
      source: end.source,
      timestamp: Math.round(
        start.timestamp + (end.timestamp - start.timestamp) * t,
      ),
      lng,
      lat,
      altitude: bridgeAltitude(start.altitude, end.altitude, t),
      track: end.track ?? start.track,
      groundSpeed: end.groundSpeed ?? start.groundSpeed,
      quality: "interpolated-bridge",
      onGround: start.onGround && end.onGround,
    });
  }

  return bridge;
}

function trimAndSnapLiveTail(
  liveTail: TrailSnapshot[],
  join: TrailSnapshot,
): TrailSnapshot[] {
  if (liveTail.length === 0) {
    return [];
  }

  const [first, ...rest] = liveTail;
  return [
    {
      ...first,
      lng: join.lng,
      lat: join.lat,
      altitude: first.altitude ?? join.altitude,
    },
    ...rest,
  ];
}

function flattenHistorySegments(
  historySegments: TrailSegment[],
): TrailSnapshot[] {
  return historySegments.flatMap((segment) => segment.samples);
}

function trimSuspectLivePrefix(
  liveTail: TrailSnapshot[],
  hasUsableHistory: boolean,
): TrailSnapshot[] {
  const firstReliableIndex = liveTail.findIndex(
    (sample) => sample.quality !== "suspect",
  );

  if (firstReliableIndex <= 0) {
    return liveTail;
  }

  const reliableCount = liveTail.length - firstReliableIndex;
  if (!hasUsableHistory && reliableCount < 2) {
    return liveTail;
  }

  return liveTail.slice(firstReliableIndex);
}

function getMaxConnectGap(referenceAltitude: number | null): number {
  return referenceAltitude !== null &&
    referenceAltitude < LOW_ALTITUDE_THRESHOLD_M
    ? MAX_GAP_LOW_ALT_DEG
    : MAX_GAP_HIGH_ALT_DEG;
}

function getEffectiveAgeSec(
  historyEnd: TrailSnapshot,
  liveStart: TrailSnapshot,
): number {
  return Math.max(0, (liveStart.timestamp - historyEnd.timestamp) / 1000);
}

function getSpeedMps(sample: TrailSnapshot): number {
  return sample.groundSpeed != null && sample.groundSpeed > MIN_SPEED_MPS
    ? sample.groundSpeed
    : DEFAULT_SPEED_MPS;
}

function suffixPathLength(
  history: TrailSnapshot[],
  startIndex: number,
): number {
  let total = 0;

  for (let index = startIndex; index < history.length - 1; index += 1) {
    total += Math.sqrt(distanceSq(history[index], history[index + 1]));
  }

  return total;
}

function findTailJoinIndex(
  history: TrailSnapshot[],
  liveStart: TrailSnapshot,
  maxJoinGap: number,
  maxSuffixPathDeg: number,
): number {
  const searchStart = Math.max(0, history.length - OVERLAP_SEARCH_WINDOW);
  const suffixStart = Math.max(
    searchStart,
    history.length - TAIL_JOIN_MAX_POINTS,
  );

  for (let index = history.length - 1; index >= suffixStart; index -= 1) {
    const distance = Math.sqrt(distanceSq(history[index], liveStart));
    if (distance > maxJoinGap) {
      continue;
    }

    if (suffixPathLength(history, index) > maxSuffixPathDeg) {
      continue;
    }

    return index;
  }

  return -1;
}

export function mergeSegments(params: {
  liveTail: TrailSnapshot[];
  historySegments: TrailSegment[];
  referenceAltitude: number | null;
}): MergeSegmentsResult {
  const history = flattenHistorySegments(params.historySegments);
  const liveTail = trimSuspectLivePrefix(params.liveTail, history.length >= 2);

  if (history.length < 2) {
    return {
      historyBody: [],
      bridge: [],
      liveContinuation: liveTail,
      samples: liveTail,
      outcome: "live-tail-only",
    };
  }

  if (liveTail.length < 1) {
    return {
      historyBody: history,
      bridge: [],
      liveContinuation: [],
      samples: history,
      outcome: "partial-history",
    };
  }

  const liveStart = liveTail[0];
  const historyEnd = history[history.length - 1];
  const maxConnectGap = getMaxConnectGap(params.referenceAltitude);
  const effectiveAgeSec = getEffectiveAgeSec(historyEnd, liveStart);
  const hardDisconnectDeg = Math.max(
    HARD_DISCONNECT_BASE_DEG,
    (getSpeedMps(liveStart) * effectiveAgeSec * 2) / 111_320 + 0.5,
  );
  const trimBridgeGap = Math.min(TRIM_AND_BRIDGE_DEG, maxConnectGap);

  const snapJoinIndex = findTailJoinIndex(
    history,
    liveStart,
    SNAP_JOIN_DEG,
    TAIL_SNAP_MAX_PATH_DEG,
  );
  if (snapJoinIndex >= 0) {
    const trimmedHistory = history.slice(0, snapJoinIndex + 1);
    const snappedLive = trimAndSnapLiveTail(
      liveTail,
      trimmedHistory[trimmedHistory.length - 1],
    );

    return {
      historyBody: trimmedHistory,
      bridge: [],
      liveContinuation: snappedLive,
      samples: [...trimmedHistory, ...snappedLive.slice(1)],
      outcome: "full-history",
    };
  }

  const endGap = Math.sqrt(distanceSq(historyEnd, liveStart));
  const shouldDisconnect =
    endGap > hardDisconnectDeg ||
    (effectiveAgeSec > STALE_DISCONNECT_AGE_SEC &&
      endGap > STALE_DISCONNECT_GAP_DEG) ||
    (effectiveAgeSec > MODERATE_DISCONNECT_AGE_SEC &&
      endGap > MODERATE_DISCONNECT_GAP_DEG);

  if (shouldDisconnect || endGap > maxConnectGap) {
    // Preserve history body so the trail still renders when the live
    // position has drifted far from the last trace point.  A straight-
    // line bridge spans the gap — not ideal visually, but much better
    // than discarding the entire historical trail.
    const bridge = buildBridge(historyEnd, liveStart);
    return {
      historyBody: history,
      bridge,
      liveContinuation: liveTail,
      samples: [...history, ...bridge, ...liveTail],
      outcome: "partial-history",
    };
  }

  const bridgeJoinIndex = findTailJoinIndex(
    history,
    liveStart,
    trimBridgeGap,
    TAIL_BRIDGE_MAX_PATH_DEG,
  );
  if (bridgeJoinIndex >= 0) {
    const trimmedHistory = history.slice(0, bridgeJoinIndex + 1);
    const bridge = buildBridge(
      trimmedHistory[trimmedHistory.length - 1],
      liveStart,
    );

    return {
      historyBody: trimmedHistory,
      bridge,
      liveContinuation: liveTail,
      samples: [...trimmedHistory, ...bridge, ...liveTail],
      outcome: "full-history",
    };
  }

  if (endGap <= CONNECT_BRIDGE_DEG) {
    const snappedLive = trimAndSnapLiveTail(liveTail, historyEnd);

    return {
      historyBody: history,
      bridge: [],
      liveContinuation: snappedLive,
      samples: [...history, ...snappedLive.slice(1)],
      outcome: "full-history",
    };
  }

  const bridge = buildBridge(historyEnd, liveStart);
  return {
    historyBody: history,
    bridge,
    liveContinuation: liveTail,
    samples: [...history, ...bridge, ...liveTail],
    outcome: "partial-history",
  };
}
