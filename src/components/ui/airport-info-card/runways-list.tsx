"use client";

import type { Runway } from "@/lib/airport-runways";
import { formatRunwayLength, surfaceLabel } from "./formatters";

type Props = {
  runways: Runway[];
  metric: boolean;
};

export function RunwaysList({ runways, metric }: Props) {
  if (runways.length === 0) return null;
  return (
    <section aria-label="Runways">
      <p className="text-label text-subtle">Runways</p>
      <dl className="mt-1">
        {runways.map((runway, index) => (
          <div
            key={`${runway.le_ident}-${runway.he_ident}-${index}`}
            className="flex items-baseline justify-between gap-3 py-1.5"
          >
            <dt className="font-mono text-small text-foreground">
              {runway.le_ident}/{runway.he_ident}
            </dt>
            <dd className="flex gap-4 text-label text-subtle">
              <span className="tabular-nums">
                {formatRunwayLength(runway.length_ft, metric)}
              </span>
              <span className="w-16 text-right">
                {surfaceLabel(runway.surface)}
              </span>
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
