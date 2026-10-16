"use client";

import {
  formatAirspaceLimit,
  formatAirspaceTitle,
  type AirspaceLimit,
} from "@/lib/airspace-format";

// ── Airspace click popup content ───────────────────────────────────
//
// Rendered into a MapLibre Popup via ReactDOM.createRoot in
// airspace-layer.tsx. Kept as a dumb presentational component so the
// DOM markup is easy to style with Tailwind and trivial to unit-test
// later if we add a test harness for react components.
// ────────────────────────────────────────────────────────────────────

export type AirspacePopupProps = {
  icao_class: string;
  type: string;
  name: string;
  lower: AirspaceLimit | null;
  upper: AirspaceLimit | null;
};

export function AirspacePopup(props: AirspacePopupProps) {
  const title = formatAirspaceTitle({
    icao_class: props.icao_class,
    type: props.type,
    name: props.name,
  });
  const upper = formatAirspaceLimit(props.upper);
  const lower = formatAirspaceLimit(props.lower);
  const showTypeLine = props.icao_class && props.icao_class !== "unclassified";

  return (
    <div className="min-w-[180px] max-w-[260px] rounded-sm bg-card/90 p-3 text-label text-foreground shadow-lift">
      <div className="font-medium text-small leading-tight">{title}</div>
      <div className="mt-2 font-mono text-caption leading-snug">
        <div>{upper}</div>
        <div className="my-0.5 text-muted-foreground">────────</div>
        <div>{lower}</div>
      </div>
      {showTypeLine && (
        <div className="mt-2 text-micro text-muted-foreground">
          {props.type}
        </div>
      )}
    </div>
  );
}
