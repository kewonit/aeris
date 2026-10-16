import type { PositionSource } from "@/lib/opensky-types";
import { positionSourceLabel } from "@/lib/aircraft-sidebar";

/** How the position was measured: ADS-B, MLAT, TIS-B, and so on. */
export function PositionSourceBadge({ source }: { source: PositionSource }) {
  const label = positionSourceLabel(source);
  if (!label) return null;
  return (
    <span
      className="shrink-0 font-mono text-micro text-subtle"
      title={`Position source: ${label}`}
    >
      {label}
    </span>
  );
}

export function OnGroundBadge({ onGround }: { onGround: boolean }) {
  if (!onGround) return null;
  return <span className="shrink-0 text-micro text-subtle">On ground</span>;
}
