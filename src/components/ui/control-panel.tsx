"use client";

import {
  useState,
  useEffect,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "motion/react";
import {
  Search,
  Map as MapIcon,
  Settings,
  Keyboard,
  X,
  Github,
  Info,
  Clock,
} from "lucide-react";
import type { City } from "@/lib/cities";
import type { MapStyle } from "@/lib/map-styles";
import type { FlightState } from "@/lib/opensky";
import { SearchContent } from "@/components/ui/control-panel-search";
import { StyleContent } from "@/components/ui/control-panel-styles";
import {
  SettingsContent,
  ShortcutsContent,
  AboutContent,
  ChangelogContent,
} from "@/components/ui/control-panel-settings";

type TabId =
  | "search"
  | "style"
  | "settings"
  | "shortcuts"
  | "changelog"
  | "about";

const MAIN_TABS: {
  id: TabId;
  icon: typeof Search;
  label: string;
}[] = [
  { id: "search", icon: Search, label: "Search" },
  { id: "style", icon: MapIcon, label: "Map Style" },
];

const PANEL_TABS = [
  ...MAIN_TABS,
  { id: "settings" as TabId, icon: Settings, label: "Settings" },
  { id: "shortcuts" as TabId, icon: Keyboard, label: "Shortcuts" },
  { id: "changelog" as TabId, icon: Clock, label: "Changelog" },
  { id: "about" as TabId, icon: Info, label: "About" },
];

const subscribePortalMount = () => () => {};

type ControlPanelProps = {
  activeCity: City;
  onSelectCity: (city: City) => void;
  activeStyle: MapStyle;
  onSelectStyle: (style: MapStyle) => void;
  flights: FlightState[];
  activeFlightIcao24: string | null;
  onLookupFlight: (query: string, enterFpv?: boolean) => Promise<boolean>;
};

export function ControlPanel({
  activeCity,
  onSelectCity,
  activeStyle,
  onSelectStyle,
  flights,
  activeFlightIcao24,
  onLookupFlight,
}: ControlPanelProps) {
  const [openTab, setOpenTab] = useState<TabId | null>(null);
  const portalMounted = useSyncExternalStore(
    subscribePortalMount,
    () => true,
    () => false,
  );

  useEffect(() => {
    function handleOpenSearch() {
      setOpenTab("search");
    }
    function handleOpenShortcuts() {
      setOpenTab("shortcuts");
    }
    window.addEventListener("aeris:open-search", handleOpenSearch);
    window.addEventListener("aeris:open-shortcuts", handleOpenShortcuts);
    return () => {
      window.removeEventListener("aeris:open-search", handleOpenSearch);
      window.removeEventListener("aeris:open-shortcuts", handleOpenShortcuts);
    };
  }, []);

  const open = (tab: TabId) => setOpenTab(tab);
  const close = () => setOpenTab(null);

  return (
    <>
      {MAIN_TABS.map(({ id, icon: Icon, label }) => (
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

      <motion.button
        onClick={() => open("settings")}
        className="flex h-9 w-9 items-center justify-center rounded-xl backdrop-blur-2xl transition-colors"
        style={{
          borderWidth: 1,
          borderColor: "rgb(var(--ui-fg) / 0.06)",
          backgroundColor: "rgb(var(--ui-fg) / 0.03)",
          color: "rgb(var(--ui-fg) / 0.5)",
        }}
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        aria-label="Settings"
      >
        <Settings className="h-4 w-4" />
      </motion.button>

      {portalMounted &&
        createPortal(
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
                flights={flights}
                activeFlightIcao24={activeFlightIcao24}
                onLookupFlight={onLookupFlight}
              />
            )}
          </AnimatePresence>,
          document.body,
        )}
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
  flights,
  activeFlightIcao24,
  onLookupFlight,
}: {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
  onClose: () => void;
  activeCity: City;
  onSelectCity: (city: City) => void;
  activeStyle: MapStyle;
  onSelectStyle: (style: MapStyle) => void;
  flights: FlightState[];
  activeFlightIcao24: string | null;
  onLookupFlight: (query: string, enterFpv?: boolean) => Promise<boolean>;
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
      if (!dialog) return;
      const elements = dialog.querySelectorAll<HTMLElement>(
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
        className="fixed inset-0 z-80 bg-background/70"
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
        <div className="flex flex-col sm:flex-row overflow-hidden rounded-2xl sm:rounded-3xl border border-border bg-popover shadow-[0_40px_100px_rgba(0,0,0,0.25)] dark:shadow-[0_40px_100px_rgba(0,0,0,0.8),0_0_0_1px_rgba(255,255,255,0.04)_inset] h-[75vh] sm:h-auto sm:max-h-[85vh]">
          {/* Desktop sidebar (hidden on mobile) */}
          <div className="hidden sm:flex w-52 shrink-0 flex-col border-r border-border py-5 px-3">
            <p className="mb-3 px-2 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/40">
              Controls
            </p>
            <nav className="flex flex-col gap-0.5">
              {PANEL_TABS.map(({ id, icon: Icon, label }) => {
                const active = id === activeTab;
                return (
                  <button
                    key={id}
                    onClick={() => onTabChange(id)}
                    className={`group relative flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-left transition-colors ${
                      active
                        ? "text-foreground/90"
                        : "text-foreground/35 hover:text-foreground/55 hover:bg-foreground/4"
                    }`}
                  >
                    {active && (
                      <motion.div
                        layoutId="panel-tab-bg"
                        className="absolute inset-0 rounded-xl bg-foreground/8"
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
                className="group relative flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-left transition-colors text-foreground/35 hover:text-foreground/55 hover:bg-foreground/4"
              >
                <Github
                  className="relative h-4 w-4 shrink-0"
                  aria-hidden="true"
                />
                <span className="relative text-[14px] font-medium">GitHub</span>
              </a>
              <div className="border-t border-foreground/5 pt-2 px-2.5">
                <p className="text-[10px] font-medium text-foreground/15 tracking-wide">
                  Data from ADS-B Exchange, adsb.lol &amp; OpenSky
                </p>
              </div>
            </div>
          </div>

          <div className="flex flex-1 flex-col min-h-0 sm:h-120">
            {/* Mobile header */}
            <div className="flex sm:hidden items-center justify-between px-4 pt-4 pb-2">
              <h2
                id="panel-dialog-title"
                className="text-[14px] font-semibold tracking-tight text-foreground/90"
              >
                {PANEL_TABS.find((t) => t.id === activeTab)?.label}
              </h2>
            </div>
            {/* Desktop header */}
            <div className="hidden sm:flex items-center justify-between px-5 pt-5 pb-2">
              <h2
                id="panel-dialog-title"
                className="text-[15px] font-semibold tracking-tight text-foreground/90"
              >
                {PANEL_TABS.find((t) => t.id === activeTab)?.label}
              </h2>
              <motion.button
                onClick={onClose}
                className="flex h-7 w-7 items-center justify-center rounded-full bg-foreground/6 transition-colors hover:bg-foreground/12"
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.9 }}
                aria-label="Close"
              >
                <X className="h-3.5 w-3.5 text-foreground/40" />
              </motion.button>
            </div>

            <div className="relative flex-1 overflow-hidden">
              <AnimatePresence mode="wait" initial={false}>
                {activeTab === "search" && (
                  <TabContent key="search">
                    <SearchContent
                      activeCity={activeCity}
                      onSelect={onSelectCity}
                      flights={flights}
                      activeFlightIcao24={activeFlightIcao24}
                      onLookupFlight={async (query, enterFpv = false) => {
                        const found = await onLookupFlight(query, enterFpv);
                        if (found) onClose();
                        return found;
                      }}
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
                {activeTab === "shortcuts" && (
                  <TabContent key="shortcuts">
                    <ShortcutsContent />
                  </TabContent>
                )}
                {activeTab === "changelog" && (
                  <TabContent key="changelog">
                    <ChangelogContent />
                  </TabContent>
                )}
                {activeTab === "about" && (
                  <TabContent key="about">
                    <AboutContent />
                  </TabContent>
                )}
              </AnimatePresence>
            </div>
          </div>

          {/* Mobile tab bar */}
          <div className="flex sm:hidden items-center gap-0.5 border-t border-border px-2 pt-2 pb-3">
            <nav className="flex flex-1 gap-0.5">
              {PANEL_TABS.map(({ id, icon: Icon, label }) => {
                const active = id === activeTab;
                return (
                  <button
                    key={id}
                    onClick={() => onTabChange(id)}
                    className={`relative flex flex-1 items-center justify-center rounded-lg py-2.5 transition-colors ${
                      active
                        ? "text-foreground/90"
                        : "text-foreground/35 active:bg-foreground/6"
                    }`}
                    aria-label={label}
                  >
                    {active && (
                      <motion.div
                        layoutId="panel-tab-bg-mobile"
                        className="absolute inset-0 rounded-lg bg-foreground/8"
                        transition={{
                          type: "spring",
                          stiffness: 400,
                          damping: 30,
                        }}
                      />
                    )}
                    <Icon className="relative h-4 w-4 shrink-0" />
                  </button>
                );
              })}
            </nav>
            <motion.button
              onClick={onClose}
              className="ml-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-foreground/6 transition-colors active:bg-foreground/12"
              whileTap={{ scale: 0.9 }}
              aria-label="Close"
            >
              <X className="h-3.5 w-3.5 text-foreground/40" />
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
