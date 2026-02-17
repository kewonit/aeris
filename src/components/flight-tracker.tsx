"use client";

import {
  useState,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from "react";
import { motion } from "motion/react";
import { ErrorBoundary } from "@/components/error-boundary";
import { Map } from "@/components/map/map";
import { CameraController } from "@/components/map/camera-controller";
import { AirportLayer } from "@/components/map/airport-layer";
import { FlightLayers } from "@/components/map/flight-layers";
import { FlightCard } from "@/components/ui/flight-card";
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
import type { FlightState } from "@/lib/opensky";
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
    window.history.replaceState(null, "", url.toString());
  } catch {
    /* ignore */
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

  const activeCity = cityOverride ?? hydratedCity;
  const mapStyle = styleOverride ?? hydratedStyle;
  const { settings, update } = useSettings();

  const setActiveCity = useCallback((city: City) => {
    setCityOverride(city);
    setSelectedIcao24(null);
    syncCityToUrl(city);
  }, []);

  const setMapStyle = useCallback((style: MapStyle) => {
    setStyleOverride(style);
    saveMapStyle(style);
  }, []);
  const { flights, loading, rateLimited, retryIn } = useFlights(activeCity);
  const trails = useTrailHistory(flights);

  const selectedFlight = useMemo(() => {
    if (!selectedIcao24) return null;
    return flights.find((f) => f.icao24 === selectedIcao24) ?? null;
  }, [selectedIcao24, flights]);

  const lastKnownFlightRef = useRef<FlightState | null>(null);
  useEffect(() => {
    if (selectedFlight) lastKnownFlightRef.current = selectedFlight;
    if (!selectedIcao24) lastKnownFlightRef.current = null;
  }, [selectedFlight, selectedIcao24]);

  // Safe: ref only changes in the effect above, which runs after state-driven re-renders.
  const displayFlight =
    // eslint-disable-next-line react-hooks/refs
    selectedFlight ?? (selectedIcao24 ? lastKnownFlightRef.current : null);

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
    // Flight is selected but not in the current flights list.
    const now = Date.now();
    if (missingSinceRef.current == null) {
      missingSinceRef.current = now;
      return;
    }
    if (now - missingSinceRef.current >= 30_000) {
      setSelectedIcao24(null);
      missingSinceRef.current = null;
    }
  }, [selectedIcao24, selectedFlight, flights]);

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

  const handleClick = useCallback((info: PickingInfo<FlightState> | null) => {
    if (info?.object) {
      setSelectedIcao24((prev) =>
        prev === info.object!.icao24 ? null : info.object!.icao24,
      );
    } else {
      setSelectedIcao24(null);
    }
  }, []);

  const handleDeselectFlight = useCallback(() => {
    setSelectedIcao24(null);
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

  useKeyboardShortcuts({
    onNorthUp: handleNorthUp,
    onResetView: handleResetView,
    onToggleOrbit: handleToggleOrbit,
    onOpenSearch: handleOpenSearch,
    onToggleHelp: handleToggleHelp,
    onDeselect: handleDeselectFlight,
  });

  return (
    <main className="relative h-dvh w-screen overflow-hidden bg-black">
      <Map mapStyle={mapStyle.style} isDark={mapStyle.dark}>
        <CameraController city={activeCity} />
        <AirportLayer
          activeCity={activeCity}
          onSelectAirport={setActiveCity}
          isDark={mapStyle.dark}
        />
        <FlightLayers
          flights={flights}
          trails={trails}
          onClick={handleClick}
          selectedIcao24={selectedIcao24}
          showTrails={settings.showTrails}
          trailThickness={settings.trailThickness}
          trailDistance={settings.trailDistance}
          showShadows={settings.showShadows}
          showAltitudeColors={settings.showAltitudeColors}
        />
      </Map>

      <div
        data-map-theme={mapStyle.dark ? "dark" : "light"}
        className="pointer-events-none absolute inset-0 z-10"
      >
        <div className="pointer-events-auto absolute left-3 top-3 flex items-center gap-3 sm:left-4 sm:top-4">
          <Brand isDark={mapStyle.dark} />
        </div>

        <div className="pointer-events-auto absolute left-3 top-14 sm:left-4 sm:top-16">
          <FlightCard flight={displayFlight} onClose={handleDeselectFlight} />
        </div>

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
          />
        </div>

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

        <div className="pointer-events-auto absolute bottom-[env(safe-area-inset-bottom,0px)] right-3 mb-3 flex flex-col items-end gap-2 sm:bottom-4 sm:right-4 sm:mb-0">
          <CameraControls />
          <AltitudeLegend />
          <MapAttribution styleId={mapStyle.id} />
        </div>
      </div>

      <KeyboardShortcutsHelp
        open={showHelp}
        onClose={() => setShowHelp(false)}
      />
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
