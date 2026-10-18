"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Info } from "lucide-react";
import { getAttributions, type AttributionEntry } from "@/lib/map-styles";

type MapAttributionProps = {
  styleId: string;
  showAirspace?: boolean;
};

const SM_BREAKPOINT = 640;

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
    <div ref={containerRef} className="flex items-end justify-end">
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
      className="flex h-5 w-5 items-center justify-center rounded-full transition-colors bg-background border border-border text-subtle"
      aria-label="Show map attribution"
      title="Map data attribution"
    >
      <Info className="h-2.5 w-2.5" />
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
      transition={{ type: "spring", stiffness: 400, damping: 30 }}
      className="flex items-center gap-1.5 rounded-md px-2 py-1 bg-background border border-border"
    >
      <button
        onClick={onCollapse}
        className="shrink-0 transition-colors text-subtle"
        aria-label="Collapse attribution"
      >
        <Info className="h-2.5 w-2.5" />
      </button>
      <span
        className="flex flex-wrap items-center gap-x-1 text-micro leading-tight text-subtle"
      >
        <span
          className="font-medium text-subtle"
        >
          ©
        </span>
        {attributions.map((attr, i) => (
          <span key={attr.label} className="inline-flex items-center">
            <a
              href={attr.url}
              target="_blank"
              rel="noopener noreferrer"
              className="transition-colors hover:underline text-subtle"
            >
              {attr.label}
            </a>
            {i < attributions.length - 1 && (
              <span
                className="ml-1 text-subtle"
              >
                ·
              </span>
            )}
          </span>
        ))}
        <span
          className="ml-0.5 text-subtle"
        >
          ·
        </span>
        <a
          href="https://opensky-network.org/"
          target="_blank"
          rel="noopener noreferrer"
          className="transition-colors hover:underline text-subtle"
        >
          OpenSky Network
        </a>
        <span className="ml-0.5 text-subtle">
          ·
        </span>
        <a
          href="https://adsb.fi/"
          target="_blank"
          rel="noopener noreferrer"
          className="transition-colors hover:underline text-subtle"
        >
          adsb.fi
        </a>
      </span>
    </motion.div>
  );
}
