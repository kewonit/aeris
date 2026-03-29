"use client";

import {
  useState,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from "react";
import { AnimatePresence, motion } from "motion/react";
import dynamic from "next/dynamic";
import { useTheme } from "next-themes";
import { ErrorBoundary } from "@/components/error-boundary";
import { Map as MapView } from "@/components/map/map";
import { CameraController } from "@/components/map/camera-controller";
import { AirportLayer } from "@/components/map/airport-layer";
import { AirspaceLayer } from "@/components/map/airspace-layer";
import { WeatherRadarLayer } from "@/components/map/weather-radar-layer";
import { FlightLayers } from "@/components/map/flight-layers";
import {
  MapStateTracker,
  type MapViewState,
} from "@/components/map/map-state-tracker";
const FlightCard = dynamic(() =>
  import("@/components/ui/flight-card").then((mod) => mod.FlightCard),
);
import { FpvHud } from "@/components/ui/fpv-hud";
const ControlPanel = dynamic(() =>
  import("@/components/ui/control-panel").then((mod) => mod.ControlPanel),
);
import { AltitudeLegend } from "@/components/ui/altitude-legend";
import { CameraControls } from "@/components/ui/camera-controls";
import { StatusBar } from "@/components/ui/status-bar";
import { MapAttribution } from "@/components/ui/map-attribution";
import { AtcPlayerBar } from "@/components/ui/atc-panel";
const AirportBoard = dynamic(() =>
  import("@/components/ui/airport-board").then((mod) => mod.AirportBoard),
);
import { Brand, GitHubBadge } from "@/components/flight-tracker-brand";
import { SettingsProvider, useSettings } from "@/hooks/use-settings";
import { useKeyboardShortcuts } from "@/hooks/use-keyboard-shortcuts";
import { useFlights } from "@/hooks/use-flights";
import { useTrailHistory } from "@/hooks/use-trail-history";
import { useFlightTrack } from "@/hooks/use-flight-track";
import { useMergedTrails } from "@/hooks/use-merged-trails";
import { useFlightMonitors } from "@/hooks/use-flight-monitors";
import { useAtcStream } from "@/hooks/use-atc-stream";
import { useIsMobile } from "@/hooks/use-is-mobile";
import { useAirportBoard } from "@/hooks/use-airport-board";
import { MobileFlightToast } from "@/components/ui/mobile-flight-toast";
import type { MapStyle } from "@/lib/map-styles";
import type { City } from "@/lib/cities";
import type { FlightState } from "@/lib/opensky";

import { fetchFlightByHex, fetchFlightByCallsign } from "@/lib/flight-api";
import { formatCallsign } from "@/lib/flight-utils";
import type { PickingInfo } from "@deck.gl/core";
import {
  DEFAULT_CITY,
  DEFAULT_STYLE,
  ICAO24_REGEX,
  subscribeNoop,
  resolveInitialCity,
  syncCityToUrl,
  syncFpvToUrl,
  resolveInitialFpv,
  loadMapStyle,
  saveMapStyle,
} from "@/components/flight-tracker-utils";
import {
  pickRandomAirportCity,
  cityFromFlight,
} from "@/components/flight-tracker-random";

function FlightTrackerInner() {
  // useSyncExternalStore with a no-op subscriber reads localStorage once
  // on the client while returning DEFAULT_CITY on the server — SSR-safe
  // hydration without useEffect flicker.
  const hydratedCity = useSyncExternalStore(
    subscribeNoop,
    resolveInitialCity,
    () => DEFAULT_CITY,
  );
  const hydratedStyle = useSyncExternalStore(
    subscribeNoop,
    loadMapStyle,
    () => DEFAULT_STYLE,
  );

  const [cityOverride, setCityOverride] = useState<City | undefined>();
  const [styleOverride, setStyleOverride] = useState<MapStyle | undefined>();
  const [selectedIcao24, setSelectedIcao24] = useState<string | null>(null);
  const [followIcao24, setFollowIcao24] = useState<string | null>(null);
  const [fpvIcao24, setFpvIcao24] = useState<string | null>(null);

  const pendingFpvRef = useRef<string | null>(resolveInitialFpv());

  const fpvPositionRef = useRef<{
    lng: number;
    lat: number;
    alt: number;
    track: number;
  } | null>(null);

  const [fpvSeedCenter, setFpvSeedCenter] = useState<{
    lng: number;
    lat: number;
  } | null>(null);

  const lookupAbortRef = useRef<AbortController | null>(null);

  const activeCity = cityOverride ?? hydratedCity;
  const mapStyle = styleOverride ?? hydratedStyle;
  const { settings, update } = useSettings();
  const { setTheme } = useTheme();

  // Sync document theme with current map style (dark/light)
  useEffect(() => {
    setTheme(mapStyle.dark ? "dark" : "light");
  }, [mapStyle.dark, setTheme]);

  const setActiveCity = useCallback((city: City) => {
    setCityOverride(city);
    setSelectedIcao24(null);
    setFpvIcao24(null);
    setFollowIcao24(null);
    syncCityToUrl(city);
  }, []);

  /** Called when user clicks an airport dot on the map — navigates AND opens the board. */
  const handleAirportDotClick = useCallback((city: City) => {
    setCityOverride(city);
    setSelectedIcao24(null);
    setFpvIcao24(null);
    setFollowIcao24(null);
    syncCityToUrl(city);
    setSelectedAirportIata(city.iata);
  }, []);

  const setMapStyle = useCallback((style: MapStyle) => {
    setStyleOverride(style);
    saveMapStyle(style);
  }, []);

  const { flights, loading, rateLimited, retryIn, source } = useFlights(
    activeCity,
    fpvIcao24,
    fpvSeedCenter,
  );

  const displayFlights = flights;
  const displayTrails = useTrailHistory(displayFlights);

  // Single Map for O(1) flight lookups — replaces 4× O(n) find() calls per poll
  const displayFlightMap = useMemo(() => {
    const m = new Map<string, FlightState>();
    for (const f of displayFlights) m.set(f.icao24, f);
    return m;
  }, [displayFlights]);

  const shouldFetchSelectedTrack = !!selectedIcao24 && !fpvIcao24;

  const { track: selectedTrack, fetchedAtMs: selectedTrackFetchedAtMs } =
    useFlightTrack(selectedIcao24, {
      enabled: shouldFetchSelectedTrack,
    });

  const mergedTrails = useMergedTrails(
    selectedIcao24,
    selectedTrack,
    selectedTrackFetchedAtMs,
    displayTrails,
    displayFlights,
  );

  const selectedFlight = useMemo(() => {
    if (!selectedIcao24) return null;
    return displayFlightMap.get(selectedIcao24) ?? null;
  }, [selectedIcao24, displayFlightMap]);

  const selectedTrail = useMemo(() => {
    if (!selectedIcao24) return null;
    return mergedTrails.find((t) => t.icao24 === selectedIcao24) ?? null;
  }, [selectedIcao24, mergedTrails]);

  const followFlight = useMemo(() => {
    if (!followIcao24) return null;
    return displayFlightMap.get(followIcao24) ?? null;
  }, [followIcao24, displayFlightMap]);

  const fpvFlight = useMemo(() => {
    if (!fpvIcao24) return null;
    return displayFlightMap.get(fpvIcao24) ?? null;
  }, [fpvIcao24, displayFlightMap]);

  useEffect(() => {
    syncFpvToUrl(fpvIcao24, activeCity);
  }, [fpvIcao24, activeCity]);

  const { repoStars } = useFlightMonitors({
    pendingFpvRef,
    fpvIcao24,
    fpvFlight,
    followIcao24,
    followFlight,
    selectedIcao24,
    selectedFlight,
    displayFlights,
    activeCity,
    rateLimited,
    setSelectedIcao24,
    setFpvIcao24,
    setFollowIcao24,
    setCityOverride,
    setFpvSeedCenter,
  });

  const atc = useAtcStream();

  const fpvFlightOrCached = fpvFlight;
  const displayFlight = selectedFlight;

  // ── Airport Board state ──────────────────────────────────────────────
  const mapStateRef = useRef<MapViewState>({
    zoom: 9.2,
    center: { lat: 0, lng: 0 },
  });
  const [mapViewState, setMapViewState] = useState<MapViewState>({
    zoom: 9.2,
    center: { lat: 0, lng: 0 },
  });
  const [selectedAirportIata, setSelectedAirportIata] = useState<string | null>(
    null,
  );

  const handleMapStateChange = useCallback((state: MapViewState) => {
    setMapViewState(state);
  }, []);

  const airportBoard = useAirportBoard(
    displayFlights,
    mapViewState.center,
    mapViewState.zoom,
    activeCity.iata,
    selectedAirportIata,
  );

  const handleAirportBoardSelect = useCallback((icao24: string) => {
    setSelectedIcao24((prev) => (prev === icao24 ? null : icao24));
  }, []);

  const handleAirportBoardClose = useCallback(() => {
    setSelectedAirportIata(null);
  }, []);

  const [atcToggle, setAtcToggle] = useState(0);
  const handleToggleAtc = useCallback(() => {
    setAtcToggle((c) => c + 1);
  }, []);

  const handleClick = useCallback(
    (info: PickingInfo<FlightState> | null) => {
      if (fpvIcao24) return;
      lookupAbortRef.current?.abort();
      lookupAbortRef.current = null;
      if (info?.object) {
        const icao24 = info.object.icao24.toLowerCase();
        setSelectedIcao24((prev) => (prev === icao24 ? null : icao24));
      } else {
        setSelectedIcao24(null);
      }
    },
    [fpvIcao24],
  );

  const handleDeselectFlight = useCallback(() => {
    if (fpvIcao24) {
      setSelectedIcao24(fpvIcao24);
      setFpvIcao24(null);
    } else {
      setSelectedIcao24(null);
    }
  }, [fpvIcao24]);

  const handleToggleFpv = useCallback(
    (icao24: string) => {
      const targetIcao24 = icao24.toLowerCase();
      const flight =
        displayFlightMap.get(targetIcao24) ??
        flights.find((f) => f.icao24 === targetIcao24);
      if (!flight) return;
      if (flight.longitude == null || flight.latitude == null) return;
      if (flight.onGround) return;
      setFpvSeedCenter({ lng: flight.longitude, lat: flight.latitude });
      setFpvIcao24((prev) => {
        if (prev === targetIcao24) {
          setFpvSeedCenter(null);
          setSelectedIcao24(targetIcao24);
          return null;
        }
        return targetIcao24;
      });
      setFollowIcao24(null);
    },
    [displayFlightMap, flights],
  );

  const handleExitFpv = useCallback(() => {
    setSelectedIcao24(fpvIcao24);
    setFpvIcao24(null);
  }, [fpvIcao24]);

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

  const handleRandomAirport = useCallback(() => {
    const randomCity = pickRandomAirportCity(activeCity.iata);
    setActiveCity(randomCity);
  }, [activeCity.iata, setActiveCity]);

  const handleToggleOrbit = useCallback(() => {
    update("autoOrbit", !settings.autoOrbit);
  }, [settings.autoOrbit, update]);

  const handleOpenSearch = useCallback(() => {
    window.dispatchEvent(new CustomEvent("aeris:open-search"));
  }, []);

  const handleToggleHelp = useCallback(() => {
    window.dispatchEvent(new CustomEvent("aeris:open-shortcuts"));
  }, []);

  const handleToggleFpvKey = useCallback(() => {
    if (fpvIcao24) {
      setSelectedIcao24(fpvIcao24);
      setFpvIcao24(null);
    } else if (selectedIcao24) {
      handleToggleFpv(selectedIcao24);
    }
  }, [fpvIcao24, selectedIcao24, handleToggleFpv]);

  const handleLookupFlight = useCallback(
    async (rawQuery: string, enterFpv = false): Promise<boolean> => {
      const compactQuery = rawQuery.trim().toLowerCase().replace(/\s+/g, "");
      if (!compactQuery) return false;

      const localMatch =
        displayFlightMap.get(compactQuery) ??
        displayFlights.find((f) =>
          formatCallsign(f.callsign)
            .toLowerCase()
            .replace(/\s+/g, "")
            .includes(compactQuery),
        ) ??
        null;

      // Helper: select flight and optionally enter FPV
      const selectFlight = (f: FlightState) => {
        setSelectedIcao24(f.icao24);
        setFollowIcao24(null);
        if (
          enterFpv &&
          !f.onGround &&
          f.longitude != null &&
          f.latitude != null
        ) {
          setFpvSeedCenter({ lng: f.longitude, lat: f.latitude });
          setFpvIcao24(f.icao24);
        }
      };

      if (localMatch) {
        selectFlight(localMatch);
        return true;
      }

      // Cancel any previous pending lookup
      lookupAbortRef.current?.abort();
      const controller = new AbortController();
      lookupAbortRef.current = controller;

      try {
        const result = ICAO24_REGEX.test(compactQuery)
          ? await fetchFlightByHex(compactQuery, controller.signal)
          : await fetchFlightByCallsign(compactQuery, controller.signal);

        if (controller.signal.aborted) return false;
        if (!result.flight) return false;

        const focusCity = cityFromFlight(result.flight);
        if (focusCity) {
          setCityOverride(focusCity);
          syncCityToUrl(focusCity);
        }

        selectFlight(result.flight);
        return true;
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return false;
        return false;
      }
    },
    [displayFlights, displayFlightMap],
  );

  useKeyboardShortcuts({
    onNorthUp: handleNorthUp,
    onResetView: handleResetView,
    onToggleOrbit: handleToggleOrbit,
    onOpenSearch: handleOpenSearch,
    onToggleHelp: handleToggleHelp,
    onDeselect: handleDeselectFlight,
    onToggleFpv: handleToggleFpvKey,
    onToggleAtc: handleToggleAtc,
    isFpv: fpvIcao24 !== null,
  });

  const isMobile = useIsMobile();

  // Whether to show the mobile bottom sheet flight card
  const showMobileFlightCard = isMobile && !fpvIcao24 && !!displayFlight;

  return (
    <main className="relative h-dvh w-screen overflow-hidden bg-background">
      <MapView
        mapStyle={mapStyle.style}
        terrainProfile={mapStyle.terrainProfile}
        isDark={mapStyle.dark}
        globeMode={settings.globeMode}
      >
        <CameraController
          city={activeCity}
          followFlight={followFlight}
          fpvFlight={fpvFlightOrCached}
          fpvPositionRef={fpvPositionRef}
        />
        <MapStateTracker
          stateRef={mapStateRef}
          onChange={handleMapStateChange}
        />
        <AirportLayer
          activeCity={activeCity}
          onSelectAirport={handleAirportDotClick}
          isDark={mapStyle.dark}
        />
        <AirspaceLayer
          visible={settings.showAirspace}
          opacity={settings.airspaceOpacity}
          showHotspots={settings.showAirspaceHotspots}
        />
        <WeatherRadarLayer
          visible={settings.showWeatherRadar}
          opacity={settings.weatherRadarOpacity}
        />
        <FlightLayers
          flights={displayFlights}
          trails={mergedTrails}
          onClick={handleClick}
          selectedIcao24={fpvIcao24 ?? selectedIcao24}
          showTrails={settings.showTrails}
          trailThickness={settings.trailThickness}
          trailDistance={settings.trailDistance}
          showShadows={settings.showShadows}
          showAltitudeColors={settings.showAltitudeColors}
          globeMode={settings.globeMode}
          fpvIcao24={fpvIcao24}
          fpvPositionRef={fpvPositionRef}
        />
      </MapView>

      <div className="pointer-events-none absolute inset-0 z-10">
        {!fpvIcao24 && (
          <div className="pointer-events-auto absolute left-3 top-3 flex items-center gap-3 sm:left-4 sm:top-4">
            <Brand isDark={mapStyle.dark} />
          </div>
        )}

        {!fpvIcao24 && !isMobile && (
          <div className="pointer-events-auto absolute left-3 top-14 sm:left-4 sm:top-16">
            <FlightCard
              flight={displayFlight}
              trail={selectedTrail}
              onClose={handleDeselectFlight}
              onToggleFpv={handleToggleFpv}
              isFpvActive={
                fpvIcao24 !== null && fpvIcao24 === displayFlight?.icao24
              }
            />
          </div>
        )}

        {!fpvIcao24 && (
          <div className="pointer-events-auto absolute right-3 top-3 flex items-center gap-1.5 sm:right-4 sm:top-4 sm:gap-2">
            <GitHubBadge stars={repoStars} />
            <ControlPanel
              activeCity={activeCity}
              onSelectCity={setActiveCity}
              activeStyle={mapStyle}
              onSelectStyle={setMapStyle}
              flights={displayFlights}
              activeFlightIcao24={selectedIcao24}
              onLookupFlight={handleLookupFlight}
            />
          </div>
        )}

        {!fpvIcao24 && (
          <div className="pointer-events-auto absolute bottom-[env(safe-area-inset-bottom,0px)] left-3 mb-3 sm:bottom-4 sm:left-4 sm:mb-0">
            <StatusBar
              flightCount={flights.length}
              cityName={activeCity.name}
              cityIata={activeCity.iata}
              cityCoordinates={activeCity.coordinates}
              loading={loading}
              rateLimited={rateLimited}
              retryIn={retryIn}
              onNorthUp={handleNorthUp}
              onResetView={handleResetView}
              onRandomAirport={handleRandomAirport}
              atc={atc}
              atcToggle={atcToggle}
              source={source}
            />
          </div>
        )}

        {/* ATC Player Bar — top-center on mobile, bottom-center on desktop */}
        {!fpvIcao24 && (
          <AnimatePresence>
            {atc.feed && (
              <div className="pointer-events-auto absolute left-1/2 top-14 -translate-x-1/2 sm:top-auto sm:bottom-18">
                <AtcPlayerBar atc={atc} onOpenFeedSelector={handleToggleAtc} />
              </div>
            )}
          </AnimatePresence>
        )}

        {!fpvIcao24 && (
          <div className="pointer-events-none absolute bottom-[env(safe-area-inset-bottom,0px)] right-3 mb-3 flex flex-col items-end gap-2 sm:bottom-4 sm:right-4 sm:mb-0">
            <div className="pointer-events-auto">
              <CameraControls />
            </div>
            <div className="pointer-events-auto">
              <AltitudeLegend />
            </div>
            <div className="pointer-events-auto">
              <MapAttribution
                styleId={mapStyle.id}
                showAirspace={settings.showAirspace}
              />
            </div>
          </div>
        )}

        {/* Airport Departure/Arrival Board — hide on mobile when flight card is open */}
        {!fpvIcao24 && !showMobileFlightCard && (
          <AnimatePresence>
            {airportBoard.isActive && (
              <div className="pointer-events-auto absolute bottom-[env(safe-area-inset-bottom,0px)] left-1/2 mb-14 -translate-x-1/2 sm:mb-16">
                <AirportBoard
                  data={airportBoard}
                  onSelectFlight={handleAirportBoardSelect}
                  selectedIcao24={selectedIcao24}
                  onClose={handleAirportBoardClose}
                />
              </div>
            )}
          </AnimatePresence>
        )}

        {/* Mobile flight card — native bottom sheet with drag-to-dismiss */}
        <AnimatePresence>
          {showMobileFlightCard && displayFlight && (
            <motion.div
              key={displayFlight.icao24}
              className="pointer-events-auto fixed inset-x-0 bottom-0 z-50 px-2 pb-[calc(0.5rem+env(safe-area-inset-bottom,0px))]"
              initial={{ y: "100%", opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: "100%", opacity: 0 }}
              transition={{
                type: "spring",
                stiffness: 400,
                damping: 35,
                mass: 0.8,
              }}
              drag="y"
              dragConstraints={{ top: 0, bottom: 0 }}
              dragElastic={{ top: 0, bottom: 0.6 }}
              onDragEnd={(_, info) => {
                if (info.offset.y > 80 || info.velocity.y > 300) {
                  handleDeselectFlight();
                }
              }}
            >
              <MobileFlightToast
                flight={displayFlight}
                onClose={handleDeselectFlight}
                onToggleFpv={handleToggleFpv}
                isFpvActive={fpvIcao24 === displayFlight.icao24}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <AnimatePresence>
        {fpvIcao24 && fpvFlightOrCached && (
          <FpvHud flight={fpvFlightOrCached} onExit={handleExitFpv} />
        )}
      </AnimatePresence>
    </main>
  );
}

export function FlightTracker() {
  return (
    <ErrorBoundary>
      <SettingsProvider>
        <FlightTrackerInner />
      </SettingsProvider>
    </ErrorBoundary>
  );
}
