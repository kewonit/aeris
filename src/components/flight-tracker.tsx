"use client";

import {
  useState,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from "react";
import { motion, AnimatePresence } from "motion/react";
import { ErrorBoundary } from "@/components/error-boundary";
import { Map as MapView } from "@/components/map/map";
import { CameraController } from "@/components/map/camera-controller";
import { AirportLayer } from "@/components/map/airport-layer";
import { FlightLayers } from "@/components/map/flight-layers";
import { FlightCard } from "@/components/ui/flight-card";
import { FpvHud } from "@/components/ui/fpv-hud";
import { KeyboardShortcutsHelp } from "@/components/ui/keyboard-shortcuts-help";
import { ControlPanel } from "@/components/ui/control-panel";
import { AltitudeLegend } from "@/components/ui/altitude-legend";
import { CameraControls } from "@/components/ui/camera-controls";
import { StatusBar } from "@/components/ui/status-bar";
import { MapAttribution } from "@/components/ui/map-attribution";
import { SettingsProvider, useSettings } from "@/hooks/use-settings";
import { useKeyboardShortcuts } from "@/hooks/use-keyboard-shortcuts";
import { useFlights } from "@/hooks/use-flights";
import { useTrailHistory } from "@/hooks/use-trail-history";
import { MAP_STYLES, DEFAULT_STYLE, type MapStyle } from "@/lib/map-styles";
import { CITIES, type City } from "@/lib/cities";
import { AIRPORTS, findByIata, airportToCity } from "@/lib/airports";
import {
  fetchFlightByIcao24,
  fetchFlightByCallsign,
  type FlightState,
} from "@/lib/opensky";
import { formatCallsign } from "@/lib/flight-utils";
import type { PickingInfo } from "@deck.gl/core";
import { Github, Star, Keyboard } from "lucide-react";

const DEFAULT_CITY_ID = "sfo";
const STYLE_STORAGE_KEY = "aeris:mapStyle";

const DEFAULT_CITY = CITIES.find((c) => c.id === DEFAULT_CITY_ID) ?? CITIES[0];
const GITHUB_REPO_URL = "https://github.com/kewonit/aeris";
const GITHUB_REPO_API = "https://api.github.com/repos/kewonit/aeris";
const HIGH_TRAFFIC_IATA = [
  "ATL",
  "DXB",
  "LHR",
  "HND",
  "DFW",
  "DEN",
  "IST",
  "LAX",
  "CDG",
  "AMS",
  "FRA",
  "MAD",
  "JFK",
  "SIN",
  "ORD",
  "SFO",
  "MIA",
  "LAS",
  "MUC",
  "CLT",
] as const;
const HUB_PICK_PROBABILITY = 0.75;
const HIGH_TRAFFIC_IATA_SET = new Set<string>(HIGH_TRAFFIC_IATA);
const HIGH_TRAFFIC_AIRPORTS = AIRPORTS.filter((airport) =>
  HIGH_TRAFFIC_IATA_SET.has(airport.iata.toUpperCase()),
);
const ICAO24_REGEX = /^[0-9a-f]{6}$/i;

const subscribeNoop = () => () => {};

let _cachedInitialCity: City | null = null;

function resolveInitialCity(): City {
  if (_cachedInitialCity) return _cachedInitialCity;
  try {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("city")?.trim().toUpperCase();
    if (!code) {
      _cachedInitialCity = DEFAULT_CITY;
      return DEFAULT_CITY;
    }

    const preset = CITIES.find(
      (c) => c.iata.toUpperCase() === code || c.id === code.toLowerCase(),
    );
    if (preset) {
      _cachedInitialCity = preset;
      return preset;
    }

    const airport = findByIata(code);
    if (airport) {
      _cachedInitialCity = airportToCity(airport);
      return _cachedInitialCity;
    }

    _cachedInitialCity = DEFAULT_CITY;
    return DEFAULT_CITY;
  } catch {
    _cachedInitialCity = DEFAULT_CITY;
    return DEFAULT_CITY;
  }
}

function syncCityToUrl(city: City): void {
  if (typeof window === "undefined") return;
  try {
    const url = new URL(window.location.href);
    url.searchParams.set("city", city.iata);
    url.searchParams.delete("from");
    url.searchParams.delete("to");
    url.searchParams.delete("fpv");
    window.history.replaceState(null, "", url.toString());
  } catch {
    /* ignore */
  }
}

function syncFpvToUrl(icao24: string | null, activeCity?: City): void {
  if (typeof window === "undefined") return;
  try {
    const url = new URL(window.location.href);
    if (icao24) {
      url.searchParams.set("fpv", icao24);
      url.searchParams.delete("city");
      url.searchParams.delete("from");
      url.searchParams.delete("to");
    } else {
      url.searchParams.delete("fpv");
      if (activeCity) {
        url.searchParams.set("city", activeCity.iata);
      }
    }
    window.history.replaceState(null, "", url.toString());
  } catch {
    /* ignore */
  }
}

function resolveInitialFpv(): string | null {
  try {
    const params = new URLSearchParams(window.location.search);
    const raw = params.get("fpv")?.trim().toLowerCase();
    return raw && /^[0-9a-f]{6}$/.test(raw) ? raw : null;
  } catch {
    return null;
  }
}

function loadMapStyle(): MapStyle {
  try {
    const id = localStorage.getItem(STYLE_STORAGE_KEY);
    if (!id) return DEFAULT_STYLE;
    return MAP_STYLES.find((s) => s.id === id) ?? DEFAULT_STYLE;
  } catch {
    return DEFAULT_STYLE;
  }
}

function saveMapStyle(style: MapStyle): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STYLE_STORAGE_KEY, style.id);
  } catch {
    /* blocked */
  }
}

function chooseRandom<T>(items: readonly T[]): T | null {
  if (items.length === 0) return null;
  return items[Math.floor(Math.random() * items.length)] ?? null;
}

function pickRandomAirportCity(excludeIata?: string): City {
  const exclude = excludeIata?.toUpperCase();
  const filteredHubs = exclude
    ? HIGH_TRAFFIC_AIRPORTS.filter(
        (airport) => airport.iata.toUpperCase() !== exclude,
      )
    : HIGH_TRAFFIC_AIRPORTS;

  const filteredAirports = exclude
    ? AIRPORTS.filter((airport) => airport.iata.toUpperCase() !== exclude)
    : AIRPORTS;

  const useHubs =
    filteredHubs.length > 0 && Math.random() < HUB_PICK_PROBABILITY;
  const source = useHubs ? filteredHubs : filteredAirports;
  const randomAirport = chooseRandom(source);
  if (!randomAirport) return DEFAULT_CITY;
  return airportToCity(randomAirport);
}

function cityFromFlight(flight: FlightState): City | null {
  if (flight.longitude == null || flight.latitude == null) return null;
  const code = flight.icao24.toUpperCase();
  return {
    id: `trk-${flight.icao24}`,
    name: `Flight ${code}`,
    country: flight.originCountry || "Unknown",
    iata: code.slice(0, 3),
    coordinates: [flight.longitude, flight.latitude],
    radius: 2,
  };
}

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
  const [showHelp, setShowHelp] = useState(false);
  const [repoStars, setRepoStars] = useState<number | null>(null);
  const [followIcao24, setFollowIcao24] = useState<string | null>(null);
  const [fpvIcao24, setFpvIcao24] = useState<string | null>(null);

  const pendingFpvRef = useRef<string | null>(resolveInitialFpv());

  const fpvPositionRef = useRef<{
    lng: number;
    lat: number;
    alt: number;
    track: number;
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
  );

  const displayFlights = flights;
  const displayTrails = useTrailHistory(displayFlights);

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

  const fpvLookupDoneRef = useRef(false);
  useEffect(() => {
    const pending = pendingFpvRef.current;
    if (!pending || fpvIcao24) return;

    const match = displayFlights.find(
      (f) => f.icao24.toLowerCase() === pending,
    );
    if (match && match.longitude != null && match.latitude != null) {
      pendingFpvRef.current = null;
      fpvLookupDoneRef.current = false;
      setFpvIcao24(pending);
      setFollowIcao24(null);
      return;
    }

    if (!fpvLookupDoneRef.current && displayFlights.length > 0) {
      fpvLookupDoneRef.current = true;
      const controller = new AbortController();
      fetchFlightByIcao24(pending, controller.signal)
        .then((result) => {
          if (
            result.flight &&
            result.flight.longitude != null &&
            result.flight.latitude != null &&
            pendingFpvRef.current === pending
          ) {
            pendingFpvRef.current = null;
            setFpvIcao24(pending);
            setFollowIcao24(null);
          } else if (pendingFpvRef.current === pending) {
            pendingFpvRef.current = null;
            syncFpvToUrl(null, activeCity);
          }
        })
        .catch(() => {
          if (pendingFpvRef.current === pending) {
            pendingFpvRef.current = null;
          }
        });
      return () => controller.abort();
    }
  }, [displayFlights, fpvIcao24, activeCity]);

  const fpvFlightOrCached = fpvFlight;

  const fpvMissCountRef = useRef(0);
  useEffect(() => {
    if (!fpvIcao24) {
      fpvMissCountRef.current = 0;
      return;
    }

    if (fpvFlight) {
      fpvMissCountRef.current = 0;
      if (fpvFlight.onGround) {
        const timer = setTimeout(() => setFpvIcao24(null), 0);
        return () => clearTimeout(timer);
      }
    } else {
      fpvMissCountRef.current += 1;
      if (fpvMissCountRef.current >= 2) {
        const timer = setTimeout(() => setFpvIcao24(null), 0);
        return () => clearTimeout(timer);
      }
    }
  }, [fpvIcao24, fpvFlight]);

  const followMissCountRef = useRef(0);
  useEffect(() => {
    if (!followIcao24) {
      followMissCountRef.current = 0;
      return;
    }
    if (followFlight) {
      followMissCountRef.current = 0;
    } else {
      followMissCountRef.current += 1;
      if (followMissCountRef.current >= 3) {
        const timer = setTimeout(() => setFollowIcao24(null), 0);
        return () => clearTimeout(timer);
      }
    }
  }, [followIcao24, followFlight]);

  const displayFlight = selectedFlight;

  const missingSinceRef = useRef<number | null>(null);
  useEffect(() => {
    if (!selectedIcao24) {
      missingSinceRef.current = null;
      return;
    }
    if (selectedFlight) {
      missingSinceRef.current = null;
      return;
    }
    const now = Date.now();
    if (missingSinceRef.current == null) {
      missingSinceRef.current = now;
      return;
    }
    if (now - missingSinceRef.current >= 30_000) {
      const timer = setTimeout(() => setSelectedIcao24(null), 0);
      missingSinceRef.current = null;
      return () => clearTimeout(timer);
    }
  }, [selectedIcao24, selectedFlight, displayFlights]);

  useEffect(() => {
    let mounted = true;

    async function loadRepoStars() {
      try {
        const res = await fetch(GITHUB_REPO_API, { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { stargazers_count?: number };
        if (mounted && typeof data.stargazers_count === "number") {
          setRepoStars(data.stargazers_count);
        }
      } catch {
        /* silent fallback */
      }
    }

    loadRepoStars();
    return () => {
      mounted = false;
    };
  }, []);

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
      if (flight && (flight.longitude == null || flight.latitude == null))
        return;
      setFpvIcao24((prev) => (prev === targetIcao24 ? null : targetIcao24));
      setFollowIcao24(null);
    },
    [displayFlights, flights],
  );

  const handleExitFpv = useCallback(() => {
    setFpvIcao24(null);
  }, []);

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
    setShowHelp((prev) => !prev);
  }, []);

  const handleToggleFpvKey = useCallback(() => {
    if (fpvIcao24) {
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
        if (enterFpv) {
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
      if (enterFpv) {
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
      <MapView mapStyle={mapStyle.style} isDark={mapStyle.dark}>
        <CameraController
          city={activeCity}
          followFlight={followFlight}
          fpvFlight={fpvFlightOrCached}
        />
        <AirportLayer
          activeCity={activeCity}
          onSelectAirport={setActiveCity}
          isDark={mapStyle.dark}
        />
        <FlightLayers
          flights={displayFlights}
          trails={displayTrails}
          onClick={handleClick}
          selectedIcao24={fpvIcao24 ?? selectedIcao24}
          showTrails={settings.showTrails}
          trailThickness={settings.trailThickness}
          trailDistance={settings.trailDistance}
          showShadows={settings.showShadows}
          showAltitudeColors={settings.showAltitudeColors}
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
            <motion.button
              onClick={handleToggleHelp}
              className="hidden h-9 w-9 items-center justify-center rounded-xl backdrop-blur-2xl transition-colors sm:flex"
              style={{
                borderWidth: 1,
                borderColor: "rgb(var(--ui-fg) / 0.06)",
                backgroundColor: "rgb(var(--ui-fg) / 0.03)",
                color: "rgb(var(--ui-fg) / 0.5)",
              }}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              aria-label="Keyboard shortcuts"
              title="Keyboard shortcuts (?)"
            >
              <Keyboard className="h-4 w-4" />
            </motion.button>
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
          <div className="pointer-events-auto absolute bottom-[env(safe-area-inset-bottom,0px)] right-3 mb-3 flex flex-col items-end gap-2 sm:bottom-4 sm:right-4 sm:mb-0">
            <CameraControls />
            <AltitudeLegend />
            <MapAttribution styleId={mapStyle.id} />
          </div>
        )}
      </div>

      {!fpvIcao24 && (
        <KeyboardShortcutsHelp
          open={showHelp}
          onClose={() => setShowHelp(false)}
        />
      )}

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

function formatStarCount(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}m`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return `${value}`;
}
