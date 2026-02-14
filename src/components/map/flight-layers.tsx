"use client";

import { useEffect, useRef, useCallback } from "react";
import { MapboxOverlay } from "@deck.gl/mapbox";
import { IconLayer, PathLayer } from "@deck.gl/layers";
import { useMap } from "./map";
import { altitudeToColor, altitudeToElevation } from "@/lib/flight-utils";
import type { FlightState } from "@/lib/opensky";
import { type TrailEntry } from "@/hooks/use-trail-history";
import type { PickingInfo } from "@deck.gl/core";

const DEFAULT_ANIM_DURATION_MS = 30_000;
const MIN_ANIM_DURATION_MS = 8_000;
const MAX_ANIM_DURATION_MS = 45_000;
const TELEPORT_THRESHOLD = 0.3;
const TRAIL_BELOW_AIRCRAFT_METERS = 20;
const STARTUP_TRAIL_POLLS = 3;
const STARTUP_TRAIL_STEP_SEC = 12;
const TRACK_DAMPING = 0.18;
const TRAIL_SMOOTHING_ITERATIONS = 3;

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

  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.moveTo(64, 12);
  ctx.lineTo(72, 48);
  ctx.lineTo(108, 72);
  ctx.lineTo(104, 78);
  ctx.lineTo(72, 66);
  ctx.lineTo(70, 96);
  ctx.lineTo(88, 108);
  ctx.lineTo(86, 114);
  ctx.lineTo(64, 104);
  ctx.lineTo(42, 114);
  ctx.lineTo(40, 108);
  ctx.lineTo(58, 96);
  ctx.lineTo(56, 66);
  ctx.lineTo(24, 78);
  ctx.lineTo(20, 72);
  ctx.lineTo(56, 48);
  ctx.closePath();
  ctx.fill();

  return canvas;
}

const AIRCRAFT_ICON_MAPPING = {
  aircraft: { x: 0, y: 0, width: 128, height: 128, mask: true },
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
  onHover: (info: PickingInfo<FlightState> | null) => void;
  onClick: (info: PickingInfo<FlightState> | null) => void;
  showTrails: boolean;
  trailThickness: number;
  trailDistance: number;
  showShadows: boolean;
  showAltitudeColors: boolean;
};

export function FlightLayers({
  flights,
  trails,
  onHover,
  onClick,
  showTrails,
  trailThickness,
  trailDistance,
  showShadows,
  showAltitudeColors,
}: FlightLayerProps) {
  const { map, isLoaded } = useMap();
  const overlayRef = useRef<MapboxOverlay | null>(null);
  const atlasUrl = getAircraftAtlasUrl();

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

  useEffect(() => {
    flightsRef.current = flights;
    trailsRef.current = trails;
    showTrailsRef.current = showTrails;
    trailThicknessRef.current = trailThickness;
    trailDistanceRef.current = trailDistance;
    showShadowsRef.current = showShadows;
    showAltColorsRef.current = showAltitudeColors;
  });

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
      onHover(info.object ? info : null);
    },
    [onHover],
  );

  const handleClick = useCallback(
    (info: PickingInfo<FlightState>) => {
      if (info.object) onClick(info);
    },
    [onClick],
  );

  useEffect(() => {
    if (!map || !isLoaded) return;

    if (!overlayRef.current) {
      overlayRef.current = new MapboxOverlay({
        interleaved: false,
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

        const layers = [];

        if (showShadowsRef.current) {
          layers.push(
            new IconLayer<FlightState>({
              id: "flight-shadows",
              data: interpolated,
              getPosition: (d) => [d.longitude!, d.latitude!, 0],
              getIcon: () => "aircraft",
              getSize: 18,
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
              updateTriggers: { getPath: elapsed },
              getPath: (d) => {
                const historyPoints = Math.max(
                  2,
                  Math.round(trailDistanceRef.current),
                );
                const pathSlice =
                  d.path.length > historyPoints
                    ? d.path.slice(d.path.length - historyPoints)
                    : d.path;
                const altitudeSlice =
                  d.altitudes.length > historyPoints
                    ? d.altitudes.slice(d.altitudes.length - historyPoints)
                    : d.altitudes;
                const smoothPathSlice = smoothPlanarPath(pathSlice);
                const altitudeMeters = smoothNumericSeries(
                  altitudeSlice.map((a) =>
                    altitudeToElevation(a ?? d.baroAltitude),
                  ),
                );

                const animFlight = interpolatedMap.get(d.icao24);
                const basePath = smoothPathSlice.map((p, i) => {
                  const pointAlt =
                    altitudeMeters[i] ?? altitudeToElevation(d.baroAltitude);
                  const trailAlt = Math.max(
                    0,
                    pointAlt - TRAIL_BELOW_AIRCRAFT_METERS,
                  );
                  return [p[0], p[1], trailAlt] as [number, number, number];
                });
                if (
                  animFlight &&
                  animFlight.longitude != null &&
                  animFlight.latitude != null &&
                  basePath.length > 1
                ) {
                  const ax = animFlight.longitude;
                  const ay = animFlight.latitude;
                  const currentAlt = Math.max(
                    0,
                    altitudeToElevation(animFlight.baroAltitude) -
                      TRAIL_BELOW_AIRCRAFT_METERS,
                  );

                  const clipped = trimPathAheadOfAircraft(basePath, [
                    ax,
                    ay,
                    currentAlt,
                  ]);
                  if (clipped.length < 4) return clipped;
                  return smoothElevatedPath(clipped);
                }
                if (basePath.length < 4) return basePath;
                return smoothElevatedPath(basePath);
              },
              getColor: (d) => {
                const historyPoints = Math.max(
                  2,
                  Math.round(trailDistanceRef.current),
                );
                const visibleLen = Math.min(d.path.length, historyPoints);
                const len =
                  visibleLen < 4
                    ? visibleLen
                    : visibleLen * 2 ** TRAIL_SMOOTHING_ITERATIONS;
                const base = altColors
                  ? altitudeToColor(d.baroAltitude)
                  : defaultColor;
                return Array.from({ length: len }, (_, i) => {
                  const tVal = len > 1 ? i / (len - 1) : 1;
                  const fade = Math.pow(tVal, 2.4);
                  return [
                    Math.min(255, base[0] + 22),
                    Math.min(255, base[1] + 22),
                    Math.min(255, base[2] + 22),
                    Math.round(20 + fade * 200),
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

        layers.push(
          new IconLayer<FlightState>({
            id: "flight-aircraft",
            data: interpolated,
            getPosition: (d) => [
              d.longitude!,
              d.latitude!,
              altitudeToElevation(d.baroAltitude),
            ],
            getIcon: () => "aircraft",
            getSize: 22,
            getColor: (d) =>
              altColors ? altitudeToColor(d.baroAltitude) : defaultColor,
            getAngle: (d) => 360 - (d.trueTrack ?? 0),
            iconAtlas: atlasUrl,
            iconMapping: AIRCRAFT_ICON_MAPPING,
            billboard: false,
            sizeUnits: "pixels",
            sizeScale: 1,
            pickable: true,
            onHover: handleHover,
            onClick: handleClick,
            autoHighlight: true,
            highlightColor: [255, 255, 255, 80],
          }),
        );

        overlay.setProps({ layers });
      } catch (err) {
        console.error("[aeris] FlightLayers render error:", err);
      }
    }

    buildAndPushLayers();
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [atlasUrl, handleHover, handleClick]);

  return null;
}
