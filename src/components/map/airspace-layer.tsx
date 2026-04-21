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
  type CancellationToken,
} from "@/lib/airspace-style";
import { AirspacePopup } from "./airspace-popup";
import type { AirspaceLimit } from "@/lib/airspace-format";

// ── OpenAIP Airspace MVT Overlay ───────────────────────────────────
//
// Renders OpenAIP airspace polygons and labels as separate MapLibre
// style layers from a single vector tile source proxied through
// /api/airspace-tiles.
//
// Lifecycle:
//   • On mount or when `visible` flips true: load sprites once, then
//     add source + layers via an atomic remove-and-add inside a
//     single effect tick. If MapLibre's style is transiently busy,
//     the swap is deferred to the next `idle` or `style.load` event
//     (whichever fires first).
//   • On `visible=false`: source and layers are removed eagerly to
//     free GPU memory.
//   • On `boundsKey` change (city / FPV cell): atomic remove + re-add
//     with the new `bounds` (MapLibre vector sources don't allow
//     mutating bounds in place).
//   • The lifecycle effect cleanup deliberately does NOT remove the
//     source — see the architectural note on the effect below.
//   • Final teardown happens in a dedicated unmount-only effect.
//
// Async sprite loading is guarded by a `CancellationToken` so a
// stale add-promise from a previous effect run can't race a newer
// one and produce duplicate / orphan sources.
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
  // Opacity is read by the lifecycle effect (via `opacityRef.current`)
  // and passed to `addAirspace(nextOpacity, …)` at add-time. The ref
  // pattern lets the slider update without forcing the lifecycle
  // effect to re-run — a separate opacity-only effect handles the
  // in-place paint update.
  const opacityRef = useRef(opacity);
  useEffect(() => {
    opacityRef.current = opacity;
  }, [opacity]);

  // Bounds are read directly inside `addAirspace` via
  // `boundsRef.current` (so the source always carries the latest box
  // at add-time), while `boundsKey` is in the lifecycle effect's dep
  // list so the effect only re-runs when the box actually changes.
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
  // The optional `cancelled` ref lets the caller invalidate this
  // particular invocation: if a newer effect run starts after the
  // sprite-load await, this stale promise will bail instead of
  // racing to add a duplicate / orphan source.
  const addAirspace = useCallback(
    async (nextOpacity: number, cancelled?: CancellationToken) => {
      if (!map || !mountedRef.current) return;
      if (cancelled?.current) return;
      if (map.getSource(AIRSPACE_SOURCE_ID)) return;

      await ensureSprites();
      if (!mountedRef.current || !map) return;
      if (cancelled?.current) return;
      // Re-check after the await — another invocation may have added it.
      if (map.getSource(AIRSPACE_SOURCE_ID)) return;

      // Absolute URL required: MapLibre resolves tile URLs inside a
      // Web Worker where relative paths can't be parsed into Requests.
      const tileBase =
        typeof window !== "undefined" ? window.location.origin : "";

      // `bounds` is read here (not from the effect closure) so the
      // source always carries the latest box at add-time.
      const currentBounds = boundsRef.current;

      try {
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
      } catch {
        // Style swap or duplicate add — bail; the next effect run
        // will reconcile.
        return;
      }

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
        if (map.getLayer(layer.id)) continue;
        try {
          map.addLayer(layer, beforeId);
        } catch {
          /* layer raced with removal — skip */
        }
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
  // Architectural note: cleanup deliberately does NOT call
  // removeAirspace(). Tearing down on every dep change (boundsKey
  // shifts, visibility toggles, callback identity changes) created a
  // gap window where the layer was gone; if `addAirspace` then raced
  // with the cleanup, sprites finished loading after unmount, or
  // `idle` fired late, the layer would silently stay missing — the
  // "fragile / randomly disappear" symptom.
  //
  // Instead the effect body atomically swaps in place: remove (if
  // present) → add. The dedicated unmount effect below handles the
  // final teardown.
  //
  // Opacity is intentionally *not* in the dep list: a separate
  // opacity-only effect handles slider updates without rebuilds.
  useEffect(() => {
    if (!map || !isLoaded) return;

    const cancelled = { current: false };
    let pendingIdle: (() => void) | null = null;
    let pendingStyleLoad: (() => void) | null = null;

    const performSwap = () => {
      if (cancelled.current || !mountedRef.current) return;
      // Atomic: remove (if present) then add. Both inside the same
      // synchronous tick — MapLibre never sees the in-between gap on
      // a render frame.
      removeAirspace();
      void addAirspace(opacityRef.current, cancelled);
    };

    const trySwap = () => {
      if (cancelled.current) return;
      if (map.isStyleLoaded()) {
        performSwap();
      } else {
        // Style transiently not ready (common during a city tap's
        // camera fly + tile fetch). Wait for the next idle, OR for
        // the next style.load — whichever fires first.
        pendingIdle = () => {
          pendingIdle = null;
          if (pendingStyleLoad) {
            map.off("style.load", pendingStyleLoad);
            pendingStyleLoad = null;
          }
          performSwap();
        };
        pendingStyleLoad = () => {
          pendingStyleLoad = null;
          if (pendingIdle) {
            map.off("idle", pendingIdle);
            pendingIdle = null;
          }
          // Style swap wipes images — force sprite reload.
          spritesLoadedRef.current = false;
          performSwap();
        };
        map.once("idle", pendingIdle);
        map.once("style.load", pendingStyleLoad);
      }
    };

    // Style reloads (basemap swap) wipe MapLibre's image registry
    // and all sources/layers. We must re-register sprites and
    // re-add. Note: this is a long-lived listener, separate from
    // the one-shot one inside trySwap.
    const onStyleLoad = () => {
      if (cancelled.current) return;
      spritesLoadedRef.current = false;
      if (visible) {
        // Re-add after style settles. Using a microtask delay so
        // MapLibre has finished its internal style-load bookkeeping.
        Promise.resolve().then(() => {
          if (!cancelled.current && visible) trySwap();
        });
      }
    };
    map.on("style.load", onStyleLoad);

    if (visible) {
      trySwap();
    } else {
      // Hidden: remove eagerly so we free GPU memory.
      removeAirspace();
      popupRef.current?.remove();
      popupRef.current = null;
    }

    return () => {
      cancelled.current = true;
      if (pendingIdle) map.off("idle", pendingIdle);
      if (pendingStyleLoad) map.off("style.load", pendingStyleLoad);
      map.off("style.load", onStyleLoad);
      // NOTE: do NOT call removeAirspace here — see comment above.
    };
  }, [map, isLoaded, visible, boundsKey, addAirspace, removeAirspace]);

  // ── Unmount-only teardown ────────────────────────────────────────
  // Separate effect so the source/layers persist across re-renders
  // and only tear down when the component truly unmounts (or the
  // map instance changes).
  useEffect(() => {
    return () => {
      removeAirspace();
      popupRef.current?.remove();
      popupRef.current = null;
      // Defer React unmount to a microtask so we don't unmount inside
      // a render commit phase (React warns on synchronous unmount of
      // a root mid-commit). Capture the current root in case popupRoot
      // is replaced before the microtask fires.
      const root = popupRootRef.current;
      popupRootRef.current = null;
      if (root) {
        Promise.resolve().then(() => {
          try {
            root.unmount();
          } catch {
            /* already unmounted */
          }
        });
      }
    };
  }, [removeAirspace]);

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
