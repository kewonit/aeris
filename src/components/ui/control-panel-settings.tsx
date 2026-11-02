"use client";

import type { ReactNode } from "react";
import { motion } from "motion/react";
import { SNAP } from "@/lib/motion";
import {
  ArrowUpToLine,
  RotateCw,
  Route,
  Layers,
  Palette,
  Globe,
  ArrowLeftRight,
  Ruler,
  Shield,
  Eye,
  CloudRain,
  Cpu,
} from "lucide-react";
import {
  useSettings,
  AIRSPACE_OPACITY_MIN,
  AIRSPACE_OPACITY_MAX,
  WEATHER_RADAR_OPACITY_MIN,
  WEATHER_RADAR_OPACITY_MAX,
  TRAIL_THICKNESS_MIN,
  TRAIL_THICKNESS_MAX,
  TRAIL_MINUTES_MIN,
  TRAIL_MINUTES_MAX,
  TRAIL_CEILING_FT_MIN,
  TRAIL_CEILING_FT_MAX,
  TRAIL_CEILING_FT_STEP,
  type OrbitDirection,
  type UnitSystem,
  type Settings,
} from "@/hooks/use-settings";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Slider } from "@/components/ui/slider";
import { formatAltitude } from "@/lib/unit-formatters";
import { SwitchTrack } from "@/components/ui/switch";
import { Kbd } from "@/components/ui/kbd";

const SHORTCUTS = [
  { key: "N", description: "North up" },
  { key: "R", description: "Reset view" },
  { key: "O", description: "Toggle orbit" },
  { key: "/", description: "Open search" },
  { key: "⌘K", description: "Open search (anywhere)" },
  { key: "F", description: "Follow the open aircraft" },
  { key: "V", description: "First person view" },
  { key: "?", description: "Shortcuts help" },
  { key: "A", description: "Air traffic control" },
  { key: "T", description: "Traffic trails" },
  { key: "Esc", description: "Close / Deselect" },
] as const;

const ORBIT_SPEED_PRESETS = [
  { label: "Slow", value: 0.06 },
  { label: "Normal", value: 0.15 },
  { label: "Fast", value: 0.35 },
];

const ORBIT_SPEED_MIN = 0.02;
const ORBIT_SPEED_MAX = 0.5;
const ORBIT_SNAP_THRESHOLD = 0.025;
const ORBIT_DIRECTIONS: { label: string; value: OrbitDirection }[] = [
  { label: "Clockwise", value: "clockwise" },
  { label: "Counter", value: "counter-clockwise" },
];

const ALTITUDE_DISPLAY_MODES: {
  label: string;
  value: Settings["altitudeDisplayMode"];
}[] = [
  { label: "Presentation", value: "presentation" },
  { label: "Realistic", value: "realistic" },
];

const UNIT_SYSTEMS: { label: string; value: UnitSystem }[] = [
  { label: "Aviation", value: "aviation" },
  { label: "Metric", value: "metric" },
  { label: "Imperial", value: "imperial" },
];

export function SettingsContent({
  airspaceAvailable = true,
}: {
  airspaceAvailable?: boolean;
}) {
  const { settings, update, reset } = useSettings();
  const showAirspace = airspaceAvailable && settings.showAirspace;

  return (
    <ScrollArea className="h-full">
      <div className="space-y-0.5 p-3 pt-1">
        {/* ── Camera ── */}
        <SectionHeader title="Camera" />

        <SettingRow
          icon={<RotateCw className="h-4 w-4" />}
          title="Auto-orbit"
          description="Uses more battery"
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

        {/* ── Visuals ── */}
        <SectionHeader title="Visuals" />

        <SettingRow
          icon={<Route className="h-4 w-4" />}
          title="Traffic trails"
          description="When off, only the aircraft you open shows its trail"
          checked={settings.showTrails}
          onChange={(v) => update("showTrails", v)}
        />
        <TrailThicknessSlider
          value={settings.trailThickness}
          onChange={(v) => update("trailThickness", v)}
        />
        <TrailLengthSlider
          value={settings.trailMinutes}
          onChange={(v) => update("trailMinutes", v)}
        />
        {settings.showTrails && (
          <>
            <SettingRow
              icon={<ArrowUpToLine className="h-4 w-4" />}
              title="Hide high trails"
                  checked={settings.hideHighTrails}
              onChange={(v) => update("hideHighTrails", v)}
            />
            {settings.hideHighTrails && (
              <TrailCeilingSlider
                value={settings.trailCeilingFt}
                unitSystem={settings.unitSystem}
                onChange={(v) => update("trailCeilingFt", v)}
              />
            )}
          </>
        )}
        <SettingRow
          icon={<Layers className="h-4 w-4" />}
          title="Ground shadows"
          checked={settings.showShadows}
          onChange={(v) => update("showShadows", v)}
        />
        <SettingRow
          icon={<Palette className="h-4 w-4" />}
          title="Altitude colors"
          checked={settings.showAltitudeColors}
          onChange={(v) => update("showAltitudeColors", v)}
        />
        <SettingRow
          icon={<Layers className="h-4 w-4" />}
          title="Solid panels"
          description="No see-through behind the search field and map buttons"
          checked={settings.solidPanels}
          onChange={(v) => update("solidPanels", v)}
        />
        <SegmentRow
          icon={<Eye className="h-4 w-4" />}
          title="Altitude mode"
          options={ALTITUDE_DISPLAY_MODES}
          value={settings.altitudeDisplayMode}
          onChange={(v) => update("altitudeDisplayMode", v)}
        />

        {/* ── Units ── */}
        <SectionHeader title="Units" />

        <SegmentRow
          icon={<Ruler className="h-4 w-4" />}
          title="Unit system"
          options={UNIT_SYSTEMS}
          value={settings.unitSystem}
          onChange={(v) => update("unitSystem", v)}
        />

        {/* ── Airspace ── */}
        <SectionHeader title="Airspace" />

        {/* Without an OpenAIP key there is no airspace to offer, so the
            row is left out rather than shown switched off. */}
        {airspaceAvailable && (
          <SettingRow
            icon={<Shield className="h-4 w-4" />}
            title="Airspace"
            description="Classes and boundaries, from OpenAIP"
            checked={showAirspace}
            onChange={(v) => update("showAirspace", v)}
          />
        )}

        {showAirspace && (
          <AirspaceOpacitySlider
            value={settings.airspaceOpacity}
            onChange={(v) => update("airspaceOpacity", v)}
          />
        )}

        {/* ── Weather ── */}
        <SectionHeader title="Weather" />

        <SettingRow
          icon={<CloudRain className="h-4 w-4" />}
          title="Weather radar"
          description="From RainViewer"
          checked={settings.showWeatherRadar}
          onChange={(v) => update("showWeatherRadar", v)}
        />

        {settings.showWeatherRadar && (
          <WeatherRadarOpacitySlider
            value={settings.weatherRadarOpacity}
            onChange={(v) => update("weatherRadarOpacity", v)}
          />
        )}

        {/* ── Performance ── */}
        <SectionHeader title="Performance" />

        <SettingRow
          icon={<Globe className="h-4 w-4" />}
          title="Globe"
          description="The earth as a sphere when zoomed out"
          checked={settings.globeMode}
          onChange={(v) => update("globeMode", v)}
          badge="Beta"
        />

        {/* ── Advanced ── */}
        <SectionHeader title="Advanced" />

        <SettingRow
          icon={<Cpu className="h-4 w-4" />}
          title="Signal details"
          description="NACp, NIC and ADS-B version in an aircraft's details"
          checked={settings.showDebugData}
          onChange={(v) => update("showDebugData", v)}
        />

        <div className="mx-3 my-2 h-px bg-accent" />

        <div className="px-3 pt-2">
          <button
            type="button"
            onClick={reset}
            className="inline-flex h-8 items-center justify-center rounded-md px-3 text-label text-muted-foreground ring-1 ring-border transition-colors hover:bg-card hover:text-foreground"
          >
            Reset to defaults
          </button>
        </div>

        <div className="mx-3 my-2 h-px bg-accent" />
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
              className="flex items-center justify-between gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-card"
            >
              <span className="text-small text-muted-foreground">
                {description}
              </span>
              <Kbd>{key}</Kbd>
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
    <div className="flex w-full items-center gap-3.5 rounded-lg px-3 py-2.5 text-left">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-card text-muted-foreground ring-1 ring-border">
        <RotateCw className="h-4 w-4" />
      </div>
      <div className="flex flex-1 min-w-0 flex-col gap-2">
        <div className="flex items-center justify-between">
          <p className="text-small text-foreground">
            Orbit speed
          </p>
          <span className="text-label text-muted-foreground">
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
                    isActive ? "bg-subtle" : "bg-border"
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
    <div className="flex w-full items-center gap-3.5 rounded-lg px-3 py-2.5 text-left">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-card text-muted-foreground ring-1 ring-border">
        <Layers className="h-4 w-4" />
      </div>
      <div className="flex flex-1 min-w-0 flex-col gap-2">
        <div className="flex items-center justify-between">
          <p className="text-small text-foreground">
            Trail thickness
          </p>
          <span className="text-label text-muted-foreground">
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

function TrailLengthSlider({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex w-full items-center gap-3.5 rounded-lg px-3 py-2.5 text-left">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-card text-muted-foreground ring-1 ring-border">
        <Route className="h-4 w-4" />
      </div>
      <div className="flex flex-1 min-w-0 flex-col gap-2">
        <div className="flex items-center justify-between">
          <p className="text-small text-foreground">
            Trail length
          </p>
          <span className="text-label text-muted-foreground">
            {value} min
          </span>
        </div>
        <Slider
          min={TRAIL_MINUTES_MIN}
          max={TRAIL_MINUTES_MAX}
          step={1}
          value={[value]}
          onValueChange={(vals) => onChange(vals[0])}
          aria-label="Trail length"
        />
      </div>
    </div>
  );
}

function TrailCeilingSlider({
  value,
  unitSystem,
  onChange,
}: {
  value: number;
  unitSystem: UnitSystem;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex w-full items-center gap-3.5 rounded-lg px-3 py-2.5 text-left">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-card text-muted-foreground ring-1 ring-border">
        <ArrowUpToLine className="h-4 w-4" />
      </div>
      <div className="flex flex-1 min-w-0 flex-col gap-2">
        <div className="flex items-center justify-between">
          <p className="text-small text-foreground">Hide above</p>
          <span className="text-label text-muted-foreground">
            {formatAltitude(value * 0.3048, unitSystem)}
          </span>
        </div>
        <Slider
          min={TRAIL_CEILING_FT_MIN}
          max={TRAIL_CEILING_FT_MAX}
          step={TRAIL_CEILING_FT_STEP}
          value={[value]}
          onValueChange={(vals) => onChange(vals[0])}
          aria-label="Hide trails above"
        />
      </div>
    </div>
  );
}

function AirspaceOpacitySlider({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex w-full items-center gap-3.5 rounded-lg px-3 py-2.5 text-left">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-card text-muted-foreground ring-1 ring-border">
        <Eye className="h-4 w-4" />
      </div>
      <div className="flex flex-1 min-w-0 flex-col gap-2">
        <div className="flex items-center justify-between">
          <p className="text-small text-foreground">
            Airspace opacity
          </p>
          <span className="text-label text-muted-foreground">
            {Math.round(value * 100)}%
          </span>
        </div>
        <Slider
          min={AIRSPACE_OPACITY_MIN}
          max={AIRSPACE_OPACITY_MAX}
          step={0.05}
          value={[value]}
          onValueChange={(vals) => onChange(vals[0])}
          aria-label="Airspace opacity"
        />
      </div>
    </div>
  );
}

function WeatherRadarOpacitySlider({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex w-full items-center gap-3.5 rounded-lg px-3 py-2.5 text-left">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-card text-muted-foreground ring-1 ring-border">
        <CloudRain className="h-4 w-4" />
      </div>
      <div className="flex flex-1 min-w-0 flex-col gap-2">
        <div className="flex items-center justify-between">
          <p className="text-small text-foreground">
            Radar opacity
          </p>
          <span className="text-label text-muted-foreground">
            {Math.round(value * 100)}%
          </span>
        </div>
        <Slider
          min={WEATHER_RADAR_OPACITY_MIN}
          max={WEATHER_RADAR_OPACITY_MAX}
          step={0.05}
          value={[value]}
          onValueChange={(vals) => onChange(vals[0])}
          aria-label="Weather radar opacity"
        />
      </div>
    </div>
  );
}

function SectionHeader({ title }: { title: string }) {
  return (
    <div className="flex items-center gap-2 px-3 pt-3 pb-1">
      <span className="text-micro text-subtle">
        {title}
      </span>
      <div className="h-px flex-1 bg-accent" />
    </div>
  );
}

function SettingRow({
  icon,
  title,
  description,
  checked,
  onChange,
  disabled = false,
  badge,
}: {
  icon: ReactNode;
  title: string;
  description?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  badge?: string;
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-disabled={disabled}
      disabled={disabled}
      onClick={() => {
        if (!disabled) onChange(!checked);
      }}
      className={`flex w-full items-center gap-3.5 rounded-lg px-3 py-3 text-left transition-colors ${
        disabled
          ? "cursor-not-allowed opacity-60"
          : "hover:bg-card active:bg-card"
      }`}
    >
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-card text-muted-foreground ring-1 ring-border">
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <p className="text-small text-foreground">{title}</p>
          {badge && (
            <span className="text-label text-tint">{badge}</span>
          )}
        </div>
        {description && (
          <p className="mt-0.5 text-label text-subtle">
            {description}
          </p>
        )}
      </div>
      <SwitchTrack checked={checked} />
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
    <div className="flex w-full items-center gap-3.5 rounded-lg px-3 py-2.5 text-left">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-card text-muted-foreground ring-1 ring-border">
        {icon}
      </div>
      <p className="flex-1 min-w-0 text-small text-foreground">
        {title}
      </p>
      <div
        role="radiogroup"
        aria-label={title}
        className="flex shrink-0 rounded-sm bg-card p-0.5 ring-1 ring-border"
      >
        {options.map((opt) => {
          const isActive = opt.value === value;
          return (
            <button
              key={String(opt.value)}
              role="radio"
              aria-checked={isActive}
              onClick={() => onChange(opt.value)}
              className={`relative rounded-sm px-2 py-1 text-label transition-colors ${
                isActive
                  ? "text-foreground"
                  : "text-subtle hover:text-muted-foreground"
              }`}
            >
              {isActive && (
                <motion.div
                  layoutId={`seg-${title}`}
                  className="absolute inset-0 rounded-sm bg-accent"
                  transition={SNAP}
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

export const CHANGELOG: {
  version: string;
  date: string;
  entries: { title: string; description: string }[];
}[] = [
  {
    version: "0.9.0",
    date: "Nov 2, 2026",
    entries: [
      { title: "Every aircraft in a sentence", description: "What it is doing and where it is going, in one line: “Descending into BOM, about 14 min out”." },
      { title: "One card", description: "Aircraft and airports open in one card: a sheet on phones, a floating panel on desktop." },
      { title: "Follow", description: "Follow an aircraft from its card or with F. First person moved to V." },
      { title: "One search", description: "Flights, airports and places from one field, opened straight from the results." },
      { title: "A quieter map", description: "Search, a map menu, locate, a compass, one status line and the altitude key. Nothing else at rest." },
      { title: "Hover", description: "With a mouse, rest on an aircraft to see what it is doing." },
      { title: "Altitude colours", description: "Low traffic reads on light maps, and cruise is no longer the dimmest band on dark ones." },
      { title: "Links", description: "Share a link that opens an aircraft, follows it, or opens an airport." },
      { title: "Smooth motion", description: "Aircraft no longer race, spin or jump when the map loads, the feed changes or you come back to the tab. New aircraft fly from the moment they appear." },
      { title: "A real globe", description: "On the globe, aircraft and trails sit on the sphere at every zoom, and the globe stays on from the first frame." },
      { title: "Steady trails", description: "Trails and aircraft have smooth edges, and trails run into their aircraft without jumping when a new position arrives." },
      { title: "Traffic trails", description: "Turn trails off from the altitude key or with T. The aircraft you open keeps its trail." },
      { title: "Fixes", description: "Airport weather shows cloud heights and flight category correctly, and aircraft passing high overhead are no longer counted as arriving. One type scale throughout. Next.js 16.4.3, deck.gl 9.4 and MapLibre 5.24." },
    ],
  },
  {
    version: "0.8.9",
    date: "Oct 18, 2026",
    entries: [
      { title: "More accurate routes", description: "Routes come from community route data first, and only ones the aircraft could be flying are shown." },
      { title: "Realistic flight", description: "Aircraft pitch, bank and turn as real ones do, at a steady speed between reports." },
      { title: "First person view rebuilt", description: "The camera rides close behind the aircraft and flies on when reports drop out." },
      { title: "Steadier trails", description: "Trails keep their shape and meet the aircraft cleanly. Their length is set in minutes." },
      { title: "Better-proportioned aircraft", description: "Aircraft are sized from their wingspan and stay in proportion at every zoom." },
      { title: "Quicker receivers", description: "The fastest receiver is asked first, and a slow one never holds the map up." },
      { title: "One design system", description: "One type scale, palette and set of surfaces in light and dark." },
      { title: "Aircraft details", description: "Each aircraft is named, like Boeing 767-332, and says where its details came from." },
      { title: "Fixes", description: "Rotate buttons turn the right way, and polling recovers when every provider times out." },
    ],
  },
  {
    version: "0.8.8",
    date: "Aug 23, 2026",
    entries: [
      { title: "More feeds", description: "adsb.fi and Airplanes.live join adsb.lol and OpenSky, with one fallback order everywhere." },
      { title: "Instant switching", description: "Changing feeds refreshes the map at once and keeps the last aircraft on screen." },
    ],
  },
  {
    version: "0.8.7",
    date: "Jul 18, 2026",
    entries: [
      { title: "Install and share", description: "Full icon sets for installing the app, and better city pages and link previews." },
    ],
  },
  {
    version: "0.8.6",
    date: "Jul 11, 2026",
    entries: [
      { title: "Faster rendering", description: "Renderer CPU fell from about 173% to 24% at JFK. Auto-orbit is now opt-in." },
    ],
  },
  {
    version: "0.8.5",
    date: "Jun 24, 2026",
    entries: [
      { title: "Fix", description: "Opening Settings, About or the changelog no longer logs a React warning." },
    ],
  },
  {
    version: "0.8.4",
    date: "May 12, 2026",
    entries: [
      { title: "Worldwide search", description: "Find any live flight by callsign, flight number or address, and any airport or place." },
      { title: "Route lookup", description: "Origin and destination come from flight-plan data, cached." },
      { title: "Light Annotated", description: "A light map style with place names." },
      { title: "Readability", description: "Higher contrast throughout the control panel." },
    ],
  },
  {
    version: "0.8.3",
    date: "Apr 21, 2026",
    entries: [
      { title: "Airport cards", description: "Arrivals, departures, weather, runways, frequencies and a photo for each airport." },
      { title: "Units", description: "Aviation, metric or imperial units, everywhere." },
      { title: "Lighter overlays", description: "Airspace and weather radar load only around where you are looking, and stay put." },
    ],
  },
  {
    version: "0.8.2",
    date: "Apr 12, 2026",
    entries: [
      { title: "Fixes", description: "More accurate origins and destinations, and no more airports at 0°, 0°. Next.js 16.2.3." },
    ],
  },
  {
    version: "0.8.1",
    date: "Apr 13, 2026",
    entries: [
      { title: "Locate and full screen", description: "Fly to where you are, or go full screen." },
      { title: "Aircraft type", description: "Cards show the aircraft type and registration." },
    ],
  },
  {
    version: "0.8.0",
    date: "Apr 12, 2026",
    entries: [
      { title: "Trails rebuilt", description: "Steadier, cleaner trails from a server trace service with fallbacks." },
      { title: "Routes and photos", description: "Departure airports from each trail, aircraft details and photos." },
    ],
  },
  {
    version: "0.7.0",
    date: "Mar 29, 2026",
    entries: [
      { title: "Weather and airspace", description: "Live precipitation radar and classified airspace overlays." },
      { title: "Dark mode", description: "Consistent colours across every panel in dark mode." },
    ],
  },
  {
    version: "0.6.2",
    date: "Mar 25, 2026",
    entries: [
      { title: "Discoverability", description: "Sitemap, link previews and a 404 page." },
    ],
  },
  {
    version: "0.6.1",
    date: "Mar 24, 2026",
    entries: [
      { title: "635 ATC feeds", description: "Live air traffic control from airports on every continent." },
    ],
  },
  {
    version: "0.6.0",
    date: "Mar 22, 2026",
    entries: [
      { title: "3D aircraft", description: "Fourteen aircraft models, matched to each aircraft's type." },
      { title: "More reliable data", description: "Falls back to another feed when one fails, without wiping the map." },
      { title: "Live ATC", description: "Listen to nearby air traffic control." },
    ],
  },
  {
    version: "0.5.0",
    date: "Mar 10, 2026",
    entries: [
      { title: "Globe", description: "Zoom out to the whole earth, with every flight as a dot. Aircraft photos in cards." },
    ],
  },
  {
    version: "0.4.1",
    date: "Feb 22, 2026",
    entries: [
      { title: "Flight history", description: "Full trails for every tracked flight." },
    ],
  },
  {
    version: "0.4.0",
    date: "Feb 21, 2026",
    entries: [
      { title: "First person view", description: "Ride along with any aircraft. Search by callsign." },
    ],
  },
  {
    version: "0.3.0",
    date: "Feb 17, 2026",
    entries: [
      { title: "Airline logos", description: "Logos for airlines, and credits for every data source." },
    ],
  },
  {
    version: "0.2.0",
    date: "Feb 15, 2026",
    entries: [
      { title: "9,000+ airports", description: "Every airport, keyboard shortcuts, and click to select." },
    ],
  },
  {
    version: "0.1.0",
    date: "Feb 14, 2026",
    entries: [
      { title: "Day one", description: "A live map, flight cards, trails and an orbiting camera." },
    ],
  },
];

export function AboutContent() {
  return (
    <ScrollArea className="h-full">
      <div className="flex flex-col gap-5 p-5 pt-3">
        <h3 className="text-value text-foreground">
          Aeris
        </h3>

        <div className="space-y-3 text-small text-muted-foreground">
          <p>
            Live flight tracking in 3D. The planes you see are real. Position
            data comes from adsb.lol, adsb.fi, airplanes.live, and OpenSky
            Network, updated every few seconds via ADS-B receivers people run
            on their roofs worldwide.
          </p>
          <p>
            You can search through 9,000+ airports, jump into first-person view
            to ride along with any plane, or just leave it on a screen and watch
            things move. Trails change color with altitude so you can tell
            who&apos;s cruising at 35,000ft and who&apos;s on approach.
          </p>
        </div>

        <div className="h-px w-full bg-accent" />

        <p className="text-label text-subtle">
          Built by a human, not just LLMs.{" "}
          <a
            href="https://github.com/kewonit"
            target="_blank"
            rel="noopener noreferrer"
            className="text-muted-foreground underline decoration-foreground/20 underline-offset-2 hover:text-foreground transition-colors"
          >
            kewonit
          </a>
          . Open to internships —{" "}
          <a
            href="mailto:kew@edbn.me"
            className="text-muted-foreground underline decoration-foreground/20 underline-offset-2 hover:text-foreground transition-colors"
          >
            kew@edbn.me
          </a>
        </p>
        <p className="text-label text-subtle">
          Source is on{" "}
          <a
            href="https://github.com/kewonit/aeris"
            target="_blank"
            rel="noopener noreferrer"
            className="text-muted-foreground underline decoration-foreground/20 underline-offset-2 hover:text-foreground transition-colors"
          >
            GitHub
          </a>
          . Got a question or just wanna say hi?{" "}
          <a
            href="mailto:aeris@edbn.me"
            className="text-muted-foreground underline decoration-foreground/20 underline-offset-2 hover:text-foreground transition-colors"
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
      <div className="flex flex-col gap-5 py-5 pl-5 pr-10 pt-3">
        {CHANGELOG.map((release, i) => (
          <div key={release.version}>
            {i > 0 && <div className="mb-5 h-px w-full bg-accent" />}
            <div className="mb-3 flex items-baseline gap-2">
              <span className="text-small text-foreground">
                v{release.version}
              </span>
              <span className="text-label text-subtle">
                {release.date}
              </span>
            </div>
            <div className="flex flex-col gap-3 pl-0.5">
              {release.entries.map((entry, j) => (
                <div key={j} className="min-w-0">
                  <p className="text-small text-foreground">
                    {entry.title}
                  </p>
                  <p className="mt-0.5 text-label text-muted-foreground">
                    {entry.description}
                  </p>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </ScrollArea>
  );
}
