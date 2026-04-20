"use client";

import { useCallback } from "react";
import { Radio } from "lucide-react";
import type { AtcFeed } from "@/lib/atc-types";
import type { UseAtcStreamReturn } from "@/hooks/use-atc-stream";
import { ScrollArea } from "@/components/ui/scroll-area";

type Props = {
  feeds: AtcFeed[];
  atc?: UseAtcStreamReturn;
};

export function AtcFrequencies({ feeds, atc }: Props) {
  const handleClick = useCallback(
    (feed: AtcFeed) => {
      if (!atc) return;
      if (atc.feed?.id === feed.id && atc.status === "playing") {
        atc.stop();
      } else {
        atc.play(feed);
      }
    },
    [atc],
  );

  if (feeds.length === 0) return null;

  return (
    <div>
      <div className="flex items-center gap-1.5">
        <Radio className="h-3 w-3 text-emerald-400/50" />
        <p className="text-[10px] font-medium tracking-widest text-foreground/25 uppercase">
          ATC Frequencies
        </p>
        <span className="ml-auto rounded-full bg-foreground/5 px-1.5 py-px text-[9px] font-medium tabular-nums text-foreground/20">
          {feeds.length}
        </span>
      </div>
      <ScrollArea className="mt-1.5 max-h-28">
        <div className="space-y-0.5">
          {feeds.map((feed) => (
            <FeedRow
              key={feed.id}
              feed={feed}
              atc={atc}
              onClick={() => handleClick(feed)}
            />
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}

function FeedRow({
  feed,
  atc,
  onClick,
}: {
  feed: AtcFeed;
  atc?: UseAtcStreamReturn;
  onClick: () => void;
}) {
  const isActive = atc?.feed?.id === feed.id && atc.status === "playing";

  if (atc) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-pressed={isActive}
        className={`flex w-full cursor-pointer items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left transition-colors ${
          isActive
            ? "bg-emerald-400/10 ring-1 ring-emerald-400/30"
            : "hover:bg-foreground/3"
        }`}
      >
        <RowLabel name={feed.name} active={isActive} />
        <Frequency value={feed.frequency} />
      </button>
    );
  }

  return (
    <div className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-foreground/3">
      <RowLabel name={feed.name} active={false} />
      <Frequency value={feed.frequency} />
    </div>
  );
}

function RowLabel({ name, active }: { name: string; active: boolean }) {
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <span
        className={`h-1.5 w-1.5 shrink-0 rounded-full ${
          active ? "bg-emerald-400" : "bg-emerald-400/40"
        }`}
      />
      <span className="truncate text-[11px] text-foreground/45">{name}</span>
    </div>
  );
}

function Frequency({ value }: { value: string }) {
  return (
    <span className="shrink-0 font-mono text-[10px] tabular-nums text-foreground/35">
      {value}
    </span>
  );
}
