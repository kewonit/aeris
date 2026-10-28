"use client";

import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState } from "react";
import { TOWER_MAP_STYLES, tuneTowerMap } from "./tower-map-style";
import type { AtcAirport } from "./types";

type Hover = { airport: AtcAirport; x: number; y: number };

function cssColor(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** The middle 90% of a country's towers, so Guam doesn't pull the US view across the Pacific. */
function countryBounds(airports: AtcAirport[]): maplibregl.LngLatBoundsLike | null {
  if (airports.length === 0) return null;
  const pick = (values: number[]) => {
    const sorted = [...values].sort((a, b) => a - b);
    const cut = Math.floor(sorted.length * 0.05);
    return [sorted[cut], sorted[sorted.length - 1 - cut]] as const;
  };
  const [west, east] = pick(airports.map((a) => a.lng));
  const [south, north] = pick(airports.map((a) => a.lat));
  return [
    [west, south],
    [east, north],
  ];
}

/** Every tower on a quiet map; tap one to tune in. */
export default function TowerMap({
  airports,
  selected,
  country,
  dark,
  onSelect,
}: {
  airports: AtcAirport[];
  selected: string | null;
  country: string | null;
  dark: boolean;
  onSelect: (icao: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const onSelectRef = useRef(onSelect);
  const [ready, setReady] = useState(false);
  const [hover, setHover] = useState<Hover | null>(null);

  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const byIcao = new Map(airports.map((a) => [a.icao, a]));
    const map = new maplibregl.Map({
      container,
      style: TOWER_MAP_STYLES[dark ? "dark" : "light"],
      center: [-30, 30],
      zoom: 1.1,
      minZoom: 0.6,
      maxZoom: 11,
      attributionControl: false,
      dragRotate: false,
      pitchWithRotate: false,
    });
    map.touchZoomRotate.disableRotation();
    map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");
    mapRef.current = map;

    map.on("load", () => {
      tuneTowerMap(map, dark);
      const tint = cssColor("--tint");
      const ring = cssColor("--background");
      map.addSource("towers", {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: airports.map((a) => ({
            type: "Feature",
            geometry: { type: "Point", coordinates: [a.lng, a.lat] },
            properties: { icao: a.icao },
          })),
        },
      });
      map.addLayer({
        id: "towers-halo",
        type: "circle",
        source: "towers",
        filter: ["==", ["get", "icao"], ""],
        paint: { "circle-radius": 16, "circle-color": tint, "circle-opacity": 0.2 },
      });
      map.addLayer({
        id: "towers",
        type: "circle",
        source: "towers",
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 1, 3, 5, 4.5, 9, 6.5],
          "circle-color": tint,
          "circle-stroke-color": ring,
          "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 1, 1, 6, 2],
        },
      });
      map.addLayer({
        id: "towers-selected",
        type: "circle",
        source: "towers",
        filter: ["==", ["get", "icao"], ""],
        paint: {
          "circle-radius": 7,
          "circle-color": tint,
          "circle-stroke-color": ring,
          "circle-stroke-width": 2.5,
        },
      });
      setReady(true);
    });

    map.on("mousemove", "towers", (event) => {
      const icao = event.features?.[0]?.properties?.icao as string | undefined;
      const airport = icao ? byIcao.get(icao) : undefined;
      map.getCanvas().style.cursor = airport ? "pointer" : "";
      setHover(airport ? { airport, x: event.point.x, y: event.point.y } : null);
    });
    map.on("mouseleave", "towers", () => {
      map.getCanvas().style.cursor = "";
      setHover(null);
    });
    map.on("click", "towers", (event) => {
      const icao = event.features?.[0]?.properties?.icao as string | undefined;
      if (icao) onSelectRef.current(icao);
    });

    return () => {
      setReady(false);
      mapRef.current = null;
      map.remove();
    };
  }, [airports, dark]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const filter: maplibregl.FilterSpecification = ["==", ["get", "icao"], selected ?? ""];
    map.setFilter("towers-halo", filter);
    map.setFilter("towers-selected", filter);
  }, [ready, selected]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const bounds = country
      ? countryBounds(airports.filter((a) => a.country === country))
      : null;
    if (bounds) {
      map.fitBounds(bounds, { padding: 48, maxZoom: 7, duration: 900 });
    } else if (!country) {
      const airport = airports.find((a) => a.icao === selected);
      map.easeTo({
        center: airport ? [airport.lng, airport.lat] : [-30, 30],
        zoom: airport ? 4 : 1.1,
        duration: 900,
      });
    }
    // Only a change of country reframes the map; a tap shouldn't move it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, country, airports]);

  return (
    <div className="relative size-full overflow-hidden rounded-lg bg-card">
      <div ref={containerRef} className="size-full" />
      {hover && (
        <div
          className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-md bg-background px-2.5 py-1.5 shadow-lift"
          style={{ left: hover.x, top: hover.y - 12 }}
        >
          <span className="text-label font-medium">{hover.airport.iata}</span>
          <span className="ml-1.5 text-label text-muted-foreground">
            {hover.airport.city}
          </span>
        </div>
      )}
    </div>
  );
}
