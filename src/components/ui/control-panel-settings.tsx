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
  Ruler,
  Shield,
  Flame,
  Eye,
  CloudRain,
} from "lucide-react";
import {
  useSettings,
  AIRSPACE_OPACITY_MIN,
  AIRSPACE_OPACITY_MAX,
  WEATHER_RADAR_OPACITY_MIN,
  WEATHER_RADAR_OPACITY_MAX,
  type OrbitDirection,
  type UnitSystem,
  type Settings,
} from "@/hooks/use-settings";
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
const TRAIL_DISTANCE_MAX = 120;

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

export function SettingsContent() {
  const { settings, update, reset } = useSettings();

  return (
    <ScrollArea className="h-full">
      <div className="space-y-0.5 p-3 pt-1">
        {/* ── Camera ── */}
        <SectionHeader title="Camera" />

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

        {/* ── Visuals ── */}
        <SectionHeader title="Visuals" />

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

        <SettingRow
          icon={<Shield className="h-4 w-4" />}
          title="Airspace overlay"
          description="Show classified airspace boundaries (OpenAIP)"
          checked={settings.showAirspace}
          onChange={(v) => update("showAirspace", v)}
        />

        {settings.showAirspace && (
          <>
            <AirspaceOpacitySlider
              value={settings.airspaceOpacity}
              onChange={(v) => update("airspaceOpacity", v)}
            />
            <SettingRow
              icon={<Flame className="h-4 w-4" />}
              title="Thermal hotspots"
              description="Glider & paraglider thermal activity areas"
              checked={settings.showAirspaceHotspots}
              onChange={(v) => update("showAirspaceHotspots", v)}
            />
          </>
        )}

        {/* ── Weather ── */}
        <SectionHeader title="Weather" />

        <SettingRow
          icon={<CloudRain className="h-4 w-4" />}
          title="Weather radar"
          description="Live precipitation radar overlay (RainViewer)"
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
          title="Globe mode"
          description="Display earth as a 3D sphere when zoomed out"
          checked={settings.globeMode}
          onChange={(v) => update("globeMode", v)}
          badge="BETA"
        />

        <div className="mx-3 my-2 h-px bg-foreground/5" />

        <div className="px-3 pt-2">
          <button
            type="button"
            onClick={reset}
            className="inline-flex h-8 items-center justify-center rounded-lg px-3 text-[12px] font-medium text-foreground/65 ring-1 ring-foreground/10 transition-colors hover:bg-foreground/5 hover:text-foreground/85"
          >
            Reset to defaults
          </button>
        </div>

        <div className="mx-3 my-2 h-px bg-foreground/5" />
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
              className="flex items-center justify-between gap-3 rounded-xl px-3 py-2.5 transition-colors hover:bg-foreground/4"
            >
              <span className="text-[13px] font-medium text-foreground/68">
                {description}
              </span>
              <kbd className="flex h-7 min-w-7 items-center justify-center rounded-md bg-foreground/6 px-2 font-mono text-[11px] font-semibold text-foreground/74 ring-1 ring-foreground/8">
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
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-foreground/5 text-foreground/35 ring-1 ring-foreground/6">
        <RotateCw className="h-4 w-4" />
      </div>
      <div className="flex flex-1 min-w-0 flex-col gap-2">
        <div className="flex items-center justify-between">
          <p className="text-[13px] font-medium text-foreground/80">
            Orbit speed
          </p>
          <span className="text-[11px] font-semibold text-foreground/40 tabular-nums">
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
                    isActive ? "bg-foreground/50" : "bg-foreground/15"
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
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-foreground/5 text-foreground/35 ring-1 ring-foreground/6">
        <Layers className="h-4 w-4" />
      </div>
      <div className="flex flex-1 min-w-0 flex-col gap-2">
        <div className="flex items-center justify-between">
          <p className="text-[13px] font-medium text-foreground/80">
            Trail thickness
          </p>
          <span className="text-[11px] font-semibold text-foreground/40 tabular-nums">
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
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-foreground/5 text-foreground/35 ring-1 ring-foreground/6">
        <Route className="h-4 w-4" />
      </div>
      <div className="flex flex-1 min-w-0 flex-col gap-2">
        <div className="flex items-center justify-between">
          <p className="text-[13px] font-medium text-foreground/80">
            Trail distance
          </p>
          <span className="text-[11px] font-semibold text-foreground/40 tabular-nums">
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

function AirspaceOpacitySlider({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex w-full items-center gap-3.5 rounded-xl px-3 py-2.5 text-left">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-foreground/5 text-foreground/35 ring-1 ring-foreground/6">
        <Eye className="h-4 w-4" />
      </div>
      <div className="flex flex-1 min-w-0 flex-col gap-2">
        <div className="flex items-center justify-between">
          <p className="text-[13px] font-medium text-foreground/80">
            Airspace opacity
          </p>
          <span className="text-[11px] font-semibold text-foreground/40 tabular-nums">
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
    <div className="flex w-full items-center gap-3.5 rounded-xl px-3 py-2.5 text-left">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-foreground/5 text-foreground/35 ring-1 ring-foreground/6">
        <CloudRain className="h-4 w-4" />
      </div>
      <div className="flex flex-1 min-w-0 flex-col gap-2">
        <div className="flex items-center justify-between">
          <p className="text-[13px] font-medium text-foreground/80">
            Radar opacity
          </p>
          <span className="text-[11px] font-semibold text-foreground/40 tabular-nums">
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
      <span className="text-[10px] font-bold tracking-widest text-foreground/25 uppercase">
        {title}
      </span>
      <div className="h-px flex-1 bg-foreground/4" />
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
      className="flex w-full items-center gap-3.5 rounded-xl px-3 py-3 text-left transition-colors hover:bg-foreground/4 active:bg-foreground/6"
    >
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-foreground/5 text-foreground/35 ring-1 ring-foreground/6">
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <p className="text-[13px] font-medium text-foreground/80">{title}</p>
          {badge && (
            <span className="inline-flex items-center rounded-md bg-indigo-500/15 px-1.5 py-0.5 text-[9px] font-bold tracking-wider text-indigo-300 ring-1 ring-indigo-400/20">
              {badge}
            </span>
          )}
        </div>
        <p className="mt-0.5 text-[11px] font-medium leading-relaxed text-foreground/22">
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
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-foreground/5 text-foreground/35 ring-1 ring-foreground/6">
        {icon}
      </div>
      <p className="flex-1 min-w-0 text-[13px] font-medium text-foreground/80">
        {title}
      </p>
      <div
        role="radiogroup"
        aria-label={title}
        className="flex shrink-0 rounded-md bg-foreground/4 p-0.5 ring-1 ring-foreground/6"
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
                isActive
                  ? "text-foreground/90"
                  : "text-foreground/30 hover:text-foreground/50"
              }`}
            >
              {isActive && (
                <motion.div
                  layoutId={`seg-${title}`}
                  className="absolute inset-0 rounded-md bg-foreground/10"
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
        checked ? "bg-foreground/20" : "bg-foreground/6"
      }`}
    >
      <motion.div
        animate={{ x: checked ? 17 : 2 }}
        transition={{ type: "spring", stiffness: 500, damping: 30 }}
        className={`absolute top-0.75 h-3.5 w-3.5 rounded-full shadow-sm transition-colors duration-200 ${
          checked ? "bg-foreground" : "bg-foreground/25"
        }`}
      />
    </div>
  );
}

const CHANGELOG: {
  version: string;
  date: string;
  entries: { title: string; description: string }[];
}[] = [
  {
    version: "0.8.2",
    date: "Apr 12, 2026",
    entries: [
      {
        title: "Route accuracy & React 19 fixes",
        description:
          "Origin/destination now prioritises flight-plan database lookups over heuristic trace matching, fixing incorrect airport assignments. Eliminated fallback airports at 0°/0° when hexdb lookups fail. Replaced next-themes with @wrksz/themes to resolve React 19 script-tag rendering warning. Fixed fullscreen button hydration mismatch. Updated Next.js to 16.2.3.",
      },
    ],
  },
  {
    version: "0.8.1",
    date: "Jun 25, 2025",
    entries: [
      {
        title: "Geolocation & fullscreen controls",
        description:
          "New 'Fly to Me' button uses browser geolocation to center the map on your current location. Fullscreen toggle button for distraction-free viewing. Both controls added to the camera control panel.",
      },
      {
        title: "Aircraft type & registration display",
        description:
          "Flight cards now show the specific aircraft type description (e.g. 'AIRBUS A-320') when available from ADS-B data, instead of the generic category hint. Registration numbers displayed with ICAO type codes on both desktop and mobile views.",
      },
    ],
  },
  {
    version: "0.8.0",
    date: "Apr 12, 2026",
    entries: [
      {
        title: "Trail system v2 — rendering, geometry & data pipeline",
        description:
          "Complete trail overhaul: server trace service with multi-provider fallback, sealed-segment display geometry that keeps the fixed trail body stable across live appends, cusp and backtrack removal, needle-kink filtering, and holding-pattern preservation. Connector rendering follows the recent tail arc. Live trail retention raised beyond 120 points. Altitude-aware color caching, opacity fading, and zoom-linked elevation smoothing.",
      },
      {
        title: "Route detection, aircraft photos & metadata",
        description:
          "New route detection system identifies departure airports from trail data. hexdb API integration provides aircraft metadata (type, registration, owner). Aircraft photo fetching with negative-cache backoff. Improved flight card and mobile toast UI.",
      },
      {
        title: "Altitude calibration and trace fallback hardening",
        description:
          "Refined altitude presentation so realistic mode recovers to full height sooner at operational zoom levels, while presentation mode maintains a clearer vertical lift. Reduced 3D aircraft model size with zoom-compensated scaling for more balanced on-map proportions. Browser-direct readsb trace fetching now treats malformed JSON responses as provider failures and falls back to the next candidate URL instead of aborting the request.",
      },
    ],
  },
  {
    version: "0.7.0",
    date: "Mar 29, 2026",
    entries: [
      {
        title: "Weather radar & airspace overlays",
        description:
          "Live precipitation radar from RainViewer with adjustable opacity. Classified airspace boundaries from OpenAIP with thermal hotspot indicators for glider and paraglider activity. ATC audio spectrum visualizer and airport board hook for departure/arrival data.",
      },
      {
        title: "UI theming overhaul",
        description:
          "Refactored color schemes across FPV HUD, hero banner, keyboard shortcuts, mobile toast, provider panel, scroll area, and slider to use foreground/background theme variables for consistent dark mode support. Improved readability and accessibility throughout.",
      },
      {
        title: "Flight data parsing & trail quality",
        description:
          "Extended FlightState with avionics data (IAS, TAS, Mach, roll, track rate, magnetic heading) and navigation intent fields. Improved GPS outlier filtering and loop cleaning in trail history. Last-leg trimming and nearest airport search for better route context.",
      },
    ],
  },
  {
    version: "0.6.2",
    date: "Mar 25, 2026",
    entries: [
      {
        title: "SEO & discoverability",
        description:
          "Added robots.txt, XML sitemap, and web app manifest. OpenGraph and Twitter card images generated server-side. Custom 404 page. Enhanced metadata across all routes for better search engine indexing.",
      },
    ],
  },
  {
    version: "0.6.1",
    date: "Mar 24, 2026",
    entries: [
      {
        title: "635 ATC feeds worldwide",
        description:
          "Expanded the static ATC feed database from a handful of airports to 635 across all continents with verified LiveATC mount points. Coverage now spans North America, Europe, Asia-Pacific, South America, Africa, and the Middle East.",
      },
    ],
  },
  {
    version: "0.6.0",
    date: "Mar 22, 2026",
    entries: [
      {
        title: "3D aircraft models & smoother trails",
        description:
          "14 distinct 3D aircraft silhouettes assigned by ADS-B category and ICAO type code — from wide-bodies to helicopters. Models hosted on Cloudinary CDN with lazy loading and prefetch. Trail smoothing overhauled: 5-pass kernel filter, tighter corner rounding (15\u00B0), denser Catmull\u2013Rom splines, and wider junction blending between historical and live data. Aircraft rendered 12% smaller for better proportions.",
      },
      {
        title: "Multi-source flight data & circuit breaker",
        description:
          "Switched from OpenSky-only to a 2-tier fallback: adsb.lol \u2192 OpenSky (airplanes.live available via override). Each provider has its own parser normalising into a shared FlightState format. Circuit breaker tracks failures per provider and temporarily disables broken ones. Empty-response guard prevents data wipe-outs during transient failures, and an immediate re-fetch fires on network reconnect.",
      },
      {
        title: "ATC feed lookup & GPU memory monitor",
        description:
          "New ATC lookup module \u2014 converts IATA to ICAO codes, finds nearby feeds by geographic proximity, and looks up feeds by airport or centre code. GPU memory monitor tracks WebGL resource allocations (textures, buffers, framebuffers) for debugging resource leaks.",
      },
      {
        title: "Reliability & polish",
        description:
          "Serialised rate limiting in the flight API client. Logo cache with size limits and eviction. Registration country lookup via pre-built O(1) maps. Keyboard shortcuts focus trapping fix. SessionStorage guard for incognito mode. Airspace display toggle in map attribution.",
      },
      {
        title: "Flight API client refactor",
        description:
          "New flight-api-client, flight-api-parsing, and flight-api-types modules. useFlights refactored to use the multi-source client \u2014 removed legacy credit management. useFlightMonitors switched to hex-based lookups.",
      },
      {
        title: "Code review fixes",
        description:
          "Fixed GPU memory monitor (duplicate WebGL enum cases, wrong byte sizes). Selection pulse halos now match aircraft height at all zoom levels. ATC stream properly cancels upstream on timeout. Airspace tile rate-limiter enforces spacing for queued requests. Photo fetch errors now surface to the UI. Spline cache clearing moved from useMemo to useEffect for React strict mode safety.",
      },
    ],
  },
  {
    version: "0.5.0",
    date: "Mar 10, 2026",
    entries: [
      {
        title: "Globe mode & aircraft photos",
        description:
          "Zoom out to see the entire earth as a 3D sphere with altitude-colored dots for every flight. Trails are now interpolated with centripetal Catmull\u2013Rom splines \u2014 a C\u00B9-continuous piecewise cubic that passes through every waypoint without overshooting, using \u03B1\u2009=\u20090.5 parameterization for natural curvature. Dark terrain, aircraft photo banners in flight cards, and a hard dot-to-flight cutover with zero overlap. Globe mode is in beta \u2014 find it in Settings.",
      },
    ],
  },
  {
    version: "0.4.1",
    date: "Feb 22, 2026",
    entries: [
      {
        title: "Flight history tracking",
        description:
          "Full trail rendering for every tracked flight. Airline logo caching so they actually load.",
      },
    ],
  },
  {
    version: "0.4.0",
    date: "Feb 21, 2026",
    entries: [
      {
        title: "First person view",
        description:
          "FPV mode \u2014 pick any plane and ride along with a HUD. Also added flight search by callsign.",
      },
    ],
  },
  {
    version: "0.3.0",
    date: "Feb 17, 2026",
    entries: [
      {
        title: "Airline logos & attribution",
        description:
          "Proper logos for airlines, and attribution for OSM, OpenSky, CARTO, Esri, and everyone whose data makes this work.",
      },
    ],
  },
  {
    version: "0.2.0",
    date: "Feb 15, 2026",
    entries: [
      {
        title: "9,000+ airports",
        description:
          "Went from a handful of cities to every airport we could find. Copilot helped build the dataset. Added keyboard shortcuts and click-to-select.",
      },
    ],
  },
  {
    version: "0.1.0",
    date: "Feb 14, 2026",
    entries: [
      {
        title: "Day one",
        description:
          "Basic map, flight cards, trail rendering, orbit camera. Spent most of the day fighting Vercel timeouts and OpenSky IP blocks before realizing the API just supports CORS.",
      },
    ],
  },
];

export function AboutContent() {
  return (
    <ScrollArea className="h-full">
      <div className="flex flex-col gap-5 p-5 pt-3">
        <h3 className="text-[20px] font-bold tracking-tight text-foreground/90">
          Aeris
        </h3>

        <div className="space-y-3 text-[13px] leading-relaxed text-foreground/40">
          <p>
            Live flight tracking in 3D. The planes you see are real — position
            data comes from ADS-B Exchange, adsb.lol, and OpenSky Network,
            updated every few seconds via ADS-B receivers people run on their
            roofs worldwide.
          </p>
          <p>
            You can search through 9,000+ airports, jump into first-person view
            to ride along with any plane, or just leave it on a screen and watch
            things move. Trails change color with altitude so you can tell
            who&apos;s cruising at 35,000ft and who&apos;s on approach.
          </p>
        </div>

        <div className="h-px w-full bg-foreground/6" />

        <p className="text-[12px] leading-relaxed text-foreground/30">
          Built by a human, not just LLMs.{" "}
          <a
            href="https://github.com/kewonit"
            target="_blank"
            rel="noopener noreferrer"
            className="text-foreground/55 underline decoration-foreground/15 underline-offset-2 hover:text-foreground/70 transition-colors"
          >
            kewonit
          </a>
          {" · "}
          <a
            href="https://x.com/kewonit"
            target="_blank"
            rel="noopener noreferrer"
            className="text-foreground/55 underline decoration-foreground/15 underline-offset-2 hover:text-foreground/70 transition-colors"
          >
            @kewonit
          </a>
          . Open to internships —{" "}
          <a
            href="mailto:kew@edbn.me"
            className="text-foreground/55 underline decoration-foreground/15 underline-offset-2 hover:text-foreground/70 transition-colors"
          >
            kew@edbn.me
          </a>
        </p>
        <p className="text-[12px] leading-relaxed text-foreground/30">
          Source is on{" "}
          <a
            href="https://github.com/kewonit/aeris"
            target="_blank"
            rel="noopener noreferrer"
            className="text-foreground/55 underline decoration-foreground/15 underline-offset-2 hover:text-foreground/70 transition-colors"
          >
            GitHub
          </a>
          . Got a question or just wanna say hi?{" "}
          <a
            href="mailto:aeris@edbn.me"
            className="text-foreground/55 underline decoration-foreground/15 underline-offset-2 hover:text-foreground/70 transition-colors"
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
      <div className="flex flex-col gap-5 p-5 pt-3">
        {CHANGELOG.map((release, i) => (
          <div key={release.version}>
            {i > 0 && <div className="mb-5 h-px w-full bg-foreground/6" />}
            <div className="mb-3 flex items-baseline gap-2">
              <span className="text-[13px] font-semibold tabular-nums text-foreground/60">
                v{release.version}
              </span>
              <span className="text-[11px] text-foreground/20">
                {release.date}
              </span>
            </div>
            <div className="flex flex-col gap-3 pl-0.5">
              {release.entries.map((entry, j) => (
                <div key={j} className="min-w-0">
                  <p className="text-[13px] font-medium text-foreground/50">
                    {entry.title}
                  </p>
                  <p className="mt-0.5 text-[12px] leading-relaxed text-foreground/30">
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
