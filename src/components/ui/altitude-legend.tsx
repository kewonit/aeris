"use client";

import { memo, useMemo, useState } from "react";
import { useSettings } from "@/hooks/use-settings";
import {
  ALTITUDE_RAMP_TOP_METERS,
  altitudeRamp,
  altitudeRampPosition,
} from "@/lib/flight-utils";
import { formatAltitude } from "@/lib/unit-formatters";

const TICKS = [ALTITUDE_RAMP_TOP_METERS, 6096, 3048, 1524, 610, 152, 0];
const SCALE_PX = 128;
const GRADIENT_STOPS = 12;

/**
 * The key to the altitude colours, drawn from the same ramp the aircraft
 * are, for the map in view. It rests as a small chip with the ramp in it;
 * pressing it opens the full scale, with each height where its colour is.
 */
export const AltitudeLegend = memo(function AltitudeLegend({
  dark,
}: {
  dark: boolean;
}) {
  const { settings } = useSettings();
  const [open, setOpen] = useState(false);
  const low = formatAltitude(0, settings.unitSystem);
  const high = formatAltitude(ALTITUDE_RAMP_TOP_METERS, settings.unitSystem);

  const ramp = useMemo(() => {
    const colors = altitudeRamp(dark ? "dark" : "light");
    return Array.from({ length: GRADIENT_STOPS }, (_, i) => {
      const [r, g, b] = colors[Math.round((i / (GRADIENT_STOPS - 1)) * (colors.length - 1))];
      return `rgb(${r},${g},${b})`;
    }).join(", ");
  }, [dark]);

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
        <span className="flex gap-2">
          <span
            className="w-1.5 rounded-full"
            style={{ height: SCALE_PX, background: `linear-gradient(to top, ${ramp})` }}
          />
          <span className="relative w-16" style={{ height: SCALE_PX }}>
            {TICKS.map((tick) => (
              <span
                key={tick}
                className="absolute left-0 -translate-y-1/2 text-micro whitespace-nowrap text-muted-foreground"
                style={{ top: `${(1 - altitudeRampPosition(tick)) * 100}%` }}
              >
                {formatAltitude(tick, settings.unitSystem)}
              </span>
            ))}
          </span>
        </span>
      ) : (
        <span
          className="h-1.5 w-12 rounded-full"
          style={{ background: `linear-gradient(to right, ${ramp})` }}
          aria-hidden="true"
        />
      )}
    </button>
  );
});
