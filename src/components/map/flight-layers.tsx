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
  MLAT_POSITION_ALPHA,
  AIRCRAFT_PICK_RADIUS_PX,
  GLOBE_FADE_ZOOM_FLOOR,
  GLOBE_FADE_ZOOM_CEIL,
  LOD_3D_ZOOM_IN,
  LOD_3D_ZOOM_OUT,
  type FlightLayerProps,
} from "./flight-layer-constants";

import {
  categorySizeMultiplier,
  tintAircraftColor,
  applySpecialTint,
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
import { altitudeToColor, altitudeToElevation } from "@/lib/flight-utils";
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
  // Recent poll intervals for median smoothing — prevents event loop
  // stalls from inflating animDuration beyond the true poll cadence.
  const recentIntervalsRef = useRef<number[]>([]);

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

  // Set on tab resume, cleared when fresh flight data arrives.
  // While true, the RAF loop clamps rawT to 1 (no dead reckoning)
  // so aircraft freeze at last-known positions on stale data instead
  // of extrapolating forward on minutes-old headings.
  const resumeSnapRef = useRef(false);

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
    const now = performance.now();
    const elapsed = now - dataTimestampRef.current;

    // If data is stale (tab was hidden 15s+), snap directly to new
    // positions instead of slowly interpolating from outdated ones.
    const STALE_THRESHOLD_MS = 15_000;
    const isStale =
      dataTimestampRef.current > 0 && elapsed > STALE_THRESHOLD_MS;

    if (isStale) {
      const snap = new Map<string, Snapshot>();
      for (const f of flights) {
        if (f.longitude != null && f.latitude != null) {
          snap.set(f.icao24, {
            lng: f.longitude,
            lat: f.latitude,
            alt: Number.isFinite(f.baroAltitude) ? f.baroAltitude! : 0,
            track: Number.isFinite(f.trueTrack) ? f.trueTrack! : 0,
          });
        }
      }
      prevSnapshotsRef.current = snap;
      currSnapshotsRef.current = new Map(snap);
      animDurationRef.current = DEFAULT_ANIM_DURATION_MS;
      dataTimestampRef.current = now;
      lastFlightsForInterpRef.current = null;
      dataVersionRef.current++;
      return;
    }
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

        // MLAT positions (~100m accuracy) jitter visibly compared to
        // ADS-B (~10m). Apply EMA blending against the previous position
        // to suppress the noise while tracking real movement.
        const isMLAT = f.positionSource === 1;
        let lng = f.longitude;
        let lat = f.latitude;
        if (isMLAT && prev) {
          lng = prev.lng + (lng - prev.lng) * MLAT_POSITION_ALPHA;
          lat = prev.lat + (lat - prev.lat) * MLAT_POSITION_ALPHA;
        }

        next.set(f.icao24, {
          lng,
          lat,
          alt: rawAlt,
          track:
            prev != null
              ? lerpAngle(prev.track, rawTrack, TRACK_DAMPING)
              : rawTrack,
        });
      }
    }
    currSnapshotsRef.current = next;
    if (dataTimestampRef.current > 0) {
      const observedInterval = now - dataTimestampRef.current;
      // Use median of recent intervals to filter event-loop stalls.
      // A single blocked tick (e.g. heavy parse of 5K aircraft) would
      // inflate observedInterval → animDuration, making aircraft move
      // too slowly that cycle. Median is robust to such outliers.
      const intervals = recentIntervalsRef.current;
      intervals.push(observedInterval);
      if (intervals.length > 5) intervals.shift();
      const sorted = [...intervals].sort((a, b) => a - b);
      const medianInterval = sorted[Math.floor(sorted.length / 2)];
      animDurationRef.current = Math.max(
        MIN_ANIM_DURATION_MS,
        Math.min(MAX_ANIM_DURATION_MS, medianInterval * 0.94),
      );
    }
    dataTimestampRef.current = now;
    // Fresh data arrived — allow dead reckoning again (was blocked during
    // the brief window after tab resume to prevent stale-heading extrapolation).
    resumeSnapRef.current = false;
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
  useEffect(() => {
    handleHoverRef.current = handleHover;
    handleClickRef.current = handleClick;
  }, [handleHover, handleClick]);

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

    function createOverlay() {
      overlayRef.current = new MapboxOverlay({
        interleaved: false,
        views: new MapView({ id: "mapbox" }) as never,
        pickingRadius: AIRCRAFT_PICK_RADIUS_PX,
        useDevicePixels: 1,
        _typedArrayManagerProps: { overAlloc: 1.5, poolSize: 0 },
        layers: [],
      });
      map!.addControl(overlayRef.current as unknown as maplibregl.IControl);
    }

    if (!overlayRef.current) {
      createOverlay();
      preloadAllModels();
    }

    // ── WebGL context loss recovery ──────────────────────────────
    // Mobile devices may reclaim GPU memory when the app is backgrounded.
    // Without explicit handling, the deck.gl overlay becomes permanently
    // blank. We listen for context events on MapLibre's canvas and
    // rebuild the overlay when the browser restores the context.
    const canvas = map.getCanvas();

    function onContextLost(e: Event) {
      e.preventDefault(); // allow browser to attempt restoration
    }

    function onContextRestored() {
      // Tear down the dead overlay and recreate with a fresh context.
      if (overlayRef.current) {
        try {
          map!.removeControl(
            overlayRef.current as unknown as maplibregl.IControl,
          );
          overlayRef.current.finalize();
        } catch {
          /* already dead */
        }
        overlayRef.current = null;
      }
      createOverlay();
    }

    canvas.addEventListener("webglcontextlost", onContextLost);
    canvas.addEventListener("webglcontextrestored", onContextRestored);

    return () => {
      canvas.removeEventListener("webglcontextlost", onContextLost);
      canvas.removeEventListener("webglcontextrestored", onContextRestored);
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

  // Visual frame counter — increments once per rendered frame.
  // Used in updateTriggers so deck.gl recomputes attributes only when we push.
  const visualFrameRef = useRef(0);
  // LOD state: true = render 3D ScenegraphLayers, false = render 2D IconLayer.
  // Uses hysteresis to avoid flickering at the zoom boundary.
  const use3DRef = useRef(true);
  // Pitch/bank time-based throttle (~10fps regardless of animation frame rate)
  const lastPitchBankTimeRef = useRef(0);

  // ── Main animation loop ────────────────────────────────────────────

  useEffect(() => {
    if (!atlasUrl) return;

    // Hoisted constant — avoids allocating a new array every frame
    const DEFAULT_COLOR: [number, number, number, number] = [
      180, 220, 255, 200,
    ];

    // Snap aircraft to last-known positions on tab resume so they
    // don't slowly slide from stale locations.  dataTimestampRef is
    // intentionally NOT reset — keeping it stale ensures the next
    // data arrival triggers the stale-data guard and snaps directly
    // to fresh positions instead of interpolating from minutes-old ones.
    // resumeSnapRef prevents dead reckoning on stale headings during
    // the brief window before fresh data arrives.
    function onVisibilityResume() {
      if (document.visibilityState === "visible") {
        const curr = currSnapshotsRef.current;
        if (curr.size > 0) {
          prevSnapshotsRef.current = new Map(curr);
        }
        animDurationRef.current = DEFAULT_ANIM_DURATION_MS;
        lastFlightsForInterpRef.current = null;
        resumeSnapRef.current = true;
      }
    }
    document.addEventListener("visibilitychange", onVisibilityResume);

    function buildAndPushLayers() {
      animFrameRef.current = requestAnimationFrame(buildAndPushLayers);

      // Skip all rendering work when tab is hidden — saves CPU/GPU.
      // RAF is already throttled to ~1fps in background but each tick
      // would still construct layers & run interpolation for nothing.
      if (document.hidden) return;

      const overlay = overlayRef.current;
      if (!overlay) return;

      const now = performance.now();
      visualFrameRef.current++;

      const currentZoom = map?.getZoom() ?? 10;
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
        // After tab resume, clamp rawT so aircraft freeze at last-known
        // positions instead of dead-reckoning forward on stale headings.
        // Cleared when fresh flight data arrives in the flights useEffect.
        const rawT = resumeSnapRef.current
          ? Math.min(elapsed / animDurationRef.current, 1)
          : elapsed / animDurationRef.current;
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

        // ── Globe dots ────────────────────────────────────────────────
        updateGlobeDotsRef.current(isGlobe, currentZoom, now);

        const altColors = showAltColorsRef.current;
        const visibleFlights = interpolated;

        // Pitch/bank change slowly — recompute at ~10fps regardless of
        // animation frame rate. Values are retained in pitchMapRef/bankMapRef
        // between compute frames.
        const PITCH_BANK_INTERVAL_MS = 100;
        if (now - lastPitchBankTimeRef.current >= PITCH_BANK_INTERVAL_MS) {
          lastPitchBankTimeRef.current = now;
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
        // constructing 4 IconLayer objects + deck.gl diffing per frame.
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

        // ── LOD: 3D models vs 2D icons ────────────────────────────────
        // At low zoom, aircraft are too small to distinguish 3D silhouettes.
        // Switch to a single IconLayer (2D) below LOD_3D_ZOOM_OUT and back
        // to ScenegraphLayers (3D) above LOD_3D_ZOOM_IN. The hysteresis
        // band (6.5–7.5) prevents rapid flickering at the boundary.
        if (use3DRef.current && currentZoom < LOD_3D_ZOOM_OUT) {
          use3DRef.current = false;
        } else if (!use3DRef.current && currentZoom >= LOD_3D_ZOOM_IN) {
          use3DRef.current = true;
        }

        if (use3DRef.current) {
          // 3D: one ScenegraphLayer per model type
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
        } else {
          // 2D: single IconLayer using the sprite atlas (much cheaper GPU-wise)
          layers.push(
            new IconLayer<FlightState>({
              id: "flight-aircraft-2d",
              pickable: true,
              visible: layersVisible,
              data: visibleFlights,
              opacity: globeFade,
              getPosition: (d) => [
                d.longitude!,
                d.latitude!,
                altitudeToElevation(d.baroAltitude) * elevScale,
              ],
              getIcon: () => "aircraft",
              getSize: (d) => 20 * categorySizeMultiplier(d.category),
              getColor: (d) => {
                const base = altColors
                  ? altitudeToColor(d.baroAltitude)
                  : DEFAULT_COLOR;
                const catColor = tintAircraftColor(base, d.category);
                return applySpecialTint(catColor, d.dbFlags, d.emergencyStatus);
              },
              getAngle: (d) =>
                360 - (Number.isFinite(d.trueTrack) ? d.trueTrack! : 0),
              iconAtlas: atlasUrl,
              iconMapping: AIRCRAFT_ICON_MAPPING,
              billboard: false,
              sizeUnits: "pixels",
              sizeScale: 1,
              onHover: stableHover,
              onClick: stableClick,
              autoHighlight: true,
              highlightColor: [255, 255, 255, 80],
              updateTriggers: {
                getPosition: [visualFrameRef.current, elevScale],
                getAngle: visualFrameRef.current,
                getColor: [dataVersionRef.current, altColors],
              },
            }),
          );
        }

        overlay.setProps({ layers });
      } catch (err) {
        if (process.env.NODE_ENV === "development") {
          console.error("[aeris] FlightLayers render error:", err);
        }
      }
    }

    buildAndPushLayers();
    return () => {
      cancelAnimationFrame(animFrameRef.current);
      document.removeEventListener("visibilitychange", onVisibilityResume);
    };
  }, [atlasUrl, haloUrl, ringUrl, stableHover, stableClick, map]);

  return null;
}
