"use client";

import {
  Signal,
  Timer,
  MessageSquare,
  Shield,
  AlertTriangle,
  Cpu,
} from "lucide-react";
import type { FlightDebugData } from "@/lib/opensky";

type DebugDataSectionProps = {
  data: FlightDebugData | null | undefined;
};

function DebugChip({
  icon,
  label,
  value,
  unit,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number | null | undefined;
  unit?: string;
}) {
  if (value == null) return null;
  return (
    <div className="flex items-center gap-1.5 rounded-lg border border-foreground/5 bg-foreground/[0.02] px-2 py-1.5">
      <span className="text-foreground/25">{icon}</span>
      <span className="text-[8px] font-semibold uppercase tracking-wider text-foreground/30">
        {label}
      </span>
      <span className="text-[11px] font-semibold tabular-nums text-foreground/60">
        {value}
        {unit ? <span className="ml-0.5 text-[9px] text-foreground/40">{unit}</span> : null}
      </span>
    </div>
  );
}

/**
 * Debug data section for FlightCard.
 * Shows raw receiver/integrity metrics: NIC, NAC, SIL, version, alert,
 * messages, seen, rssi.
 *
 * Returns null if no debug data is available.
 */
export function DebugDataSection({ data }: DebugDataSectionProps) {
  if (!data) return null;

  const hasAnyData =
    data.nic != null ||
    data.nacP != null ||
    data.nacV != null ||
    data.sil != null ||
    data.version != null ||
    (data.alert != null && data.alert !== 0) ||
    data.messages != null ||
    data.seen != null ||
    data.rssi != null;

  if (!hasAnyData) return null;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5">
        <Cpu className="h-3 w-3 text-foreground/20" />
        <span className="text-[9px] font-semibold uppercase tracking-widest text-foreground/25">
          Raw Data
        </span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <DebugChip icon={<Shield className="h-2.5 w-2.5" />} label="NIC" value={data.nic} />
        <DebugChip icon={<Shield className="h-2.5 w-2.5" />} label="NAC-P" value={data.nacP} />
        <DebugChip icon={<Shield className="h-2.5 w-2.5" />} label="NAC-V" value={data.nacV} />
        <DebugChip icon={<Shield className="h-2.5 w-2.5" />} label="SIL" value={data.sil} />
        <DebugChip icon={<Cpu className="h-2.5 w-2.5" />} label="VER" value={data.version} />
        {/* Only show alert when active (non-zero) */}
        {data.alert !== null && data.alert !== 0 && (
          <DebugChip
            icon={<AlertTriangle className="h-2.5 w-2.5" />}
            label="ALERT"
            value={data.alert}
          />
        )}
        <DebugChip
          icon={<MessageSquare className="h-2.5 w-2.5" />}
          label="MSG"
          value={data.messages}
        />
        <DebugChip
          icon={<Timer className="h-2.5 w-2.5" />}
          label="SEEN"
          value={data.seen}
          unit="s"
        />
        <DebugChip
          icon={<Signal className="h-2.5 w-2.5" />}
          label="RSSI"
          value={data.rssi}
          unit="dB"
        />
      </div>
    </div>
  );
}
