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
  panelVisualOffset,
  shouldCenterMapPanel,
  type MapPanelCameraState,
} from "./panel-camera";

const DEFAULT_ZOOM = 9.2;
const DEFAULT_PITCH = 49;
const DEFAULT_BEARING = 27.4;
const FOLLOW_ZOOM = 10.5;
const FOLLOW_PITCH = 55;
const FOLLOW_EASE_MS = 2000;
const CITY_FLY_MS = 2800;
const PANEL_EASE_MS = 640;
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
  const prevFpvRef = useRef<string | null>(null);
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
  const previousPanelFocusRef = useRef<string | null>(null);
  const cityTransitionTargetRef = useRef<[number, number] | null>(null);
  const panelCameraRef = useRef(panelCamera);
  const hasPanelCoordinates = panelCamera.coordinates !== null;

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
      duration: CITY_FLY_MS,
      essential: true,
    });

    return () => window.clearTimeout(clearTargetTimer);
  }, [map, isLoaded, city, panelCamera.open, panelCamera.kind]);

  useEffect(() => {
    if (!map || !isLoaded) return;

    const activePanel = panelCameraRef.current;

    if (!activePanel.open) {
      previousPanelFocusRef.current = null;
      return;
    }

    if (!shouldCenterMapPanel(previousPanelFocusRef.current, activePanel)) {
      return;
    }

    const focusKey = activePanel.focusKey;
    const coordinates = activePanel.coordinates;
    if (!focusKey || !coordinates) return;

    const panelJustOpened = previousPanelFocusRef.current === null;
    const followsCityTransition =
      activePanel.kind === "airport" &&
      coordinatesMatch(cityTransitionTargetRef.current, coordinates);

    if (followsCityTransition) {
      previousPanelFocusRef.current = focusKey;
      return;
    }

    let correctionTimer: number | null = null;
    let refinementTimer: number | null = null;
    const centerTimer = window.setTimeout(() => {
      const currentPanel = panelCameraRef.current;
      if (!currentPanel.open || currentPanel.focusKey !== focusKey) return;

      const currentCoordinates = currentPanel.coordinates;
      if (!currentCoordinates) return;
      previousPanelFocusRef.current = focusKey;

      map.easeTo({
        center: currentCoordinates,
        duration: PANEL_EASE_MS,
        essential: true,
      });

      if (currentPanel.kind !== "flight") return;

      correctionTimer = window.setTimeout(() => {
        const latestPanel = panelCameraRef.current;
        if (!latestPanel.open || latestPanel.focusKey !== focusKey) return;

        const latestCoordinates = latestPanel.coordinates;
        const altitudeMeters = latestPanel.altitudeMeters;
        if (!latestCoordinates || altitudeMeters == null) return;

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
          latestCoordinates[0],
          latestCoordinates[1],
          elevationMeters,
        );
        const groundPoint = projectLngLatElevationPixelDelta(
          map,
          latestCoordinates[0],
          latestCoordinates[1],
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
          latestCoordinates[0],
          latestCoordinates[1],
          offset,
        );
        if (!correctedCenter) return;

        map.easeTo({
          center: correctedCenter,
          duration: PANEL_VISUAL_EASE_MS,
          essential: true,
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
            duration: PANEL_VISUAL_REFINEMENT_MS,
            essential: true,
          });
        }, PANEL_VISUAL_EASE_MS + 40);
      }, PANEL_EASE_MS + 80);
    }, panelJustOpened ? PANEL_EASE_MS : 0);

    return () => {
      window.clearTimeout(centerTimer);
      if (correctionTimer !== null) window.clearTimeout(correctionTimer);
      if (refinementTimer !== null) window.clearTimeout(refinementTimer);
    };
  }, [
    map,
    isLoaded,
    panelCamera.open,
    panelCamera.focusKey,
    panelCamera.kind,
    hasPanelCoordinates,
    settings.altitudeDisplayMode,
  ]);

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
    city,
    fpvFlightRef,
    fpvPosRef,
    isFpvActiveRef,
    prevFpvRef,
    settings.altitudeDisplayMode,
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
