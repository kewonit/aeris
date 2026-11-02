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
  const { kind, name } = formatAirspaceTitle({
    icao_class: props.icao_class,
    type: props.type,
    name: props.name,
  });
  const upper = formatAirspaceLimit(props.upper);
  const lower = formatAirspaceLimit(props.lower);
  return (
    <div className="aeris-float max-w-64 min-w-44 rounded-lg px-4 py-3">
      <p className="text-label text-subtle">{kind}</p>
      {name && <p className="text-small text-foreground">{name}</p>}
      <p className="mt-1 font-mono text-label text-muted-foreground">
        {lower} – {upper}
      </p>
    </div>
  );
}
