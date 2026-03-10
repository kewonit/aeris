"use client";

import { useEffect, useRef, useCallback } from "react";
import maplibregl from "maplibre-gl";
import { MapboxOverlay } from "@deck.gl/mapbox";
import { IconLayer } from "@deck.gl/layers";
import { ScenegraphLayer } from "@deck.gl/mesh-layers";
import { useMap } from "./map";
import { altitudeToColor, altitudeToElevation } from "@/lib/flight-utils";
import type { FlightState } from "@/lib/opensky";
import { type PickingInfo, MapView } from "@deck.gl/core";

import type { DeckGLOverlay, Snapshot } from "./flight-layer-constants";
import {
  DEFAULT_ANIM_DURATION_MS,
  MIN_ANIM_DURATION_MS,
  MAX_ANIM_DURATION_MS,
  TELEPORT_THRESHOLD,
  TRACK_DAMPING,
  AIRCRAFT_SCENEGRAPH_URL,
  AIRCRAFT_PX_PER_UNIT,
  BASE_AIRCRAFT_SIZE,
  AIRCRAFT_PICK_RADIUS_PX,
  GLOBE_FADE_ZOOM_FLOOR,
  GLOBE_FADE_ZOOM_CEIL,
  type FlightLayerProps,
} from "./flight-layer-constants";

import {
  categorySizeMultiplier,
  tintAircraftColor,
  AIRCRAFT_ICON_MAPPING,
  getHaloUrl,
  getRingUrl,
  getAircraftAtlasUrl,
} from "./aircraft-appearance";

import {
  lerpAngle,
  smoothStep,
  computePitchByIcao,
  computeInterpolatedFlights,
} from "./flight-animation-helpers";

import { buildTrailLayers } from "./flight-layer-builders";
import { buildSelectionPulseLayers } from "./flight-layer-builders";
import { useGlobeDots } from "./use-globe-dots";

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
  globeMode = false,
  fpvIcao24 = null,
  fpvPositionRef,
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
  const onClickRef = useRef(onClick);
  const showTrailsRef = useRef(showTrails);
  const trailThicknessRef = useRef(trailThickness);
  const trailDistanceRef = useRef(trailDistance);
  const showShadowsRef = useRef(showShadows);
  const showAltColorsRef = useRef(showAltitudeColors);
  const globeModeRef = useRef(globeMode);
  const selectedIcao24Ref = useRef(selectedIcao24);
  const fpvIcao24Ref = useRef(fpvIcao24);
  const fpvPosRef = useRef(fpvPositionRef);
  const prevSelectedRef = useRef<string | null>(null);
  const selectionChangeTimeRef = useRef(0);

  const { updateGlobeDots } = useGlobeDots(
    map,
    isLoaded,
    flightsRef,
    trailsRef,
    dataTimestampRef,
    onClickRef,
    showTrailsRef,
  );

  // Stabilize updateGlobeDots via ref so the animation loop doesn't restart on every render
  const updateGlobeDotsRef = useRef(updateGlobeDots);

  // ── Sync props into refs ───────────────────────────────────────────

  useEffect(() => {
    updateGlobeDotsRef.current = updateGlobeDots;
    flightsRef.current = flights;
    trailsRef.current = trails;
    showTrailsRef.current = showTrails;
    trailThicknessRef.current = trailThickness;
    trailDistanceRef.current = trailDistance;
    showShadowsRef.current = showShadows;
    showAltColorsRef.current = showAltitudeColors;
    fpvIcao24Ref.current = fpvIcao24;
    fpvPosRef.current = fpvPositionRef;
    onClickRef.current = onClick;
    globeModeRef.current = globeMode;
    if (selectedIcao24 !== selectedIcao24Ref.current) {
      prevSelectedRef.current = selectedIcao24Ref.current;
      selectionChangeTimeRef.current = performance.now();
    }
    selectedIcao24Ref.current = selectedIcao24;
  }, [
    updateGlobeDots,
    flights,
    trails,
    onClick,
    showTrails,
    trailThickness,
    trailDistance,
    showShadows,
    showAltitudeColors,
    globeMode,
    selectedIcao24,
    fpvIcao24,
    fpvPositionRef,
  ]);

  // ── Snapshot interpolation on new data ─────────────────────────────

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
        const rawTrack = Number.isFinite(f.trueTrack) ? f.trueTrack! : 0;
        const rawAlt = Number.isFinite(f.baroAltitude) ? f.baroAltitude! : 0;
        next.set(f.icao24, {
          lng: f.longitude,
          lat: f.latitude,
          alt: rawAlt,
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

  // ── Cursor management ──────────────────────────────────────────────

  const handleHover = useCallback(
    (info: PickingInfo<FlightState>) => {
      const canvas = map?.getCanvas();
      if (canvas) canvas.style.cursor = info.object ? "pointer" : "";
    },
    [map],
  );

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

  // ── Map click pass-through ─────────────────────────────────────────

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

  // ── Overlay lifecycle ──────────────────────────────────────────────

  useEffect(() => {
    if (!map || !isLoaded) return;

    if (!overlayRef.current) {
      overlayRef.current = new MapboxOverlay({
        interleaved: false,
        views: new MapView({ id: "mapbox" }) as never,
        pickingRadius: AIRCRAFT_PICK_RADIUS_PX,
        layers: [],
      });
      map.addControl(overlayRef.current as unknown as maplibregl.IControl);
    }

    return () => {
      if (overlayRef.current) {
        try {
          overlayRef.current.finalize();
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

  // ── Main animation loop ────────────────────────────────────────────

  useEffect(() => {
    if (!atlasUrl) return;

    function buildAndPushLayers() {
      animFrameRef.current = requestAnimationFrame(buildAndPushLayers);

      const overlay = overlayRef.current;
      if (!overlay) return;

      const currentZoom = map?.getZoom() ?? 10;
      const now = performance.now();
      const isGlobe = globeModeRef.current;

      updateGlobeDotsRef.current(isGlobe, currentZoom, now);

      let globeFade = 1;
      let layersVisible = true;
      if (isGlobe) {
        if (currentZoom < GLOBE_FADE_ZOOM_FLOOR) {
          layersVisible = false;
          globeFade = 0;
        } else if (currentZoom < GLOBE_FADE_ZOOM_CEIL) {
          const t =
            (currentZoom - GLOBE_FADE_ZOOM_FLOOR) /
            (GLOBE_FADE_ZOOM_CEIL - GLOBE_FADE_ZOOM_FLOOR);
          globeFade = t * t * t;
        }
      }

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

        const interpolated = computeInterpolatedFlights(
          currentFlights,
          prevSnapshotsRef.current,
          currSnapshotsRef.current,
          tPos,
          tAngle,
          rawT,
          animDurationRef.current,
        );

        const interpolatedMap = new Map<string, FlightState>();
        for (const f of interpolated) {
          interpolatedMap.set(f.icao24, f);
        }

        // FPV position output
        const fpvId = fpvIcao24Ref.current?.toLowerCase() ?? null;
        const visibleFlights = interpolated;
        const fpvPosOut = fpvPosRef.current;
        if (fpvPosOut && fpvId) {
          const fpvF =
            interpolated.find((f) => f.icao24.toLowerCase() === fpvId) ?? null;
          if (
            fpvF &&
            Number.isFinite(fpvF.longitude) &&
            Number.isFinite(fpvF.latitude)
          ) {
            fpvPosOut.current = {
              lng: fpvF.longitude!,
              lat: fpvF.latitude!,
              alt: Number.isFinite(fpvF.baroAltitude)
                ? fpvF.baroAltitude!
                : 5000,
              track: Number.isFinite(fpvF.trueTrack) ? fpvF.trueTrack! : 0,
            };
          } else {
            fpvPosOut.current = null;
          }
        } else if (fpvPosOut && !fpvId) {
          fpvPosOut.current = null;
        }

        const pitchByIcao = computePitchByIcao(
          interpolated,
          new Map(currentTrails.map((t) => [t.icao24, t])),
          currSnapshotsRef.current,
          prevSnapshotsRef.current,
        );

        const layers = [];

        // Shadow layer — always included, toggled via `visible` to retain WebGL state
        layers.push(
          new IconLayer<FlightState>({
            id: "flight-shadows",
            visible: layersVisible && showShadowsRef.current,
            data: visibleFlights,
            opacity: globeFade,
            getPosition: (d) => [d.longitude!, d.latitude!, 0],
            getIcon: () => "aircraft",
            getSize: (d) => 20 * categorySizeMultiplier(d.category),
            getColor: () => [0, 0, 0, 60],
            getAngle: (d) =>
              360 - (Number.isFinite(d.trueTrack) ? d.trueTrack! : 0),
            iconAtlas: atlasUrl,
            iconMapping: AIRCRAFT_ICON_MAPPING,
            billboard: false,
            sizeUnits: "pixels",
            sizeScale: 1,
          }),
        );

        // Trail layer — always included, toggled via `visible` to retain WebGL state
        layers.push(
          buildTrailLayers({
            interpolated,
            interpolatedMap,
            currentTrails,
            trailDistance: trailDistanceRef.current,
            trailThickness: trailThicknessRef.current,
            altColors,
            defaultColor,
            elapsed,
            globeFade,
            currentZoom,
            visible: layersVisible && showTrailsRef.current,
          }),
        );

        // Selection pulse layers (halo + rings)
        const pulseResult = buildSelectionPulseLayers({
          selectionChangeTime: selectionChangeTimeRef.current,
          selectedId: selectedIcao24Ref.current,
          prevId: prevSelectedRef.current,
          interpolated,
          elapsed,
          globeFade,
          currentZoom,
          haloUrl,
          ringUrl,
          layersVisible,
        });
        layers.push(...pulseResult.layers);
        if (pulseResult.shouldClearPrev) {
          prevSelectedRef.current = null;
        }

        // Zoom-dependent elevation scale to prevent absurd altitude spikes
        // at globe zoom levels. Full exaggeration at city zoom (>8).
        const elevScale =
          currentZoom < 5
            ? 0.15 + (currentZoom / 5) * 0.35
            : currentZoom < 8
              ? 0.5 + ((currentZoom - 5) / 3) * 0.5
              : 1.0;

        // Aircraft 3D model layer — always included with `visible` to avoid
        // re-fetching the .glb model on every zoom in/out cycle
        layers.push(
          new ScenegraphLayer<FlightState>({
            id: "flight-aircraft",
            visible: layersVisible,
            data: visibleFlights,
            opacity: globeFade,
            getPosition: (d) => [
              d.longitude!,
              d.latitude!,
              altitudeToElevation(d.baroAltitude) * elevScale,
            ],
            getOrientation: (d) => {
              const pitch = pitchByIcao.get(d.icao24) ?? 0;
              const yaw = -(Number.isFinite(d.trueTrack) ? d.trueTrack! : 0);
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
