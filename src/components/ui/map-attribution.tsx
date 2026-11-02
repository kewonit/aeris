"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { SNAP } from "@/lib/motion";
import { Info } from "lucide-react";
import { getAttributions, type AttributionEntry } from "@/lib/map-styles";

type MapAttributionProps = {
  styleId: string;
  showAirspace?: boolean;
};

/** The flight data, credited after the map's own sources. */
const FEED_CREDITS: AttributionEntry[] = [
  { label: "OpenSky Network", url: "https://opensky-network.org/" },
  { label: "adsb.fi", url: "https://adsb.fi/" },
];

/**
 * The map's credits, closed to an (i) the size of the controls beside it.
 * Open, they slide out to its left, so the (i) never moves, and a click
 * anywhere else closes them.
 */
export function MapAttribution({ styleId, showAirspace }: MapAttributionProps) {
  const [expanded, setExpanded] = useState(false);
  const credits = [...getAttributions(styleId, { showAirspace }), ...FEED_CREDITS];
  const containerRef = useRef<HTMLDivElement>(null);

  const toggle = useCallback(() => setExpanded((prev) => !prev), []);

  useEffect(() => {
    if (!expanded) return;
    function handlePointerDown(e: PointerEvent) {
      if (containerRef.current?.contains(e.target as Node)) return;
      setExpanded(false);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [expanded]);

  return (
    <div
      ref={containerRef}
      className="aeris-float flex h-11 items-center rounded-full"
    >
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            key="credits"
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: "auto", opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={SNAP}
            className="overflow-hidden"
          >
            {/* Its own width, so the credits do not reflow as they open. */}
            <p className="flex w-max max-w-[calc(100vw-13rem)] flex-wrap items-center gap-x-1.5 pl-4 text-micro text-subtle">
              <span aria-hidden="true">©</span>
              {credits.map((credit, i) => (
                <span key={credit.label} className="inline-flex items-center">
                  <a
                    href={credit.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="transition-colors hover:text-foreground"
                  >
                    {credit.label}
                  </a>
                  {i < credits.length - 1 && ","}
                </span>
              ))}
            </p>
          </motion.div>
        )}
      </AnimatePresence>
      <button
        type="button"
        onClick={toggle}
        className="grid size-11 shrink-0 place-items-center rounded-full text-subtle transition-colors hover:text-foreground"
        aria-label={expanded ? "Hide map credits" : "Show map credits"}
        aria-expanded={expanded}
        title="Map credits"
      >
        <Info className="size-4" aria-hidden="true" />
      </button>
    </div>
  );
}
