"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowUpRight,
  Check,
  ChevronDown,
  ChevronLeft,
  Play,
  RotateCcw,
  Square,
} from "lucide-react";
import { useTheme } from "@wrksz/themes/client";
import { LiveFlightMap } from "@/components/map/live-flight-map";
import { useAtcStream } from "@/hooks/use-atc-stream";
import { useDropdownDismiss } from "@/hooks/use-dropdown-dismiss";
import type { Settings } from "@/hooks/use-settings";
import { airportToCity } from "@/lib/airport-city";
import type { AtcFeed, AtcStreamStatus } from "@/lib/atc-types";
import { TowerSheet } from "./tower-sheet";
import type { AtcAirport, AtcCountry } from "./types";
import { VoiceWave } from "./voice-wave";

const DEFAULT_TOWER = "KJFK";
const OUTBOUND_URL = "https://outbound.edbn.me";
const POP = { type: "spring", stiffness: 520, damping: 38 } as const;
/** The map turns slowly around the tower while you listen. */
const MAP_SETTINGS: Partial<Settings> = { autoOrbit: true };

function feedsOf(airport: AtcAirport): AtcFeed[] {
  return airport.feeds.map((feed) => ({
    ...feed,
    icao: airport.icao,
    streamUrl: `https://www.liveatc.net/play/${feed.mountPoint}.pls`,
  }));
}

const FEED_LABELS: Record<AtcFeed["type"], string> = {
  tower: "Tower",
  ground: "Ground",
  approach: "Approach",
  departure: "Departure",
  atis: "ATIS",
  center: "Center",
  combined: "Tower and approach",
};

/** "JFK Tower" reads as "Tower" next to the airport's own code. */
function feedLabel(feed: AtcFeed, airport: AtcAirport, feeds: AtcFeed[]): string {
  if (feeds.filter((f) => f.type === feed.type).length === 1) return FEED_LABELS[feed.type];
  return feed.name.replace(new RegExp(`^(${airport.iata}|${airport.city})\\s+`, "i"), "");
}

const STATUS_TEXT: Partial<Record<AtcStreamStatus, string>> = {
  playing: "Live",
  loading: "Connecting",
  blocked: "Tap play",
  error: "Unavailable",
};

function Pill({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <span
      className={`flex h-9 items-center gap-1.5 rounded-full bg-background text-small font-medium shadow-lift transition-colors group-hover:bg-card ${className}`}
    >
      {children}
    </span>
  );
}

function FeedLabel({ feed, label }: { feed: AtcFeed; label: string }) {
  return (
    <>
      <span className="truncate">{label}</span>
      {feed.frequency && (
        <span className="shrink-0 font-mono text-muted-foreground">{feed.frequency}</span>
      )}
    </>
  );
}

/** The feed in use, and with more than one, a menu of the rest. */
function FeedPicker({
  feeds,
  feed,
  airport,
  onTune,
}: {
  feeds: AtcFeed[];
  feed: AtcFeed;
  airport: AtcAirport;
  onTune: (feed: AtcFeed) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemsRef = useRef<(HTMLButtonElement | null)[]>([]);
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  useDropdownDismiss(ref, open, close);
  const current = Math.max(0, feeds.findIndex((f) => f.id === feed.id));

  useEffect(() => {
    if (open) itemsRef.current[current]?.focus();
  }, [open, current]);

  if (feeds.length < 2) {
    return (
      <p className="flex h-9 min-w-0 items-center gap-2 text-small">
        <FeedLabel feed={feed} label={feedLabel(feed, airport, feeds)} />
      </p>
    );
  }

  const onMenuKey = (event: React.KeyboardEvent) => {
    const items = itemsRef.current.filter(Boolean) as HTMLButtonElement[];
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    const move = (to: number) => {
      event.preventDefault();
      items[(to + items.length) % items.length]?.focus();
    };
    if (event.key === "ArrowDown") move(at + 1);
    else if (event.key === "ArrowUp") move(at - 1);
    else if (event.key === "Home") move(0);
    else if (event.key === "End") move(items.length - 1);
    else if (event.key === "Escape") {
      event.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
    } else if (event.key === "Tab") setOpen(false);
  };

  return (
    <div ref={ref} className="relative min-w-0">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(event) => {
          if (event.key === "ArrowUp" || event.key === "ArrowDown") {
            event.preventDefault();
            setOpen(true);
          }
        }}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Feed: ${feed.name}${feed.frequency ? `, ${feed.frequency}` : ""}. Change feed`}
        className="flex h-9 max-w-full items-center gap-2 rounded-full bg-card pl-3.5 pr-3 text-small transition-colors hover:bg-accent"
      >
        <FeedLabel feed={feed} label={feedLabel(feed, airport, feeds)} />
        <ChevronDown
          className={`size-3.5 shrink-0 text-subtle transition-transform ${open ? "rotate-180" : ""}`}
          aria-hidden="true"
        />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            aria-label="Feeds"
            onKeyDown={onMenuKey}
            initial={{ opacity: 0, y: 6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.98 }}
            transition={POP}
            style={{ transformOrigin: "bottom left" }}
            className="scrollbar-none absolute bottom-full left-0 z-20 mb-2 max-h-[min(320px,50dvh)] w-64 max-w-[calc(100vw-48px)] overflow-y-auto overscroll-contain rounded-lg bg-card p-1.5 shadow-lift"
          >
            {feeds.map((f, i) => (
              <button
                key={f.id}
                ref={(node) => {
                  itemsRef.current[i] = node;
                }}
                type="button"
                role="menuitemradio"
                aria-checked={f.id === feed.id}
                onClick={() => {
                  setOpen(false);
                  triggerRef.current?.focus();
                  if (f.id !== feed.id) onTune(f);
                }}
                className="flex h-10 w-full items-center gap-3 rounded-md px-2.5 text-left text-small outline-none transition-colors hover:bg-accent focus-visible:bg-accent"
              >
                <Check
                  className={`size-4 shrink-0 text-tint ${f.id === feed.id ? "" : "invisible"}`}
                  aria-hidden="true"
                />
                <span className="min-w-0 flex-1 truncate">{feedLabel(f, airport, feeds)}</span>
                {f.frequency && (
                  <span className="shrink-0 font-mono text-muted-foreground">{f.frequency}</span>
                )}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function AtcRadio({
  airports,
  countries,
}: {
  airports: AtcAirport[];
  countries: AtcCountry[];
}) {
  const atc = useAtcStream();
  const { resolvedTheme } = useTheme();
  const dark = resolvedTheme !== "light";

  const byIcao = useMemo(() => new Map(airports.map((a) => [a.icao, a])), [airports]);
  const [icao, setIcao] = useState(() => (byIcao.has(DEFAULT_TOWER) ? DEFAULT_TOWER : airports[0].icao));
  const [feedId, setFeedId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [peek, setPeek] = useState(0);
  const [speaking, setSpeaking] = useState(false);

  const airport = byIcao.get(icao) ?? airports[0];
  const feeds = useMemo(() => feedsOf(airport), [airport]);
  const feed = feeds.find((f) => f.id === feedId) ?? feeds[0];
  const countryName = countries.find((c) => c.code === airport.country)?.name;
  const city = useMemo(() => airportToCity(airport), [airport]);

  const { status } = atc;
  const onAir = atc.feed !== null && (status === "playing" || status === "loading");
  const statusText = STATUS_TEXT[status];

  const pick = useCallback(
    (next: string) => {
      const target = byIcao.get(next);
      if (!target) return;
      setIcao(next);
      setFeedId(null);
      const [first] = feedsOf(target);
      if (first) atc.play(first);
    },
    [atc, byIcao],
  );

  const toggle = useCallback(() => {
    if (status === "blocked") atc.resume();
    else if (onAir) atc.stop();
    else if (feed) atc.play(feed);
  }, [atc, feed, onAir, status]);

  const tune = useCallback(
    (next: AtcFeed) => {
      setFeedId(next.id);
      atc.play(next);
    },
    [atc],
  );

  // Space plays and stops, unless it's typing, pressing a control, or a shortcut.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.code !== "Space" || event.repeat || event.defaultPrevented) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement;
      if (target.isContentEditable || target.closest("input, textarea, select, button, a, [role=menu]")) return;
      event.preventDefault();
      toggle();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle]);

  const PlayIcon = onAir ? Square : status === "error" ? RotateCcw : Play;

  return (
    <main className="relative h-dvh w-full overflow-hidden bg-background">
      <div className="absolute inset-0">
        <LiveFlightMap
          city={city}
          overrides={MAP_SETTINGS}
          attributionClassName="absolute right-4 top-[calc(max(16px,env(safe-area-inset-top))+48px)] z-10"
        />
      </div>

      <nav className="pointer-events-none absolute inset-x-4 top-[max(16px,env(safe-area-inset-top))] z-10 flex items-center justify-between">
        <Link href="/" className="group pointer-events-auto" aria-label="Back to the Aeris map">
          <Pill className="pl-2 pr-3.5">
            <ChevronLeft className="size-4 text-muted-foreground" aria-hidden="true" />
            Aeris
          </Pill>
        </Link>
        <a href={OUTBOUND_URL} target="_blank" rel="noopener" className="group pointer-events-auto">
          <Pill className="pl-1.5 pr-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/outbound.svg" alt="" width={24} height={24} className="size-6" />
            Outbound
            <ArrowUpRight className="size-3.5 text-subtle" aria-hidden="true" />
          </Pill>
        </a>
      </nav>

      <motion.section
        aria-label="Now playing"
        className="absolute bottom-[calc(var(--peek)+12px)] left-1/2 z-10 w-[min(calc(100%-32px),360px)] -translate-x-1/2 sm:bottom-[calc(var(--peek)+20px)]"
        style={{ "--peek": `${peek}px`, pointerEvents: peek ? "auto" : "none" } as React.CSSProperties}
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: peek ? 1 : 0, y: peek ? 0 : 12 }}
        transition={{ type: "spring", stiffness: 300, damping: 32 }}
      >
        <div className="rounded-xl bg-background p-5 shadow-lift">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0" title={[airport.name, countryName].filter(Boolean).join(", ")}>
              <h1 className="text-title font-medium">{airport.iata}</h1>
              <p className="mt-0.5 truncate text-small text-muted-foreground">{airport.city}</p>
            </div>
            <p
              role="status"
              aria-live="polite"
              className={`flex h-7 shrink-0 items-center gap-1.5 text-label ${
                status === "error" ? "text-danger" : "text-muted-foreground"
              }`}
            >
              {onAir && (
                <span
                  aria-hidden="true"
                  className={`size-1.5 rounded-full bg-danger transition-transform ${
                    status === "loading" ? "animate-pulse opacity-60" : speaking ? "scale-150" : ""
                  }`}
                />
              )}
              {statusText}
            </p>
          </div>

          <VoiceWave
            audioElement={atc.audioElement}
            active={status === "playing" && atc.usingProxy}
            onLevel={setSpeaking}
            className="mt-4 h-10 w-full [@media(max-height:560px)]:hidden"
          />

          <div className="mt-4 flex items-center justify-between gap-3">
            {feed ? (
              <FeedPicker key={airport.icao} feeds={feeds} feed={feed} airport={airport} onTune={tune} />
            ) : (
              <p className="text-small text-muted-foreground">No feed</p>
            )}
            <button
              type="button"
              onClick={toggle}
              disabled={!feed}
              aria-label={onAir ? "Stop" : status === "error" ? "Try again" : "Listen"}
              className="flex size-11 shrink-0 items-center justify-center rounded-full bg-foreground text-background transition-transform active:scale-95 disabled:opacity-40"
            >
              <PlayIcon
                className={onAir ? "size-3.5" : status === "error" ? "size-4" : "ml-0.5 size-4"}
                fill={status === "error" ? "none" : "currentColor"}
                strokeWidth={status === "error" ? 2.25 : 0}
                aria-hidden="true"
              />
            </button>
          </div>
        </div>
      </motion.section>

      <TowerSheet
        airports={airports}
        countries={countries}
        selected={airport.icao}
        live={onAir}
        open={open}
        dark={dark}
        onOpenChange={setOpen}
        onPick={pick}
        onPeek={setPeek}
      />
    </main>
  );
}
