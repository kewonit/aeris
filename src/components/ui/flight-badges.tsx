"use client";

// ── Flight Badges ──────────────────────────────────────────────────────
//
// Small, source-aware badges for flight metadata.
// All badges return null when data is unavailable — they never render
// placeholders or "-".
// ────────────────────────────────────────────────────────────────────────

import type { PositionSource } from "@/lib/opensky-types";

type BadgeProps = {
  source: PositionSource;
};

const SOURCE_STYLES: Record<
  NonNullable<PositionSource>,
  { label: string; className: string }
> = {
  adsb: {
    label: "ADS-B",
    className:
      "border-emerald-400/24 bg-emerald-400/10 text-emerald-300/90",
  },
  asterix: {
    label: "ASTERIX",
    className: "border-sky-400/24 bg-sky-400/10 text-sky-300/90",
  },
  mlat: {
    label: "MLAT",
    className: "border-amber-400/24 bg-amber-400/10 text-amber-300/90",
  },
  flarm: {
    label: "FLARM",
    className: "border-violet-400/24 bg-violet-400/10 text-violet-300/90",
  },
  tisb: {
    label: "TIS-B",
    className: "border-orange-400/24 bg-orange-400/10 text-orange-300/90",
  },
  adsc: {
    label: "ADS-C",
    className: "border-cyan-400/24 bg-cyan-400/10 text-cyan-300/90",
  },
  other: {
    label: "OTHER",
    className: "border-foreground/[0.08] bg-foreground/[0.04] text-foreground/45",
  },
};

/** Position source badge — ADS-B, MLAT, TIS-B, etc. */
export function PositionSourceBadge({ source }: BadgeProps) {
  if (!source) return null;
  const style = SOURCE_STYLES[source];
  if (!style) return null;

  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full border px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-wide ${style.className}`}
      title={`Position source: ${style.label}`}
    >
      {style.label}
    </span>
  );
}

/** Ground indicator — shown only when aircraft is on ground. */
export function OnGroundBadge({ onGround }: { onGround: boolean }) {
  if (!onGround) return null;

  return (
    <span
      className="inline-flex shrink-0 items-center rounded-full border border-foreground/[0.08] bg-foreground/[0.04] px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-wide text-foreground/45"
      title="Aircraft is on the ground"
    >
      GND
    </span>
  );
}

/**
 * Aircraft type + registration line.
 *
 * Examples:
 *   "Boeing 737-800 · G-EUUY"
 *   "B738 · N38451"
 *   "G-EUUY" (registration only)
 *   null (nothing available)
 */
export function AircraftTypeLine({
  typeCode,
  typeDescription,
  registration,
}: {
  typeCode: string | null | undefined;
  typeDescription: string | null | undefined;
  registration: string | null | undefined;
}) {
  const tc = typeCode?.trim();
  const td = typeDescription?.trim();
  const reg = registration?.trim();

  // Use description if available, otherwise type code
  const typeLabel = td ?? tc;

  if (!typeLabel && !reg) return null;

  return (
    <p className="truncate text-[13px] font-medium text-foreground/66">
      {typeLabel}
      {typeLabel && reg ? (
        <span className="text-foreground/34"> · </span>
      ) : null}
      {reg ? (
        <span className="font-mono text-[12px] text-foreground/52">
          {reg}
        </span>
      ) : null}
    </p>
  );
}

/**
 * Manufacturer + owner line.
 * Only shows when different from the airline name to avoid duplication.
 */
export function AircraftOperatorLine({
  manufacturer,
  owner,
  airlineName,
}: {
  manufacturer: string | null | undefined;
  owner: string | null | undefined;
  airlineName: string | null | undefined;
}) {
  const mfr = manufacturer?.trim();
  const own = owner?.trim();
  const airline = airlineName?.trim();

  // Filter out values that duplicate the airline name
  const parts: string[] = [];
  if (mfr) parts.push(mfr);
  if (own && own !== airline) parts.push(own);

  if (parts.length === 0) return null;

  return (
    <p className="truncate text-[12px] text-foreground/46">
      {parts.join(" · ")}
    </p>
  );
}
