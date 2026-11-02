"use client";

import { useState } from "react";
import { useSettings } from "@/hooks/use-settings";
import { formatAltitude } from "@/lib/unit-formatters";

const RAMP =
  "rgb(72,210,160), rgb(160,195,80), rgb(235,150,60), rgb(240,110,80), rgb(220,85,130), rgb(180,90,190), rgb(120,110,220), rgb(100,170,240)";
const TICKS = [13000, 6096, 3048, 1524, 610, 152, 0];

/**
 * The key to the altitude colours. It rests as a small chip with the ramp
 * in it; pressing it opens the full scale, pressing again puts it away.
 */
export function AltitudeLegend() {
  const { settings } = useSettings();
  const [open, setOpen] = useState(false);
  const low = formatAltitude(0, settings.unitSystem);
  const high = formatAltitude(13000, settings.unitSystem);

  return (
    <button
      type="button"
      onClick={() => setOpen((value) => !value)}
      aria-expanded={open}
      aria-label={`Altitude colours, ${low} to ${high}`}
      className={`aeris-float flex text-muted-foreground transition-colors hover:text-foreground ${
        open
          ? "flex-col items-start gap-2 rounded-lg p-3"
          : "h-11 items-center gap-2 rounded-full px-3.5 sm:px-4"
      }`}
    >
      <span className={open ? "text-label" : "hidden text-label sm:inline"}>
        Altitude
      </span>
      {open ? (
        <span className="flex items-center gap-2">
          <span
            className="h-32 w-1.5 rounded-full"
            style={{ background: `linear-gradient(to top, ${RAMP})` }}
          />
          <span className="flex h-32 flex-col justify-between text-left">
            {TICKS.map((tick) => (
              <span key={tick} className="text-micro text-muted-foreground">
                {formatAltitude(tick, settings.unitSystem)}
              </span>
            ))}
          </span>
        </span>
      ) : (
        <span
          className="h-1.5 w-12 rounded-full"
          style={{ background: `linear-gradient(to right, ${RAMP})` }}
          aria-hidden="true"
        />
      )}
    </button>
  );
}
