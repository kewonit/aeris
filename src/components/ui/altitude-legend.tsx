"use client";

import { useMemo } from "react";
import { motion } from "motion/react";
import { useSettings } from "@/hooks/use-settings";
import { legendTicksMeters } from "@/lib/altitude-legend-ticks";
import { altitudeRamp, altitudeRampPosition } from "@/lib/flight-utils";
import { formatAltitude } from "@/lib/unit-formatters";

/** Colour samples between two labels, so the bar curves like the ramp. */
const STOPS_BETWEEN_TICKS = 4;
/** The bar's height (h-32) and one label's line (text-micro: 10px at 1.4). */
const BAR_PX = 128;
const LABEL_LINE_PX = 14;

/**
 * The bar, drawn from the colours the map uses, with the colour beside each
 * label the one the map gives that height. The labels are spread evenly, so
 * the middle of the first and last sits half a line in from the bar's ends.
 */
function legendGradient(dark: boolean, ticks: number[]): string {
  const colors = altitudeRamp(dark ? "dark" : "light");
  const rising = [...ticks].reverse();
  const segments = rising.length - 1;
  const fromBottom = (step: number) =>
    (LABEL_LINE_PX / 2 + (step / segments) * (BAR_PX - LABEL_LINE_PX)) /
    BAR_PX;
  const stops: string[] = [];
  for (let s = 0; s < segments; s++) {
    const from = altitudeRampPosition(rising[s]);
    const to = altitudeRampPosition(rising[s + 1]);
    for (let j = s === 0 ? 0 : 1; j <= STOPS_BETWEEN_TICKS; j++) {
      const f = j / STOPS_BETWEEN_TICKS;
      const [r, g, b] =
        colors[Math.round((from + (to - from) * f) * (colors.length - 1))];
      stops.push(`rgb(${r},${g},${b}) ${(fromBottom(s + f) * 100).toFixed(2)}%`);
    }
  }
  return `linear-gradient(to top, ${stops.join(", ")})`;
}

export function AltitudeLegend({ dark }: { dark: boolean }) {
  const { settings } = useSettings();
  const unitSystem = settings.unitSystem;
  // Round heights in the unit shown, with each colour the map's for it.
  const ticks = useMemo(() => legendTicksMeters(unitSystem), [unitSystem]);
  const gradient = useMemo(() => legendGradient(dark, ticks), [dark, ticks]);

  return (
    <motion.div
      initial={{ opacity: 0, x: 12 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ type: "spring", stiffness: 300, damping: 24, delay: 0.6 }}
      className="flex flex-col gap-2 rounded-lg border p-3 border-border bg-background"
      role="img"
      aria-label={`Altitude color scale from ${formatAltitude(ticks[ticks.length - 1], unitSystem)} (green) to ${formatAltitude(ticks[0], unitSystem)} (blue)`}
    >
      <p className="aeris-eyebrow text-subtle">Altitude</p>
      <div className="flex items-center gap-2">
        <div
          className="h-32 w-1.5 rounded-full"
          style={{ background: gradient }}
        />
        <div className="flex h-32 flex-col justify-between">
          {ticks.map((tick) => (
            <span
              key={tick}
              className="text-micro font-medium text-muted-foreground"
            >
              {formatAltitude(tick, unitSystem)}
            </span>
          ))}
        </div>
      </div>
    </motion.div>
  );
}
