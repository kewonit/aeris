"use client";

import { memo, useMemo, useState } from "react";
import { Route } from "lucide-react";
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
 * The traffic trails switch and the key to the altitude colours, in one
 * chip. The key is drawn from the same ramp the aircraft are; pressing it
 * opens the full scale above, with each height where its colour is.
 */
export const AltitudeLegend = memo(function AltitudeLegend({
  dark,
}: {
  dark: boolean;
}) {
  const { settings, update } = useSettings();
  const trails = settings.showTrails;
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
    <div className="aeris-float relative flex h-11 items-center rounded-full">
      <button
        type="button"
        onClick={() => update("showTrails", !trails)}
        aria-pressed={trails}
        aria-label="Traffic trails"
        title="Trails for all traffic (T)"
        className={`flex h-11 items-center rounded-l-full pr-3 pl-3.5 transition-colors hover:text-foreground sm:pl-4 ${
          trails ? "text-foreground" : "text-subtle"
        }`}
      >
        <Route className="size-4" aria-hidden="true" />
      </button>
      <span className="h-5 w-px bg-border" aria-hidden="true" />
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-label={`Altitude colours, ${low} to ${high}`}
        className="flex h-11 items-center gap-2 rounded-r-full pr-3.5 pl-3 text-muted-foreground transition-colors hover:text-foreground sm:pr-4"
      >
        <span className="hidden text-label sm:inline">Altitude</span>
        <span
          className="h-1.5 w-12 rounded-full"
          style={{ background: `linear-gradient(to right, ${ramp})` }}
          aria-hidden="true"
        />
      </button>
      {open && (
        <div className="aeris-float absolute right-0 bottom-full mb-2 flex flex-col gap-2 rounded-lg p-3 text-muted-foreground">
          <span className="text-label">Altitude</span>
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
        </div>
      )}
    </div>
  );
});
