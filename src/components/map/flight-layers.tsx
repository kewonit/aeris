"use client";

import { useEffect, useRef, useCallback } from "react";
import maplibregl from "maplibre-gl";
import { MapboxOverlay } from "@deck.gl/mapbox";
import { IconLayer } from "@deck.gl/layers";
import { useMap } from "./map";
import type { FlightState } from "@/lib/opensky";
import type { TrailEntry } from "@/hooks/use-trail-history";
import { type PickingInfo, MapView } from "@deck.gl/core";

import type {
  DeckGLOverlay,
  ElevatedPoint,
  Snapshot,
} from "./flight-layer-constants";
import {
  DEFAULT_ANIM_DURATION_MS,
  MIN_ANIM_DURATION_MS,
  MAX_ANIM_DURATION_MS,
  TELEPORT_THRESHOLD,
  TRACK_DAMPING,
  AIRCRAFT_PICK_RADIUS_PX,
  GLOBE_FADE_ZOOM_FLOOR,
  GLOBE_FADE_ZOOM_CEIL,
  type FlightLayerProps,
} from "./flight-layer-constants";

import {
  categorySizeMultiplier,
  AIRCRAFT_ICON_MAPPING,
  getHaloUrl,
  getRingUrl,
  getAircraftAtlasUrl,
} from "./aircraft-appearance";

import {
  lerpAngle,
  smoothStep,
  computePitchByIcao,
  computeBankByIcao,
  computeInterpolatedFlights,
  updateInterpolatedInPlace,
} from "./flight-animation-helpers";

import { buildTrailLayers } from "./flight-layer-builders";
import { buildSelectionPulseLayers } from "./flight-layer-builders";
import { buildAircraftModelLayers } from "./aircraft-model-layers";
import { preloadAllModels } from "./aircraft-model-mapping";
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

  // Persistent caches reused across animation frames to reduce GC pressure
  const trailBasePathCacheRef = useRef(
    new Map<string, { key: string; basePath: ElevatedPoint[] }>(),
  );
  const interpolatedMapRef = useRef(new Map<string, FlightState>());
  const pitchMapRef = useRef(new Map<string, number>());
  const bankMapRef = useRef(new Map<string, number>());
  // Reusable containers for buildTrailLayers — clear+reuse each frame
  const handledIdsRef = useRef(new Set<string>());
  const visibleTrailCacheRef = useRef(new Map<string, ElevatedPoint[]>());
  const activeIcaosRef = useRef(new Set<string>());
  // Persistent caches for slope-limited trail paths and colors across frames
  const trailPathCacheRef = useRef(
    new Map<string, { key: string; result: [number, number, number][] }>(),
  );
  const trailColorCacheRef = useRef(
    new Map<
      string,
      { key: string; result: [number, number, number, number][] }
    >(),
  );
  // Cached trail-by-icao24 Map — rebuilt only when trailsRef changes, not every frame
  const trailMapRef = useRef(new Map<string, TrailEntry>());
  const lastTrailsForMapRef = useRef<TrailEntry[] | null>(null);

  // Interpolation pool — reuse FlightState objects between animation frames
  // to avoid ~18K object allocations/sec from spread syntax
  const interpArrayRef = useRef<FlightState[]>([]);
  const lastFlightsForInterpRef = useRef<FlightState[] | null>(null);

  // Data version increments when raw flight data changes — drives color/scale updateTriggers
  const dataVersionRef = useRef(0);

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
    // Increment data version so model layers know color/scale need recomputation
    dataVersionRef.current++;
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

  // Stable refs for event handlers — prevents RAF loop restart when handlers change
  const handleHoverRef = useRef(handleHover);
  const handleClickRef = useRef(handleClick);
  handleHoverRef.current = handleHover;
  handleClickRef.current = handleClick;

  const stableHover = useCallback(
    (info: PickingInfo<FlightState>) => handleHoverRef.current(info),
    [],
  );
  const stableClick = useCallback(
    (info: PickingInfo<FlightState>) => handleClickRef.current(info),
    [],
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
        useDevicePixels: 1,
        layers: [],
      });
      map.addControl(overlayRef.current as unknown as maplibregl.IControl);
      preloadAllModels();
    }

    return () => {
      if (overlayRef.current) {
        try {
          map.removeControl(
            overlayRef.current as unknown as maplibregl.IControl,
          );
          overlayRef.current.finalize();
        } catch {
          /* unmounted */
        }
        overlayRef.current = null;
      }
    };
  }, [map, isLoaded]);

  // Frame pacing: only push layer updates to deck.gl every TARGET_FRAME_MS
  // to avoid overloading the GPU/attribute pipeline. Interpolation still
  // happens every rAF for smooth FPV camera tracking.
  const lastSetPropsTimeRef = useRef(0);
  // Visual frame counter — only increments when we actually push layers
  // to deck.gl. Used in updateTriggers so deck.gl doesn't recompute
  // attribute buffers on skipped frames.
  const visualFrameRef = useRef(0);

  // ── Main animation loop ────────────────────────────────────────────

  useEffect(() => {
    if (!atlasUrl) return;

    // Target ~24fps for deck.gl layer updates. The rAF still fires at
    // ~60fps for smooth interpolation / FPV camera, but layer construction
    // + overlay.setProps are skipped on intermediate frames.
    const TARGET_FRAME_MS = 42;

    // Hoisted constant — avoids allocating a new array every frame
    const DEFAULT_COLOR: [number, number, number, number] = [
      180, 220, 255, 200,
    ];

    function buildAndPushLayers() {
      animFrameRef.current = requestAnimationFrame(buildAndPushLayers);

      const overlay = overlayRef.current;
      if (!overlay) return;

      const currentZoom = map?.getZoom() ?? 10;
      const now = performance.now();
      const isGlobe = globeModeRef.current;

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

        // On new poll data: full interpolation (creates new FlightState objects).
        // Between polls: mutate positions in-place (zero object allocations).
        let interpolated: FlightState[];
        if (currentFlights !== lastFlightsForInterpRef.current) {
          interpolated = computeInterpolatedFlights(
            currentFlights,
            prevSnapshotsRef.current,
            currSnapshotsRef.current,
            tPos,
            tAngle,
            rawT,
            animDurationRef.current,
          );
          interpArrayRef.current = interpolated;
          lastFlightsForInterpRef.current = currentFlights;

          // Rebuild Map only on new poll — updateInterpolatedInPlace mutates
          // the same FlightState objects in-place, so existing Map entries
          // remain valid between polls.
          const interpolatedMap = interpolatedMapRef.current;
          interpolatedMap.clear();
          for (const f of interpolated) {
            interpolatedMap.set(f.icao24, f);
          }
        } else {
          interpolated = interpArrayRef.current;
          updateInterpolatedInPlace(
            interpolated,
            currentFlights,
            prevSnapshotsRef.current,
            currSnapshotsRef.current,
            tPos,
            tAngle,
            rawT,
            animDurationRef.current,
          );
        }

        // FPV position output — O(1) Map lookup instead of O(n) find
        const fpvId = fpvIcao24Ref.current?.toLowerCase() ?? null;
        const fpvPosOut = fpvPosRef.current;
        if (fpvPosOut && fpvId) {
          const fpvF = interpolatedMapRef.current.get(fpvId) ?? null;
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

        // Rebuild trail-by-icao24 Map only when trails reference changes
        if (currentTrails !== lastTrailsForMapRef.current) {
          trailMapRef.current.clear();
          for (const t of currentTrails) {
            trailMapRef.current.set(t.icao24, t);
          }
          lastTrailsForMapRef.current = currentTrails;
        }

        // ── Frame throttle ──────────────────────────────────────────
        // Interpolation + FPV updates above still run every rAF for
        // smooth position tracking. Everything below (layer construction,
        // pitch/bank, globe dots, overlay.setProps) is throttled to
        // ~24fps to halve deck.gl's internal attribute recomputation,
        // WebGL draw calls, and MapLibre GeoJSON updates.
        if (now - lastSetPropsTimeRef.current < TARGET_FRAME_MS) return;
        lastSetPropsTimeRef.current = now;
        visualFrameRef.current++;

        // Globe dots — throttled along with deck.gl updates
        updateGlobeDotsRef.current(isGlobe, currentZoom, now);

        const altColors = showAltColorsRef.current;
        const visibleFlights = interpolated;

        // Pitch/bank change slowly — recompute every 3rd visual frame (~8fps)
        // to avoid iterating all flights at 24fps. Values are retained in
        // pitchMapRef/bankMapRef between compute frames.
        if (visualFrameRef.current % 3 === 0) {
          computePitchByIcao(
            interpolated,
            trailMapRef.current,
            currSnapshotsRef.current,
            prevSnapshotsRef.current,
            pitchMapRef.current,
          );

          computeBankByIcao(
            interpolated,
            prevSnapshotsRef.current,
            currSnapshotsRef.current,
            tAngle,
            bankMapRef.current,
          );
        }
        const pitchByIcao = pitchMapRef.current;
        const bankByIcao = bankMapRef.current;

        const layers = [];

        // Zoom-dependent elevation scale to prevent absurd altitude spikes
        // at globe zoom levels. Full exaggeration at city zoom (>8).
        // Computed once per frame and passed to all builders.
        const elevScale =
          currentZoom < 5
            ? 0.15 + (currentZoom / 5) * 0.35
            : currentZoom < 8
              ? 0.5 + ((currentZoom - 5) / 3) * 0.5
              : 1.0;

        // Shadow layer — always included, toggled via `visible` to retain WebGL state
        layers.push(
          new IconLayer<FlightState>({
            id: "flight-shadows",
            pickable: false,
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
            updateTriggers: {
              getPosition: visualFrameRef.current,
              getAngle: visualFrameRef.current,
            },
          }),
        );

        // Trail layer — always included, toggled via `visible` to retain WebGL state
        layers.push(
          buildTrailLayers({
            interpolated,
            interpolatedMap: interpolatedMapRef.current,
            currentTrails,
            trailMap: trailMapRef.current,
            trailDistance: trailDistanceRef.current,
            trailThickness: trailThicknessRef.current,
            altColors,
            defaultColor: DEFAULT_COLOR,
            elapsed,
            visualFrame: visualFrameRef.current,
            globeFade,
            currentZoom,
            elevScale,
            visible: layersVisible && showTrailsRef.current,
            trailBasePathCache: trailBasePathCacheRef.current,
            trailPathCache: trailPathCacheRef.current,
            trailColorCache: trailColorCacheRef.current,
            handledIdsSet: handledIdsRef.current,
            visibleTrailCacheMap: visibleTrailCacheRef.current,
            activeIcaosSet: activeIcaosRef.current,
          }),
        );

        // Selection pulse layers (halo + rings) — skip entirely when
        // nothing is selected and no fade-out is in progress. Saves
        // constructing 8 IconLayer objects + deck.gl diffing per frame.
        if (selectedIcao24Ref.current || prevSelectedRef.current) {
          const pulseResult = buildSelectionPulseLayers({
            selectionChangeTime: selectionChangeTimeRef.current,
            selectedId: selectedIcao24Ref.current,
            prevId: prevSelectedRef.current,
            interpolated,
            interpolatedMap: interpolatedMapRef.current,
            elapsed,
            globeFade,
            currentZoom,
            elevScale,
            haloUrl,
            ringUrl,
            layersVisible,
          });
          layers.push(...pulseResult.layers);
          if (pulseResult.shouldClearPrev) {
            prevSelectedRef.current = null;
          }
        }

        // Aircraft 3D model layers — one ScenegraphLayer per model type,
        // always included with `visible` to avoid re-fetching .glb files
        layers.push(
          ...buildAircraftModelLayers({
            rawFlights: currentFlights,
            interpolatedMap: interpolatedMapRef.current,
            frameCounter: visualFrameRef.current,
            dataVersion: dataVersionRef.current,
            layersVisible,
            globeFade,
            elevScale,
            altColors,
            defaultColor: DEFAULT_COLOR,
            pitchByIcao,
            bankByIcao,
            handleHover: stableHover,
            handleClick: stableClick,
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
  }, [atlasUrl, haloUrl, ringUrl, stableHover, stableClick, map]);

  return null;
}
