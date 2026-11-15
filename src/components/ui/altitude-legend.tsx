"use client";

import { useMemo } from "react";
import { motion } from "motion/react";
import { useSettings } from "@/hooks/use-settings";
import { altitudeRamp, altitudeRampPosition } from "@/lib/flight-utils";
import { formatAltitude } from "@/lib/unit-formatters";

const TICKS = [13000, 6096, 3048, 1524, 610, 152, 0];
/** Colour samples between two labels, so the bar curves like the ramp. */
const STOPS_BETWEEN_TICKS = 4;

/**
 * The bar, drawn from the colours the map uses. The labels sit evenly down
 * the bar, so each one is pinned to the colour the map gives that height.
 */
function legendGradient(dark: boolean): string {
  const colors = altitudeRamp(dark ? "dark" : "light");
  const rising = [...TICKS].reverse();
  const segments = rising.length - 1;
  const stops: string[] = [];
  for (let s = 0; s < segments; s++) {
    const from = altitudeRampPosition(rising[s]);
    const to = altitudeRampPosition(rising[s + 1]);
    for (let j = s === 0 ? 0 : 1; j <= STOPS_BETWEEN_TICKS; j++) {
      const f = j / STOPS_BETWEEN_TICKS;
      const [r, g, b] =
        colors[Math.round((from + (to - from) * f) * (colors.length - 1))];
      stops.push(`rgb(${r},${g},${b}) ${(((s + f) / segments) * 100).toFixed(2)}%`);
    }
  }
  return `linear-gradient(to top, ${stops.join(", ")})`;
}

export function AltitudeLegend({ dark }: { dark: boolean }) {
  const { settings } = useSettings();
  const gradient = useMemo(() => legendGradient(dark), [dark]);

  return (
    <motion.div
      initial={{ opacity: 0, x: 12 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ type: "spring", stiffness: 300, damping: 24, delay: 0.6 }}
      className="flex flex-col gap-2 rounded-lg border p-3 border-border bg-background"
      role="img"
      aria-label={`Altitude color scale from ${formatAltitude(0, settings.unitSystem)} (green) to ${formatAltitude(13000, settings.unitSystem)} (blue)`}
    >
      <p className="aeris-eyebrow text-subtle">Altitude</p>
      <div className="flex items-center gap-2">
        <div
          className="h-32 w-1.5 rounded-full"
          style={{ background: gradient }}
        />
        <div className="flex h-32 flex-col justify-between">
          {TICKS.map((tick) => (
            <span
              key={tick}
              className="text-micro font-medium text-muted-foreground"
            >
              {formatAltitude(tick, settings.unitSystem)}
            </span>
          ))}
        </div>
      </div>
    </motion.div>
  );
}
