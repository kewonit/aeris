"use client";

import { useEffect, useRef, useCallback } from "react";
import maplibregl from "maplibre-gl";
import { MapboxOverlay } from "@deck.gl/mapbox";
import { IconLayer, PathLayer } from "@deck.gl/layers";
import { ScenegraphLayer } from "@deck.gl/mesh-layers";
import { useMap } from "./map";
import { altitudeToColor, altitudeToElevation } from "@/lib/flight-utils";
import type { FlightState } from "@/lib/opensky";
import { type TrailEntry } from "@/hooks/use-trail-history";
import type { PickingInfo } from "@deck.gl/core";

/** Typed overlay with deck.gl's pickObject capability */
type DeckGLOverlay = MapboxOverlay & {
  pickObject?(opts: {
    x: number;
    y: number;
    radius: number;
  }): PickingInfo | null;
};

const DEFAULT_ANIM_DURATION_MS = 30_000;
const MIN_ANIM_DURATION_MS = 8_000;
const MAX_ANIM_DURATION_MS = 45_000;
const TELEPORT_THRESHOLD = 0.3;
const TRAIL_BELOW_AIRCRAFT_METERS = 40;
const STARTUP_TRAIL_POLLS = 3;
const STARTUP_TRAIL_STEP_SEC = 12;
const TRACK_DAMPING = 0.18;
const TRAIL_SMOOTHING_ITERATIONS = 3;
const AIRCRAFT_SCENEGRAPH_URL = "/models/airplane.glb";
const AIRCRAFT_PX_PER_UNIT = 0.3;
const BASE_AIRCRAFT_SIZE = 25;
const AIRCRAFT_PICK_RADIUS_PX = 14;

const CATEGORY_TINT: Record<number, [number, number, number]> = {
  2: [100, 235, 180],
  3: [120, 225, 235],
  4: [255, 210, 120],
  5: [255, 185, 110],
  6: [255, 160, 120],
  7: [255, 120, 200],
  8: [140, 220, 160],
  9: [170, 210, 255],
  10: [220, 170, 255],
  11: [255, 150, 180],
  12: [180, 230, 160],
  14: [195, 165, 255],
};

function categorySizeMultiplier(category: number | null): number {
  switch (category) {
    case 2:
      return 0.88;
    case 3:
      return 0.96;
    case 4:
      return 1.08;
    case 5:
      return 1.18;
    case 6:
      return 1.28;
    case 7:
      return 1.04;
    case 8:
      return 0.86;
    case 9:
    case 12:
      return 0.8;
    case 10:
      return 1.15;
    case 14:
      return 0.72;
    default:
      return 1;
  }
}

function tintAircraftColor(
  base: [number, number, number, number],
  category: number | null,
): [number, number, number, number] {
  const tint = category !== null ? CATEGORY_TINT[category] : undefined;
  if (!tint) return base;

  return [
    Math.round(base[0] * 0.58 + tint[0] * 0.42),
    Math.round(base[1] * 0.58 + tint[1] * 0.42),
    Math.round(base[2] * 0.58 + tint[2] * 0.42),
    base[3],
  ];
}

const PULSE_PERIOD_MS = 7000;
const RING_PERIOD_MS = 5500;

function createHaloAtlas(): HTMLCanvasElement {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, size, size);
  const c = size / 2;
  for (let r = 0; r < c; r++) {
    const norm = r / c;
    let alpha = 0;
    if (norm < 0.18) {
      alpha = 0;
    } else if (norm < 0.35) {
      const t = (norm - 0.18) / 0.17;
      alpha = t * t * 0.7;
    } else if (norm < 0.55) {
      alpha = 0.7 - ((norm - 0.35) / 0.2) * 0.3;
    } else {
      const t = (norm - 0.55) / 0.45;
      alpha = 0.4 * (1 - t) * (1 - t);
    }
    if (alpha < 0.003) continue;
    ctx.strokeStyle = `rgba(255,255,255,${alpha})`;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(c, c, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  return canvas;
}

function createSoftRingAtlas(): HTMLCanvasElement {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, size, size);
  const c = size / 2;
  const ringCenter = c * 0.75;
  const ringWidth = c * 0.18;
  for (let r = 0; r < c; r++) {
    const dist = Math.abs(r - ringCenter);
    const falloff = Math.max(0, 1 - (dist / ringWidth) ** 2);
    const alpha = falloff * 0.85;
    if (alpha < 0.005) continue;
    ctx.strokeStyle = `rgba(255,255,255,${alpha})`;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(c, c, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  return canvas;
}

const HALO_MAPPING = {
  halo: {
    x: 0,
    y: 0,
    width: 256,
    height: 256,
    anchorX: 128,
    anchorY: 128,
    mask: true,
  },
};

const RING_MAPPING = {
  ring: {
    x: 0,
    y: 0,
    width: 256,
    height: 256,
    anchorX: 128,
    anchorY: 128,
    mask: true,
  },
};

let _haloCache: string | undefined;
function getHaloUrl(): string {
  if (typeof document === "undefined") return "";
  if (!_haloCache) _haloCache = createHaloAtlas().toDataURL();
  return _haloCache;
}

let _ringCache: string | undefined;
function getRingUrl(): string {
  if (typeof document === "undefined") return "";
  if (!_ringCache) _ringCache = createSoftRingAtlas().toDataURL();
  return _ringCache;
}

function buildStartupFallbackTrail(f: FlightState): [number, number][] {
  if (f.longitude == null || f.latitude == null) return [];

  const heading = ((f.trueTrack ?? 0) * Math.PI) / 180;
  const speed = f.velocity ?? 200;
  const degPerSecond = speed / 111_320;

  const path: [number, number][] = [];
  for (let i = STARTUP_TRAIL_POLLS; i >= 1; i--) {
    const distDeg = Math.min(degPerSecond * STARTUP_TRAIL_STEP_SEC * i, 0.08);
    path.push([
      f.longitude - Math.sin(heading) * distDeg,
      f.latitude - Math.cos(heading) * distDeg,
    ]);
  }
  path.push([f.longitude, f.latitude]);
  return path;
}

type Snapshot = { lng: number; lat: number; alt: number; track: number };

function lerpAngle(a: number, b: number, t: number): number {
  const delta = ((b - a + 540) % 360) - 180;
  return a + delta * t;
}

function trackFromDelta(dx: number, dy: number, fallback: number): number {
  if (dx * dx + dy * dy < 1e-10) return fallback;
  return ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
}

function smoothStep(t: number): number {
  return t * t * (3 - 2 * t);
}

function horizontalDistanceFromLngLat(
  aLng: number,
  aLat: number,
  bLng: number,
  bLat: number,
): number {
  const avgLatRad = ((aLat + bLat) * 0.5 * Math.PI) / 180;
  const metersPerDegLon = 111_320 * Math.max(0.2, Math.cos(avgLatRad));
  const dx = (bLng - aLng) * metersPerDegLon;
  const dy = (bLat - aLat) * 111_320;
  return Math.hypot(dx, dy);
}

function horizontalDistanceMeters(a: Snapshot, b: Snapshot): number {
  return horizontalDistanceFromLngLat(a.lng, a.lat, b.lng, b.lat);
}

type ElevatedPoint = [number, number, number];

function smoothElevatedPath(
  points: ElevatedPoint[],
  iterations: number = TRAIL_SMOOTHING_ITERATIONS,
): ElevatedPoint[] {
  if (points.length < 3 || iterations <= 0) return points;

  let current = points;
  for (let iter = 0; iter < iterations; iter++) {
    if (current.length < 3) break;

    const next: ElevatedPoint[] = [current[0]];
    for (let i = 0; i < current.length - 1; i++) {
      const a = current[i];
      const b = current[i + 1];
      next.push([
        a[0] * 0.75 + b[0] * 0.25,
        a[1] * 0.75 + b[1] * 0.25,
        a[2] * 0.75 + b[2] * 0.25,
      ]);
      next.push([
        a[0] * 0.25 + b[0] * 0.75,
        a[1] * 0.25 + b[1] * 0.75,
        a[2] * 0.25 + b[2] * 0.75,
      ]);
    }
    next.push(current[current.length - 1]);
    current = next;
  }

  return current;
}

function densifyElevatedPath(
  points: ElevatedPoint[],
  subdivisions: number = 2,
): ElevatedPoint[] {
  if (points.length < 2 || subdivisions <= 1) return points;

  const out: ElevatedPoint[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    out.push(a);
    for (let j = 1; j < subdivisions; j++) {
      const t = j / subdivisions;
      out.push([
        a[0] + (b[0] - a[0]) * t,
        a[1] + (b[1] - a[1]) * t,
        a[2] + (b[2] - a[2]) * t,
      ]);
    }
  }
  out.push(points[points.length - 1]);
  return out;
}

function smoothNumericSeries(values: number[]): number[] {
  if (values.length < 3) return values;
  const out = [...values];
  for (let i = 1; i < values.length - 1; i++) {
    out[i] = values[i - 1] * 0.2 + values[i] * 0.6 + values[i + 1] * 0.2;
  }
  return out;
}

function smoothPlanarPath(points: [number, number][]): [number, number][] {
  if (points.length < 3) return points;

  let current = points;
  for (let pass = 0; pass < 2; pass++) {
    const next = [...current];
    for (let i = 1; i < current.length - 1; i++) {
      next[i] = [
        current[i - 1][0] * 0.2 + current[i][0] * 0.6 + current[i + 1][0] * 0.2,
        current[i - 1][1] * 0.2 + current[i][1] * 0.6 + current[i + 1][1] * 0.2,
      ];
    }
    current = next;
  }

  return current;
}

function trimPathAheadOfAircraft(
  points: ElevatedPoint[],
  aircraft: ElevatedPoint,
): ElevatedPoint[] {
  if (points.length < 2) return [aircraft];

  const px = aircraft[0];
  const py = aircraft[1];

  let bestIndex = points.length - 2;
  let bestDistanceSq = Number.POSITIVE_INFINITY;
  const searchStart = Math.max(0, points.length - 10);

  for (let i = searchStart; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const denom = dx * dx + dy * dy;
    const t =
      denom > 1e-12
        ? Math.max(
            0,
            Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / denom),
          )
        : 0;
    const qx = a[0] + dx * t;
    const qy = a[1] + dy * t;
    const distSq = (px - qx) * (px - qx) + (py - qy) * (py - qy);

    if (distSq < bestDistanceSq) {
      bestDistanceSq = distSq;
      bestIndex = i;
    }
  }

  const trimmed = points.slice(0, bestIndex + 1);
  trimmed.push([px, py, aircraft[2]]);

  return trimmed;
}

function createAircraftAtlas(): HTMLCanvasElement {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;

  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = "#ffffff";

  ctx.beginPath();
  ctx.moveTo(64, 6);
  ctx.lineTo(71, 19);
  ctx.lineTo(71, 33);
  ctx.lineTo(100, 44);
  ctx.lineTo(106, 52);
  ctx.lineTo(80, 53);
  ctx.lineTo(72, 56);
  ctx.lineTo(72, 88);
  ctx.lineTo(90, 101);
  ctx.lineTo(88, 108);
  ctx.lineTo(69, 99);
  ctx.lineTo(69, 121);
  ctx.lineTo(64, 126);
  ctx.lineTo(59, 121);
  ctx.lineTo(59, 99);
  ctx.lineTo(40, 108);
  ctx.lineTo(38, 101);
  ctx.lineTo(56, 88);
  ctx.lineTo(56, 56);
  ctx.lineTo(48, 53);
  ctx.lineTo(22, 52);
  ctx.lineTo(28, 44);
  ctx.lineTo(57, 33);
  ctx.lineTo(57, 19);
  ctx.closePath();
  ctx.fill();

  ctx.globalCompositeOperation = "destination-out";
  ctx.beginPath();
  ctx.moveTo(64, 13);
  ctx.lineTo(67, 19);
  ctx.lineTo(64, 24);
  ctx.lineTo(61, 19);
  ctx.closePath();
  ctx.fill();
  ctx.globalCompositeOperation = "source-over";

  return canvas;
}

const AIRCRAFT_ICON_MAPPING = {
  aircraft: {
    x: 0,
    y: 0,
    width: 128,
    height: 128,
    anchorX: 64,
    anchorY: 64,
    mask: true,
  },
};

let _atlasCache: string | undefined;
function getAircraftAtlasUrl(): string {
  if (typeof document === "undefined") return "";
  if (!_atlasCache) _atlasCache = createAircraftAtlas().toDataURL();
  return _atlasCache;
}

type FlightLayerProps = {
  flights: FlightState[];
  trails: TrailEntry[];
  onClick: (info: PickingInfo<FlightState> | null) => void;
  selectedIcao24: string | null;
  showTrails: boolean;
  trailThickness: number;
  trailDistance: number;
  showShadows: boolean;
  showAltitudeColors: boolean;
};

export function FlightLayers({
  flights,
  trails,
  onClick,
  selectedIcao24,
  showTrails,
  trailThickness,
  trailDistance,
  showShadows,
  showAltitudeColors,
}: FlightLayerProps) {
  const { map, isLoaded } = useMap();
  const overlayRef = useRef<MapboxOverlay | null>(null);
  const atlasUrl = getAircraftAtlasUrl();
  const haloUrl = getHaloUrl();
  const ringUrl = getRingUrl();

  const prevSnapshotsRef = useRef<Map<string, Snapshot>>(new Map());
  const currSnapshotsRef = useRef<Map<string, Snapshot>>(new Map());
  const dataTimestampRef = useRef(0);
  const animDurationRef = useRef(DEFAULT_ANIM_DURATION_MS);
  const animFrameRef = useRef(0);

  const flightsRef = useRef(flights);
  const trailsRef = useRef(trails);
  const showTrailsRef = useRef(showTrails);
  const trailThicknessRef = useRef(trailThickness);
  const trailDistanceRef = useRef(trailDistance);
  const showShadowsRef = useRef(showShadows);
  const showAltColorsRef = useRef(showAltitudeColors);
  const selectedIcao24Ref = useRef(selectedIcao24);
  const prevSelectedRef = useRef<string | null>(null);
  const selectionChangeTimeRef = useRef(0);
  const SELECTION_FADE_MS = 600;

  useEffect(() => {
    flightsRef.current = flights;
    trailsRef.current = trails;
    showTrailsRef.current = showTrails;
    trailThicknessRef.current = trailThickness;
    trailDistanceRef.current = trailDistance;
    showShadowsRef.current = showShadows;
    showAltColorsRef.current = showAltitudeColors;
    if (selectedIcao24 !== selectedIcao24Ref.current) {
      prevSelectedRef.current = selectedIcao24Ref.current;
      selectionChangeTimeRef.current = performance.now();
    }
    selectedIcao24Ref.current = selectedIcao24;
  }, [
    flights,
    trails,
    showTrails,
    trailThickness,
    trailDistance,
    showShadows,
    showAltitudeColors,
    selectedIcao24,
  ]);

  useEffect(() => {
    const elapsed = performance.now() - dataTimestampRef.current;
    const oldLinearT = Math.min(elapsed / animDurationRef.current, 1);
    const oldAngleT = smoothStep(oldLinearT);

    const newPrev = new Map<string, Snapshot>();
    for (const f of flights) {
      if (f.longitude == null || f.latitude == null) continue;
      const id = f.icao24;
      const oldPrev = prevSnapshotsRef.current.get(id);
      const oldCurr = currSnapshotsRef.current.get(id);

      if (oldPrev && oldCurr) {
        const dx = oldCurr.lng - oldPrev.lng;
        const dy = oldCurr.lat - oldPrev.lat;
        if (dx * dx + dy * dy <= TELEPORT_THRESHOLD * TELEPORT_THRESHOLD) {
          newPrev.set(id, {
            lng: oldPrev.lng + dx * oldLinearT,
            lat: oldPrev.lat + dy * oldLinearT,
            alt: oldPrev.alt + (oldCurr.alt - oldPrev.alt) * oldLinearT,
            track: lerpAngle(oldPrev.track, oldCurr.track, oldAngleT),
          });
        } else {
          newPrev.set(id, oldCurr);
        }
      } else if (oldCurr) {
        newPrev.set(id, oldCurr);
      }
    }
    prevSnapshotsRef.current = newPrev;

    const next = new Map<string, Snapshot>();
    for (const f of flights) {
      if (f.longitude != null && f.latitude != null) {
        const prev = newPrev.get(f.icao24);
        const rawTrack = f.trueTrack ?? 0;
        next.set(f.icao24, {
          lng: f.longitude,
          lat: f.latitude,
          alt: f.baroAltitude ?? 0,
          track:
            prev != null
              ? lerpAngle(prev.track, rawTrack, TRACK_DAMPING)
              : rawTrack,
        });
      }
    }
    currSnapshotsRef.current = next;
    const now = performance.now();
    if (dataTimestampRef.current > 0) {
      const observedInterval = now - dataTimestampRef.current;
      animDurationRef.current = Math.max(
        MIN_ANIM_DURATION_MS,
        Math.min(MAX_ANIM_DURATION_MS, observedInterval * 0.94),
      );
    }
    dataTimestampRef.current = now;
  }, [flights]);

  const handleHover = useCallback(
    (info: PickingInfo<FlightState>) => {
      const canvas = map?.getCanvas();
      if (canvas) canvas.style.cursor = info.object ? "pointer" : "";
    },
    [map],
  );

  // Reset cursor if component unmounts while hovering.
  useEffect(() => {
    return () => {
      const canvas = map?.getCanvas();
      if (canvas) canvas.style.cursor = "";
    };
  }, [map]);

  const handleClick = useCallback(
    (info: PickingInfo<FlightState>) => {
      if (info.object) onClick(info);
    },
    [onClick],
  );

  useEffect(() => {
    if (!map || !isLoaded) return;

    function onMapClick(e: maplibregl.MapMouseEvent) {
      const overlay = overlayRef.current;
      if (!overlay) {
        onClick(null);
        return;
      }
      const picked = (overlay as unknown as DeckGLOverlay).pickObject?.({
        x: e.point.x,
        y: e.point.y,
        radius: AIRCRAFT_PICK_RADIUS_PX,
      });
      if (!picked?.object) {
        onClick(null);
      }
    }

    map.on("click", onMapClick);
    return () => {
      map.off("click", onMapClick);
    };
  }, [map, isLoaded, onClick]);

  useEffect(() => {
    if (!map || !isLoaded) return;

    if (!overlayRef.current) {
      overlayRef.current = new MapboxOverlay({
        interleaved: false,
        pickingRadius: AIRCRAFT_PICK_RADIUS_PX,
        layers: [],
      });
      map.addControl(overlayRef.current as unknown as maplibregl.IControl);
    }

    return () => {
      if (overlayRef.current) {
        try {
          map.removeControl(
            overlayRef.current as unknown as maplibregl.IControl,
          );
        } catch {
          /* unmounted */
        }
        overlayRef.current = null;
      }
    };
  }, [map, isLoaded]);

  useEffect(() => {
    if (!atlasUrl) return;

    function buildAndPushLayers() {
      animFrameRef.current = requestAnimationFrame(buildAndPushLayers);

      const overlay = overlayRef.current;
      if (!overlay) return;

      try {
        const elapsed = performance.now() - dataTimestampRef.current;
        const rawT = elapsed / animDurationRef.current;
        const tPos = Math.min(rawT, 1);
        const tAngle = smoothStep(smoothStep(smoothStep(tPos)));

        const currentFlights = flightsRef.current;
        const currentTrails = trailsRef.current;
        const trailByIcao = new Map(currentTrails.map((t) => [t.icao24, t]));
        const altColors = showAltColorsRef.current;
        const defaultColor: [number, number, number, number] = [
          180, 220, 255, 200,
        ];

        const interpolated: FlightState[] = currentFlights.map((f) => {
          if (f.longitude == null || f.latitude == null) return f;

          const curr = currSnapshotsRef.current.get(f.icao24);
          if (!curr) return f;

          let prev = prevSnapshotsRef.current.get(f.icao24);
          if (!prev) {
            const rad = (curr.track * Math.PI) / 180;
            const spd = f.velocity ?? 200;
            const step = Math.min(
              (spd * (animDurationRef.current / 1000)) / 111_320,
              0.015,
            );
            prev = {
              lng: curr.lng - Math.sin(rad) * step,
              lat: curr.lat - Math.cos(rad) * step,
              alt: curr.alt,
              track: curr.track,
            };
          }

          const dx = curr.lng - prev.lng;
          const dy = curr.lat - prev.lat;
          if (dx * dx + dy * dy > TELEPORT_THRESHOLD * TELEPORT_THRESHOLD) {
            return f;
          }

          if (rawT <= 1) {
            const blendedTrack = lerpAngle(prev.track, curr.track, tAngle);
            return {
              ...f,
              longitude: prev.lng + dx * tPos,
              latitude: prev.lat + dy * tPos,
              baroAltitude: prev.alt + (curr.alt - prev.alt) * tPos,
              trueTrack: trackFromDelta(dx, dy, blendedTrack),
            };
          }

          const heading = (curr.track * Math.PI) / 180;
          const speed = f.velocity ?? 200;
          const extraSec = ((rawT - 1) * animDurationRef.current) / 1000;
          const extraDeg = Math.min((speed * extraSec) / 111_320, 0.03);
          const moveDx = Math.sin(heading) * extraDeg;
          const moveDy = Math.cos(heading) * extraDeg;
          return {
            ...f,
            longitude: curr.lng + moveDx,
            latitude: curr.lat + moveDy,
            baroAltitude: curr.alt,
            trueTrack: trackFromDelta(moveDx, moveDy, curr.track),
          };
        });

        const interpolatedMap = new Map<string, FlightState>();
        for (const f of interpolated) {
          interpolatedMap.set(f.icao24, f);
        }

        const pitchByIcao = new Map<string, number>();
        for (const f of interpolated) {
          const curr = currSnapshotsRef.current.get(f.icao24);
          const prev = prevSnapshotsRef.current.get(f.icao24);

          const trendTrail = trailByIcao.get(f.icao24);
          const trendPitch =
            trendTrail && trendTrail.path.length >= 2
              ? (() => {
                  const end = trendTrail.path.length - 1;
                  const start = Math.max(0, end - 7);
                  const startAlt =
                    trendTrail.altitudes[start] ??
                    trendTrail.altitudes[end] ??
                    f.baroAltitude ??
                    0;
                  const endAlt =
                    trendTrail.altitudes[end] ?? f.baroAltitude ?? startAlt;
                  const [sLng, sLat] = trendTrail.path[start];
                  const [eLng, eLat] = trendTrail.path[end];
                  const horizontalMeters = horizontalDistanceFromLngLat(
                    sLng,
                    sLat,
                    eLng,
                    eLat,
                  );
                  if (horizontalMeters < 1) return 0;
                  return (
                    (-Math.atan2(endAlt - startAlt, horizontalMeters) * 180) /
                    Math.PI
                  );
                })()
              : 0;

          const risePitch =
            curr && prev
              ? (() => {
                  const horizontalMeters = horizontalDistanceMeters(prev, curr);
                  if (horizontalMeters < 1) return 0;
                  const deltaAltitudeMeters = curr.alt - prev.alt;
                  return (
                    (-Math.atan2(deltaAltitudeMeters, horizontalMeters) * 180) /
                    Math.PI
                  );
                })()
              : 0;

          const speed = f.velocity ?? 0;
          const verticalRate = f.verticalRate ?? 0;
          const kinematicPitch =
            speed > 0 ? (-Math.atan2(verticalRate, speed) * 180) / Math.PI : 0;

          const blendedPitch =
            trendPitch * 0.5 + risePitch * 0.38 + kinematicPitch * 0.12;
          const amplifiedPitch = blendedPitch * 1.55;
          const clampedPitch = Math.max(-40, Math.min(40, amplifiedPitch));
          pitchByIcao.set(f.icao24, clampedPitch);
        }

        const layers = [];

        if (showShadowsRef.current) {
          layers.push(
            new IconLayer<FlightState>({
              id: "flight-shadows",
              data: interpolated,
              getPosition: (d) => [d.longitude!, d.latitude!, 0],
              getIcon: () => "aircraft",
              getSize: (d) => 20 * categorySizeMultiplier(d.category),
              getColor: [0, 0, 0, 60],
              getAngle: (d) => 360 - (d.trueTrack ?? 0),
              iconAtlas: atlasUrl,
              iconMapping: AIRCRAFT_ICON_MAPPING,
              billboard: false,
              sizeUnits: "pixels",
              sizeScale: 1,
            }),
          );
        }

        if (showTrailsRef.current) {
          const trailMap = new Map(currentTrails.map((t) => [t.icao24, t]));
          const handledIds = new Set<string>();
          const trailData: TrailEntry[] = [];
          const denseSubdivisions = interpolated.length > 140 ? 1 : 2;
          const smoothingIterations =
            interpolated.length > 220 ? 1 : TRAIL_SMOOTHING_ITERATIONS;

          const buildVisibleTrailPoints = (
            trail: TrailEntry,
            animFlight: FlightState | undefined,
          ): ElevatedPoint[] => {
            const historyPoints = Math.max(
              2,
              Math.round(trailDistanceRef.current),
            );
            const pathSlice =
              trail.path.length > historyPoints
                ? trail.path.slice(trail.path.length - historyPoints)
                : trail.path;
            const altitudeSlice =
              trail.altitudes.length > historyPoints
                ? trail.altitudes.slice(trail.altitudes.length - historyPoints)
                : trail.altitudes;
            const smoothPathSlice = smoothPlanarPath(pathSlice);

            const altitudeMeters = smoothNumericSeries(
              altitudeSlice.map(
                (a) => a ?? trail.baroAltitude ?? animFlight?.baroAltitude ?? 0,
              ),
            );

            const basePath = smoothPathSlice.map((p, i) => [
              p[0],
              p[1],
              Math.max(0, altitudeMeters[i] ?? trail.baroAltitude ?? 0),
            ]) as ElevatedPoint[];
            const denseBasePath = densifyElevatedPath(
              basePath,
              denseSubdivisions,
            );

            if (
              animFlight &&
              animFlight.longitude != null &&
              animFlight.latitude != null &&
              denseBasePath.length > 1
            ) {
              const clipped = trimPathAheadOfAircraft(denseBasePath, [
                animFlight.longitude,
                animFlight.latitude,
                Math.max(0, animFlight.baroAltitude ?? 0),
              ]);

              const smoothed =
                clipped.length < 4
                  ? clipped
                  : smoothElevatedPath(clipped, smoothingIterations);

              return smoothed.map((p) => [p[0], p[1], Math.max(0, p[2])]);
            }

            const smoothed =
              denseBasePath.length < 4
                ? denseBasePath
                : smoothElevatedPath(denseBasePath, smoothingIterations);

            return smoothed.map((p) => [p[0], p[1], Math.max(0, p[2])]);
          };

          const visibleTrailCache = new Map<string, ElevatedPoint[]>();
          const getVisibleTrailPoints = (
            trail: TrailEntry,
            animFlight: FlightState | undefined,
          ): ElevatedPoint[] => {
            const cached = visibleTrailCache.get(trail.icao24);
            if (cached) return cached;
            const computed = buildVisibleTrailPoints(trail, animFlight);
            visibleTrailCache.set(trail.icao24, computed);
            return computed;
          };

          for (const f of interpolated) {
            if (f.longitude == null || f.latitude == null) continue;

            const existing = trailMap.get(f.icao24);
            handledIds.add(f.icao24);

            if (existing && existing.path.length >= 2) {
              trailData.push(existing);
              continue;
            }

            const startupPath = buildStartupFallbackTrail(f);

            trailData.push({
              icao24: f.icao24,
              path: startupPath,
              altitudes: startupPath.map(
                () => existing?.baroAltitude ?? f.baroAltitude,
              ),
              baroAltitude: existing?.baroAltitude ?? f.baroAltitude,
            });
          }

          for (const d of currentTrails) {
            if (!handledIds.has(d.icao24)) {
              trailData.push(d);
            }
          }

          layers.push(
            new PathLayer<TrailEntry>({
              id: "flight-trails",
              data: trailData,
              updateTriggers: {
                getPath: [elapsed, trailDistanceRef.current],
                getColor: [elapsed, altColors, trailDistanceRef.current],
              },
              getPath: (d) => {
                const animFlight = interpolatedMap.get(d.icao24);
                const visiblePoints = getVisibleTrailPoints(d, animFlight);
                return visiblePoints.map(
                  (p) =>
                    [
                      p[0],
                      p[1],
                      Math.max(
                        0,
                        altitudeToElevation(p[2]) - TRAIL_BELOW_AIRCRAFT_METERS,
                      ),
                    ] as [number, number, number],
                );
              },
              getColor: (d) => {
                const animFlight = interpolatedMap.get(d.icao24);
                const visiblePoints = getVisibleTrailPoints(d, animFlight);
                const len = visiblePoints.length;
                return visiblePoints.map((point, i) => {
                  const tVal = len > 1 ? i / (len - 1) : 1;
                  const fade = Math.pow(tVal, 1.65);
                  const base = altColors
                    ? altitudeToColor(point[2])
                    : defaultColor;
                  return [
                    base[0],
                    base[1],
                    base[2],
                    Math.round(70 + fade * 150),
                  ];
                }) as [number, number, number, number][];
              },
              getWidth: trailThicknessRef.current,
              widthUnits: "pixels",
              widthMinPixels: Math.max(1, trailThicknessRef.current * 0.6),
              widthMaxPixels: Math.max(2, trailThicknessRef.current * 1.8),
              billboard: true,
              capRounded: true,
              jointRounded: true,
            }),
          );
        }

        const smoothstep = (t: number) => t * t * (3 - 2 * t);
        const easeOutQuint = (t: number) => 1 - (1 - t) ** 5;

        const fadeElapsed = performance.now() - selectionChangeTimeRef.current;
        const fadeT = Math.min(fadeElapsed / SELECTION_FADE_MS, 1);
        const fadeIn = smoothstep(fadeT);
        const fadeOut = 1 - fadeIn;

        const selectedId = selectedIcao24Ref.current;
        const prevId = prevSelectedRef.current;

        const pulseTargets: { id: string; opacity: number; prefix: string }[] =
          [];
        if (selectedId)
          pulseTargets.push({ id: selectedId, opacity: fadeIn, prefix: "sel" });
        if (prevId && prevId !== selectedId && fadeOut > 0.01) {
          pulseTargets.push({ id: prevId, opacity: fadeOut, prefix: "prev" });
        } else if (fadeT >= 1) {
          prevSelectedRef.current = null;
        }

        for (const target of pulseTargets) {
          const flight = interpolated.find((f) => f.icao24 === target.id);
          if (!flight || flight.longitude == null || flight.latitude == null)
            continue;

          const pos: [number, number, number] = [
            flight.longitude,
            flight.latitude,
            altitudeToElevation(flight.baroAltitude),
          ];
          const op = target.opacity;

          const breathT = (elapsed % PULSE_PERIOD_MS) / PULSE_PERIOD_MS;
          const breath = Math.sin(breathT * Math.PI * 2);
          const softBreath = smoothstep(smoothstep((breath + 1) / 2)) * 2 - 1;

          const haloSize = 75 + 8 * softBreath;
          const haloAlpha = Math.round((18 + 8 * softBreath) * op);

          if (haloAlpha > 0) {
            layers.push(
              new IconLayer({
                id: `${target.prefix}-halo`,
                data: [{ position: pos }],
                getPosition: (d: { position: [number, number, number] }) =>
                  d.position,
                getIcon: () => "halo",
                getSize: haloSize,
                getColor: [70, 160, 240, haloAlpha],
                iconAtlas: haloUrl,
                iconMapping: HALO_MAPPING,
                billboard: true,
                sizeUnits: "pixels",
                sizeScale: 1,
              }),
            );
          }

          const ringOffsets = [0, RING_PERIOD_MS / 3, (RING_PERIOD_MS * 2) / 3];
          ringOffsets.forEach((offset, i) => {
            const t = ((elapsed + offset) % RING_PERIOD_MS) / RING_PERIOD_MS;
            const eased = easeOutQuint(t);
            const ringSize = 30 + 60 * eased;
            const fade = 1 - t;
            const ringAlpha = Math.round(70 * fade * fade * fade * fade * op);

            if (ringAlpha < 2) return;

            layers.push(
              new IconLayer({
                id: `${target.prefix}-ring-${i}`,
                data: [{ position: pos }],
                getPosition: (d: { position: [number, number, number] }) =>
                  d.position,
                getIcon: () => "ring",
                getSize: ringSize,
                getColor: [70, 165, 235, ringAlpha],
                iconAtlas: ringUrl,
                iconMapping: RING_MAPPING,
                billboard: true,
                sizeUnits: "pixels",
                sizeScale: 1,
              }),
            );
          });
        }

        layers.push(
          new ScenegraphLayer<FlightState>({
            id: "flight-aircraft",
            data: interpolated,
            getPosition: (d) => [
              d.longitude!,
              d.latitude!,
              altitudeToElevation(d.baroAltitude),
            ],
            getOrientation: (d) => {
              const pitch = pitchByIcao.get(d.icao24) ?? 0;
              const yaw = -(d.trueTrack ?? 0);
              return [pitch, yaw, 90];
            },
            getColor: (d) => {
              const base = altColors
                ? altitudeToColor(d.baroAltitude)
                : defaultColor;
              return tintAircraftColor(base, d.category);
            },
            scenegraph: AIRCRAFT_SCENEGRAPH_URL,
            getScale: (d) => {
              const scale = categorySizeMultiplier(d.category);
              return [scale, scale, scale];
            },
            sizeScale: BASE_AIRCRAFT_SIZE,
            sizeMinPixels: AIRCRAFT_PX_PER_UNIT,
            sizeMaxPixels: AIRCRAFT_PX_PER_UNIT,
            _lighting: "pbr",
            pickable: true,
            onHover: handleHover,
            onClick: handleClick,
            autoHighlight: true,
            highlightColor: [255, 255, 255, 80],
          }),
        );

        overlay.setProps({ layers });
      } catch (err) {
        if (process.env.NODE_ENV === "development") {
          console.error("[aeris] FlightLayers render error:", err);
        }
      }
    }

    buildAndPushLayers();
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [atlasUrl, haloUrl, ringUrl, handleHover, handleClick, map]);

  return null;
}
