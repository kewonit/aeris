"use client";

import { useEffect } from "react";
import { useMap } from "./map";

const SOURCE_ID = "user-location";
const DOT_LAYER = "user-location-dot";
const RING_LAYER = "user-location-ring";

const emptyGeoJson: GeoJSON.FeatureCollection = {
  type: "FeatureCollection",
  features: [],
};

function makeGeoJson(coordinates: [number, number]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: { type: "Point", coordinates },
        properties: {},
      },
    ],
  };
}

export function UserLocationMarker({
  coordinates,
}: {
  coordinates: [number, number] | null;
}) {
  const { map, isLoaded } = useMap();

  useEffect(() => {
    if (!map || !isLoaded) return;
    const m = map;

    function addSourceAndLayers() {
      if (!m.getSource(SOURCE_ID)) {
        m.addSource(SOURCE_ID, {
          type: "geojson",
          data: coordinates ? makeGeoJson(coordinates) : emptyGeoJson,
        });
      }

      if (!m.getLayer(RING_LAYER)) {
        m.addLayer({
          id: RING_LAYER,
          type: "circle",
          source: SOURCE_ID,
          paint: {
            "circle-radius": [
              "interpolate",
              ["linear"],
              ["zoom"],
              2,
              4,
              8,
              6,
              14,
              9,
            ],
            "circle-color": "rgba(255,255,255,0)",
            "circle-stroke-color": "rgba(59,130,246,0.6)",
            "circle-stroke-width": 1.5,
            "circle-pitch-alignment": "map",
            "circle-pitch-scale": "map",
          },
        });
      }

      if (!m.getLayer(DOT_LAYER)) {
        m.addLayer({
          id: DOT_LAYER,
          type: "circle",
          source: SOURCE_ID,
          paint: {
            "circle-radius": ["step", ["zoom"], 1.3, 6, 1.8, 10, 2.4, 14, 3],
            "circle-color": "rgba(37,99,235,1)",
            "circle-opacity": 1,
            "circle-stroke-color": "rgba(255,255,255,0.4)",
            "circle-stroke-width": [
              "interpolate",
              ["linear"],
              ["zoom"],
              2,
              0.3,
              10,
              0.5,
              14,
              0.8,
            ],
            "circle-pitch-alignment": "map",
            "circle-pitch-scale": "map",
          },
        });
      }
    }

    addSourceAndLayers();
    m.on("style.load", addSourceAndLayers);

    return () => {
      m.off("style.load", addSourceAndLayers);
      try {
        if (m.getLayer(DOT_LAYER)) m.removeLayer(DOT_LAYER);
        if (m.getLayer(RING_LAYER)) m.removeLayer(RING_LAYER);
        if (m.getSource(SOURCE_ID)) m.removeSource(SOURCE_ID);
      } catch {
        // Map may already be disposed
      }
    };
  }, [map, isLoaded]);

  // Update source data when coordinates change
  useEffect(() => {
    if (!map || !isLoaded) return;
    const src = map.getSource(SOURCE_ID);
    if (src && "setData" in src) {
      (src as maplibregl.GeoJSONSource).setData(
        coordinates ? makeGeoJson(coordinates) : emptyGeoJson,
      );
    }
  }, [map, isLoaded, coordinates]);

  return null;
}
