"use client";

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
  if (!metar) {
    if (!loading && !hasIcao) return null;
    return (
      <p className="py-4 text-small text-subtle">
        {loading ? "Loading weather…" : "No weather report for this airport"}
      </p>
    );
  }

  const clouds = metar.clouds
    ?.map(
      (layer) =>
        `${cloudCoverLabel(layer.cover)}${formatCloudBaseHundredsFeet(layer.base, unitSystem)}`,
    )
    .join(" · ");

  return (
    <section aria-label="Current weather">
      <dl className="grid grid-cols-2 gap-x-6 gap-y-4">
        <Reading
          label="Wind"
          value={formatWindFromKnots(metar.wdir, metar.wspd, metar.wgst, unitSystem)}
        />
        <Reading label="Visibility" value={formatVisibility(metar.visib, unitSystem)} />
        <Reading
          label="Temperature / dew point"
          value={
            metar.temp !== undefined
              ? `${formatTemperatureC(metar.temp, unitSystem)} / ${formatTemperatureC(metar.dewp, unitSystem)}`
              : "-"
          }
        />
        <Reading label="QNH" value={formatPressureHpa(metar.altim, unitSystem)} />
        {clouds && <Reading label="Clouds" value={clouds} wide />}
      </dl>
      {metar.rawOb && (
        <p className="mt-4 font-mono text-micro break-all text-subtle select-all">
          {metar.rawOb}
        </p>
      )}
    </section>
  );
}

function Reading({
  label,
  value,
  wide = false,
}: {
  label: string;
  value: string;
  wide?: boolean;
}) {
  return (
    <div className={wide ? "col-span-2 min-w-0" : "min-w-0"}>
      <dt className="text-label text-subtle">{label}</dt>
      <dd className="mt-0.5 text-small text-foreground">{value}</dd>
    </div>
  );
}
