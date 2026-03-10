"use client";

import {
  useState,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from "react";
import { AnimatePresence } from "motion/react";
import { ErrorBoundary } from "@/components/error-boundary";
import { Map as MapView } from "@/components/map/map";
import { CameraController } from "@/components/map/camera-controller";
import { AirportLayer } from "@/components/map/airport-layer";
import { FlightLayers } from "@/components/map/flight-layers";
import { FlightCard } from "@/components/ui/flight-card";
import { FpvHud } from "@/components/ui/fpv-hud";
import { ControlPanel } from "@/components/ui/control-panel";
import { AltitudeLegend } from "@/components/ui/altitude-legend";
import { CameraControls } from "@/components/ui/camera-controls";
import { StatusBar } from "@/components/ui/status-bar";
import { MapAttribution } from "@/components/ui/map-attribution";
import { SettingsProvider, useSettings } from "@/hooks/use-settings";
import { useKeyboardShortcuts } from "@/hooks/use-keyboard-shortcuts";
import { useFlights } from "@/hooks/use-flights";
import { useTrailHistory } from "@/hooks/use-trail-history";
import { useFlightTrack } from "@/hooks/use-flight-track";
import { useMergedTrails } from "@/hooks/use-merged-trails";
import { useFlightMonitors } from "@/hooks/use-flight-monitors";
import type { MapStyle } from "@/lib/map-styles";
import type { City } from "@/lib/cities";
import {
  fetchFlightByIcao24,
  fetchFlightByCallsign,
  type FlightState,
} from "@/lib/opensky";
import { formatCallsign } from "@/lib/flight-utils";
import type { PickingInfo } from "@deck.gl/core";
import { Github, Star } from "lucide-react";
import {
  DEFAULT_CITY,
  DEFAULT_STYLE,
  GITHUB_REPO_URL,
  ICAO24_REGEX,
  subscribeNoop,
  resolveInitialCity,
  syncCityToUrl,
  syncFpvToUrl,
  resolveInitialFpv,
  loadMapStyle,
  saveMapStyle,
  formatStarCount,
} from "@/components/flight-tracker-utils";
import {
  pickRandomAirportCity,
  cityFromFlight,
} from "@/components/flight-tracker-random";

function FlightTrackerInner() {
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

  const activeCity = cityOverride ?? hydratedCity;
  const mapStyle = styleOverride ?? hydratedStyle;
  const { settings, update } = useSettings();

  const setActiveCity = useCallback((city: City) => {
    setCityOverride(city);
    setSelectedIcao24(null);
    setFpvIcao24(null);
    setFollowIcao24(null);
    syncCityToUrl(city);
  }, []);

  const setMapStyle = useCallback((style: MapStyle) => {
    setStyleOverride(style);
    saveMapStyle(style);
  }, []);

  const { flights, loading, rateLimited, retryIn } = useFlights(
    activeCity,
    fpvIcao24,
    fpvSeedCenter,
  );

  const displayFlights = flights;
  const displayTrails = useTrailHistory(displayFlights);

  const selectedFlightForTrack = useMemo(() => {
    if (!selectedIcao24) return null;
    return displayFlights.find((f) => f.icao24 === selectedIcao24) ?? null;
  }, [selectedIcao24, displayFlights]);

  const shouldFetchSelectedTrack =
    !!selectedIcao24 &&
    !fpvIcao24 &&
    !(selectedFlightForTrack?.onGround ?? false);

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
    return (
      displayFlights.find((f) => f.icao24.toLowerCase() === selectedIcao24) ??
      null
    );
  }, [selectedIcao24, displayFlights]);

  const followFlight = useMemo(() => {
    if (!followIcao24) return null;
    return (
      displayFlights.find((f) => f.icao24.toLowerCase() === followIcao24) ??
      null
    );
  }, [followIcao24, displayFlights]);

  const fpvFlight = useMemo(() => {
    if (!fpvIcao24) return null;
    return (
      displayFlights.find((f) => f.icao24.toLowerCase() === fpvIcao24) ?? null
    );
  }, [fpvIcao24, displayFlights]);

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

  const fpvFlightOrCached = fpvFlight;
  const displayFlight = selectedFlight;

  const handleClick = useCallback(
    (info: PickingInfo<FlightState> | null) => {
      if (fpvIcao24) return;
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
        displayFlights.find((f) => f.icao24.toLowerCase() === targetIcao24) ??
        flights.find((f) => f.icao24.toLowerCase() === targetIcao24);
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
    [displayFlights, flights],
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
        displayFlights.find((f) => f.icao24.toLowerCase() === compactQuery) ??
        displayFlights.find((f) =>
          formatCallsign(f.callsign)
            .toLowerCase()
            .replace(/\s+/g, "")
            .includes(compactQuery),
        ) ??
        null;

      if (localMatch) {
        setSelectedIcao24(localMatch.icao24);
        setFollowIcao24(null);
        if (
          enterFpv &&
          !localMatch.onGround &&
          localMatch.longitude != null &&
          localMatch.latitude != null
        ) {
          setFpvSeedCenter({
            lng: localMatch.longitude,
            lat: localMatch.latitude,
          });
          setFpvIcao24(localMatch.icao24);
        }
        return true;
      }

      const result = ICAO24_REGEX.test(compactQuery)
        ? await fetchFlightByIcao24(compactQuery)
        : await fetchFlightByCallsign(compactQuery);

      if (!result.flight) return false;

      const focusCity = cityFromFlight(result.flight);
      if (focusCity) {
        setCityOverride(focusCity);
        syncCityToUrl(focusCity);
      }

      setSelectedIcao24(result.flight.icao24);
      setFollowIcao24(null);
      if (
        enterFpv &&
        !result.flight.onGround &&
        result.flight.longitude != null &&
        result.flight.latitude != null
      ) {
        setFpvSeedCenter({
          lng: result.flight.longitude,
          lat: result.flight.latitude,
        });
        setFpvIcao24(result.flight.icao24);
      }
      return true;
    },
    [displayFlights],
  );

  useKeyboardShortcuts({
    onNorthUp: handleNorthUp,
    onResetView: handleResetView,
    onToggleOrbit: handleToggleOrbit,
    onOpenSearch: handleOpenSearch,
    onToggleHelp: handleToggleHelp,
    onDeselect: handleDeselectFlight,
    onToggleFpv: handleToggleFpvKey,
    isFpv: fpvIcao24 !== null,
  });

  return (
    <main className="relative h-dvh w-screen overflow-hidden bg-black">
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
        <AirportLayer
          activeCity={activeCity}
          onSelectAirport={setActiveCity}
          isDark={mapStyle.dark}
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

      <div
        data-map-theme={mapStyle.dark ? "dark" : "light"}
        className="pointer-events-none absolute inset-0 z-10"
      >
        {!fpvIcao24 && (
          <div className="pointer-events-auto absolute left-3 top-3 flex items-center gap-3 sm:left-4 sm:top-4">
            <Brand isDark={mapStyle.dark} />
          </div>
        )}

        {!fpvIcao24 && (
          <div className="pointer-events-auto absolute left-3 top-14 sm:left-4 sm:top-16">
            <FlightCard
              flight={displayFlight}
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
            <a
              href={GITHUB_REPO_URL}
              target="_blank"
              rel="noreferrer"
              aria-label="Open GitHub repository"
              className="relative inline-flex h-9 w-9 items-center justify-center rounded-xl backdrop-blur-2xl transition-colors"
              style={{
                borderWidth: 1,
                borderColor: "rgb(var(--ui-fg) / 0.06)",
                backgroundColor: "rgb(var(--ui-fg) / 0.03)",
                color: "rgb(var(--ui-fg) / 0.5)",
              }}
              title={
                repoStars != null
                  ? `GitHub · ${formatStarCount(repoStars)} stars`
                  : "Open GitHub repository"
              }
            >
              <Github className="h-4 w-4" />
              {repoStars != null && (
                <span
                  className="pointer-events-none absolute -bottom-1 -right-1 rounded-full px-1.5 py-0.5 text-[9px] font-semibold tabular-nums"
                  style={{
                    backgroundColor: "rgb(var(--ui-bg) / 0.95)",
                    border: "1px solid rgb(var(--ui-fg) / 0.1)",
                    color: "rgb(var(--ui-fg) / 0.55)",
                  }}
                >
                  <span className="flex items-center gap-0.5">
                    <Star className="h-2 w-2" />
                    {formatStarCount(repoStars)}
                  </span>
                </span>
              )}
            </a>
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
              loading={loading}
              rateLimited={rateLimited}
              retryIn={retryIn}
              onNorthUp={handleNorthUp}
              onResetView={handleResetView}
              onRandomAirport={handleRandomAirport}
            />
          </div>
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
              <MapAttribution styleId={mapStyle.id} />
            </div>
          </div>
        )}
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

function Brand({ isDark }: { isDark: boolean }) {
  return (
    <span
      className={`text-sm font-semibold tracking-wide ${
        isDark ? "text-white/70" : "text-black/70"
      }`}
    >
      aeris
    </span>
  );
}
