"use client";

import { useEffect, useRef, useCallback } from "react";
import maplibregl from "maplibre-gl";
import { createRoot, type Root } from "react-dom/client";
import { useMap } from "./map";
import {
  AIRSPACE_SOURCE_ID,
  AIRSPACE_LAYERS,
  AIRSPACE_INTERACTIVE_LAYER_IDS,
  airspaceBoundsKey,
  type AirspaceBounds,
} from "@/lib/airspace-style";
import { AirspacePopup } from "./airspace-popup";
import type { AirspaceLimit } from "@/lib/airspace-format";

// ── OpenAIP Airspace MVT Overlay ───────────────────────────────────
//
// Renders OpenAIP airspace polygons and labels as separate MapLibre
// style layers from a single vector tile source proxied through
// /api/airspace-tiles.
//
// Source/layer add-remove lifecycle matches the old raster layer:
// when hidden, the source and all layers are removed entirely to
// free GPU memory. When shown, sprites are loaded (once), then the
// source and layers are re-added.
//
// Click-to-inspect: clicking an airspace fill opens a popup with
// class/name/altitude bounds. Cursor turns pointer on hover.
//
// Data: openaip.net (CC BY-NC 4.0)
// ────────────────────────────────────────────────────────────────────

const AIRSPACE_MIN_ZOOM = 4;
const AIRSPACE_MAX_ZOOM = 14;

const SPRITES: Array<{ id: string; url: string }> = [
  { id: "airspace-diagonal-red", url: "/airspace-patterns/diagonal-red.png" },
  {
    id: "airspace-diagonal-purple",
    url: "/airspace-patterns/diagonal-purple.png",
  },
];

type AirspaceLayerProps = {
  visible: boolean;
  opacity: number;
  /**
   * Optional bounding box `[west, south, east, north]` that restricts
   * tile fetches to the active city's vicinity. `null` disables the
   * restriction (tiles are fetched for the whole viewport).
   */
  bounds?: AirspaceBounds | null;
};

type FeatureProps = {
  icao_class?: string;
  type?: string;
  name?: string;
  lower_limit_value?: number;
  lower_limit_unit?: string;
  lower_limit_reference_datum?: string;
  upper_limit_value?: number;
  upper_limit_unit?: string;
  upper_limit_reference_datum?: string;
};

function toLimit(
  value: number | undefined,
  unit: string | undefined,
  datum: string | undefined,
): AirspaceLimit | null {
  if (value === undefined || unit === undefined || datum === undefined) {
    return null;
  }
  return { value, unit, referenceDatum: datum };
}

export function AirspaceLayer({
  visible,
  opacity,
  bounds = null,
}: AirspaceLayerProps) {
  const { map, isLoaded } = useMap();

  const mountedRef = useRef(true);
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const popupRootRef = useRef<Root | null>(null);
  const popupContainerRef = useRef<HTMLDivElement | null>(null);
  const spritesLoadedRef = useRef(false);
  // Keep opacity in a ref so addAirspace can read the current value at
  // add-time without triggering a full remount when the slider moves.
  const opacityRef = useRef(opacity);
  useEffect(() => {
    opacityRef.current = opacity;
  }, [opacity]);

  // Bounds go through a ref too so `addAirspace` can read the latest
  // value, and a key string so the add/remove effect below only
  // re-runs when the box actually changes.
  const boundsRef = useRef<AirspaceBounds | null>(bounds);
  useEffect(() => {
    boundsRef.current = bounds;
  }, [bounds]);
  const boundsKey = airspaceBoundsKey(bounds);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // ── Sprite loading (once per style) ───────────────────────────────
  const ensureSprites = useCallback(async () => {
    if (!map || spritesLoadedRef.current) return;
    await Promise.all(
      SPRITES.map(async ({ id, url }) => {
        if (map.hasImage(id)) return;
        try {
          const img = await map.loadImage(url);
          if (!mountedRef.current) return;
          if (!map.hasImage(id) && img.data) {
            try {
              map.addImage(id, img.data);
            } catch {
              // Another caller may have registered the same id between
              // our hasImage() check and addImage() — benign race.
            }
          }
        } catch {
          // Sprite missing → hatched fills degrade to flat color via
          // MapLibre's default behavior (fill-pattern reference just
          // draws nothing). We log once at the warn level.
          if (typeof console !== "undefined") {
            console.warn(`[airspace] failed to load sprite ${url}`);
          }
        }
      }),
    );
    spritesLoadedRef.current = true;
  }, [map]);

  // ── Opacity helpers ───────────────────────────────────────────────
  const applyOpacity = useCallback(
    (nextOpacity: number) => {
      if (!map) return;
      for (const layer of AIRSPACE_LAYERS) {
        if (!map.getLayer(layer.id)) continue;
        try {
          if (layer.type === "fill") {
            const base = (layer.paint as Record<string, unknown>)[
              "fill-opacity"
            ];
            map.setPaintProperty(
              layer.id,
              "fill-opacity",
              scaleOpacity(base, nextOpacity),
            );
          } else if (layer.type === "line") {
            const base = (layer.paint as Record<string, unknown>)[
              "line-opacity"
            ];
            map.setPaintProperty(
              layer.id,
              "line-opacity",
              scaleOpacity(base, nextOpacity),
            );
          }
          // symbol layer (labels) ignores opacity multiplier — always full
        } catch {
          /* layer may be in the process of being removed */
        }
      }
    },
    [map],
  );

  // ── Remove layers + source ───────────────────────────────────────
  const removeAirspace = useCallback(() => {
    if (!map) return;
    try {
      for (const layer of AIRSPACE_LAYERS) {
        if (map.getLayer(layer.id)) map.removeLayer(layer.id);
      }
      if (map.getSource(AIRSPACE_SOURCE_ID)) {
        map.removeSource(AIRSPACE_SOURCE_ID);
      }
    } catch {
      /* map may already be destroyed */
    }
  }, [map]);

  // ── Add source + layers ──────────────────────────────────────────
  const addAirspace = useCallback(
    async (nextOpacity: number) => {
      if (!map || !mountedRef.current) return;
      if (map.getSource(AIRSPACE_SOURCE_ID)) return;

      await ensureSprites();
      if (!mountedRef.current || !map) return;

      // Absolute URL required: MapLibre resolves tile URLs inside a
      // Web Worker where relative paths can't be parsed into Requests.
      const tileBase =
        typeof window !== "undefined" ? window.location.origin : "";

      // `bounds` is read here (not from the effect closure) so the
      // source always carries the latest box at add-time.
      const currentBounds = boundsRef.current;

      map.addSource(AIRSPACE_SOURCE_ID, {
        type: "vector",
        tiles: [`${tileBase}/api/airspace-tiles?z={z}&x={x}&y={y}`],
        minzoom: AIRSPACE_MIN_ZOOM,
        maxzoom: AIRSPACE_MAX_ZOOM,
        // MapLibre skips any tile whose mercator footprint doesn't
        // intersect this box. Passing a mutable copy because the
        // spec types want a plain number[].
        ...(currentBounds
          ? { bounds: [...currentBounds] as [number, number, number, number] }
          : {}),
        attribution:
          '&copy; <a href="https://www.openaip.net" target="_blank">OpenAIP</a>',
      });

      // Insert below first symbol layer so base-map labels stay on top.
      const layers = map.getStyle()?.layers ?? [];
      let beforeId: string | undefined;
      for (const layer of layers) {
        if (layer.type === "symbol") {
          beforeId = layer.id;
          break;
        }
      }

      for (const layer of AIRSPACE_LAYERS) {
        map.addLayer(layer, beforeId);
      }
      applyOpacity(nextOpacity);
    },
    [map, ensureSprites, applyOpacity],
  );

  // ── Click popup ──────────────────────────────────────────────────
  const openPopup = useCallback(
    (lngLat: maplibregl.LngLat, props: FeatureProps) => {
      if (!map) return;
      // Close any existing popup
      popupRef.current?.remove();
      popupRootRef.current?.unmount();

      const container = document.createElement("div");
      popupContainerRef.current = container;
      const root = createRoot(container);
      popupRootRef.current = root;
      root.render(
        <AirspacePopup
          icao_class={props.icao_class ?? "unclassified"}
          type={props.type ?? ""}
          name={props.name ?? ""}
          lower={toLimit(
            props.lower_limit_value,
            props.lower_limit_unit,
            props.lower_limit_reference_datum,
          )}
          upper={toLimit(
            props.upper_limit_value,
            props.upper_limit_unit,
            props.upper_limit_reference_datum,
          )}
        />,
      );

      const popup = new maplibregl.Popup({
        closeButton: true,
        closeOnClick: true,
        maxWidth: "none",
        className: "airspace-popup",
      })
        .setLngLat(lngLat)
        .setDOMContent(container)
        .addTo(map);
      popup.on("close", () => {
        popupRootRef.current?.unmount();
        popupRootRef.current = null;
        popupContainerRef.current = null;
      });
      popupRef.current = popup;
    },
    [map],
  );

  // ── Add/remove based on visibility + bounds ──────────────────────
  // Opacity is intentionally *not* in the dep list: the opacity-only
  // effect below handles slider updates without tearing down tiles.
  //
  // `boundsKey` IS in the dep list so switching city re-adds the source
  // with the new bounding box. Tiles inside the new box are served
  // from the browser HTTP cache (the tile proxy sets
  // `Cache-Control: public, max-age=86400, immutable`), so the
  // teardown/rebuild is effectively free on the network.
  useEffect(() => {
    if (!map || !isLoaded) return;

    const onStyleLoad = () => {
      // A style reload wipes MapLibre's image registry, so force the
      // sprite re-registration before any layer using fill-pattern is
      // added back.
      spritesLoadedRef.current = false;
      if (visible) void addAirspace(opacityRef.current);
    };
    map.on("style.load", onStyleLoad);

    if (visible && map.isStyleLoaded()) {
      // Ensure we always hit the add path with the latest bounds even
      // if a previous source is still attached.
      if (map.getSource(AIRSPACE_SOURCE_ID)) removeAirspace();
      void addAirspace(opacityRef.current);
    } else if (!visible) {
      removeAirspace();
      popupRef.current?.remove();
      popupRef.current = null;
    }

    return () => {
      map.off("style.load", onStyleLoad);
      removeAirspace();
      popupRef.current?.remove();
      popupRootRef.current?.unmount();
    };
  }, [map, isLoaded, visible, boundsKey, addAirspace, removeAirspace]);

  // ── Opacity updates ──────────────────────────────────────────────
  useEffect(() => {
    if (!map || !isLoaded || !visible) return;
    applyOpacity(opacity);
  }, [map, isLoaded, visible, opacity, applyOpacity]);

  // ── Click + hover handlers ───────────────────────────────────────
  useEffect(() => {
    if (!map || !isLoaded || !visible) return;

    const canvas = map.getCanvas();

    const onClick = (e: maplibregl.MapMouseEvent) => {
      const features = map.queryRenderedFeatures(e.point, {
        layers: AIRSPACE_INTERACTIVE_LAYER_IDS.filter((id) => map.getLayer(id)),
      });
      if (!features.length) return;
      const top = features[0];
      openPopup(e.lngLat, top.properties as FeatureProps);
    };

    const onEnter = () => {
      canvas.style.cursor = "pointer";
    };
    const onLeave = () => {
      canvas.style.cursor = "";
    };

    map.on("click", onClick);
    for (const id of AIRSPACE_INTERACTIVE_LAYER_IDS) {
      map.on("mouseenter", id, onEnter);
      map.on("mouseleave", id, onLeave);
    }

    return () => {
      map.off("click", onClick);
      for (const id of AIRSPACE_INTERACTIVE_LAYER_IDS) {
        map.off("mouseenter", id, onEnter);
        map.off("mouseleave", id, onLeave);
      }
      canvas.style.cursor = "";
    };
  }, [map, isLoaded, visible, openPopup]);

  return null;
}

// ── Helpers ────────────────────────────────────────────────────────

/**
 * Multiplies a base opacity (possibly an interpolate expression) by a
 * scalar multiplier for the user's opacity slider. MapLibre accepts
 * a `["*", base, multiplier]` expression — we wrap the original paint
 * value and return the result.
 */
function scaleOpacity(base: unknown, multiplier: number): unknown {
  if (typeof base === "number") return base * multiplier;
  if (base === undefined || base === null) return multiplier;

  // Expressions containing ["zoom"] (interpolate / step) must remain the
  // top-level expression — MapLibre rejects ["*", <interpolate>, m]. So
  // instead of wrapping, we push the multiplier down to the output stops.
  if (Array.isArray(base) && base.length > 0) {
    const op = base[0];

    if (
      op === "interpolate" ||
      op === "interpolate-hcl" ||
      op === "interpolate-lab"
    ) {
      // Shape: [op, interpolation, input, stop0_in, stop0_out, stop1_in, stop1_out, …]
      const result: unknown[] = [base[0], base[1], base[2]];
      for (let i = 3; i + 1 < base.length; i += 2) {
        result.push(base[i]);
        result.push(scaleOpacity(base[i + 1], multiplier));
      }
      return result;
    }

    if (op === "step") {
      // Shape: [op, input, output0, stop1_in, output1, stop2_in, output2, …]
      const result: unknown[] = [
        base[0],
        base[1],
        scaleOpacity(base[2], multiplier),
      ];
      for (let i = 3; i + 1 < base.length; i += 2) {
        result.push(base[i]);
        result.push(scaleOpacity(base[i + 1], multiplier));
      }
      return result;
    }

    if (op === "case") {
      // Shape: [op, cond0, out0, cond1, out1, …, fallback]
      const result: unknown[] = [base[0]];
      let i = 1;
      for (; i + 1 < base.length; i += 2) {
        result.push(base[i]);
        result.push(scaleOpacity(base[i + 1], multiplier));
      }
      if (i < base.length) {
        result.push(scaleOpacity(base[i], multiplier));
      }
      return result;
    }

    if (op === "match") {
      // Shape: [op, input, label0, out0, label1, out1, …, fallback]
      const result: unknown[] = [base[0], base[1]];
      let i = 2;
      for (; i + 1 < base.length; i += 2) {
        result.push(base[i]);
        result.push(scaleOpacity(base[i + 1], multiplier));
      }
      if (i < base.length) {
        result.push(scaleOpacity(base[i], multiplier));
      }
      return result;
    }

    if (op === "coalesce") {
      return [
        "coalesce",
        ...base.slice(1).map((v) => scaleOpacity(v, multiplier)),
      ];
    }

    // Unknown / leaf expression with no ["zoom"] reference — multiplying
    // via ["*", …] is safe. If it turns out to contain zoom we'd fail,
    // but the common MapLibre output expressions are handled above.
    if (multiplier === 1) return base;
    return ["*", base, multiplier];
  }

  if (multiplier === 1) return base;
  return multiplier;
}
