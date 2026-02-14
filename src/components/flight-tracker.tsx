"use client";

import { useState, useCallback, useSyncExternalStore } from "react";
import { ErrorBoundary } from "@/components/error-boundary";
import { Map } from "@/components/map/map";
import { CameraController } from "@/components/map/camera-controller";
import { AirportLayer } from "@/components/map/airport-layer";
import { FlightLayers } from "@/components/map/flight-layers";
import { FlightCard } from "@/components/ui/flight-card";
import { ControlPanel } from "@/components/ui/control-panel";
import { AltitudeLegend } from "@/components/ui/altitude-legend";
import { StatusBar } from "@/components/ui/status-bar";
import { SettingsProvider, useSettings } from "@/hooks/use-settings";
import { useFlights } from "@/hooks/use-flights";
import { useTrailHistory } from "@/hooks/use-trail-history";
import { MAP_STYLES, DEFAULT_STYLE, type MapStyle } from "@/lib/map-styles";
import { CITIES, type City } from "@/lib/cities";
import { findByIata, airportToCity } from "@/lib/airports";
import type { FlightState } from "@/lib/opensky";
import type { PickingInfo } from "@deck.gl/core";

const DEFAULT_CITY_ID = "mia";
const STYLE_STORAGE_KEY = "aeris:mapStyle";

const DEFAULT_CITY = CITIES.find((c) => c.id === DEFAULT_CITY_ID) ?? CITIES[0];

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
  const activeCity = cityOverride ?? hydratedCity;
  const mapStyle = styleOverride ?? hydratedStyle;
  const { settings } = useSettings();

  const setActiveCity = useCallback((city: City) => {
    setCityOverride(city);
    syncCityToUrl(city);
  }, []);

  const setMapStyle = useCallback((style: MapStyle) => {
    setStyleOverride(style);
    saveMapStyle(style);
  }, []);
  const { flights, loading, rateLimited, retryIn } = useFlights(activeCity);
  const trails = useTrailHistory(flights);
  const [hoveredFlight, setHoveredFlight] = useState<FlightState | null>(null);
  const [cursorPos, setCursorPos] = useState({ x: 0, y: 0 });

  const handleHover = useCallback((info: PickingInfo<FlightState> | null) => {
    if (info?.object) {
      setHoveredFlight(info.object);
      setCursorPos({ x: info.x ?? 0, y: info.y ?? 0 });
    } else {
      setHoveredFlight(null);
    }
  }, []);

  const handleClick = useCallback((info: PickingInfo<FlightState> | null) => {
    if (info?.object) {
      setHoveredFlight(info.object);
      setCursorPos({ x: info.x ?? 0, y: info.y ?? 0 });
    }
  }, []);

  return (
    <main className="relative h-screen w-screen overflow-hidden bg-black">
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
          onHover={handleHover}
          onClick={handleClick}
          showTrails={settings.showTrails}
          showShadows={settings.showShadows}
          showAltitudeColors={settings.showAltitudeColors}
        />
      </Map>

      <div
        data-map-theme={mapStyle.dark ? "dark" : "light"}
        className="pointer-events-none absolute inset-0 z-10"
      >
        <div className="pointer-events-auto absolute left-4 top-4 flex items-center gap-3">
          <Brand isDark={mapStyle.dark} />
        </div>

        <div className="pointer-events-auto absolute right-4 top-4 flex items-center gap-2">
          <ControlPanel
            activeCity={activeCity}
            onSelectCity={setActiveCity}
            activeStyle={mapStyle}
            onSelectStyle={setMapStyle}
          />
        </div>

        <div className="pointer-events-auto absolute bottom-4 left-4">
          <StatusBar
            flightCount={flights.length}
            cityName={activeCity.name}
            loading={loading}
            rateLimited={rateLimited}
            retryIn={retryIn}
          />
        </div>

        <div className="pointer-events-auto absolute bottom-4 right-4">
          <AltitudeLegend />
        </div>
      </div>

      <FlightCard flight={hoveredFlight} x={cursorPos.x} y={cursorPos.y} />
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
