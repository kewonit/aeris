"use client";

import { useCallback } from "react";
import { Radio } from "lucide-react";
import type { AtcFeed } from "@/lib/atc-types";
import type { UseAtcStreamReturn } from "@/hooks/use-atc-stream";

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
    <section aria-label="ATC frequencies">
      <p className="flex items-center gap-1.5 text-label text-subtle">
        <Radio className="size-3" aria-hidden="true" />
        Live ATC
      </p>
      <div className="-mx-2 mt-1">
        {feeds.map((feed) => (
          <FeedRow
            key={feed.id}
            feed={feed}
            atc={atc}
            onClick={() => handleClick(feed)}
          />
        ))}
      </div>
    </section>
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
        className={`flex w-full cursor-pointer items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-left transition-colors ${
          isActive ? "bg-card text-tint" : "hover:bg-card"
        }`}
      >
        <RowLabel name={feed.name} active={isActive} />
        <Frequency value={feed.frequency} />
      </button>
    );
  }

  return (
    <div className="flex items-center justify-between gap-2 rounded-sm px-2 py-1.5 transition-colors hover:bg-card">
      <RowLabel name={feed.name} active={false} />
      <Frequency value={feed.frequency} />
    </div>
  );
}

function RowLabel({ name, active }: { name: string; active: boolean }) {
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <span
        className={`size-1.5 shrink-0 rounded-full ${active ? "bg-tint" : "bg-border"}`}
        aria-hidden="true"
      />
      <span className={`truncate text-small ${active ? "text-tint" : "text-muted-foreground"}`}>
        {name}
      </span>
    </div>
  );
}

function Frequency({ value }: { value: string }) {
  return (
    <span className="shrink-0 font-mono text-micro text-subtle">
      {value}
    </span>
  );
}
