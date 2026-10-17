"use client";

import { useEffect, useRef, useCallback } from "react";
import maplibregl from "maplibre-gl";
import { MapboxOverlay } from "@deck.gl/mapbox";
import { IconLayer } from "@deck.gl/layers";
import { useMap } from "./map";
import type { FlightState } from "@/lib/opensky";
import type { TrailTrack } from "@/lib/trails/types";
import {
  type PickingInfo,
  MapView,
  WebMercatorViewport,
} from "@deck.gl/core";

import type { DeckGLOverlay, Snapshot } from "./flight-layer-constants";
import {
  DEFAULT_ANIM_DURATION_MS,
  MIN_ANIM_DURATION_MS,
  MAX_ANIM_DURATION_MS,
  TELEPORT_THRESHOLD,
  TRACK_DAMPING,
  AIRCRAFT_PICK_RADIUS_PX,
  SELECTION_FADE_MS,
  GLOBE_FADE_ZOOM_FLOOR,
  GLOBE_FADE_ZOOM_CEIL,
  LOD_3D_ZOOM_IN,
  LOD_3D_ZOOM_OUT,
  type FlightLayerProps,
} from "./flight-layer-constants";

import {
  aircraftColor,
  AIRCRAFT_ICON_MAPPING,
  getHaloUrl,
  getRingUrl,
  getAircraftAtlasUrl,
} from "./aircraft-appearance";

import { lerpAngle, smoothStep } from "./flight-math";

import { createAttitudeState, updateAttitudes } from "./aircraft-attitude";
import {
  carryForward,
  computeInterpolatedFlights,
  displayHeading,
  FLIGHT_RENDER_STALE_MS,
  getSafeInterpolationProgress,
  noteReceipt,
  reportLeadMs,
  updateInterpolatedInPlace,
  type ReceiptDelays,
} from "./flight-interpolation";

import { buildSelectionPulseLayers } from "./selection-pulse-layers";
import { buildTrailLayers, createTrailRenderCache } from "./trail-layers";
import {
  buildFpvTrafficLabelLayer,
  pickFpvTrafficLabels,
} from "./fpv-traffic-labels";
import { buildAircraftModelLayers } from "./aircraft-model-layers";
import {
  aircraftFootprintPixels,
  aircraftTailShare,
  aircraftWingspanMeters,
  altitudeMagnification,
  fpvFootprintPixels,
  metersPerPixel,
  type AircraftScreenSize,
} from "./aircraft-size";
import { preloadAllModels } from "./aircraft-model-mapping";
import { aircraftElevationMeters } from "./altitude-projection";
import { altitudeToColor, MLAT_POSITION_ALPHA } from "@/lib/flight-utils";
import type { AltitudeDisplayMode } from "@/lib/altitude-display-mode";
import { useGlobeDots } from "./use-globe-dots";
import {
  frameIntervalMs,
  isFrameDue,
} from "./frame-rate";

/** Flat icons are never pitched, so their trails meet a level tail. */
const NO_PITCH = new Map<string, number>();
/** Seen from the cockpit, other aircraft's trails are this much fainter... */
const FPV_TRAIL_OPACITY = 0.35;
/** ...and this much thinner. */
const FPV_TRAIL_THICKNESS = 0.6;
const METERS_PER_DEGREE = 111_320;

type CockpitCamera = {
  lng: number;
  lat: number;
  alt: number;
  /** Half the canvas height over the tangent of half the field of view. */
  focalPx: number;
  /** Metres per pixel at the map's centre, the unit models are drawn in. */
  metersPerPixel: number;
};

/** Where the first person camera is, and how it maps metres to pixels. */
function cockpitCamera(
  map: maplibregl.Map,
  zoom: number,
): CockpitCamera | null {
  const { lng, lat } = map.transform.getCameraLngLat();
  const alt = map.transform.getCameraAltitude();
  if (![lng, lat, alt].every(Number.isFinite)) return null;
  const halfFov = (map.getVerticalFieldOfView() * Math.PI) / 360;
  return {
    lng,
    lat,
    alt,
    focalPx: map.getCanvas().clientHeight / 2 / Math.tan(halfFov),
    metersPerPixel: metersPerPixel(zoom, map.getCenter().lat),
  };
}

/**
 * Whether the cockpit camera can see an aircraft: within its field of view
 * across and up and down, measured as angles from the camera.
 */
function inCockpitView(
  camera: CockpitCamera,
  view: { bearing: number; pitch: number; verticalFov: number; aspect: number },
  flight: FlightState,
  elevation: number,
): boolean {
  const cosLat = Math.cos((camera.lat * Math.PI) / 180);
  const east =
    (((flight.longitude! - camera.lng + 540) % 360) - 180) *
    METERS_PER_DEGREE *
    cosLat;
  const north = (flight.latitude! - camera.lat) * METERS_PER_DEGREE;
  const across = Math.hypot(east, north);
  const bearing = (Math.atan2(east, north) * 180) / Math.PI;
  const offAxis = Math.abs(((bearing - view.bearing + 540) % 360) - 180);
  const elevationAngle =
    (Math.atan2(elevation - camera.alt, across) * 180) / Math.PI;
  const halfVertical = view.verticalFov / 2;
  const halfHorizontal =
    (Math.atan(Math.tan((halfVertical * Math.PI) / 180) * view.aspect) * 180) /
    Math.PI;
  return (
    offAxis < halfHorizontal &&
    Math.abs(elevationAngle - (view.pitch - 90)) < halfVertical
  );
}

/** Straight-line metres from the cockpit camera to an aircraft. */
function distanceFromCockpit(
  camera: CockpitCamera,
  flight: FlightState,
  altitudeMode: AltitudeDisplayMode,
  altitudeOffset: number,
): number {
  const cosLat = Math.cos(
    (((camera.lat + flight.latitude!) / 2) * Math.PI) / 180,
  );
  const east =
    (((flight.longitude! - camera.lng + 540) % 360) - 180) *
    METERS_PER_DEGREE *
    cosLat;
  const north = (flight.latitude! - camera.lat) * METERS_PER_DEGREE;
  const up =
    aircraftElevationMeters(flight.baroAltitude, altitudeMode, altitudeOffset) -
    camera.alt;
  return Math.hypot(east, north, up);
}

export function FlightLayers({
  flights,
  trails,
  onClick,
  selectedIcao24,
  showTrails,
  trailThickness,
  trailMinutes,
  trailCeilingMeters,
  showShadows,
  showAltitudeColors,
  altitudeDisplayMode,
  globeMode = false,
  fpvIcao24 = null,
  fpvHeightOffsetMeters = 0,
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
  // Recent poll intervals for median smoothing - prevents event loop
  // stalls from inflating animDuration beyond the true poll cadence.
  const recentIntervalsRef = useRef<number[]>([]);
  // How quickly each provider's answers reach us, to time its reports.
  const receiptDelaysRef = useRef<ReceiptDelays>(new Map());

  // Persistent caches reused across animation frames to reduce GC pressure
  const trailRenderCacheRef = useRef(createTrailRenderCache());
  const interpolatedMapRef = useRef(new Map<string, FlightState>());
  const aircraftSizesRef = useRef(new Map<string, AircraftScreenSize>());
  // Every aircraft's shown pitch and bank, eased from frame to frame.
  const attitudeRef = useRef(createAttitudeState());
  // Cached trail-by-icao24 Map - rebuilt only when trailsRef changes, not every frame
  const trailMapRef = useRef(new Map<string, TrailTrack>());
  const lastTrailsForMapRef = useRef<TrailTrack[] | null>(null);

  // Interpolation pool - reuse FlightState objects between animation frames
  // to avoid ~18K object allocations/sec from spread syntax
  const interpArrayRef = useRef<FlightState[]>([]);
  const lastFlightsForInterpRef = useRef<FlightState[] | null>(null);

  // Set on tab resume, cleared when fresh flight data arrives.
  // While true, the RAF loop holds traffic at its current snapshot, so
  // aircraft freeze at last-known positions on stale data instead of
  // gliding on along minutes-old moves.
  const resumeSnapRef = useRef(false);
  const pageActiveRef = useRef(true);
  const requestRenderRef = useRef<() => void>(() => {});

  // Data version increments when raw flight data changes - drives color/scale updateTriggers
  const dataVersionRef = useRef(0);

  const flightsRef = useRef(flights);
  const trailsRef = useRef(trails);
  const onClickRef = useRef(onClick);
  const showTrailsRef = useRef(showTrails);
  const trailThicknessRef = useRef(trailThickness);
  const trailMinutesRef = useRef(trailMinutes);
  const trailCeilingMetersRef = useRef(trailCeilingMeters);
  const showShadowsRef = useRef(showShadows);
  const showAltColorsRef = useRef(showAltitudeColors);
  const altitudeDisplayModeRef = useRef(altitudeDisplayMode);
  const globeModeRef = useRef(globeMode);
  const selectedIcao24Ref = useRef(selectedIcao24);
  const fpvIcao24Ref = useRef(fpvIcao24);
  const fpvHeightOffsetRef = useRef(fpvHeightOffsetMeters);
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
    trailMinutesRef.current = trailMinutes;
    trailCeilingMetersRef.current = trailCeilingMeters;
    showShadowsRef.current = showShadows;
    showAltColorsRef.current = showAltitudeColors;
    altitudeDisplayModeRef.current = altitudeDisplayMode;
    fpvIcao24Ref.current = fpvIcao24;
    fpvHeightOffsetRef.current = fpvHeightOffsetMeters;
    onClickRef.current = onClick;
    globeModeRef.current = globeMode;
    if (selectedIcao24 !== selectedIcao24Ref.current) {
      prevSelectedRef.current = selectedIcao24Ref.current;
      selectionChangeTimeRef.current = performance.now();
    }
    selectedIcao24Ref.current = selectedIcao24;
    requestRenderRef.current();
  }, [
    updateGlobeDots,
    flights,
    trails,
    onClick,
    showTrails,
    trailThickness,
    trailMinutes,
    trailCeilingMeters,
    showShadows,
    showAltitudeColors,
    altitudeDisplayMode,
    globeMode,
    selectedIcao24,
    fpvIcao24,
    fpvHeightOffsetMeters,
  ]);

  // ── Snapshot interpolation on new data ─────────────────────────────

  useEffect(() => {
    const now = performance.now();
    const elapsed = now - dataTimestampRef.current;
    // Every report is placed where its aircraft is as the poll arrives.
    const receivedAt = Date.now();
    noteReceipt(receiptDelaysRef.current, flights, receivedAt);
    const reported = (f: FlightState) =>
      carryForward(f, reportLeadMs(f, receivedAt, receiptDelaysRef.current));

    // If data is stale (tab was hidden 15s+), snap directly to new
    // positions instead of slowly interpolating from outdated ones.
    const isStale =
      dataTimestampRef.current > 0 && elapsed > FLIGHT_RENDER_STALE_MS;

    if (isStale) {
      const snap = new Map<string, Snapshot>();
      for (const f of flights) {
        const at = reported(f);
        if (at) {
          snap.set(f.icao24, {
            lng: at.lng,
            lat: at.lat,
            alt: at.alt ?? 0,
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
      requestRenderRef.current();
      return;
    }
    // Where each aircraft is drawn now, which may be a little past its last
    // report if this one came late; its next move starts from there.
    const oldLinearT = getSafeInterpolationProgress({
      elapsedMs: elapsed,
      animDurationMs: animDurationRef.current,
      pageActive: pageActiveRef.current && !resumeSnapRef.current,
    }).tPos;
    const oldAngleT = smoothStep(Math.min(oldLinearT, 1));

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
            // Where the nose pointed as this report arrived, to turn on from.
            heading: displayHeading(
              oldPrev,
              oldCurr,
              oldLinearT * animDurationRef.current,
            ),
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
      const at = reported(f);
      if (at) {
        const prev = newPrev.get(f.icao24);
        const rawTrack = Number.isFinite(f.trueTrack) ? f.trueTrack! : 0;
        const rawAlt = at.alt ?? 0;

        // MLAT positions (~100m accuracy) jitter visibly compared to
        // ADS-B (~10m). Apply EMA blending against the previous position
        // to suppress the noise while tracking real movement.
        const isMLAT = f.positionSource === "mlat";
        let lng = at.lng;
        let lat = at.lat;
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
        // A move lasts the whole interval, so aircraft glide on until the
        // next report instead of arriving early and standing still.
        Math.min(MAX_ANIM_DURATION_MS, medianInterval),
      );
    }
    dataTimestampRef.current = now;
    // Fresh data arrived - allow dead reckoning again (was blocked during
    // the brief window after tab resume to prevent stale-heading extrapolation).
    resumeSnapRef.current = false;
    // Increment data version so model layers know color/scale need recomputation
    dataVersionRef.current++;
    requestRenderRef.current();
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

  // Stable refs for event handlers - prevents RAF loop restart when handlers change
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
      if (e.defaultPrevented) return;

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

    function createOverlay(): MapboxOverlay {
      const overlay = new MapboxOverlay({
        interleaved: false,
        views: new MapView({ id: "mapbox" }) as never,
        pickingRadius: AIRCRAFT_PICK_RADIUS_PX,
        useDevicePixels: 1,
        deviceProps: {
          webgl: { antialias: false, preserveDrawingBuffer: false },
        },
        _typedArrayManagerProps: { overAlloc: 1.5, poolSize: 0 },
        layers: [],
      });
      overlayRef.current = overlay;
      map!.addControl(overlay as unknown as maplibregl.IControl);
      return overlay;
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
    const mapCanvas = map.getCanvas();
    let deckCanvas: HTMLCanvasElement | null = null;
    let recreatingOverlay = false;

    function onContextLost(e: Event) {
      e.preventDefault(); // allow browser to attempt restoration
    }

    function onContextRestored() {
      if (recreatingOverlay) return;
      recreatingOverlay = true;
      if (deckCanvas && deckCanvas !== mapCanvas) {
        deckCanvas.removeEventListener("webglcontextlost", onContextLost);
        deckCanvas.removeEventListener("webglcontextrestored", onContextRestored);
      }
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
      const restoredOverlay = createOverlay();
      trailRenderCacheRef.current = createTrailRenderCache();
      requestRenderRef.current();
      deckCanvas = restoredOverlay.getCanvas();
      if (deckCanvas && deckCanvas !== mapCanvas) {
        deckCanvas.addEventListener("webglcontextlost", onContextLost);
        deckCanvas.addEventListener("webglcontextrestored", onContextRestored);
      }
      recreatingOverlay = false;
    }

    mapCanvas.addEventListener("webglcontextlost", onContextLost);
    mapCanvas.addEventListener("webglcontextrestored", onContextRestored);
    deckCanvas = overlayRef.current?.getCanvas() ?? null;
    if (deckCanvas && deckCanvas !== mapCanvas) {
      deckCanvas.addEventListener("webglcontextlost", onContextLost);
      deckCanvas.addEventListener("webglcontextrestored", onContextRestored);
    }

    return () => {
      mapCanvas.removeEventListener("webglcontextlost", onContextLost);
      mapCanvas.removeEventListener("webglcontextrestored", onContextRestored);
      if (deckCanvas && deckCanvas !== mapCanvas) {
        deckCanvas.removeEventListener("webglcontextlost", onContextLost);
        deckCanvas.removeEventListener("webglcontextrestored", onContextRestored);
      }
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

  // Visual frame counter - increments once per rendered frame.
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

    // Hoisted constant - avoids allocating a new array every frame
    const DEFAULT_COLOR: [number, number, number, number] = [
      180, 220, 255, 200,
    ];

    // Only a hidden page pauses the map. A visible but unfocused window, such
    // as one on a second screen, keeps animating.
    const isPageActive = () => document.visibilityState === "visible";
    let lastRenderedAt = 0;
    let needsRender = true;
    let continueAnimating = true;
    let cameraMoving = false;

    function scheduleFrame() {
      if (
        animFrameRef.current !== 0 ||
        !pageActiveRef.current ||
        !isPageActive()
      ) {
        return;
      }
      animFrameRef.current = requestAnimationFrame(buildAndPushLayers);
    }

    function requestRender() {
      needsRender = true;
      scheduleFrame();
    }

    requestRenderRef.current = requestRender;

    function freezeAtCurrentSnapshots() {
      const curr = currSnapshotsRef.current;
      if (curr.size > 0) {
        prevSnapshotsRef.current = new Map(curr);
      }
      animDurationRef.current = DEFAULT_ANIM_DURATION_MS;
      lastFlightsForInterpRef.current = null;
      resumeSnapRef.current = true;
    }

    function markPageInactive() {
      pageActiveRef.current = false;
      if (animFrameRef.current !== 0) {
        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = 0;
      }
      freezeAtCurrentSnapshots();
    }

    function handlePageResume() {
      pageActiveRef.current = isPageActive();
      freezeAtCurrentSnapshots();

      if (pageActiveRef.current) {
        requestRender();
      }
    }

    function onVisibilityChange() {
      if (document.visibilityState === "visible") {
        handlePageResume();
      } else {
        markPageInactive();
      }
    }
    pageActiveRef.current = isPageActive();
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pagehide", markPageInactive);
    window.addEventListener("pageshow", handlePageResume);
    document.addEventListener("freeze", markPageInactive);
    document.addEventListener("resume", handlePageResume);
    // Sizes and trail heads depend on the camera, so a moving camera redraws
    // at a faster cadence to keep them in step with it.
    function onCameraMove() {
      cameraMoving = true;
      requestRender();
    }
    map?.on("move", onCameraMove);
    map?.on("style.load", requestRender);

    function buildAndPushLayers(now: number) {
      animFrameRef.current = 0;

      // Skip rendering while the tab is hidden.
      if (!isPageActive()) {
        if (pageActiveRef.current) {
          markPageInactive();
        }
        return;
      }

      const frameInterval = frameIntervalMs({
        fpv: Boolean(fpvIcao24Ref.current),
        cameraMoving,
      });
      if (!isFrameDue(lastRenderedAt, now, frameInterval)) {
        scheduleFrame();
        return;
      }

      if (!needsRender && !continueAnimating) return;
      needsRender = false;
      cameraMoving = false;
      lastRenderedAt = now;

      const overlay = overlayRef.current;
      if (!overlay) return;

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
        const elapsed = now - dataTimestampRef.current;
        const progress = getSafeInterpolationProgress({
          elapsedMs: elapsed,
          animDurationMs: animDurationRef.current,
          // `resumeSnapRef` stays true until fresh flight data arrives; during
          // that resume window we render the latest authoritative snapshot only.
          pageActive: pageActiveRef.current && !resumeSnapRef.current,
        });
        const tPos = progress.tPos;

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
            animDurationRef.current,
          );
          interpArrayRef.current = interpolated;
          lastFlightsForInterpRef.current = currentFlights;

          // Rebuild Map only on new poll - updateInterpolatedInPlace mutates
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
            animDurationRef.current,
          );
        }

        const fpvId = fpvIcao24Ref.current?.toLowerCase() ?? null;

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

        if (!layersVisible) {
          overlay.setProps({ layers: [] });
          continueAnimating = false;
          return;
        }

        const altColors = showAltColorsRef.current;
        // In FPV the camera sits inside this aircraft, so its own icon,
        // model, shadow, and trail would block the view. Other traffic stays.
        const visibleFlights = fpvId
          ? interpolated.filter((flight) => flight.icao24 !== fpvId)
          : interpolated;
        const modelFlights = fpvId
          ? currentFlights.filter((flight) => flight.icao24 !== fpvId)
          : currentFlights;

        // The FPV camera sits at the aircraft's true altitude, so traffic is
        // drawn at true altitudes too. Otherwise the exaggerated presentation
        // heights would float every other aircraft far above the horizon.
        const altitudeMode: AltitudeDisplayMode = fpvId
          ? "realistic"
          : altitudeDisplayModeRef.current;
        // ...and above the local ground, as the camera is (fpv-height).
        const altitudeOffset = fpvId ? fpvHeightOffsetRef.current : 0;

        // Pitch and bank follow each aircraft's reported motion and change
        // slowly, so they are eased at ~10fps whatever the frame rate.
        const PITCH_BANK_INTERVAL_MS = 100;
        if (now - lastPitchBankTimeRef.current >= PITCH_BANK_INTERVAL_MS) {
          lastPitchBankTimeRef.current = now;
          updateAttitudes(currentFlights, attitudeRef.current, now);
        }
        const pitchByIcao = attitudeRef.current.pitch;
        const bankByIcao = attitudeRef.current.bank;

        const layers = [];

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

        // Every aircraft's drawn size, shared by models, icons, shadows, and
        // trail heads so they agree. 3D models are drawn at their exaggerated
        // height, where perspective would enlarge them, so outside FPV that
        // enlargement is measured and divided back out.
        const aircraftSizes = aircraftSizesRef.current;
        aircraftSizes.clear();
        let project: ((position: [number, number, number]) => number[]) | null =
          null;
        const bearing = map?.getBearing() ?? 0;
        if (use3DRef.current && !fpvId && map) {
          const canvas = map.getCanvas();
          const center = map.getCenter();
          const viewport = new WebMercatorViewport({
            width: canvas.clientWidth,
            height: canvas.clientHeight,
            longitude: center.lng,
            latitude: center.lat,
            zoom: currentZoom,
            pitch: map.getPitch(),
            bearing,
            padding: map.getPadding(),
          });
          project = (position) => viewport.project(position);
        }
        // From the cockpit, traffic is drawn at its real size for its
        // distance from the camera, kept a visible dot when far away.
        const cockpit = fpvId && map ? cockpitCamera(map, currentZoom) : null;
        for (const flight of visibleFlights) {
          if (flight.longitude == null || flight.latitude == null) continue;
          const wingspan = aircraftWingspanMeters(flight);
          aircraftSizes.set(flight.icao24, {
            footprintPx: cockpit
              ? fpvFootprintPixels(
                  wingspan,
                  distanceFromCockpit(
                    cockpit,
                    flight,
                    altitudeMode,
                    altitudeOffset,
                  ),
                  cockpit.focalPx,
                  cockpit.metersPerPixel,
                )
              : aircraftFootprintPixels(wingspan, currentZoom, flight.latitude),
            magnification: project
              ? altitudeMagnification(
                  project,
                  flight.longitude,
                  flight.latitude,
                  aircraftElevationMeters(flight.baroAltitude, altitudeMode),
                  bearing,
                )
              : 1,
            tailShare: aircraftTailShare(flight, use3DRef.current),
          });
        }
        const footprintOf = (flight: FlightState) =>
          aircraftSizes.get(flight.icao24)?.footprintPx ?? 20;

        // From the cockpit, ground shadows sit far below their aircraft
        // and would be sized for the aircraft, not the ground.
        if (layersVisible && showShadowsRef.current && !fpvId) {
          layers.push(
            new IconLayer<FlightState>({
            id: "flight-shadows",
            pickable: false,
            visible: true,
            data: visibleFlights,
            opacity: globeFade,
            getPosition: (d) => [d.longitude!, d.latitude!, 0],
            getIcon: () => "aircraft",
            getSize: footprintOf,
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
              getSize: visualFrameRef.current,
            },
            }),
          );
        }

        if (layersVisible && showTrailsRef.current) {
          layers.push(
            ...buildTrailLayers({
              flights: visibleFlights,
              aircraftSizes,
              pitchByIcao: use3DRef.current ? pitchByIcao : NO_PITCH,
              // A halo reads as a streak across the cockpit's sky, and full
              // trails crowd it, so they are thinner and fainter there.
              glow: !fpvId,
              zoom: currentZoom,
              trailMap: trailMapRef.current,
              selectedIcao24: selectedIcao24Ref.current,
              trailMinutes: trailMinutesRef.current,
              ceilingMeters: trailCeilingMetersRef.current,
              thickness:
                trailThicknessRef.current * (fpvId ? FPV_TRAIL_THICKNESS : 1),
              altColors,
              altitudeDisplayMode: altitudeMode,
              altitudeOffsetMeters: altitudeOffset,
              defaultColor: DEFAULT_COLOR,
              opacity: globeFade * (fpvId ? FPV_TRAIL_OPACITY : 1),
              cache: trailRenderCacheRef.current,
            }),
          );
        }

        // Selection pulse layers (halo + rings) - skip entirely when
        // nothing is selected and no fade-out is in progress. Saves
        // constructing 4 IconLayer objects + deck.gl diffing per frame.
        if (
          layersVisible &&
          !fpvId &&
          (selectedIcao24Ref.current || prevSelectedRef.current)
        ) {
          const pulseResult = buildSelectionPulseLayers({
            selectionChangeTime: selectionChangeTimeRef.current,
            selectedId: selectedIcao24Ref.current,
            prevId: prevSelectedRef.current,
            interpolated,
            interpolatedMap: interpolatedMapRef.current,
            elapsed,
            globeFade,
            currentZoom,
            altitudeDisplayMode: altitudeMode,
            haloUrl,
            ringUrl,
            layersVisible,
          });
          layers.push(...pulseResult.layers);
          if (pulseResult.shouldClearPrev) {
            prevSelectedRef.current = null;
          }
        }

        if (!layersVisible) {
          // Native MapLibre globe layers own low-zoom rendering. Leaving the
          // Deck layer list empty releases its per-layer buffers and work.
        } else if (use3DRef.current) {
          // 3D: one ScenegraphLayer per model type
          layers.push(
            ...buildAircraftModelLayers({
              rawFlights: modelFlights,
              interpolatedMap: interpolatedMapRef.current,
              frameCounter: visualFrameRef.current,
              dataVersion: dataVersionRef.current,
              layersVisible,
              globeFade,
              aircraftSizes,
              altitudeDisplayMode: altitudeMode,
              altitudeOffsetMeters: altitudeOffset,
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
              visible: true,
              data: visibleFlights,
              opacity: globeFade,
              getPosition: (d) => [
                d.longitude!,
                d.latitude!,
                aircraftElevationMeters(
                  d.baroAltitude,
                  altitudeMode,
                  altitudeOffset,
                ),
              ],
              getIcon: () => "aircraft",
              getSize: footprintOf,
              getColor: (d) => {
                const base = altColors
                  ? altitudeToColor(d.baroAltitude)
                  : DEFAULT_COLOR;
                return aircraftColor(base, d);
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
                getPosition: [
                  visualFrameRef.current,
                  altitudeMode,
                  altitudeOffset,
                ],
                getAngle: visualFrameRef.current,
                getSize: visualFrameRef.current,
                getColor: [dataVersionRef.current, altColors],
              },
            }),
          );
        }

        // Nearby traffic is labelled from the cockpit, as on a traffic display.
        if (layersVisible && cockpit && map) {
          const canvas = map.getCanvas();
          const view = {
            bearing: map.getBearing(),
            pitch: map.getPitch(),
            verticalFov: map.getVerticalFieldOfView(),
            aspect: canvas.clientWidth / Math.max(1, canvas.clientHeight),
          };
          const elevationOf = (flight: FlightState) =>
            aircraftElevationMeters(
              flight.baroAltitude,
              altitudeMode,
              altitudeOffset,
            );
          const labels = pickFpvTrafficLabels(
            visibleFlights,
            cockpit.alt,
            elevationOf,
            (flight) =>
              distanceFromCockpit(cockpit, flight, altitudeMode, altitudeOffset),
            footprintOf,
            (flight) =>
              inCockpitView(cockpit, view, flight, elevationOf(flight)),
          );
          if (labels.length > 0) {
            layers.push(
              buildFpvTrafficLabelLayer(
                labels,
                document.documentElement.classList.contains("dark")
                  ? "dark"
                  : "light",
              ),
            );
          }
        }

        overlay.setProps({ layers });

        const selectionAnimating =
          (selectedIcao24Ref.current != null || prevSelectedRef.current != null) &&
          now - selectionChangeTimeRef.current < SELECTION_FADE_MS;
        continueAnimating =
          layersVisible &&
          ((!resumeSnapRef.current &&
            currentFlights.length > 0 &&
            progress.moving) ||
            fpvId != null ||
            selectionAnimating);
        if (continueAnimating) scheduleFrame();
      } catch (err) {
        continueAnimating = false;
        if (process.env.NODE_ENV === "development") {
          console.error("[aeris] FlightLayers render error:", err);
        }
      }
    }

    requestRender();
    return () => {
      requestRenderRef.current = () => {};
      if (animFrameRef.current !== 0) {
        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = 0;
      }
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pagehide", markPageInactive);
      window.removeEventListener("pageshow", handlePageResume);
      document.removeEventListener("freeze", markPageInactive);
      document.removeEventListener("resume", handlePageResume);
      map?.off("move", onCameraMove);
      map?.off("style.load", requestRender);
    };
  }, [atlasUrl, haloUrl, ringUrl, stableHover, stableClick, map]);

  return null;
}
