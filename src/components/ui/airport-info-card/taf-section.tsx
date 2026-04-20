"use client";

import { useState } from "react";
import { FileText, Loader2 } from "lucide-react";
import type { TafData } from "./types";

type Props = {
  taf: TafData | null;
  loading: boolean;
};

export function TafSection({ taf, loading }: Props) {
  const [expanded, setExpanded] = useState(false);
  if (!loading && !taf) return null;

  return (
    <div>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-1.5 rounded-md py-1 transition-colors hover:bg-foreground/3"
        aria-expanded={expanded}
        aria-controls="airport-taf-raw"
      >
        <FileText className="h-3 w-3 text-foreground/25" />
        <span className="text-[10px] font-medium tracking-widest text-foreground/25 uppercase">
          Forecast (TAF)
        </span>
        {loading && !taf && (
          <Loader2 className="ml-auto h-3 w-3 animate-spin text-foreground/20" />
        )}
        {taf && (
          <span className="ml-auto text-[9px] text-foreground/30">
            {expanded ? "Hide" : "Show"}
          </span>
        )}
      </button>
      {taf?.rawTAF && expanded && (
        <div
          id="airport-taf-raw"
          className="mt-1 rounded-lg bg-foreground/3 px-2.5 py-2 ring-1 ring-foreground/4"
        >
          <p className="font-mono text-[9px] leading-relaxed whitespace-pre-wrap text-foreground/45 break-all select-all">
            {taf.rawTAF}
          </p>
        </div>
      )}
    </div>
  );
}
