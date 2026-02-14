"use client";

import { useEffect, useRef, useCallback } from "react";
import { MapboxOverlay } from "@deck.gl/mapbox";
import { IconLayer, PathLayer } from "@deck.gl/layers";
import { useMap } from "./map";
import { altitudeToColor, altitudeToElevation } from "@/lib/flight-utils";
import type { FlightState } from "@/lib/opensky";
import { type TrailEntry } from "@/hooks/use-trail-history";
import type { PickingInfo } from "@deck.gl/core";

const ANIM_DURATION_MS = 30_000;
const TELEPORT_THRESHOLD = 0.3; // degrees

type Snapshot = { lng: number; lat: number; alt: number; track: number };

function lerpAngle(a: number, b: number, t: number): number {
  const delta = ((b - a + 540) % 360) - 180;
  return a + delta * t;
}

function smoothStep(t: number): number {
  return t * t * (3 - 2 * t);
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
  showShadows: boolean;
  showAltitudeColors: boolean;
};

export function FlightLayers({
  flights,
  trails,
  onHover,
  onClick,
  showTrails,
  showShadows,
  showAltitudeColors,
}: FlightLayerProps) {
  const { map, isLoaded } = useMap();
  const overlayRef = useRef<MapboxOverlay | null>(null);
  const atlasUrl = getAircraftAtlasUrl();

  const prevSnapshotsRef = useRef<Map<string, Snapshot>>(new Map());
  const currSnapshotsRef = useRef<Map<string, Snapshot>>(new Map());
  const dataTimestampRef = useRef(0);
  const animFrameRef = useRef(0);

  const flightsRef = useRef(flights);
  const trailsRef = useRef(trails);
  const showTrailsRef = useRef(showTrails);
  const showShadowsRef = useRef(showShadows);
  const showAltColorsRef = useRef(showAltitudeColors);

  useEffect(() => {
    flightsRef.current = flights;
    trailsRef.current = trails;
    showTrailsRef.current = showTrails;
    showShadowsRef.current = showShadows;
    showAltColorsRef.current = showAltitudeColors;
  });

  // Capture current animated position as new "prev" on each data update
  useEffect(() => {
    const elapsed = performance.now() - dataTimestampRef.current;
    const oldLinearT = Math.min(elapsed / ANIM_DURATION_MS, 1);
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
        next.set(f.icao24, {
          lng: f.longitude,
          lat: f.latitude,
          alt: f.baroAltitude ?? 0,
          track: f.trueTrack ?? 0,
        });
      }
    }
    currSnapshotsRef.current = next;
    dataTimestampRef.current = performance.now();
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
        const rawT = elapsed / ANIM_DURATION_MS;
        const tPos = Math.min(rawT, 1);
        const tAngle = smoothStep(tPos);

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

          // Synthesize a virtual "prev" for new flights so they slide in
          let prev = prevSnapshotsRef.current.get(f.icao24);
          if (!prev) {
            const rad = (curr.track * Math.PI) / 180;
            const spd = f.velocity ?? 200;
            const step = Math.min(
              (spd * (ANIM_DURATION_MS / 1000)) / 111_320,
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
            return f; // teleport — skip interpolation
          }

          if (rawT <= 1) {
            return {
              ...f,
              longitude: prev.lng + dx * tPos,
              latitude: prev.lat + dy * tPos,
              baroAltitude: prev.alt + (curr.alt - prev.alt) * tPos,
              trueTrack: lerpAngle(prev.track, curr.track, tAngle),
            };
          }

          // Extrapolate when the next poll is delayed (velocity-continuous
          // with the linear interpolation above)
          const heading = (curr.track * Math.PI) / 180;
          const speed = f.velocity ?? 200;
          const extraSec = ((rawT - 1) * ANIM_DURATION_MS) / 1000;
          const extraDeg = Math.min((speed * extraSec) / 111_320, 0.03);
          return {
            ...f,
            longitude: curr.lng + Math.sin(heading) * extraDeg,
            latitude: curr.lat + Math.cos(heading) * extraDeg,
            baroAltitude: curr.alt,
            trueTrack: curr.track,
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
          layers.push(
            new PathLayer<TrailEntry>({
              id: "flight-trails",
              data: currentTrails,
              updateTriggers: { getPath: elapsed },
              getPath: (d) => {
                const animFlight = interpolatedMap.get(d.icao24);
                const alt = altitudeToElevation(
                  animFlight?.baroAltitude ?? d.baroAltitude,
                );
                const basePath = d.path.map(
                  (p) => [p[0], p[1], alt] as [number, number, number],
                );
                if (
                  animFlight &&
                  animFlight.longitude != null &&
                  animFlight.latitude != null &&
                  basePath.length > 1
                ) {
                  const ax = animFlight.longitude;
                  const ay = animFlight.latitude;

                  const curr = currSnapshotsRef.current.get(d.icao24);
                  const prev = prevSnapshotsRef.current.get(d.icao24);

                  if (curr && prev) {
                    // Direction from prev → curr
                    const fdx = curr.lng - prev.lng;
                    const fdy = curr.lat - prev.lat;

                    // Walk backward; collapse points that are ahead of the
                    // animated position (positive projection along flight dir)
                    for (let i = basePath.length - 1; i >= 0; i--) {
                      const vx = basePath[i][0] - ax;
                      const vy = basePath[i][1] - ay;
                      if (vx * fdx + vy * fdy > 0) {
                        basePath[i] = [ax, ay, alt];
                      } else {
                        break;
                      }
                    }
                  }
                  basePath[basePath.length - 1] = [ax, ay, alt];
                }
                return basePath;
              },
              getColor: (d) => {
                const len = d.path.length;
                const base = altColors
                  ? altitudeToColor(d.baroAltitude)
                  : defaultColor;
                return Array.from({ length: len }, (_, i) => {
                  const tVal = len > 1 ? i / (len - 1) : 1;
                  return [
                    base[0],
                    base[1],
                    base[2],
                    Math.round(tVal * tVal * 100),
                  ];
                }) as [number, number, number, number][];
              },
              getWidth: 2,
              widthUnits: "pixels",
              widthMinPixels: 1,
              widthMaxPixels: 4,
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
