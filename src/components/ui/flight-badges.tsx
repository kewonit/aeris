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
      "border-emerald-500/25 bg-emerald-500/10 text-emerald-400/80",
  },
  asterix: {
    label: "ASTERIX",
    className: "border-sky-500/25 bg-sky-500/10 text-sky-400/80",
  },
  mlat: {
    label: "MLAT",
    className: "border-amber-500/25 bg-amber-500/10 text-amber-400/80",
  },
  flarm: {
    label: "FLARM",
    className: "border-violet-500/25 bg-violet-500/10 text-violet-400/80",
  },
  tisb: {
    label: "TIS-B",
    className: "border-orange-500/25 bg-orange-500/10 text-orange-400/80",
  },
  adsc: {
    label: "ADS-C",
    className: "border-cyan-500/25 bg-cyan-500/10 text-cyan-400/80",
  },
  other: {
    label: "OTHER",
    className: "border-foreground/10 bg-foreground/[0.04] text-foreground/30",
  },
};

/** Position source badge — ADS-B, MLAT, TIS-B, etc. */
export function PositionSourceBadge({ source }: BadgeProps) {
  if (!source) return null;
  const style = SOURCE_STYLES[source];
  if (!style) return null;

  return (
    <span
      className={`inline-flex shrink-0 items-center rounded border px-1 py-px text-[8px] font-bold uppercase tracking-wider ${style.className}`}
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
      className="inline-flex shrink-0 items-center rounded border border-foreground/10 bg-foreground/[0.04] px-1 py-px text-[8px] font-bold uppercase tracking-wider text-foreground/30"
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
    <p className="truncate text-[12px] text-foreground/35">
      {typeLabel}
      {typeLabel && reg ? (
        <span className="text-foreground/20"> · </span>
      ) : null}
      {reg ? (
        <span className="font-mono text-[11px] text-foreground/30">
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
    <p className="truncate text-[11px] text-foreground/30">
      {parts.join(" · ")}
    </p>
  );
}
