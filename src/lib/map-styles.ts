export type MapStyleSpec = string | Record<string, unknown>;

export type TerrainProfile = "none" | "dark";

export const TERRAIN_DEM_SOURCE_ID = "aeris-terrain-dem";
export const TERRAIN_HILLSHADE_LAYER_ID = "aeris-terrain-hillshade";

/**
 * Single shared DEM source for both terrain mesh AND hillshade.
 * Uses AWS Terrain Tiles (Mapzen/Tilezen) - free, reliable, globally cached on S3.
 * Terrarium encoding: elevation = (R * 256 + G + B / 256) - 32768
 * maxzoom capped at 12 (terrain detail beyond that is imperceptible for flight tracking).
 */
export function createTerrainDemSource(): Record<string, unknown> {
  return {
    type: "raster-dem",
    tiles: [
      "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png",
    ],
    encoding: "terrarium",
    tileSize: 256,
    maxzoom: 12,
    volatile: true,
  };
}

export const DARK_TERRAIN_SPEC: Record<string, unknown> = {
  source: TERRAIN_DEM_SOURCE_ID,
  exaggeration: 0.8, // MapLibre terrain.exaggeration only accepts a number, not an expression
};

export const DARK_TERRAIN_HILLSHADE_LAYER: Record<string, unknown> = {
  id: TERRAIN_HILLSHADE_LAYER_ID,
  type: "hillshade",
  source: TERRAIN_DEM_SOURCE_ID, // reuse same DEM source - no duplicate tile fetches
  minzoom: 3, // skip hillshade at globe zoom (invisible anyway, saves GPU)
  layout: { visibility: "visible" },
  paint: {
    "hillshade-shadow-color": "#040608",
    "hillshade-highlight-color": "rgba(180,195,210,0.12)",
    "hillshade-accent-color": "#0d1117",
    "hillshade-exaggeration": [
      "interpolate",
      ["linear"],
      ["zoom"],
      3,
      0, // invisible at low zoom
      5,
      0.3, // fade in gently
      8,
      0.5, // full hillshade at regional zoom
    ],
  },
};

export const DARK_TERRAIN_SKY: Record<string, unknown> = {
  "sky-color": "#070a0d",
  "sky-horizon-blend": 0.5,
  "horizon-color": "#0a0e12",
  "fog-color": "#070a0d",
  "fog-ground-blend": 0.5,
  "atmosphere-blend": ["interpolate", ["linear"], ["zoom"], 0, 0.8, 5, 0],
};

export type MapStyle = {
  id: string;
  name: string;
  style: MapStyleSpec;
  preview: string;
  /**
   * A still of the style over the Bay Area at zoom 9, rendered from the
   * style itself and served locally. CARTO's raster tiles, which the
   * previews used to load, now return an "API key required" placeholder.
   */
  previewUrl: string;
  dark: boolean;
  terrainProfile?: TerrainProfile;
};

const SATELLITE_STYLE: Record<string, unknown> = {
  version: 8,
  sources: {
    "esri-satellite": {
      type: "raster",
      tiles: [
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      ],
      tileSize: 256,
      maxzoom: 18,
      attribution:
        "&copy; <a href='https://www.esri.com/'>Esri</a>, Maxar, Earthstar Geographics",
    },
  },
  layers: [{ id: "satellite", type: "raster", source: "esri-satellite" }],
};

const ESRI_TOPO_STYLE: Record<string, unknown> = {
  version: 8,
  sources: {
    "esri-topo": {
      type: "raster",
      tiles: [
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}",
      ],
      tileSize: 256,
      maxzoom: 19,
      attribution:
        "&copy; <a href='https://www.esri.com/'>Esri</a> · &copy; <a href='https://www.openstreetmap.org/copyright'>OpenStreetMap</a> contributors",
    },
  },
  layers: [{ id: "esri-topo", type: "raster", source: "esri-topo" }],
};

export const MAP_STYLES: MapStyle[] = [
  {
    id: "dark",
    name: "Dark",
    style:
      "https://basemaps.cartocdn.com/gl/dark-matter-nolabels-gl-style/style.json",
    preview: "linear-gradient(135deg, #191a1a 0%, #2d2d2d 50%, #191a1a 100%)",
    previewUrl: "/map-previews/dark.webp",
    dark: true,
  },
  {
    id: "dark-terrain",
    name: "Dark Terrain",
    style:
      "https://basemaps.cartocdn.com/gl/dark-matter-nolabels-gl-style/style.json",
    preview: "linear-gradient(135deg, #111416 0%, #1d2427 50%, #101315 100%)",
    previewUrl: "/map-previews/dark-terrain.webp",
    dark: true,
    terrainProfile: "dark",
  },
  {
    id: "dark-labels",
    name: "Annotated",
    style: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
    preview: "linear-gradient(135deg, #1a1c1e 0%, #33363a 50%, #1a1c1e 100%)",
    previewUrl: "/map-previews/dark-labels.webp",
    dark: true,
  },
  {
    id: "voyager",
    name: "Voyager",
    style:
      "https://basemaps.cartocdn.com/gl/voyager-nolabels-gl-style/style.json",
    preview: "linear-gradient(135deg, #f2efe9 0%, #d4cfc4 50%, #f2efe9 100%)",
    previewUrl: "/map-previews/voyager.webp",
    dark: false,
  },
  {
    id: "voyager-labels",
    name: "Light Annotated",
    style: "https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json",
    preview: "linear-gradient(135deg, #e8e4dc 0%, #ccc7bc 50%, #e8e4dc 100%)",
    previewUrl: "/map-previews/voyager-labels.webp",
    dark: false,
  },
  {
    id: "satellite",
    name: "Satellite",
    style: SATELLITE_STYLE,
    preview: "linear-gradient(135deg, #0a1628 0%, #1a3050 50%, #0a1628 100%)",
    previewUrl: "/map-previews/satellite.webp",
    dark: true,
  },
  {
    id: "topo",
    name: "Topo",
    style: ESRI_TOPO_STYLE,
    preview: "linear-gradient(135deg, #d4cbb3 0%, #c4b89c 50%, #e0d8c4 100%)",
    previewUrl: "/map-previews/topo.webp",
    dark: false,
  },
];

export const DEFAULT_STYLE = MAP_STYLES[0];

export type AttributionEntry = {
  label: string;
  /** Where the credit links to; a credit without one is plain text. */
  url?: string;
};

// Only what each source's licence or terms require, as of November 2026.
// MapLibre is BSD licensed, which asks for nothing on the map itself.

/** OSM (ODbL) and CARTO's basemap terms ask for exactly this wording. */
const OSM: AttributionEntry = {
  label: "© OpenStreetMap contributors",
  url: "https://www.openstreetmap.org/copyright",
};
const CARTO: AttributionEntry = {
  label: "© CARTO",
  url: "https://carto.com/attributions",
};
/** Several of the terrain tiles' sources require credit; the link lists them. */
const TERRAIN: AttributionEntry = {
  label: "Terrain sources",
  url: "https://github.com/tilezen/joerd/blob/master/docs/attribution.md",
};
/**
 * The Esri maps are credited "Powered by Esri" and OpenStreetMap, by the
 * project's choice (November 2026), without the services' own source
 * lists, which Esri's attribution rules ask for.
 */
const POWERED_BY_ESRI: AttributionEntry = {
  label: "Powered by Esri",
  url: "https://www.esri.com/",
};

/**
 * The live map's flight data, by provider id (see flight-api-client.ts).
 * adsb.fi asks to be cited with a link, adsb.lol's data is ODbL, and
 * airplanes.live and OpenSky ask to be named where their data is shown.
 */
const FLIGHT_DATA: Record<string, AttributionEntry> = {
  adsbfi: { label: "adsb.fi", url: "https://adsb.fi/" },
  adsb: {
    label: "adsb.lol (ODbL)",
    url: "https://www.adsb.lol/docs/open-data/api/",
  },
  airplanes: { label: "airplanes.live", url: "https://airplanes.live/" },
  opensky: {
    label: "The OpenSky Network",
    url: "https://opensky-network.org/",
  },
};

/**
 * The credits the map must show for what is on it: the basemap, the
 * provider the aircraft currently come from, and any overlay that is on.
 */
export function getAttributions(
  styleId: string,
  options?: {
    showAirspace?: boolean;
    showWeatherRadar?: boolean;
    /** The live map's current provider id, if any. */
    flightSource?: string | null;
  },
): AttributionEntry[] {
  const credits: AttributionEntry[] = [];

  switch (styleId) {
    case "dark":
    case "dark-labels":
    case "voyager":
    case "voyager-labels":
      credits.push(OSM, CARTO);
      break;
    case "dark-terrain":
      credits.push(OSM, CARTO, TERRAIN);
      break;
    case "satellite":
    case "topo":
      credits.push(POWERED_BY_ESRI, OSM);
      break;
    default:
      credits.push(OSM);
  }

  const flightData = options?.flightSource
    ? FLIGHT_DATA[options.flightSource]
    : undefined;
  if (flightData) credits.push(flightData);

  if (options?.showWeatherRadar) {
    credits.push({ label: "RainViewer", url: "https://www.rainviewer.com/" });
  }
  if (options?.showAirspace) {
    credits.push({ label: "OpenAIP", url: "https://www.openaip.net" });
  }

  return credits;
}
