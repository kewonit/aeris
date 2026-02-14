"use client";

import { useState, useMemo, useRef, useEffect, type ReactNode } from "react";
import Image from "next/image";
import { motion, AnimatePresence } from "motion/react";
import {
  Search,
  Map as MapIcon,
  Settings,
  X,
  Check,
  MapPin,
  ChevronRight,
  RotateCw,
  Route,
  Layers,
  Palette,
  ArrowLeftRight,
  Github,
  Globe,
} from "lucide-react";
import { CITIES, type City } from "@/lib/cities";
import { MAP_STYLES, type MapStyle } from "@/lib/map-styles";
import { useSettings, type OrbitDirection } from "@/hooks/use-settings";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Slider } from "@/components/ui/slider";

type TabId = "search" | "style" | "settings";

const TABS: { id: TabId; icon: typeof Search; label: string }[] = [
  { id: "search", icon: Search, label: "Search" },
  { id: "style", icon: MapIcon, label: "Map Style" },
  { id: "settings", icon: Settings, label: "Settings" },
];

type ControlPanelProps = {
  activeCity: City;
  onSelectCity: (city: City) => void;
  activeStyle: MapStyle;
  onSelectStyle: (style: MapStyle) => void;
};

export function ControlPanel({
  activeCity,
  onSelectCity,
  activeStyle,
  onSelectStyle,
}: ControlPanelProps) {
  const [openTab, setOpenTab] = useState<TabId | null>(null);

  const open = (tab: TabId) => setOpenTab(tab);
  const close = () => setOpenTab(null);

  return (
    <>
      {TABS.map(({ id, icon: Icon, label }) => (
        <motion.button
          key={id}
          onClick={() => open(id)}
          className="flex h-9 w-9 items-center justify-center rounded-xl backdrop-blur-2xl transition-colors"
          style={{
            borderWidth: 1,
            borderColor: "rgb(var(--ui-fg) / 0.06)",
            backgroundColor: "rgb(var(--ui-fg) / 0.03)",
            color: "rgb(var(--ui-fg) / 0.5)",
          }}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          aria-label={label}
        >
          <Icon className="h-4 w-4" />
        </motion.button>
      ))}

      <AnimatePresence>
        {openTab && (
          <PanelDialog
            activeTab={openTab}
            onTabChange={setOpenTab}
            onClose={close}
            activeCity={activeCity}
            onSelectCity={(c) => {
              onSelectCity(c);
              close();
            }}
            activeStyle={activeStyle}
            onSelectStyle={onSelectStyle}
          />
        )}
      </AnimatePresence>
    </>
  );
}

function PanelDialog({
  activeTab,
  onTabChange,
  onClose,
  activeCity,
  onSelectCity,
  activeStyle,
  onSelectStyle,
}: {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
  onClose: () => void;
  activeCity: City;
  onSelectCity: (city: City) => void;
  activeStyle: MapStyle;
  onSelectStyle: (style: MapStyle) => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const focusable = dialog.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    if (focusable.length === 0) return;

    const first = focusable[0];
    first.focus();

    function trapFocus(e: KeyboardEvent) {
      if (e.key !== "Tab") return;
      const elements = dialog!.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      const f = elements[0];
      const l = elements[elements.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === f) {
          e.preventDefault();
          l.focus();
        }
      } else {
        if (document.activeElement === l) {
          e.preventDefault();
          f.focus();
        }
      }
    }

    dialog.addEventListener("keydown", trapFocus);
    return () => dialog.removeEventListener("keydown", trapFocus);
  }, [activeTab]);

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        className="fixed inset-0 z-80 bg-black/60 backdrop-blur-xl"
        onClick={onClose}
      />

      <motion.div
        ref={dialogRef}
        initial={{ opacity: 0, scale: 0.94, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.94, y: 16 }}
        transition={{
          type: "spring",
          stiffness: 400,
          damping: 30,
          mass: 0.8,
        }}
        className="fixed inset-x-3 bottom-3 top-auto z-90 sm:inset-auto sm:left-1/2 sm:top-1/2 sm:w-full sm:max-w-180 sm:-translate-x-1/2 sm:-translate-y-1/2 sm:px-4"
        role="dialog"
        aria-modal="true"
        aria-labelledby="panel-dialog-title"
      >
        <div className="flex flex-col sm:flex-row overflow-hidden rounded-2xl sm:rounded-3xl border border-white/8 bg-[#0c0c0e]/92 shadow-[0_40px_100px_rgba(0,0,0,0.8),0_0_0_1px_rgba(255,255,255,0.04)_inset] backdrop-blur-3xl backdrop-saturate-[1.8] h-[75vh] sm:h-auto sm:max-h-[85vh]">
          {/* Desktop sidebar (hidden on mobile) */}
          <div className="hidden sm:flex w-52 shrink-0 flex-col border-r border-white/6 py-5 px-3">
            <p className="mb-3 px-2 text-[11px] font-semibold uppercase tracking-widest text-white/20">
              Controls
            </p>
            <nav className="flex flex-col gap-0.5">
              {TABS.map(({ id, icon: Icon, label }) => {
                const active = id === activeTab;
                return (
                  <button
                    key={id}
                    onClick={() => onTabChange(id)}
                    className={`group relative flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-left transition-colors ${
                      active
                        ? "text-white/90"
                        : "text-white/35 hover:text-white/55 hover:bg-white/4"
                    }`}
                  >
                    {active && (
                      <motion.div
                        layoutId="panel-tab-bg"
                        className="absolute inset-0 rounded-xl bg-white/8"
                        transition={{
                          type: "spring",
                          stiffness: 400,
                          damping: 30,
                        }}
                      />
                    )}
                    <Icon className="relative h-4 w-4 shrink-0" />
                    <span className="relative text-[14px] font-medium">
                      {label}
                    </span>
                  </button>
                );
              })}
            </nav>

            <div className="mt-auto pt-4 px-1 flex flex-col gap-3">
              <a
                href="https://github.com/kewonit/aeris"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="GitHub (opens in new tab)"
                className="group relative flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-left transition-colors text-white/35 hover:text-white/55 hover:bg-white/4"
              >
                <Github
                  className="relative h-4 w-4 shrink-0"
                  aria-hidden="true"
                />
                <span className="relative text-[14px] font-medium">GitHub</span>
              </a>
              <div className="border-t border-white/3 pt-2 px-2.5">
                <p className="text-[10px] font-medium text-white/10 tracking-wide">
                  v0.1 \u00b7 OpenSky Network
                </p>
              </div>
            </div>
          </div>

          <div className="flex flex-1 flex-col min-h-0 sm:h-120">
            {/* Mobile header */}
            <div className="flex sm:hidden items-center justify-between px-4 pt-4 pb-2">
              <h2
                id="panel-dialog-title"
                className="text-[14px] font-semibold tracking-tight text-white/90"
              >
                {TABS.find((t) => t.id === activeTab)?.label}
              </h2>
            </div>
            {/* Desktop header */}
            <div className="hidden sm:flex items-center justify-between px-5 pt-5 pb-2">
              <h2
                id="panel-dialog-title"
                className="text-[15px] font-semibold tracking-tight text-white/90"
              >
                {TABS.find((t) => t.id === activeTab)?.label}
              </h2>
              <motion.button
                onClick={onClose}
                className="flex h-7 w-7 items-center justify-center rounded-full bg-white/6 transition-colors hover:bg-white/12"
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.9 }}
                aria-label="Close"
              >
                <X className="h-3.5 w-3.5 text-white/40" />
              </motion.button>
            </div>

            <div className="relative flex-1 overflow-hidden">
              <AnimatePresence mode="wait" initial={false}>
                {activeTab === "search" && (
                  <TabContent key="search">
                    <SearchContent
                      activeCity={activeCity}
                      onSelect={onSelectCity}
                    />
                  </TabContent>
                )}
                {activeTab === "style" && (
                  <TabContent key="style">
                    <StyleContent
                      activeStyle={activeStyle}
                      onSelect={onSelectStyle}
                    />
                  </TabContent>
                )}
                {activeTab === "settings" && (
                  <TabContent key="settings">
                    <SettingsContent />
                  </TabContent>
                )}
              </AnimatePresence>
            </div>
          </div>

          {/* Mobile tab bar */}
          <div className="flex sm:hidden items-center gap-1 border-t border-white/6 px-3 pt-2 pb-3">
            <nav className="flex flex-1 gap-1">
              {TABS.map(({ id, icon: Icon, label }) => {
                const active = id === activeTab;
                return (
                  <button
                    key={id}
                    onClick={() => onTabChange(id)}
                    className={`relative flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-center transition-colors ${
                      active
                        ? "text-white/90"
                        : "text-white/35 active:bg-white/6"
                    }`}
                  >
                    {active && (
                      <motion.div
                        layoutId="panel-tab-bg-mobile"
                        className="absolute inset-0 rounded-lg bg-white/8"
                        transition={{
                          type: "spring",
                          stiffness: 400,
                          damping: 30,
                        }}
                      />
                    )}
                    <Icon className="relative h-3.5 w-3.5 shrink-0" />
                    <span className="relative text-[12px] font-semibold">
                      {label}
                    </span>
                  </button>
                );
              })}
            </nav>
            <motion.button
              onClick={onClose}
              className="ml-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/6 transition-colors active:bg-white/12"
              whileTap={{ scale: 0.9 }}
              aria-label="Close"
            >
              <X className="h-3.5 w-3.5 text-white/40" />
            </motion.button>
          </div>
        </div>
      </motion.div>
    </>
  );
}

function TabContent({ children }: { children: ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      className="absolute inset-0"
    >
      {children}
    </motion.div>
  );
}

function SearchContent({
  activeCity,
  onSelect,
}: {
  activeCity: City;
  onSelect: (city: City) => void;
}) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    return CITIES.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.iata.toLowerCase().includes(q) ||
        c.country.toLowerCase().includes(q),
    );
  }, [query]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2.5 border-b border-white/6 mx-5 pb-3">
        <Search className="h-3.5 w-3.5 shrink-0 text-white/25" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search airspace..."
          aria-label="Search cities by name, IATA code, or country"
          className="flex-1 bg-transparent text-[14px] font-medium text-white/90 placeholder:text-white/20 outline-none"
        />
      </div>

      <ScrollArea className="flex-1">
        <div className="p-2">
          {filtered.length === 0 && (
            <p className="py-8 text-center text-[12px] text-white/25">
              No cities found
            </p>
          )}
          {filtered.map((city) => (
            <button
              key={city.id}
              onClick={() => onSelect(city)}
              aria-current={activeCity?.id === city.id ? "true" : undefined}
              className={`group flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-white/4 ${
                activeCity?.id === city.id ? "bg-white/6" : ""
              }`}
            >
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/4">
                <MapPin className="h-3.5 w-3.5 text-white/40" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="truncate text-[14px] font-medium text-white/80">
                  {city.name}
                </p>
                <p className="text-[11px] font-medium text-white/25">
                  {city.iata} \u00b7 {city.country}
                </p>
              </div>
              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-white/12 transition-colors group-hover:text-white/25" />
            </button>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}

function StyleContent({
  activeStyle,
  onSelect,
}: {
  activeStyle: MapStyle;
  onSelect: (style: MapStyle) => void;
}) {
  return (
    <ScrollArea className="h-full">
      <div className="grid grid-cols-2 sm:grid-cols-2 gap-2.5 sm:gap-3 p-4 sm:p-5 pt-2">
        {MAP_STYLES.map((style, i) => (
          <StyleTile
            key={style.id}
            style={style}
            isActive={style.id === activeStyle.id}
            index={i}
            onSelect={() => onSelect(style)}
          />
        ))}
      </div>
      <div className="border-t border-white/4 px-5 py-3">
        <p className="text-[11px] font-medium text-white/12">
          Satellite \u00a9 Esri \u00b7 Terrain \u00a9 OpenTopoMap \u00b7 Base maps \u00a9
          CARTO
        </p>
      </div>
    </ScrollArea>
  );
}

function StyleTile({
  style,
  isActive,
  index,
  onSelect,
}: {
  style: MapStyle;
  isActive: boolean;
  index: number;
  onSelect: () => void;
}) {
  const [imgLoaded, setImgLoaded] = useState(false);

  return (
    <motion.button
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.04 * index, duration: 0.25, ease: "easeOut" }}
      onClick={onSelect}
      aria-pressed={isActive}
      aria-label={`${style.name} map style`}
      className="group relative flex flex-col gap-2 text-left"
    >
      <div
        className={`relative aspect-16/10 w-full overflow-hidden rounded-xl transition-all duration-200 ${
          isActive
            ? "ring-2 ring-white/50 ring-offset-2 ring-offset-black/80 shadow-[0_0_20px_rgba(255,255,255,0.06)]"
            : "ring-1 ring-white/8 group-hover:ring-white/18"
        }`}
      >
        <div
          className="absolute inset-0"
          style={{ background: style.preview }}
        />
        <Image
          src={style.previewUrl}
          alt={`${style.name} preview`}
          fill
          unoptimized
          onLoad={() => setImgLoaded(true)}
          className={`object-cover transition-all duration-500 group-hover:scale-105 ${
            imgLoaded ? "opacity-100" : "opacity-0"
          }`}
          draggable={false}
        />
        <div className="absolute inset-0 rounded-xl shadow-[inset_0_1px_0_rgba(255,255,255,0.06),inset_0_-16px_28px_-10px_rgba(0,0,0,0.4)]" />

        <AnimatePresence>
          {isActive && (
            <motion.div
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0, opacity: 0 }}
              transition={{
                type: "spring",
                stiffness: 500,
                damping: 28,
              }}
              className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-white shadow-md shadow-black/30"
            >
              <Check className="h-3 w-3 text-black" strokeWidth={3} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="flex items-center gap-1.5 px-0.5">
        <span
          className={`text-[12px] font-semibold tracking-tight transition-colors ${
            isActive
              ? "text-white/90"
              : "text-white/40 group-hover:text-white/60"
          }`}
        >
          {style.name}
        </span>
        {style.dark && (
          <span className="h-0.5 w-0.5 rounded-full bg-white/20" />
        )}
      </div>
    </motion.button>
  );
}

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

function SettingsContent() {
  const { settings, update } = useSettings();

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
          icon={<Globe className="h-4 w-4" />}
          title="Globe view"
          description="Display the Earth as a 3D sphere"
          checked={settings.globeView}
          onChange={(v) => update("globeView", v)}
        />

        <div className="mx-3 my-2 h-px bg-white/4" />

        <SettingRow
          icon={<Route className="h-4 w-4" />}
          title="Flight trails"
          description="Altitude-colored trails behind aircraft"
          checked={settings.showTrails}
          onChange={(v) => update("showTrails", v)}
        />
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
    )?.label ?? `${value.toFixed(2)}\u00d7`;

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

function SettingRow({
  icon,
  title,
  description,
  checked,
  onChange,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
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
        <p className="text-[13px] font-medium text-white/80">{title}</p>
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
