"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Info } from "lucide-react";
import { getAttributions, type AttributionEntry } from "@/lib/map-styles";

type MapAttributionProps = {
  styleId: string;
};

const SM_BREAKPOINT = 640;

function getInitialExpanded(): boolean {
  if (typeof window === "undefined") return true;
  return window.innerWidth >= SM_BREAKPOINT;
}

export function MapAttribution({ styleId }: MapAttributionProps) {
  const [expanded, setExpanded] = useState(getInitialExpanded);
  const attributions = getAttributions(styleId);
  const containerRef = useRef<HTMLDivElement>(null);

  const toggle = useCallback(() => setExpanded((prev) => !prev), []);

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
      className="flex h-5 w-5 items-center justify-center rounded-full backdrop-blur-xl transition-colors"
      style={{
        backgroundColor: "rgb(var(--ui-bg) / 0.35)",
        border: "1px solid rgb(var(--ui-fg) / 0.06)",
        color: "rgb(var(--ui-fg) / 0.3)",
      }}
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
      className="flex items-center gap-1.5 rounded-lg px-2 py-1 backdrop-blur-xl"
      style={{
        backgroundColor: "rgb(var(--ui-bg) / 0.45)",
        border: "1px solid rgb(var(--ui-fg) / 0.06)",
      }}
    >
      <button
        onClick={onCollapse}
        className="shrink-0 transition-colors"
        style={{ color: "rgb(var(--ui-fg) / 0.3)" }}
        aria-label="Collapse attribution"
      >
        <Info className="h-2.5 w-2.5" />
      </button>
      <span
        className="flex flex-wrap items-center gap-x-1 text-[9px] leading-tight tracking-wide"
        style={{ color: "rgb(var(--ui-fg) / 0.35)" }}
      >
        <span
          className="font-medium"
          style={{ color: "rgb(var(--ui-fg) / 0.25)" }}
        >
          ©
        </span>
        {attributions.map((attr, i) => (
          <span key={attr.label} className="inline-flex items-center">
            <a
              href={attr.url}
              target="_blank"
              rel="noopener noreferrer"
              className="transition-colors hover:underline"
              style={{ color: "rgb(var(--ui-fg) / 0.4)" }}
            >
              {attr.label}
            </a>
            {i < attributions.length - 1 && (
              <span
                className="ml-1"
                style={{ color: "rgb(var(--ui-fg) / 0.15)" }}
              >
                ·
              </span>
            )}
          </span>
        ))}
        <span className="ml-0.5" style={{ color: "rgb(var(--ui-fg) / 0.15)" }}>
          ·
        </span>
        <a
          href="https://opensky-network.org/"
          target="_blank"
          rel="noopener noreferrer"
          className="transition-colors hover:underline"
          style={{ color: "rgb(var(--ui-fg) / 0.4)" }}
        >
          OpenSky Network
        </a>
      </span>
    </motion.div>
  );
}
