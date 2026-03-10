"use client";

import type { ReactNode } from "react";
import { motion } from "motion/react";
import {
  RotateCw,
  Route,
  Layers,
  Palette,
  Globe,
  ArrowLeftRight,
} from "lucide-react";
import { useSettings, type OrbitDirection } from "@/hooks/use-settings";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Slider } from "@/components/ui/slider";
import { SHORTCUTS } from "@/components/ui/keyboard-shortcuts-help";

const ORBIT_SPEED_PRESETS = [
  { label: "Slow", value: 0.06 },
  { label: "Normal", value: 0.15 },
  { label: "Fast", value: 0.35 },
];

const ORBIT_SPEED_MIN = 0.02;
const ORBIT_SPEED_MAX = 0.5;
const ORBIT_SNAP_THRESHOLD = 0.025;
const TRAIL_THICKNESS_MIN = 0.5;
const TRAIL_THICKNESS_MAX = 8;
const TRAIL_DISTANCE_MIN = 12;
const TRAIL_DISTANCE_MAX = 100;

const ORBIT_DIRECTIONS: { label: string; value: OrbitDirection }[] = [
  { label: "Clockwise", value: "clockwise" },
  { label: "Counter", value: "counter-clockwise" },
];

export function SettingsContent() {
  const { settings, update, reset } = useSettings();

  return (
    <ScrollArea className="h-full">
      <div className="space-y-0.5 p-3 pt-1">
        <SettingRow
          icon={<RotateCw className="h-4 w-4" />}
          title="Auto-orbit"
          description="Camera slowly rotates around the airport"
          checked={settings.autoOrbit}
          onChange={(v) => update("autoOrbit", v)}
        />

        {settings.autoOrbit && (
          <>
            <OrbitSpeedSlider
              value={settings.orbitSpeed}
              onChange={(v) => update("orbitSpeed", v)}
            />
            <SegmentRow
              icon={<ArrowLeftRight className="h-4 w-4" />}
              title="Direction"
              options={ORBIT_DIRECTIONS}
              value={settings.orbitDirection}
              onChange={(v) => update("orbitDirection", v)}
            />
          </>
        )}

        <div className="mx-3 my-2 h-px bg-white/4" />

        <SettingRow
          icon={<Route className="h-4 w-4" />}
          title="Flight trails"
          description="Altitude-colored trails behind aircraft"
          checked={settings.showTrails}
          onChange={(v) => update("showTrails", v)}
        />
        {settings.showTrails && (
          <>
            <TrailThicknessSlider
              value={settings.trailThickness}
              onChange={(v) => update("trailThickness", v)}
            />
            <TrailDistanceSlider
              value={settings.trailDistance}
              onChange={(v) => update("trailDistance", v)}
            />
          </>
        )}
        <SettingRow
          icon={<Layers className="h-4 w-4" />}
          title="Ground shadows"
          description="Shadow projections on the map surface"
          checked={settings.showShadows}
          onChange={(v) => update("showShadows", v)}
        />
        <SettingRow
          icon={<Palette className="h-4 w-4" />}
          title="Altitude colors"
          description="Color aircraft and trails by altitude"
          checked={settings.showAltitudeColors}
          onChange={(v) => update("showAltitudeColors", v)}
        />

        <div className="mx-3 my-2 h-px bg-white/4" />

        <SettingRow
          icon={<Globe className="h-4 w-4" />}
          title="Globe mode"
          description="Display earth as a 3D sphere when zoomed out"
          checked={settings.globeMode}
          onChange={(v) => update("globeMode", v)}
          badge="BETA"
        />

        <div className="mx-3 my-2 h-px bg-white/4" />

        <div className="px-3 pt-2">
          <button
            type="button"
            onClick={reset}
            className="inline-flex h-8 items-center justify-center rounded-lg px-3 text-[12px] font-medium text-white/65 ring-1 ring-white/10 transition-colors hover:bg-white/5 hover:text-white/85"
          >
            Reset to defaults
          </button>
        </div>

        <div className="mx-3 my-2 h-px bg-white/4" />
      </div>
    </ScrollArea>
  );
}

export function ShortcutsContent() {
  return (
    <ScrollArea className="h-full">
      <div className="p-3 pt-1">
        <div className="space-y-1">
          {SHORTCUTS.map(({ key, description }) => (
            <div
              key={key}
              className="flex items-center justify-between gap-3 rounded-xl px-3 py-2.5 transition-colors hover:bg-white/4"
            >
              <span className="text-[13px] font-medium text-white/68">
                {description}
              </span>
              <kbd className="flex h-7 min-w-7 items-center justify-center rounded-md bg-white/6 px-2 font-mono text-[11px] font-semibold text-white/74 ring-1 ring-white/8">
                {key}
              </kbd>
            </div>
          ))}
        </div>
      </div>
    </ScrollArea>
  );
}

function OrbitSpeedSlider({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  const activeLabel =
    ORBIT_SPEED_PRESETS.find(
      (p) => Math.abs(p.value - value) < ORBIT_SNAP_THRESHOLD,
    )?.label ?? `${value.toFixed(2)}×`;

  function handleChange(vals: number[]) {
    let raw = vals[0];
    for (const preset of ORBIT_SPEED_PRESETS) {
      if (Math.abs(raw - preset.value) < ORBIT_SNAP_THRESHOLD) {
        raw = preset.value;
        break;
      }
    }
    onChange(raw);
  }

  return (
    <div className="flex w-full items-center gap-3.5 rounded-xl px-3 py-2.5 text-left">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/5 text-white/35 ring-1 ring-white/6">
        <RotateCw className="h-4 w-4" />
      </div>
      <div className="flex flex-1 min-w-0 flex-col gap-2">
        <div className="flex items-center justify-between">
          <p className="text-[13px] font-medium text-white/80">Orbit speed</p>
          <span className="text-[11px] font-semibold text-white/40 tabular-nums">
            {activeLabel}
          </span>
        </div>
        <div className="relative">
          <Slider
            min={ORBIT_SPEED_MIN}
            max={ORBIT_SPEED_MAX}
            step={0.01}
            value={[value]}
            onValueChange={handleChange}
            aria-label="Orbit speed"
          />
          <div className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 flex justify-between px-0.5">
            {ORBIT_SPEED_PRESETS.map((preset) => {
              const pct =
                ((preset.value - ORBIT_SPEED_MIN) /
                  (ORBIT_SPEED_MAX - ORBIT_SPEED_MIN)) *
                100;
              const isActive =
                Math.abs(preset.value - value) < ORBIT_SNAP_THRESHOLD;
              return (
                <span
                  key={preset.label}
                  className={`absolute h-1.5 w-1.5 rounded-full -translate-x-1/2 -translate-y-1/2 transition-colors ${
                    isActive ? "bg-white/50" : "bg-white/15"
                  }`}
                  style={{ left: `${pct}%` }}
                />
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function TrailThicknessSlider({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex w-full items-center gap-3.5 rounded-xl px-3 py-2.5 text-left">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/5 text-white/35 ring-1 ring-white/6">
        <Layers className="h-4 w-4" />
      </div>
      <div className="flex flex-1 min-w-0 flex-col gap-2">
        <div className="flex items-center justify-between">
          <p className="text-[13px] font-medium text-white/80">
            Trail thickness
          </p>
          <span className="text-[11px] font-semibold text-white/40 tabular-nums">
            {value.toFixed(1)} px
          </span>
        </div>
        <Slider
          min={TRAIL_THICKNESS_MIN}
          max={TRAIL_THICKNESS_MAX}
          step={0.1}
          value={[value]}
          onValueChange={(vals) => onChange(vals[0])}
          aria-label="Trail thickness"
        />
      </div>
    </div>
  );
}

function TrailDistanceSlider({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex w-full items-center gap-3.5 rounded-xl px-3 py-2.5 text-left">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/5 text-white/35 ring-1 ring-white/6">
        <Route className="h-4 w-4" />
      </div>
      <div className="flex flex-1 min-w-0 flex-col gap-2">
        <div className="flex items-center justify-between">
          <p className="text-[13px] font-medium text-white/80">
            Trail distance
          </p>
          <span className="text-[11px] font-semibold text-white/40 tabular-nums">
            {value} pts
          </span>
        </div>
        <Slider
          min={TRAIL_DISTANCE_MIN}
          max={TRAIL_DISTANCE_MAX}
          step={1}
          value={[value]}
          onValueChange={(vals) => onChange(vals[0])}
          aria-label="Trail distance"
        />
      </div>
    </div>
  );
}

function SettingRow({
  icon,
  title,
  description,
  checked,
  onChange,
  badge,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  badge?: string;
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex w-full items-center gap-3.5 rounded-xl px-3 py-3 text-left transition-colors hover:bg-white/4 active:bg-white/6"
    >
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/5 text-white/35 ring-1 ring-white/6">
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <p className="text-[13px] font-medium text-white/80">{title}</p>
          {badge && (
            <span className="inline-flex items-center rounded-md bg-indigo-500/15 px-1.5 py-0.5 text-[9px] font-bold tracking-wider text-indigo-300 ring-1 ring-indigo-400/20">
              {badge}
            </span>
          )}
        </div>
        <p className="mt-0.5 text-[11px] font-medium leading-relaxed text-white/22">
          {description}
        </p>
      </div>
      <Toggle checked={checked} />
    </button>
  );
}

function SegmentRow<T extends string | number>({
  icon,
  title,
  options,
  value,
  onChange,
}: {
  icon: ReactNode;
  title: string;
  options: { label: string; value: T }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex w-full items-center gap-3.5 rounded-xl px-3 py-2.5 text-left">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/5 text-white/35 ring-1 ring-white/6">
        {icon}
      </div>
      <p className="flex-1 min-w-0 text-[13px] font-medium text-white/80">
        {title}
      </p>
      <div
        role="radiogroup"
        aria-label={title}
        className="flex shrink-0 rounded-md bg-white/4 p-0.5 ring-1 ring-white/6"
      >
        {options.map((opt) => {
          const isActive = opt.value === value;
          return (
            <button
              key={String(opt.value)}
              role="radio"
              aria-checked={isActive}
              onClick={() => onChange(opt.value)}
              className={`relative rounded-md px-2 py-1 text-[11px] font-semibold transition-colors ${
                isActive ? "text-white/90" : "text-white/30 hover:text-white/50"
              }`}
            >
              {isActive && (
                <motion.div
                  layoutId={`seg-${title}`}
                  className="absolute inset-0 rounded-md bg-white/10"
                  transition={{
                    type: "spring",
                    stiffness: 500,
                    damping: 35,
                  }}
                />
              )}
              <span className="relative">{opt.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Toggle({ checked }: { checked: boolean }) {
  return (
    <div
      className={`relative h-5 w-9 shrink-0 rounded-full transition-colors duration-200 ${
        checked ? "bg-white/20" : "bg-white/6"
      }`}
    >
      <motion.div
        animate={{ x: checked ? 17 : 2 }}
        transition={{ type: "spring", stiffness: 500, damping: 30 }}
        className={`absolute top-0.75 h-3.5 w-3.5 rounded-full shadow-sm transition-colors duration-200 ${
          checked ? "bg-white" : "bg-white/25"
        }`}
      />
    </div>
  );
}

const CHANGELOG = [
  {
    date: "Mar 11",
    title: "Globe mode & aircraft photos",
    description:
      "Zoom out to see the entire earth as a 3D sphere with altitude-colored dots for every flight. Trails are now interpolated with centripetal Catmull\u2013Rom splines — a C\u00B9-continuous piecewise cubic that passes through every waypoint without overshooting, using \u03B1\u2009=\u20090.5 parameterization for natural curvature. Dark terrain, aircraft photo banners in flight cards, and a hard dot-to-flight cutover with zero overlap. Globe mode is in beta — find it in Settings.",
  },
  {
    date: "Feb 22",
    title: "Flight history tracking",
    description:
      "Full trail rendering for every tracked flight. Airline logo caching so they actually load.",
  },
  {
    date: "Feb 21",
    title: "First person view",
    description:
      "FPV mode — pick any plane and ride along with a HUD. Also added flight search by callsign.",
  },
  {
    date: "Feb 17",
    title: "Airline logos & attribution",
    description:
      "Proper logos for airlines, and attribution for OSM, OpenSky, CARTO, Esri, and everyone whose data makes this work.",
  },
  {
    date: "Feb 15",
    title: "9,000+ airports",
    description:
      "Went from a handful of cities to every airport we could find. Copilot helped build the dataset. Added keyboard shortcuts and click-to-select.",
  },
  {
    date: "Feb 14",
    title: "Day one",
    description:
      "Basic map, flight cards, trail rendering, orbit camera. Spent most of the day fighting Vercel timeouts and OpenSky IP blocks before realizing the API just supports CORS.",
  },
];

export function AboutContent() {
  return (
    <ScrollArea className="h-full">
      <div className="flex flex-col gap-5 p-5 pt-3">
        <h3 className="text-[20px] font-bold tracking-tight text-white/90">
          Aeris
        </h3>

        <div className="space-y-3 text-[13px] leading-relaxed text-white/40">
          <p>
            Live flight tracking in 3D. The planes you see are real — position
            data comes from the OpenSky Network, updated every few seconds via
            ADS-B receivers people run on their roofs worldwide.
          </p>
          <p>
            You can search through 9,000+ airports, jump into first-person view
            to ride along with any plane, or just leave it on a screen and watch
            things move. Trails change color with altitude so you can tell
            who&apos;s cruising at 35,000ft and who&apos;s on approach.
          </p>
        </div>

        <div className="h-px w-full bg-white/6" />

        <p className="text-[12px] leading-relaxed text-white/30">
          Built by{" "}
          <a
            href="https://github.com/kewonit"
            target="_blank"
            rel="noopener noreferrer"
            className="text-white/55 underline decoration-white/15 underline-offset-2 hover:text-white/70 transition-colors"
          >
            kewonit
          </a>
          . Open to internships —{" "}
          <a
            href="mailto:kew@edbn.me"
            className="text-white/55 underline decoration-white/15 underline-offset-2 hover:text-white/70 transition-colors"
          >
            kew@edbn.me
          </a>
        </p>
        <p className="text-[12px] leading-relaxed text-white/30">
          Source is on{" "}
          <a
            href="https://github.com/kewonit/aeris"
            target="_blank"
            rel="noopener noreferrer"
            className="text-white/55 underline decoration-white/15 underline-offset-2 hover:text-white/70 transition-colors"
          >
            GitHub
          </a>
          . Got a question or just wanna say hi?{" "}
          <a
            href="mailto:aeris@edbn.me"
            className="text-white/55 underline decoration-white/15 underline-offset-2 hover:text-white/70 transition-colors"
          >
            aeris@edbn.me
          </a>
        </p>
      </div>
    </ScrollArea>
  );
}

export function ChangelogContent() {
  return (
    <ScrollArea className="h-full">
      <div className="flex flex-col gap-4 p-5 pt-3">
        {CHANGELOG.map((entry) => (
          <div key={entry.date} className="flex gap-3">
            <span className="shrink-0 pt-0.5 text-[11px] tabular-nums text-white/20 w-11">
              {entry.date}
            </span>
            <div className="min-w-0">
              <p className="text-[13px] font-medium text-white/55">
                {entry.title}
              </p>
              <p className="mt-0.5 text-[12px] leading-relaxed text-white/30">
                {entry.description}
              </p>
            </div>
          </div>
        ))}
      </div>
    </ScrollArea>
  );
}
