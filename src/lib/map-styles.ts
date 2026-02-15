export type MapStyleSpec = string | Record<string, unknown>;

export type MapStyle = {
  id: string;
  name: string;
  style: MapStyleSpec;
  preview: string;
  previewUrl: string;
  dark: boolean;
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
      attribution: "&copy; Esri",
    },
  },
  layers: [{ id: "satellite", type: "raster", source: "esri-satellite" }],
};

const TERRAIN_STYLE: Record<string, unknown> = {
  version: 8,
  sources: {
    opentopomap: {
      type: "raster",
      tiles: ["https://tile.opentopomap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      maxzoom: 17,
      attribution: "&copy; OpenTopoMap",
    },
  },
  layers: [{ id: "terrain", type: "raster", source: "opentopomap" }],
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
      attribution: "&copy; Esri",
    },
  },
  layers: [{ id: "esri-topo", type: "raster", source: "esri-topo" }],
};

const SHADED_RELIEF_STYLE: Record<string, unknown> = {
  version: 8,
  sources: {
    "esri-satellite": {
      type: "raster",
      tiles: [
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      ],
      tileSize: 256,
      maxzoom: 18,
      attribution: "&copy; Esri",
    },
    "terrain-dem": {
      type: "raster-dem",
      tiles: [
        "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png",
      ],
      tileSize: 256,
      maxzoom: 15,
      encoding: "terrarium",
    },
  },
  terrain: {
    source: "terrain-dem",
    exaggeration: 1.5,
  },
  sky: {
    "sky-color": "#76a8d6",
    "horizon-color": "#d4e4f0",
    "fog-color": "#c8d8e8",
    "sky-horizon-blend": 0.5,
    "horizon-fog-blend": 0.1,
  },
  layers: [{ id: "satellite-base", type: "raster", source: "esri-satellite" }],
};

export const MAP_STYLES: MapStyle[] = [
  {
    id: "dark",
    name: "Dark",
    style:
      "https://basemaps.cartocdn.com/gl/dark-matter-nolabels-gl-style/style.json",
    preview: "linear-gradient(135deg, #191a1a 0%, #2d2d2d 50%, #191a1a 100%)",
    previewUrl: "https://a.basemaps.cartocdn.com/dark_nolabels/3/4/2@2x.png",
    dark: true,
  },
  {
    id: "dark-labels",
    name: "Annotated",
    style: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
    preview: "linear-gradient(135deg, #1a1c1e 0%, #33363a 50%, #1a1c1e 100%)",
    previewUrl: "https://a.basemaps.cartocdn.com/dark_all/3/4/2@2x.png",
    dark: true,
  },
  {
    id: "voyager",
    name: "Voyager",
    style:
      "https://basemaps.cartocdn.com/gl/voyager-nolabels-gl-style/style.json",
    preview: "linear-gradient(135deg, #f2efe9 0%, #d4cfc4 50%, #f2efe9 100%)",
    previewUrl:
      "https://a.basemaps.cartocdn.com/rastertiles/voyager_nolabels/3/4/2@2x.png",
    dark: false,
  },
  {
    id: "satellite",
    name: "Satellite",
    style: SATELLITE_STYLE,
    preview: "linear-gradient(135deg, #0a1628 0%, #1a3050 50%, #0a1628 100%)",
    previewUrl:
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/3/2/4",
    dark: true,
  },
  {
    id: "terrain",
    name: "Terrain",
    style: TERRAIN_STYLE,
    preview: "linear-gradient(135deg, #c8d8c0 0%, #a8c098 50%, #d0d8c0 100%)",
    previewUrl: "https://tile.opentopomap.org/3/4/2.png",
    dark: false,
  },
  {
    id: "topo",
    name: "Topo",
    style: ESRI_TOPO_STYLE,
    preview: "linear-gradient(135deg, #d4cbb3 0%, #c4b89c 50%, #e0d8c4 100%)",
    previewUrl:
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/3/2/4",
    dark: false,
  },
  {
    id: "relief",
    name: "3D Terrain",
    style: SHADED_RELIEF_STYLE,
    preview: "linear-gradient(135deg, #1a3050 0%, #2a5040 50%, #1a3050 100%)",
    previewUrl:
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/3/2/4",
    dark: true,
  },
  {
    id: "positron",
    name: "Light",
    style:
      "https://basemaps.cartocdn.com/gl/positron-nolabels-gl-style/style.json",
    preview: "linear-gradient(135deg, #e8e8e8 0%, #fafafa 50%, #e8e8e8 100%)",
    previewUrl: "https://a.basemaps.cartocdn.com/light_nolabels/3/4/2@2x.png",
    dark: false,
  },
];

export const DEFAULT_STYLE = MAP_STYLES[1];
