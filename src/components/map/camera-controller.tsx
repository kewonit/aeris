"use client";

import { useEffect, useRef } from "react";
import { useMap } from "./map";
import {
  centerLngLatForScreenOffset,
  DEFAULT_BEARING,
  DEFAULT_PITCH,
  DEFAULT_ZOOM,
  FPV_EXIT_DURATION_MS,
  fpvExitCamera,
  isWellBelowCamera,
  projectLngLatElevationPixelDelta,
  smoothstep,
} from "./camera-controller-utils";
import {
  aircraftElevationMeters,
  cameraHeightMeters,
} from "./altitude-projection";
import { useSettings } from "@/hooks/use-settings";
import type { City } from "@/lib/cities";
import type { FlightState } from "@/lib/opensky";
import type { AltitudeDisplayMode } from "@/lib/altitude-display-mode";
import { useFpvCamera } from "./use-fpv-camera";
import { useKeyboardCamera } from "./use-keyboard-camera";
import { useOrbitCamera } from "./use-orbit-camera";
import {
  coordinatesMatch,
  mapPanelMotionOptions,
  mapPanelPadding,
  panelVisualOffset,
  shouldCenterMapPanel,
  MAP_PANEL_TRANSITION_MS,
  type MapPanelCameraState,
} from "./panel-camera";

const FOLLOW_ZOOM = 10.5;
const FOLLOW_PITCH = 55;
const FOLLOW_EASE_MS = 2000;
const CITY_FLY_MS = 2800;
const PANEL_VISUAL_EASE_MS = 320;
const PANEL_VISUAL_REFINEMENT_MS = 220;


/**
 * Returns the map center that puts the aircraft as drawn (lifted by its
 * altitude) where its ground position would be, or null when no correction
 * is needed or the aircraft is drawn too near the camera's height to frame.
 */
function drawnAircraftCenter(
  map: maplibregl.Map,
  panel: MapPanelCameraState,
  altitudeMode: AltitudeDisplayMode,
): [number, number] | null {
  const { coordinates, altitudeMeters } = panel;
  if (!coordinates || altitudeMeters == null) return null;
  const [lng, lat] = coordinates;

  const canvas = map.getCanvas();
  const elevationMeters = aircraftElevationMeters(altitudeMeters, altitudeMode);
  const cameraHeight = cameraHeightMeters(
    map.getZoom(),
    map.getCenter().lat,
    canvas.clientHeight,
    map.getPitch(),
  );
  if (!isWellBelowCamera(elevationMeters, cameraHeight)) return null;
  const elevated = projectLngLatElevationPixelDelta(map, lng, lat, elevationMeters);
  const ground = projectLngLatElevationPixelDelta(map, lng, lat, 0);
  if (!elevated || !ground) return null;

  const offset = panelVisualOffset(
    { dx: elevated.dx - ground.dx, dy: elevated.dy - ground.dy },
    canvas.clientWidth,
    canvas.clientHeight,
  );
  if (Math.abs(offset[0]) < 0.5 && Math.abs(offset[1]) < 0.5) return null;
  return centerLngLatForScreenOffset(map, lng, lat, offset);
}

export function CameraController({
  city,
  followFlight = null,
  fpvIcao24 = null,
  fpvFlight = null,
  fpvHeightOffsetMeters = 0,
  panelCamera,
}: {
  city: City;
  followFlight?: FlightState | null;
  /** The FPV selection. Stays set while a poll misses the aircraft. */
  fpvIcao24?: string | null;
  fpvFlight?: FlightState | null;
  /** Added to pressure altitudes in FPV to sit them above the map. */
  fpvHeightOffsetMeters?: number;
  panelCamera: MapPanelCameraState;
}) {
  const { map, isLoaded } = useMap();
  const { settings } = useSettings();
  const prevCityRef = useRef<string | null>(null);
  const prevFollowRef = useRef<string | null>(null);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const orbitFrameRef = useRef<number | null>(null);
  const isInteractingRef = useRef(false);
  const isFollowingRef = useRef(false);
  const followFlyToActiveRef = useRef(false);
  const followFlyToTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const isFpvActiveRef = useRef(false);
  // Where the FPV aircraft was on the last frame, to centre the exit on.
  const fpvAircraftPositionRef = useRef<[number, number] | null>(null);
  const previousFpvKeyRef = useRef<string | null>(null);
  const previousPanelFocusRef = useRef<string | null>(null);
  const previousPanelInsetRef = useRef(0);
  const cityTransitionTargetRef = useRef<[number, number] | null>(null);
  const panelCameraRef = useRef(panelCamera);
  const hasPanelCoordinates = panelCamera.coordinates !== null;
  const fpvKey = fpvIcao24;

  useEffect(() => {
    panelCameraRef.current = panelCamera;
  }, [panelCamera]);

  // City flyTo
  useEffect(() => {
    if (!map || !isLoaded || !city) return;
    if (city.id === prevCityRef.current) return;

    prevCityRef.current = city.id;
    // Read the panel through its ref: depending on the panel object would
    // re-run this effect on every panel update, and the cleanup would cancel
    // the timer that clears the transition target.
    const panel = panelCameraRef.current;
    if (panel.open && panel.kind === "flight") {
      cityTransitionTargetRef.current = null;
      return;
    }

    cityTransitionTargetRef.current = city.coordinates;
    const isAirportPanelNavigation = panel.open && panel.kind === "airport";
    const reducePanelMotion =
      isAirportPanelNavigation &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const transitionOptions = isAirportPanelNavigation
      ? mapPanelMotionOptions(reducePanelMotion)
      : { duration: CITY_FLY_MS, essential: true as const };
    const clearTargetTimer = window.setTimeout(() => {
      if (coordinatesMatch(cityTransitionTargetRef.current, city.coordinates)) {
        cityTransitionTargetRef.current = null;
      }
    }, 0);
    map.flyTo({
      center: city.coordinates,
      zoom: DEFAULT_ZOOM,
      pitch: DEFAULT_PITCH,
      bearing: DEFAULT_BEARING,
      padding: mapPanelPadding(panel),
      ...transitionOptions,
    });

    return () => window.clearTimeout(clearTargetTimer);
  }, [map, isLoaded, city]);

  useEffect(() => {
    if (!map || !isLoaded) return;

    const activePanel = panelCameraRef.current;
    const padding = mapPanelPadding(activePanel);
    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const panelMotion = mapPanelMotionOptions(reduceMotion);
    const isExitingFpv =
      previousFpvKeyRef.current !== null && fpvKey === null;
    const lastCockpitPosition = (): [number, number] => {
      if (fpvAircraftPositionRef.current) return fpvAircraftPositionRef.current;
      const { lng, lat } = map.transform.getCameraLngLat();
      return [lng, lat];
    };
    const insetChanged =
      Math.abs(activePanel.leftInsetPx - previousPanelInsetRef.current) > 0.5;

    if (!activePanel.open) {
      const shouldResetPadding =
        previousPanelFocusRef.current !== null ||
        previousPanelInsetRef.current > 0;
      previousPanelFocusRef.current = null;
      previousPanelInsetRef.current = 0;

      // Leaving the cockpit always pulls out to the aircraft, whatever is
      // pending: the camera would otherwise stay in the cockpit's pose.
      if (isExitingFpv) {
        cityTransitionTargetRef.current = null;
        map.easeTo(
          fpvExitCamera({
            panelCoordinates: null,
            cockpit: lastCockpitPosition(),
            padding,
            reduceMotion,
          }),
        );
        return;
      }
      if (!shouldResetPadding || cityTransitionTargetRef.current) return;

      map.easeTo({ padding, ...panelMotion });
      return;
    }

    const shouldCenter = shouldCenterMapPanel(
      previousPanelFocusRef.current,
      activePanel,
    );
    const focusKey = activePanel.focusKey;
    const coordinates = activePanel.coordinates;
    const followsCityTransition =
      activePanel.kind === "airport" &&
      coordinates !== null &&
      coordinatesMatch(cityTransitionTargetRef.current, coordinates);

    if (followsCityTransition) {
      previousPanelFocusRef.current = focusKey ?? null;
      previousPanelInsetRef.current = activePanel.leftInsetPx;
      return;
    }

    if (!shouldCenter && !insetChanged && !isExitingFpv) return;

    if (isExitingFpv) {
      cityTransitionTargetRef.current = null;
      map.easeTo(
        fpvExitCamera({
          panelCoordinates: coordinates,
          cockpit: lastCockpitPosition(),
          padding,
          reduceMotion,
        }),
      );
    } else {
      map.easeTo({
        ...(shouldCenter && coordinates ? { center: coordinates } : {}),
        padding,
        ...panelMotion,
      });
    }

    if (shouldCenter || isExitingFpv) previousPanelFocusRef.current = focusKey;
    previousPanelInsetRef.current = activePanel.leftInsetPx;

    const shouldCorrectFlightAltitude =
      activePanel.kind === "flight" &&
      Boolean(focusKey && coordinates) &&
      (shouldCenter || insetChanged || isExitingFpv);
    if (!shouldCorrectFlightAltitude || !focusKey) return;

    // Center the drawn aircraft, which sits above its ground position, then
    // correct once more for the residual left by the first ease.
    const altitudeMode = settings.altitudeDisplayMode;
    const easeToDrawnAircraft = (duration: number): boolean => {
      const panel = panelCameraRef.current;
      if (!panel.open || panel.focusKey !== focusKey) return false;
      const center = drawnAircraftCenter(map, panel, altitudeMode);
      if (!center) return false;
      map.easeTo({
        center,
        padding: mapPanelPadding(panel),
        duration: reduceMotion ? 0 : duration,
        easing: panelMotion.easing,
        essential: false,
      });
      return true;
    };

    // Correct once the first ease has finished, which leaving the cockpit
    // takes longer to do.
    const firstEaseMs = isExitingFpv
      ? FPV_EXIT_DURATION_MS
      : MAP_PANEL_TRANSITION_MS;
    let refinementTimer: number | null = null;
    const correctionTimer = window.setTimeout(() => {
      if (!easeToDrawnAircraft(PANEL_VISUAL_EASE_MS)) return;
      refinementTimer = window.setTimeout(
        () => easeToDrawnAircraft(PANEL_VISUAL_REFINEMENT_MS),
        reduceMotion ? 0 : PANEL_VISUAL_EASE_MS + 40,
      );
    }, reduceMotion ? 0 : firstEaseMs + 80);

    return () => {
      window.clearTimeout(correctionTimer);
      if (refinementTimer !== null) window.clearTimeout(refinementTimer);
    };
  }, [
    map,
    isLoaded,
    panelCamera.open,
    panelCamera.focusKey,
    panelCamera.kind,
    panelCamera.leftInsetPx,
    hasPanelCoordinates,
    fpvKey,
    settings.altitudeDisplayMode,
    city.coordinates,
  ]);

  useEffect(() => {
    previousFpvKeyRef.current = fpvKey;
  }, [fpvKey]);

  // Follow flight init
  useEffect(() => {
    if (!map || !isLoaded) return;

    const followKey = followFlight?.icao24 ?? null;
    if (followKey === prevFollowRef.current) return;
    prevFollowRef.current = followKey;

    if (followFlyToTimerRef.current) {
      clearTimeout(followFlyToTimerRef.current);
      followFlyToTimerRef.current = null;
    }
    followFlyToActiveRef.current = false;

    if (
      !followFlight ||
      followFlight.longitude == null ||
      followFlight.latitude == null
    ) {
      isFollowingRef.current = false;
      return;
    }

    isFollowingRef.current = true;
    followFlyToActiveRef.current = true;
    const bearing = Number.isFinite(followFlight.trueTrack)
      ? followFlight.trueTrack!
      : map.getBearing();

    const FOLLOW_FLYTO_MS = 2200;
    map.flyTo({
      center: [followFlight.longitude, followFlight.latitude],
      zoom: FOLLOW_ZOOM,
      pitch: FOLLOW_PITCH,
      bearing,
      duration: FOLLOW_FLYTO_MS,
      essential: true,
    });

    followFlyToTimerRef.current = setTimeout(() => {
      followFlyToActiveRef.current = false;
      followFlyToTimerRef.current = null;
    }, FOLLOW_FLYTO_MS);
  }, [map, isLoaded, followFlight]);

  // Follow flight continuous update
  useEffect(() => {
    if (!map || !isLoaded || !followFlight) return;
    if (followFlight.longitude == null || followFlight.latitude == null) return;

    if (!isFollowingRef.current) return;
    if (followFlyToActiveRef.current) return;

    map.easeTo({
      center: [followFlight.longitude, followFlight.latitude],
      bearing: Number.isFinite(followFlight.trueTrack)
        ? followFlight.trueTrack!
        : map.getBearing(),
      duration: FOLLOW_EASE_MS,
      essential: true,
    });
  }, [
    map,
    isLoaded,
    followFlight,
    followFlight?.longitude,
    followFlight?.latitude,
    followFlight?.trueTrack,
  ]);

  useFpvCamera(
    map,
    isLoaded,
    fpvIcao24,
    fpvFlight,
    fpvHeightOffsetMeters,
    isFpvActiveRef,
    fpvAircraftPositionRef,
  );

  // North-up & reset-view
  useEffect(() => {
    if (!map || !isLoaded || !city) return;

    let northUpRafId: number | undefined;

    const onNorthUp = () => {
      if (isFpvActiveRef.current) return;
      if (northUpRafId != null) cancelAnimationFrame(northUpRafId);
      if (!map) return;
      const m = map;

      // Stop any in-progress flyTo/easeTo (e.g. city transition, follow
      // init) so this RAF setBearing() loop won't fight a parallel
      // camera animation - which causes visible oscillation.
      m.stop();

      const startBearing = m.getBearing();
      const delta = ((0 - startBearing + 540) % 360) - 180;
      if (Math.abs(delta) < 0.5) {
        m.setBearing(0);
        return;
      }
      const duration = 650;
      const start = performance.now();
      function animateBearing() {
        const t = Math.min((performance.now() - start) / duration, 1);
        const eased = smoothstep(t);
        m.setBearing(startBearing + delta * eased);
        if (t < 1) {
          northUpRafId = requestAnimationFrame(animateBearing);
        } else {
          northUpRafId = undefined;
        }
      }
      northUpRafId = requestAnimationFrame(animateBearing);
    };

    const onResetView = (event: Event) => {
      if (isFpvActiveRef.current) return;
      const customEvent = event as CustomEvent<{ center?: [number, number] }>;
      const center = customEvent.detail?.center ?? city.coordinates;
      map.flyTo({
        center,
        zoom: DEFAULT_ZOOM,
        pitch: DEFAULT_PITCH,
        bearing: DEFAULT_BEARING,
        duration: 1200,
        essential: true,
      });
    };

    window.addEventListener("aeris:north-up", onNorthUp);
    window.addEventListener("aeris:reset-view", onResetView);

    return () => {
      if (northUpRafId != null) cancelAnimationFrame(northUpRafId);
      window.removeEventListener("aeris:north-up", onNorthUp);
      window.removeEventListener("aeris:reset-view", onResetView);
    };
  }, [map, isLoaded, city]);

  // Keyboard camera hook
  useKeyboardCamera(
    map,
    isLoaded,
    isFpvActiveRef,
    isInteractingRef,
    idleTimerRef,
  );

  // Auto-orbit hook
  useOrbitCamera(
    map,
    isLoaded,
    city,
    followFlight,
    fpvFlight,
    settings,
    panelCamera.open,
    isInteractingRef,
    orbitFrameRef,
    idleTimerRef,
  );

  return null;
}
