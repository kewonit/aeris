"use client";

import { ChevronDown } from "lucide-react";
import type { TafData } from "./types";

type Props = {
  taf: TafData | null;
  loading: boolean;
};

export function TafSection({ taf, loading }: Props) {
  if (!taf?.rawTAF) {
    return loading ? (
      <p className="text-small text-subtle">Loading forecast…</p>
    ) : null;
  }

  return (
    <details className="group border-t border-border">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between text-small text-foreground marker:content-none">
        Forecast (TAF)
        <ChevronDown
          className="size-4 text-subtle transition-transform group-open:rotate-180"
          aria-hidden="true"
        />
      </summary>
      <p className="pb-3 font-mono text-micro break-all whitespace-pre-wrap text-subtle select-all">
        {taf.rawTAF}
      </p>
    </details>
  );
}
