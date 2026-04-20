"use client";

import { Cloud, Eye, Gauge, Loader2, Thermometer, Wind } from "lucide-react";
import type { UnitSystem } from "@/hooks/use-settings";
import {
  formatCloudBaseHundredsFeet,
  formatPressureHpa,
  formatTemperatureC,
  formatVisibility,
  formatWindFromKnots,
} from "@/lib/unit-formatters";
import { cloudCoverLabel } from "./formatters";
import type { MetarData } from "./types";

type Props = {
  metar: MetarData | null;
  loading: boolean;
  hasIcao: boolean;
  unitSystem: UnitSystem;
};

export function WeatherSection({ metar, loading, hasIcao, unitSystem }: Props) {
  if (loading && !metar) {
    return (
      <div className="flex items-center gap-2">
        <Loader2 className="h-3 w-3 animate-spin text-foreground/20" />
        <span className="text-[10px] text-foreground/25">
          Loading weather...
        </span>
      </div>
    );
  }

  if (!metar) {
    if (!hasIcao) return null;
    return (
      <p className="text-[10px] text-foreground/25">
        No weather data available
      </p>
    );
  }

  return (
    <div>
      <p className="text-[10px] font-medium tracking-widest text-foreground/25 uppercase">
        Current Weather
      </p>

      <div className="mt-2 grid grid-cols-2 gap-1.5">
        <Metric
          icon={<Wind className="h-3 w-3" />}
          label="Wind"
          value={formatWindFromKnots(
            metar.wdir,
            metar.wspd,
            metar.wgst,
            unitSystem,
          )}
        />
        <Metric
          icon={<Eye className="h-3 w-3" />}
          label="Visibility"
          value={formatVisibility(metar.visib, unitSystem)}
        />
        <Metric
          icon={<Thermometer className="h-3 w-3" />}
          label="Temp / Dew"
          value={
            metar.temp !== undefined
              ? `${formatTemperatureC(metar.temp, unitSystem)} / ${formatTemperatureC(metar.dewp, unitSystem)}`
              : "—"
          }
        />
        <Metric
          icon={<Gauge className="h-3 w-3" />}
          label="QNH"
          value={formatPressureHpa(metar.altim, unitSystem)}
        />
      </div>

      {metar.clouds && metar.clouds.length > 0 && (
        <div className="mt-2 flex items-start gap-1.5 rounded-lg bg-foreground/3 px-2.5 py-2 ring-1 ring-foreground/4">
          <Cloud className="mt-0.5 h-3 w-3 shrink-0 text-foreground/25" />
          <div className="flex flex-col gap-0.5">
            <span className="text-[9px] font-medium tracking-widest text-foreground/20 uppercase">
              Cloud Layers
            </span>
            <p className="text-[11px] leading-snug text-foreground/45">
              {metar.clouds
                .map(
                  (c) =>
                    `${cloudCoverLabel(c.cover)}${formatCloudBaseHundredsFeet(c.base, unitSystem)}`,
                )
                .join(" · ")}
            </p>
          </div>
        </div>
      )}

      {metar.rawOb && (
        <div className="mt-2 rounded-lg bg-foreground/3 px-2.5 py-2 ring-1 ring-foreground/4">
          <p className="font-mono text-[9px] leading-relaxed text-foreground/25 break-all select-all">
            {metar.rawOb}
          </p>
        </div>
      )}
    </div>
  );
}

function Metric({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex flex-col gap-0.5 rounded-lg bg-foreground/3 px-2.5 py-2 ring-1 ring-foreground/4">
      <div className="flex items-center gap-1 text-foreground/25">
        {icon}
        <span className="text-[9px] font-medium tracking-widest uppercase">
          {label}
        </span>
      </div>
      <p className="text-[12px] font-semibold tabular-nums text-foreground/80">
        {value}
      </p>
    </div>
  );
}
