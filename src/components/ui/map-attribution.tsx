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

const SM_BREAKPOINT = 640;

/** The flight data, credited after the map's own sources. */
const FEED_CREDITS: AttributionEntry[] = [
  { label: "OpenSky Network", url: "https://opensky-network.org/" },
  { label: "adsb.fi", url: "https://adsb.fi/" },
];

export function MapAttribution({ styleId, showAirspace }: MapAttributionProps) {
  const [expanded, setExpanded] = useState(false);
  const attributions = getAttributions(styleId, { showAirspace });
  const containerRef = useRef<HTMLDivElement>(null);

  const toggle = useCallback(() => setExpanded((prev) => !prev), []);

  // Expand by default on larger screens (after mount to avoid hydration mismatch)
  useEffect(() => {
    const mq = window.matchMedia(`(min-width: ${SM_BREAKPOINT}px)`);
    const sync = () => setExpanded(mq.matches);
    const raf = window.requestAnimationFrame(sync);

    mq.addEventListener("change", sync);
    return () => {
      window.cancelAnimationFrame(raf);
      mq.removeEventListener("change", sync);
    };
  }, []);

  // Close on outside click for small screens
  useEffect(() => {
    if (!expanded) return;
    function handlePointerDown(e: PointerEvent) {
      if (
        window.innerWidth >= SM_BREAKPOINT ||
        !containerRef.current ||
        containerRef.current.contains(e.target as Node)
      )
        return;
      setExpanded(false);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [expanded]);

  return (
    <div ref={containerRef} className="flex items-center justify-end">
      <AnimatePresence mode="wait">
        {expanded ? (
          <ExpandedAttribution
            key="expanded"
            attributions={attributions}
            onCollapse={toggle}
          />
        ) : (
          <CollapsedAttribution key="collapsed" onExpand={toggle} />
        )}
      </AnimatePresence>
    </div>
  );
}

function CollapsedAttribution({ onExpand }: { onExpand: () => void }) {
  return (
    <motion.button
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      transition={{ duration: 0.15 }}
      onClick={onExpand}
      className="grid size-11 place-items-center text-subtle transition-colors hover:text-foreground"
      aria-label="Show map credits"
      title="Map credits"
    >
      <span className="aeris-float grid size-7 place-items-center rounded-full">
        <Info className="size-3.5" aria-hidden="true" />
      </span>
    </motion.button>
  );
}

function ExpandedAttribution({
  attributions,
  onCollapse,
}: {
  attributions: AttributionEntry[];
  onCollapse: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95, y: 4 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95, y: 4 }}
      transition={SNAP}
      className="aeris-float flex min-h-7 max-w-[calc(100vw-9rem)] items-center gap-1.5 rounded-full py-1 pr-3 pl-2"
    >
      <button
        onClick={onCollapse}
        className="grid size-5 shrink-0 place-items-center text-subtle transition-colors hover:text-foreground"
        aria-label="Hide map credits"
      >
        <Info className="size-3" aria-hidden="true" />
      </button>
      <span className="flex flex-wrap items-center gap-x-1.5 text-micro text-subtle">
        <span aria-hidden="true">©</span>
        {[...attributions, ...FEED_CREDITS].map((attr, i) => (
          <span key={attr.label} className="inline-flex items-center gap-x-1.5">
            {i > 0 && <span aria-hidden="true">·</span>}
            <a
              href={attr.url}
              target="_blank"
              rel="noopener noreferrer"
              className="transition-colors hover:text-foreground"
            >
              {attr.label}
            </a>
          </span>
        ))}
      </span>
    </motion.div>
  );
}
