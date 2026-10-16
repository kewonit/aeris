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
            <dd className="text-label text-subtle">
              {formatRunwayLength(runway.length_ft, metric)} ·{" "}
              {surfaceLabel(runway.surface)}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
