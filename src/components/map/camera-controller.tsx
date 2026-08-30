"use client";

import { useEffect, useRef, type MutableRefObject } from "react";
import { useMap } from "./map";
import {
  centerLngLatForScreenOffset,
  projectLngLatElevationPixelDelta,
  smoothstep,
} from "./camera-controller-utils";
import { getZoomAdjustedElevationScale } from "./altitude-projection";
import { useSettings } from "@/hooks/use-settings";
import type { City } from "@/lib/cities";
import type { FlightState } from "@/lib/opensky";
import { altitudeToElevation } from "@/lib/flight-utils";
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

const DEFAULT_ZOOM = 9.2;
const DEFAULT_PITCH = 49;
const DEFAULT_BEARING = 27.4;
const FOLLOW_ZOOM = 10.5;
const FOLLOW_PITCH = 55;
const FOLLOW_EASE_MS = 2000;
const CITY_FLY_MS = 2800;
const PANEL_VISUAL_EASE_MS = 320;
const PANEL_VISUAL_REFINEMENT_MS = 220;

type FpvPosition = { lng: number; lat: number; alt: number; track: number };

export function CameraController({
  city,
  followFlight = null,
  fpvFlight = null,
  fpvPositionRef,
  panelCamera,
}: {
  city: City;
  followFlight?: FlightState | null;
  fpvFlight?: FlightState | null;
  fpvPositionRef?: MutableRefObject<FpvPosition | null>;
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
  const fpvFlightRef = useRef<FlightState | null>(fpvFlight);
  const fpvPosRef = useRef(fpvPositionRef);
  const previousFpvKeyRef = useRef<string | null>(null);
  const previousPanelFocusRef = useRef<string | null>(null);
  const previousPanelInsetRef = useRef(0);
  const cityTransitionTargetRef = useRef<[number, number] | null>(null);
  const panelCameraRef = useRef(panelCamera);
  const hasPanelCoordinates = panelCamera.coordinates !== null;
  const fpvKey = fpvFlight?.icao24 ?? null;

  useEffect(() => {
    fpvPosRef.current = fpvPositionRef;
  }, [fpvPositionRef]);

  useEffect(() => {
    fpvFlightRef.current = fpvFlight;
  }, [fpvFlight]);

  useEffect(() => {
    panelCameraRef.current = panelCamera;
  }, [panelCamera]);

  // City flyTo
  useEffect(() => {
    if (!map || !isLoaded || !city) return;
    if (city.id === prevCityRef.current) return;

    prevCityRef.current = city.id;
    if (panelCamera.open && panelCamera.kind === "flight") {
      cityTransitionTargetRef.current = null;
      return;
    }

    cityTransitionTargetRef.current = city.coordinates;
    const isAirportPanelNavigation =
      panelCamera.open && panelCamera.kind === "airport";
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
      padding: mapPanelPadding(panelCamera),
      ...transitionOptions,
    });

    return () => window.clearTimeout(clearTargetTimer);
  }, [map, isLoaded, city, panelCamera]);

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
    const insetChanged =
      Math.abs(activePanel.leftInsetPx - previousPanelInsetRef.current) > 0.5;

    if (!activePanel.open) {
      const shouldResetPadding =
        previousPanelFocusRef.current !== null ||
        previousPanelInsetRef.current > 0;
      previousPanelFocusRef.current = null;
      previousPanelInsetRef.current = 0;

      if (
        (!shouldResetPadding && !isExitingFpv) ||
        cityTransitionTargetRef.current
      ) {
        return;
      }

      map.easeTo({
        ...(isExitingFpv
          ? {
              center: city.coordinates,
              zoom: DEFAULT_ZOOM,
              pitch: DEFAULT_PITCH,
              bearing: DEFAULT_BEARING,
            }
          : {}),
        padding,
        ...panelMotion,
      });
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

    if (!shouldCenter && !insetChanged) return;

    map.easeTo({
      ...(shouldCenter && coordinates ? { center: coordinates } : {}),
      ...(isExitingFpv
        ? {
            zoom: DEFAULT_ZOOM,
            pitch: DEFAULT_PITCH,
            bearing: DEFAULT_BEARING,
          }
        : {}),
      padding,
      ...panelMotion,
    });

    if (shouldCenter) previousPanelFocusRef.current = focusKey;
    previousPanelInsetRef.current = activePanel.leftInsetPx;

    const shouldCorrectFlightAltitude =
      activePanel.kind === "flight" &&
      Boolean(focusKey && coordinates) &&
      (shouldCenter || insetChanged);
    if (!shouldCorrectFlightAltitude || !focusKey) return;

    let correctionTimer: number | null = null;
    let refinementTimer: number | null = null;
    correctionTimer = window.setTimeout(() => {
      const currentPanel = panelCameraRef.current;
      if (!currentPanel.open || currentPanel.focusKey !== focusKey) return;

      const currentCoordinates = currentPanel.coordinates;
      const altitudeMeters = currentPanel.altitudeMeters;
      if (!currentCoordinates || altitudeMeters == null) return;

      const elevationMeters =
        altitudeToElevation(
          altitudeMeters,
          settings.altitudeDisplayMode,
        ) *
        getZoomAdjustedElevationScale(
          map.getZoom(),
          settings.altitudeDisplayMode,
        );
      const elevatedPoint = projectLngLatElevationPixelDelta(
        map,
        currentCoordinates[0],
        currentCoordinates[1],
        elevationMeters,
      );
      const groundPoint = projectLngLatElevationPixelDelta(
        map,
        currentCoordinates[0],
        currentCoordinates[1],
        0,
      );
      if (!elevatedPoint || !groundPoint) return;

      const canvas = map.getCanvas();
      const offset = panelVisualOffset(
        {
          dx: elevatedPoint.dx - groundPoint.dx,
          dy: elevatedPoint.dy - groundPoint.dy,
        },
        canvas.clientWidth,
        canvas.clientHeight,
      );
      if (Math.abs(offset[0]) < 0.5 && Math.abs(offset[1]) < 0.5) return;

      const correctedCenter = centerLngLatForScreenOffset(
        map,
        currentCoordinates[0],
        currentCoordinates[1],
        offset,
      );
      if (!correctedCenter) return;

      map.easeTo({
        center: correctedCenter,
        padding: mapPanelPadding(currentPanel),
        duration: reduceMotion ? 0 : PANEL_VISUAL_EASE_MS,
        easing: panelMotion.easing,
        essential: false,
      });

      refinementTimer = window.setTimeout(() => {
        const refinedPanel = panelCameraRef.current;
        if (!refinedPanel.open || refinedPanel.focusKey !== focusKey) return;

        const refinedCoordinates = refinedPanel.coordinates;
        const refinedAltitudeMeters = refinedPanel.altitudeMeters;
        if (!refinedCoordinates || refinedAltitudeMeters == null) return;

        const refinedElevationMeters =
          altitudeToElevation(
            refinedAltitudeMeters,
            settings.altitudeDisplayMode,
          ) *
          getZoomAdjustedElevationScale(
            map.getZoom(),
            settings.altitudeDisplayMode,
          );
        const elevatedResidual = projectLngLatElevationPixelDelta(
          map,
          refinedCoordinates[0],
          refinedCoordinates[1],
          refinedElevationMeters,
        );
        const groundResidual = projectLngLatElevationPixelDelta(
          map,
          refinedCoordinates[0],
          refinedCoordinates[1],
          0,
        );
        if (!elevatedResidual || !groundResidual) return;

        const refinedOffset = panelVisualOffset(
          {
            dx: elevatedResidual.dx - groundResidual.dx,
            dy: elevatedResidual.dy - groundResidual.dy,
          },
          canvas.clientWidth,
          canvas.clientHeight,
        );
        const refinedCenter = centerLngLatForScreenOffset(
          map,
          refinedCoordinates[0],
          refinedCoordinates[1],
          refinedOffset,
        );
        if (!refinedCenter) return;

        map.easeTo({
          center: refinedCenter,
          padding: mapPanelPadding(refinedPanel),
          duration: reduceMotion ? 0 : PANEL_VISUAL_REFINEMENT_MS,
          easing: panelMotion.easing,
          essential: false,
        });
      }, reduceMotion ? 0 : PANEL_VISUAL_EASE_MS + 40);
    }, reduceMotion ? 0 : MAP_PANEL_TRANSITION_MS + 80);

    return () => {
      if (correctionTimer !== null) window.clearTimeout(correctionTimer);
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

  // FPV camera hook
  useFpvCamera(
    map,
    isLoaded,
    fpvFlight,
    fpvFlightRef,
    fpvPosRef,
    isFpvActiveRef,
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
