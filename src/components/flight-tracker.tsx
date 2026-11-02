"use client";

import {
  useState,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  type CSSProperties,
} from "react";
import { AnimatePresence, MotionConfig } from "motion/react";
import dynamic from "next/dynamic";
import { useTheme } from "@wrksz/themes/client";
import { ErrorBoundary } from "@/components/error-boundary";
import { Map as MapView, type MapRef } from "@/components/map/map";
import { CameraController } from "@/components/map/camera-controller";
import {
  CLOSED_MAP_PANEL_CAMERA_STATE,
  createMapPanelCameraState,
  MAP_PANEL_EASE_CSS,
  MAP_PANEL_TRANSITION_MS,
} from "@/components/map/panel-camera";
import { AirportLayer } from "@/components/map/airport-layer";
import { AirspaceLayer } from "@/components/map/airspace-layer";
import { WeatherRadarLayer } from "@/components/map/weather-radar-layer";
import { UserLocationMarker } from "@/components/map/user-location-marker";
import { FlightLayers } from "@/components/map/flight-layers";
import { FpvHud } from "@/components/ui/fpv-hud";

const ControlPanel = dynamic(() =>
  import("@/components/ui/control-panel").then((mod) => mod.ControlPanel),
);
import {
  PLACE_PANEL_WIDTH,
  PlacePanel,
  type PlacePanelKind,
} from "@/components/place/place-panel";
import { PlaceSheet } from "@/components/place/place-sheet";
import { AltitudeLegend } from "@/components/ui/altitude-legend";
import { CameraControls } from "@/components/ui/camera-controls";
import { StatusBar } from "@/components/ui/status-bar";
import { MapAttribution } from "@/components/ui/map-attribution";
import { AtcPlayerBar } from "@/components/ui/atc-panel";
const AirportInfoCard = dynamic(() =>
  import("@/components/ui/airport-info-card").then(
    (mod) => mod.AirportInfoCard,
  ),
);
import { MapMenu } from "@/components/chrome/map-menu";
import { LocateButton } from "@/components/chrome/locate-button";
import { Compass, CompassBridge } from "@/components/chrome/compass";
import {
  SettingsProvider,
  trailCeilingMeters,
  useSettings,
} from "@/hooks/use-settings";
import { useKeyboardShortcuts } from "@/hooks/use-keyboard-shortcuts";
import { useFlights } from "@/hooks/use-flights";
import { useTrailSystem } from "@/hooks/use-trail-system";
import { useFlightMonitors } from "@/hooks/use-flight-monitors";
import { useSelectedAircraft } from "@/hooks/use-selected-aircraft";
import { useAtcStream } from "@/hooks/use-atc-stream";
import { useIsMobile } from "@/hooks/use-is-mobile";
import { useAirportBoard } from "@/hooks/use-airport-board";
import { AircraftCard } from "@/components/place/aircraft-card";
import { FollowChip } from "@/components/chrome/follow-chip";
import { HoverCard } from "@/components/chrome/hover-card";
import { SearchPill } from "@/components/search/search-pill";
import {
  locationToCity,
  type SearchLocation,
} from "@/lib/search-location-client";
import type { MapStyle } from "@/lib/map-styles";
import type { City } from "@/lib/cities";
import type { FlightState } from "@/lib/opensky";
import type { FpvDrawnPosition } from "@/components/map/flight-layer-constants";

import { fetchFlightByHex, fetchFlightByCallsign } from "@/lib/flight-api";
import { expandFlightQuery, flightQueryMatches } from "@/lib/airlines";
import { findNearestAirport, airportToCity } from "@/lib/airports";
import { findCityByCode } from "@/lib/city-routing";
import {
  INITIAL_SELECTION,
  selectedAircraftIcao24,
  selectedAirportIata as selectedAirportOf,
  useSelection,
} from "@/hooks/use-selection";
import type { PendingAircraftLink } from "@/hooks/use-flight-monitors";
import type { SelectionLink } from "@/components/flight-tracker-utils";
import {
  computeAirspaceBounds,
  FPV_BOUNDS_SNAP_DEG,
  FPV_AIRSPACE_RADIUS_DEG,
  AIRSPACE_RADIUS_MULTIPLIER,
} from "@/lib/airspace-style";
import type { PickingInfo } from "@deck.gl/core";
import {
  DEFAULT_CITY,
  DEFAULT_STYLE,
  subscribeNoop,
  resolveInitialCity,
  syncCityToUrl,
  syncSelectionToUrl,
  resolveInitialLink,
  loadMapStyle,
  saveMapStyle,
} from "@/components/flight-tracker-utils";
import {
  pickRandomAirportCity,
  cityFromFlight,
} from "@/components/flight-tracker-random";

type FlightTrackerProps = {
  airspaceAvailable?: boolean;
  /**
   * City resolved on the server from the URL (e.g. /city/[code]).
   * When provided, this takes precedence over any client-side URL parsing
   * to avoid hydration flicker and keep SSR output in sync with the client.
   */
  initialCity?: City;
};

function FlightTrackerInner({
  airspaceAvailable = true,
  initialCity,
}: FlightTrackerProps) {
  // useSyncExternalStore with a no-op subscriber reads localStorage once
  // on the client while returning DEFAULT_CITY on the server - SSR-safe
  // hydration without useEffect flicker.
  //
  // When the server already resolved a city (from a /city/[code] route),
  // use that as both the server snapshot and the client snapshot so
  // hydration matches and we skip one client-side URL parse.
  const hydratedCity = useSyncExternalStore(
    subscribeNoop,
    initialCity ? () => initialCity : resolveInitialCity,
    () => initialCity ?? DEFAULT_CITY,
  );
  const hydratedStyle = useSyncExternalStore(
    subscribeNoop,
    loadMapStyle,
    () => DEFAULT_STYLE,
  );

  const [cityOverride, setCityOverride] = useState<City | undefined>();
  // Where the first person aircraft is drawn, shared from the flight
  // layers to the camera that follows it.
  const fpvDrawnRef = useRef<FpvDrawnPosition | null>(null);
  // Where the followed aircraft is drawn, for the camera that centres it.
  const followDrawnRef = useRef<FpvDrawnPosition | null>(null);
  const [styleOverride, setStyleOverride] = useState<MapStyle | undefined>();
  // A shared link is read once and opened after the first render, so the
  // server's HTML and the browser's first render agree. An aircraft waits
  // in pendingLinkRef until the feed or a lookup finds it.
  const [initialLink] = useState(resolveInitialLink);
  const [selectionState, dispatch] = useSelection(INITIAL_SELECTION);
  const selectedIcao24 = selectedAircraftIcao24(selectionState);
  const selectedAirportIata = selectedAirportOf(selectionState);
  const followIcao24 = selectionState.follow;
  const fpvIcao24 = selectionState.fpv;
  const [leftPanelInsetPx, setLeftPanelInsetPx] = useState(0);
  const [sheetPeekPx, setSheetPeekPx] = useState(0);
  const mapRef = useRef<MapRef>(null);

  const restoreMapFocus = useCallback(() => {
    window.requestAnimationFrame(() => {
      mapRef.current?.getCanvas().focus({ preventScroll: true });
    });
  }, []);

  const pendingLinkRef = useRef<SelectionLink | null>(initialLink);

  const [fpvSeedCenter, setFpvSeedCenter] = useState<{
    lng: number;
    lat: number;
  } | null>(null);

  const lookupAbortRef = useRef<AbortController | null>(null);
  const [userLocation, setUserLocation] = useState<[number, number] | null>(
    null,
  );

  const activeCity = cityOverride ?? hydratedCity;
  const mapStyle = styleOverride ?? hydratedStyle;
  const { settings, update } = useSettings();
  const { setTheme } = useTheme();
  const isMobile = useIsMobile();
  const showAirspace = airspaceAvailable && settings.showAirspace;

  // Frosted navigation can be turned off; the page root carries the choice.
  useEffect(() => {
    document.documentElement.toggleAttribute(
      "data-solid-panels",
      settings.solidPanels,
    );
  }, [settings.solidPanels]);

  // Sync document theme with current map style (dark/light)
  useEffect(() => {
    setTheme(mapStyle.dark ? "dark" : "light");
  }, [mapStyle.dark, setTheme]);

  const setActiveCity = useCallback(
    (city: City) => {
      setCityOverride(city);
      dispatch({ type: "reset" });
      syncCityToUrl(city);
    },
    [dispatch],
  );

  /** Called when user clicks an airport dot on the map - navigates AND opens the board. */
  const handleAirportDotClick = useCallback(
    (city: City) => {
      setCityOverride(city);
      syncCityToUrl(city);
      dispatch({ type: "selectAirport", iata: city.iata });
    },
    [dispatch],
  );

  const setMapStyle = useCallback((style: MapStyle) => {
    setStyleOverride(style);
    saveMapStyle(style);
  }, []);

  const { flights, loading, rateLimited, retryIn, source } = useFlights(
    activeCity,
    fpvIcao24,
    fpvSeedCenter,
  );

  // Both the airspace and weather radar overlays are scoped to ~2×
  // the flight fetch radius so we don't pull tiles for the entire
  // globe. Two modes:
  //   • City mode (default): box centered on `activeCity` with radius
  //     = city.radius × 2 (~300 NM for the seed cities).
  //   • FPV mode: box centered on the tracked aircraft, sized to the
  //     FPV point-radius × 2 (~240 NM half-width). The center is
  //     snapped to a 0.5° grid so the bbox only re-anchors every
  //     ~30 NM of travel - otherwise every position tick would force
  //     a source re-add.
  //
  // The overlay layers debounce identical bounds via
  // `airspaceBoundsKey`, so returning a freshly allocated array each
  // render is fine - their effects only re-run when the quantised
  // key actually changes.
  const airspaceBounds = useMemo(() => {
    if (fpvIcao24) {
      const target = fpvIcao24.toLowerCase();
      const tracked = flights.find((f) => f.icao24.toLowerCase() === target);
      const lng =
        tracked && Number.isFinite(tracked.longitude)
          ? (tracked.longitude as number)
          : (fpvSeedCenter?.lng ?? null);
      const lat =
        tracked && Number.isFinite(tracked.latitude)
          ? (tracked.latitude as number)
          : (fpvSeedCenter?.lat ?? null);
      if (lng !== null && lat !== null) {
        const snap = FPV_BOUNDS_SNAP_DEG;
        const snappedLng = Math.round(lng / snap) * snap;
        const snappedLat = Math.round(lat / snap) * snap;
        return computeAirspaceBounds(
          {
            coordinates: [snappedLng, snappedLat],
            // AIRSPACE_RADIUS_MULTIPLIER is applied inside
            // computeAirspaceBounds; dividing here keeps the final
            // half-width at exactly FPV_AIRSPACE_RADIUS_DEG.
            radius: FPV_AIRSPACE_RADIUS_DEG / AIRSPACE_RADIUS_MULTIPLIER,
          },
          AIRSPACE_RADIUS_MULTIPLIER,
        );
      }
    }
    return computeAirspaceBounds(activeCity);
  }, [fpvIcao24, flights, fpvSeedCenter, activeCity]);

  const displayFlights = flights;
  // The aircraft whose whole path is drawn: the open one, else the one
  // being followed.
  const trackedIcao24 = selectedIcao24 ?? followIcao24;
  const trailState = useTrailSystem({
    flights: displayFlights,
    selectedIcao24: trackedIcao24,
    historyEnabled: !!trackedIcao24 && !fpvIcao24,
  });

  // Single Map for O(1) flight lookups - replaces 4× O(n) find() calls per poll
  const displayFlightMap = useMemo(() => {
    const m = new Map<string, FlightState>();
    for (const f of displayFlights) m.set(f.icao24, f);
    return m;
  }, [displayFlights]);

  // A flight picked from search or a click can be missing from the feed
  // until the next poll. The seed covers that gap and is dropped as soon as
  // the feed has the aircraft.
  const selectionSeed = selectionState.seed;
  if (selectionSeed && displayFlightMap.has(selectionSeed.icao24)) {
    dispatch({ type: "dropSeed" });
  }
  const selectedMapFlight = useMemo(() => {
    if (!selectedIcao24) return null;
    return (
      displayFlightMap.get(selectedIcao24) ??
      (selectionSeed?.icao24 === selectedIcao24 ? selectionSeed : null)
    );
  }, [selectedIcao24, displayFlightMap, selectionSeed]);
  const selectedFlight = useSelectedAircraft(selectedMapFlight);

  const followFlight = useMemo(() => {
    if (!followIcao24) return null;
    return displayFlightMap.get(followIcao24) ?? null;
  }, [followIcao24, displayFlightMap]);

  const fpvFlight = useMemo(() => {
    if (!fpvIcao24) return null;
    return displayFlightMap.get(fpvIcao24) ?? null;
  }, [fpvIcao24, displayFlightMap]);

  // The address bar always points at what is open. Until a shared link has
  // found its aircraft, the link is left as it is.
  useEffect(() => {
    if (pendingLinkRef.current) return;
    syncSelectionToUrl(selectionState);
  }, [selectionState]);

  // Ends FPV however it ends; the camera always pulls back out to the
  // aircraft. Leaving deliberately keeps it selected with its card open.
  // After a landing or when the feed has lost it, the aircraft is off the
  // map, which shows none on the ground, so nothing stays selected.
  const endFpv = useCallback(
    (how: "exited" | "landed" | "lost") => {
      dispatch({ type: "exitFpv", how });
      setFpvSeedCenter(null);
    },
    [dispatch],
  );

  const handleLinkResolved = useCallback(
    (link: PendingAircraftLink, flight: FlightState, remote: boolean) => {
      if (remote) {
        const focusCity = cityFromFlight(flight);
        if (focusCity) setCityOverride(focusCity);
      }
      const airborne =
        !flight.onGround && flight.longitude != null && flight.latitude != null;
      if (link.mode === "fpv" && airborne) {
        setFpvSeedCenter({ lng: flight.longitude!, lat: flight.latitude! });
        dispatch({ type: "enterFpv", icao24: flight.icao24 });
      } else if (link.mode === "follow" && airborne) {
        dispatch({ type: "follow", icao24: flight.icao24, seed: flight });
      } else {
        dispatch({ type: "selectAircraft", icao24: flight.icao24, seed: flight });
      }
    },
    [dispatch],
  );
  const handleAirportLink = useCallback(
    (iata: string) => {
      const city = findCityByCode(iata);
      if (city) setCityOverride(city);
      dispatch({ type: "selectAirport", iata });
    },
    [dispatch],
  );
  const handleFollowLost = useCallback(
    () => dispatch({ type: "unfollow" }),
    [dispatch],
  );
  const handleSelectionLost = useCallback(
    () => dispatch({ type: "clear" }),
    [dispatch],
  );

  const { repoStars } = useFlightMonitors({
    pendingLinkRef,
    fpvIcao24,
    fpvFlight,
    followIcao24,
    followFlight,
    selectedIcao24,
    selectedFlight,
    displayFlights,
    rateLimited,
    onLinkResolved: handleLinkResolved,
    onAirportLink: handleAirportLink,
    onFollowLost: handleFollowLost,
    onSelectionLost: handleSelectionLost,
    endFpv,
  });

  const atc = useAtcStream();


  const displayFlight = selectedFlight;

  // ── Airport Board state ──────────────────────────────────────────────
  const airportBoard = useAirportBoard(
    displayFlights,
    selectedAirportIata,
  );

  // One card at a time: the desktop sidebar shows whatever is selected,
  // and nothing while flying first person.
  const leftPanelKind: PlacePanelKind["kind"] | null =
    isMobile || fpvIcao24
      ? null
      : selectedIcao24
        ? "flight"
        : airportBoard.isActive
          ? "airport"
          : null;
  const leftPanel = useMemo<PlacePanelKind | null>(
    () => (leftPanelKind ? { kind: leftPanelKind } : null),
    [leftPanelKind],
  );

  const handleAirportBoardSelect = useCallback(
    (icao24: string) => {
      if (selectedIcao24 === icao24) {
        dispatch({ type: "clear" });
        return;
      }
      dispatch({
        type: "selectAircraft",
        icao24,
        seed: displayFlightMap.get(icao24) ?? null,
      });
    },
    [dispatch, displayFlightMap, selectedIcao24],
  );

  const handleAirportBoardClose = useCallback(() => {
    if (selectedAirportIata) dispatch({ type: "clear" });
  }, [dispatch, selectedAirportIata]);

  const [atcToggle, setAtcToggle] = useState(0);
  const handleToggleAtc = useCallback(() => {
    setAtcToggle((c) => c + 1);
  }, []);

  const handleToggleTrails = useCallback(() => {
    update("showTrails", !settings.showTrails);
  }, [update, settings.showTrails]);

  const handleClick = useCallback(
    (info: PickingInfo<FlightState> | null) => {
      if (fpvIcao24) return;
      lookupAbortRef.current?.abort();
      lookupAbortRef.current = null;
      if (info?.object) {
        const icao24 = info.object.icao24.toLowerCase();
        if (selectedIcao24 === icao24) dispatch({ type: "clear" });
        else dispatch({ type: "selectAircraft", icao24, seed: info.object });
      } else {
        dispatch({ type: "clear" });
      }
    },
    [dispatch, fpvIcao24, selectedIcao24],
  );

  const handleDeselectFlight = useCallback(() => {
    if (fpvIcao24) {
      endFpv("exited");
      return;
    }
    dispatch({ type: "clear" });
  }, [dispatch, endFpv, fpvIcao24]);

  const enterFpv = useCallback(
    (icao24: string) => {
      const target = icao24.toLowerCase();
      const flight = displayFlightMap.get(target);
      if (
        !flight ||
        flight.longitude == null ||
        flight.latitude == null ||
        flight.onGround
      ) {
        return;
      }
      setFpvSeedCenter({ lng: flight.longitude, lat: flight.latitude });
      dispatch({ type: "enterFpv", icao24: target });
    },
    [dispatch, displayFlightMap],
  );

  const handleExitFpv = useCallback(() => endFpv("exited"), [endFpv]);

  const handleToggleFpv = useCallback(
    (icao24: string) => {
      if (fpvIcao24 === icao24.toLowerCase()) handleExitFpv();
      else enterFpv(icao24);
    },
    [enterFpv, fpvIcao24, handleExitFpv],
  );

  const handleNorthUp = useCallback(() => {
    window.dispatchEvent(new CustomEvent("aeris:north-up"));
  }, []);

  const handleResetView = useCallback(() => {
    window.dispatchEvent(
      new CustomEvent("aeris:reset-view", {
        detail: { center: activeCity.coordinates },
      }),
    );
  }, [activeCity.coordinates]);

  // Geolocation: find nearest airport, switch active city, store user dot
  useEffect(() => {
    function onGeolocate(e: Event) {
      const { coordinates } = (
        e as CustomEvent<{ coordinates: [number, number] }>
      ).detail;
      setUserLocation(coordinates);
      const [lng, lat] = coordinates;
      const nearest = findNearestAirport(lat, lng, 250);
      if (nearest) {
        const city = airportToCity(nearest);
        setActiveCity(city);
      }
      // Always fly to the user's actual location (not the airport)
      window.dispatchEvent(
        new CustomEvent("aeris:reset-view", {
          detail: { center: coordinates },
        }),
      );
    }
    window.addEventListener("aeris:geolocate", onGeolocate);
    return () => window.removeEventListener("aeris:geolocate", onGeolocate);
  }, [setActiveCity]);

  const handleRandomAirport = useCallback(() => {
    const randomCity = pickRandomAirportCity(activeCity.iata);
    setActiveCity(randomCity);
  }, [activeCity.iata, setActiveCity]);

  const handleToggleOrbit = useCallback(() => {
    update("autoOrbit", !settings.autoOrbit);
  }, [settings.autoOrbit, update]);

  const handleToggleMenu = useCallback(() => {
    window.dispatchEvent(new CustomEvent("aeris:toggle-menu"));
  }, []);

  const handleOpenSearch = useCallback(() => {
    window.dispatchEvent(new CustomEvent("aeris:open-search"));
  }, []);

  const handleToggleHelp = useCallback(() => {
    window.dispatchEvent(new CustomEvent("aeris:open-shortcuts"));
  }, []);

  const toggleFollow = useCallback(
    (icao24: string) => {
      const target = icao24.toLowerCase();
      if (selectionState.follow === target) {
        dispatch({ type: "unfollow" });
        return;
      }
      const flight = displayFlightMap.get(target) ?? null;
      if (flight && (flight.longitude == null || flight.latitude == null)) return;
      if (selectionState.fpv) setFpvSeedCenter(null);
      dispatch({ type: "follow", icao24: target, seed: flight });
    },
    [dispatch, displayFlightMap, selectionState.follow, selectionState.fpv],
  );

  // F follows whatever is open, or leaves first person to follow it.
  const handleToggleFollowKey = useCallback(() => {
    const current = selectionState;
    const target =
      current.fpv ??
      (current.selection.kind === "aircraft" ? current.selection.icao24 : null);
    if (target) toggleFollow(target);
    else if (current.follow) dispatch({ type: "unfollow" });
  }, [dispatch, selectionState, toggleFollow]);

  const handleOpenFollowed = useCallback(() => {
    if (!followIcao24) return;
    dispatch({
      type: "selectAircraft",
      icao24: followIcao24,
      seed: displayFlightMap.get(followIcao24) ?? null,
    });
  }, [dispatch, displayFlightMap, followIcao24]);

  const handleToggleFpvKey = useCallback(() => {
    if (fpvIcao24) handleExitFpv();
    else if (selectedIcao24) enterFpv(selectedIcao24);
  }, [enterFpv, fpvIcao24, handleExitFpv, selectedIcao24]);

  // Escape backs out one step at a time: first person, then the open card,
  // then following.
  const handleShortcutDeselect = useCallback(() => {
    const current = selectionState;
    if (current.fpv) {
      handleExitFpv();
    } else if (current.selection.kind !== "none") {
      dispatch({ type: "clear" });
      restoreMapFocus();
    } else if (current.follow) {
      dispatch({ type: "unfollow" });
    }
  }, [dispatch, handleExitFpv, restoreMapFocus, selectionState]);

  // Helper: select flight and optionally enter FPV
  const selectFlight = useCallback(
    (f: FlightState, startFpv = false) => {
      dispatch({ type: "selectAircraft", icao24: f.icao24, seed: f });
      if (
        startFpv &&
        !f.onGround &&
        f.longitude != null &&
        f.latitude != null
      ) {
        setFpvSeedCenter({ lng: f.longitude, lat: f.latitude });
        dispatch({ type: "enterFpv", icao24: f.icao24 });
      }
    },
    [dispatch],
  );

  const handleSelectFlight = useCallback(
    (flight: FlightState) => {
      const focusCity = cityFromFlight(flight);
      if (focusCity) {
        setCityOverride(focusCity);
        syncCityToUrl(focusCity);
      }
      selectFlight(flight);
    },
    [selectFlight],
  );

  const handleSearchAirport = useCallback(
    (location: SearchLocation) => handleAirportDotClick(locationToCity(location)),
    [handleAirportDotClick],
  );
  const handleSearchPlace = useCallback(
    (location: SearchLocation) => setActiveCity(locationToCity(location)),
    [setActiveCity],
  );

  const handleLookupFlight = useCallback(
    async (rawQuery: string, startFpv = false): Promise<boolean> => {
      const compactQuery = rawQuery.trim().toLowerCase().replace(/\s+/g, "");
      if (!compactQuery) return false;

      // Local match: try direct hex lookup first, then callsign match with
      // IATA ↔ ICAO translation support.
      const localMatch =
        displayFlightMap.get(compactQuery) ??
        displayFlights.find((f) =>
          flightQueryMatches(rawQuery, f.callsign),
        ) ??
        null;

      if (localMatch) {
        selectFlight(localMatch, startFpv);
        return true;
      }

      // Cancel any previous pending lookup
      lookupAbortRef.current?.abort();
      const controller = new AbortController();
      lookupAbortRef.current = controller;

      try {
        // Phase 1: Always try expanded query variants first (IATA ↔ ICAO).
        // This handles the common case where a user searches "IX2680" but
        // the transponder broadcasts "AXB2680".
        let result: { flight: FlightState | null } = { flight: null };

        const variants = expandFlightQuery(rawQuery);
        // Ensure the raw compact query is included as a fallback variant
        if (!variants.includes(compactQuery.toUpperCase())) {
          variants.unshift(compactQuery.toUpperCase());
        }

        for (const variant of variants) {
          if (controller.signal.aborted) break;
          const vCompact = variant.toLowerCase();
          const vHex = /^[0-9a-f]{6}$/i.test(vCompact);

          if (vHex) {
            result = await fetchFlightByHex(vCompact, controller.signal);
          } else {
            result = await fetchFlightByCallsign(variant, controller.signal);
          }
          if (result.flight) break;
        }

        // Phase 2: A 6-char hex query may also be a callsign.
        if (!result.flight && !controller.signal.aborted) {
          const isHex = /^[0-9a-f]{6}$/i.test(compactQuery);
          if (isHex) {
            // Variants already tried hex; try raw callsign as last resort
            result = await fetchFlightByCallsign(
              compactQuery.toUpperCase(),
              controller.signal,
            );
          }
        }

        if (controller.signal.aborted) return false;
        if (!result.flight) return false;

        const focusCity = cityFromFlight(result.flight);
        if (focusCity) {
          setCityOverride(focusCity);
          syncCityToUrl(focusCity);
        }

        selectFlight(result.flight, startFpv);
        return true;
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return false;
        return false;
      }
    },
    [displayFlights, displayFlightMap, selectFlight],
  );

  useKeyboardShortcuts({
    onNorthUp: handleNorthUp,
    onResetView: handleResetView,
    onToggleOrbit: handleToggleOrbit,
    onOpenSearch: handleOpenSearch,
    onToggleHelp: handleToggleHelp,
    onDeselect: handleShortcutDeselect,
    onToggleFpv: handleToggleFpvKey,
    onToggleFollow: handleToggleFollowKey,
    onToggleMenu: handleToggleMenu,
    onToggleAtc: handleToggleAtc,
    onToggleTrails: handleToggleTrails,
    isFpv: fpvIcao24 !== null,
  });

  const desktopLeftPanelOpen = !isMobile && !fpvIcao24 && leftPanel !== null;
  // The camera frames what is open beside the desktop panel, or above the
  // phone's sheet at rest.
  const sheetOpen = isMobile && !fpvIcao24 && (!!displayFlight || airportBoard.isActive);
  const panelKind: "flight" | "airport" | null = desktopLeftPanelOpen
    ? (leftPanel?.kind ?? null)
    : sheetOpen
      ? displayFlight
        ? "flight"
        : "airport"
      : null;
  const insets = isMobile
    ? { leftInsetPx: 0, bottomInsetPx: sheetPeekPx }
    : { leftInsetPx: leftPanelInsetPx, bottomInsetPx: 0 };
  const panelCamera = useMemo(() => {
    if (!panelKind) return CLOSED_MAP_PANEL_CAMERA_STATE;

    if (panelKind === "flight") {
      return createMapPanelCameraState({
        kind: "flight",
        // Keyed on the selection, not the flight object, so a poll that
        // briefly misses the aircraft does not re-center the map.
        focusKey: selectedIcao24 ? `flight:${selectedIcao24}` : null,
        longitude: displayFlight?.longitude,
        latitude: displayFlight?.latitude,
        altitudeMeters: displayFlight?.baroAltitude ?? displayFlight?.geoAltitude,
        ...insets,
      });
    }

    return createMapPanelCameraState({
      kind: "airport",
      focusKey: airportBoard.airport
        ? `airport:${airportBoard.airport.iata}`
        : null,
      longitude: airportBoard.airport?.lng,
      latitude: airportBoard.airport?.lat,
      altitudeMeters: 0,
      ...insets,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- insets are read through their parts
  }, [
    airportBoard.airport,
    displayFlight,
    panelKind,
    insets.leftInsetPx,
    insets.bottomInsetPx,
    selectedIcao24,
  ]);
  // Until the panel reports where it ends, assume its CSS width.
  const leftPanelInset =
    leftPanelInsetPx > 0
      ? `${leftPanelInsetPx}px`
      : `calc(${PLACE_PANEL_WIDTH} + 1.75rem)`;

  const desktopPanelStyle = {
    "--panel-duration": `${MAP_PANEL_TRANSITION_MS}ms`,
    "--panel-ease": MAP_PANEL_EASE_CSS,
    "--place-width": PLACE_PANEL_WIDTH,
    "--aeris-left-chrome-shift": `calc(${leftPanelInset} - 1rem)`,
    "--aeris-map-center-shift": `calc(${leftPanelInset} / 2)`,
  } as CSSProperties;

  return (
    <main
      className="relative h-dvh w-screen overflow-hidden bg-sidebar"
      style={desktopPanelStyle}
    >
      <div className="absolute inset-0 z-0 overflow-hidden bg-background">
        <MapView
          ref={mapRef}
          mapStyle={mapStyle.style}
          terrainProfile={mapStyle.terrainProfile}
          isDark={mapStyle.dark}
          globeMode={settings.globeMode}
        >
          <CompassBridge />
          <CameraController
            city={activeCity}
            followIcao24={fpvIcao24 ? null : followIcao24}
            followDrawnRef={followDrawnRef}
            onFollowEnd={handleFollowLost}
            fpvIcao24={fpvIcao24}
            fpvFlight={fpvFlight}
            fpvDrawnRef={fpvDrawnRef}
            panelCamera={panelCamera}
          />
          {!fpvIcao24 && (
            <AirportLayer
              activeCity={activeCity}
              onSelectAirport={handleAirportDotClick}
              isDark={mapStyle.dark}
            />
          )}
          {!fpvIcao24 && <UserLocationMarker coordinates={userLocation} />}
          {airspaceAvailable && (
            <AirspaceLayer
              visible={showAirspace}
              opacity={settings.airspaceOpacity}
              bounds={airspaceBounds}
            />
          )}
          <WeatherRadarLayer
            visible={settings.showWeatherRadar}
            opacity={settings.weatherRadarOpacity}
            bounds={airspaceBounds}
          />
          <FlightLayers
            flights={displayFlights}
            trails={trailState.trails}
            onClick={handleClick}
            selectedIcao24={fpvIcao24 ?? trackedIcao24}
            showTrails={settings.showTrails}
            trailThickness={settings.trailThickness}
            trailMinutes={settings.trailMinutes}
            trailCeilingMeters={trailCeilingMeters(settings)}
            showShadows={settings.showShadows}
            showAltitudeColors={settings.showAltitudeColors}
            altitudeDisplayMode={settings.altitudeDisplayMode}
            globeMode={settings.globeMode}
            fpvIcao24={fpvIcao24}
            fpvDrawnRef={fpvDrawnRef}
            followIcao24={followIcao24}
            followDrawnRef={followDrawnRef}
            isDark={mapStyle.dark}
          />
        </MapView>
      </div>

      <div className="pointer-events-none absolute inset-0 z-10">
        {/* Top left: the name and the one search field. On a phone the
            field spans the top, with the map menu inside it. */}
        {!fpvIcao24 && (
          <div
            className="pointer-events-auto absolute top-3 right-3 left-3 z-50 sm:top-4 sm:right-auto sm:left-4 sm:w-(--place-width)"
          >
            <div className="w-full">
              <SearchPill
                flights={displayFlights}
                center={activeCity.coordinates}
                onSelectFlight={handleSelectFlight}
                onSelectAirport={handleSearchAirport}
                onSelectPlace={handleSearchPlace}
                onLookupFlight={handleLookupFlight}
                trailing={
                  isMobile ? (
                    <MapMenu
                      inline
                      activeStyle={mapStyle}
                      onSelectStyle={setMapStyle}
                      airspaceAvailable={airspaceAvailable}
                      onRandomAirport={handleRandomAirport}
                      onResetView={handleResetView}
                      repoStars={repoStars}
                    />
                  ) : undefined
                }
              />
            </div>
          </div>
        )}

        {!fpvIcao24 && !isMobile && (
          <PlacePanel
            leftPanel={leftPanel}
            displayFlight={displayFlight}
            onCloseFlight={handleDeselectFlight}
            onToggleFpv={handleToggleFpv}
            followIcao24={followIcao24}
            onToggleFollow={toggleFollow}
            airportBoard={airportBoard}
            onSelectAirportFlight={handleAirportBoardSelect}
            selectedIcao24={selectedIcao24}
            onCloseAirport={handleAirportBoardClose}
            atc={atc}
            onInsetChange={setLeftPanelInsetPx}
            onRestoreFocus={restoreMapFocus}
          />
        )}

        {/* Top right: the map menu, your location, and north when the
            map is turned. */}
        {!fpvIcao24 && (
          <div className="pointer-events-auto absolute top-17 right-3 z-40 flex flex-col items-end gap-2 sm:top-4 sm:right-4">
            {!isMobile && (
              <MapMenu
                activeStyle={mapStyle}
                onSelectStyle={setMapStyle}
                airspaceAvailable={airspaceAvailable}
                onRandomAirport={handleRandomAirport}
                onResetView={handleResetView}
                repoStars={repoStars}
              />
            )}
            <LocateButton />
            <Compass />
          </div>
        )}
        <ControlPanel airspaceAvailable={airspaceAvailable} />

        {/* Bottom left: one line about the feed and the place. */}
        {!fpvIcao24 && (
          <div
            className="aeris-left-chrome pointer-events-auto absolute bottom-[env(safe-area-inset-bottom,0px)] left-3 mb-3 sm:bottom-4 sm:left-4 sm:mb-0"
            data-panel-open={desktopLeftPanelOpen}
          >
            <StatusBar
              flightCount={flights.length}
              cityName={activeCity.name}
              cityIata={activeCity.iata}
              cityCoordinates={activeCity.coordinates}
              loading={loading}
              rateLimited={rateLimited}
              retryIn={retryIn}
              atc={atc}
              atcToggle={atcToggle}
              source={source}
            />
          </div>
        )}

        {!fpvIcao24 && <HoverCard hiddenFor={selectedIcao24} />}

        {/* While following with the card closed, a chip says so. */}
        {!fpvIcao24 && followFlight && selectedIcao24 !== followIcao24 && (
          <div
            className="aeris-map-centered-chrome pointer-events-auto absolute top-17 left-1/2 max-w-[calc(100vw-8rem)] sm:top-4 sm:max-w-none"
            data-panel-open={desktopLeftPanelOpen}
          >
            <FollowChip
              flight={followFlight}
              onOpen={handleOpenFollowed}
              onStop={handleFollowLost}
            />
          </div>
        )}

        {/* The ATC player sits centred just above the status line. */}
        {!fpvIcao24 && (
          <AnimatePresence>
            {atc.feed && (
              <div
                className="aeris-map-centered-chrome pointer-events-auto absolute bottom-[calc(4.25rem+env(safe-area-inset-bottom,0px))] left-1/2 sm:bottom-18"
                data-panel-open={desktopLeftPanelOpen}
              >
                <AtcPlayerBar atc={atc} onOpenFeedSelector={handleToggleAtc} />
              </div>
            )}
          </AnimatePresence>
        )}

        {/* Bottom right: the camera for a mouse, the altitude key, credits. */}
        {!fpvIcao24 && (
          <div className="pointer-events-none absolute right-3 bottom-[env(safe-area-inset-bottom,0px)] mb-3 flex flex-col items-end gap-2 sm:right-4 sm:bottom-4 sm:mb-0">
            <div className="pointer-events-auto">
              <CameraControls autoHide />
            </div>
            {/* Level with the status line: the credits, then the key. */}
            <div className="pointer-events-auto flex items-center gap-2">
              <MapAttribution
                styleId={mapStyle.id}
                showAirspace={showAirspace}
              />
              <AltitudeLegend dark={mapStyle.dark} />
            </div>
          </div>
        )}

        {/* On a phone, what is open sits in one sheet over the map. */}
        <AnimatePresence>
          {sheetOpen && (
            <PlaceSheet
              key="place-sheet"
              label={displayFlight ? "Aircraft" : "Airport"}
              contentKey={
                displayFlight
                  ? `flight:${displayFlight.icao24}`
                  : `airport:${airportBoard.airport?.iata ?? ""}`
              }
              onDismiss={displayFlight ? handleDeselectFlight : handleAirportBoardClose}
              onPeekChange={setSheetPeekPx}
            >
              {displayFlight ? (
                <AircraftCard
                  flight={displayFlight}
                  following={followIcao24 === displayFlight.icao24}
                  onToggleFpv={handleToggleFpv}
                  onToggleFollow={toggleFollow}
                  onClose={handleDeselectFlight}
                />
              ) : (
                <AirportInfoCard
                  board={airportBoard}
                  onSelectFlight={handleAirportBoardSelect}
                  selectedIcao24={selectedIcao24}
                  onClose={handleAirportBoardClose}
                  atc={atc}
                />
              )}
            </PlaceSheet>
          )}
        </AnimatePresence>
      </div>

      <AnimatePresence>
        {fpvIcao24 && (
          <FpvHud key={fpvIcao24} flight={fpvFlight} onExit={handleExitFpv} />
        )}
      </AnimatePresence>
    </main>
  );
}

export function FlightTracker({
  airspaceAvailable = true,
  initialCity,
}: FlightTrackerProps) {
  return (
    <ErrorBoundary>
      <MotionConfig reducedMotion="user">
        <SettingsProvider>
          <FlightTrackerInner
            airspaceAvailable={airspaceAvailable}
            initialCity={initialCity}
          />
        </SettingsProvider>
      </MotionConfig>
    </ErrorBoundary>
  );
}
