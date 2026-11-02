"use client";

import {
  useState,
  useEffect,
  useRef,
  useCallback,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "motion/react";
import { SNAP, PRESS_SCALE } from "@/lib/motion";
import {
  Settings,
  Keyboard,
  X,
  Info,
  Clock,
} from "lucide-react";
import {
  SettingsContent,
  ShortcutsContent,
  AboutContent,
  ChangelogContent,
} from "@/components/ui/control-panel-settings";

/** The round buttons that sit on the map. */
export const MAP_BUTTON_CLASS =
  "grid size-9 place-items-center rounded-full border border-border bg-background text-muted-foreground transition-colors hover:text-foreground";

export type ControlPanelTabId =
  | "settings"
  | "shortcuts"
  | "changelog"
  | "about";

export const CONTROL_PANEL_TABS = [
  { id: "settings" as ControlPanelTabId, icon: Settings, label: "Settings" },
  { id: "shortcuts" as ControlPanelTabId, icon: Keyboard, label: "Shortcuts" },
  { id: "changelog" as ControlPanelTabId, icon: Clock, label: "Changelog" },
  { id: "about" as ControlPanelTabId, icon: Info, label: "About" },
];

const subscribePortalMount = () => () => {};

type ControlPanelProps = {
  airspaceAvailable?: boolean;
};

export function ControlPanel({
  airspaceAvailable = true,
}: ControlPanelProps) {
  const [openTab, setOpenTab] = useState<ControlPanelTabId | null>(null);
  const portalMounted = useSyncExternalStore(
    subscribePortalMount,
    () => true,
    () => false,
  );

  const open = useCallback((tab: ControlPanelTabId) => {
    setOpenTab(tab);
  }, []);

  useEffect(() => {
    function handleOpenShortcuts() {
      open("shortcuts");
    }
    function handleOpenPanel(event: Event) {
      const tab = (event as CustomEvent<{ tab?: ControlPanelTabId }>).detail?.tab;
      open(tab ?? "settings");
    }
    window.addEventListener("aeris:open-shortcuts", handleOpenShortcuts);
    window.addEventListener("aeris:open-panel", handleOpenPanel);
    return () => {
      window.removeEventListener("aeris:open-shortcuts", handleOpenShortcuts);
      window.removeEventListener("aeris:open-panel", handleOpenPanel);
    };
  }, [open]);

  const close = () => setOpenTab(null);

  return (
    <>
      {portalMounted &&
        createPortal(
          <AnimatePresence>
            {openTab && (
              <PanelDialog
                activeTab={openTab}
                onTabChange={setOpenTab}
                onClose={close}
                airspaceAvailable={airspaceAvailable}
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
  airspaceAvailable,
}: {
  activeTab: ControlPanelTabId;
  onTabChange: (tab: ControlPanelTabId) => void;
  onClose: () => void;
  airspaceAvailable: boolean;
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
        className="fixed inset-0 z-80 bg-scrim"
        onClick={onClose}
      />

      <motion.div
        ref={dialogRef}
        initial={{ opacity: 0, scale: 0.94, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.94, y: 16 }}
        transition={SNAP}
        className="fixed inset-x-3 bottom-3 top-auto z-90 sm:inset-auto sm:left-1/2 sm:top-1/2 sm:w-full sm:max-w-180 sm:-translate-x-1/2 sm:-translate-y-1/2 sm:px-4"
        role="dialog"
        aria-modal="true"
        aria-labelledby="panel-dialog-title"
      >
        <div className="flex flex-col sm:flex-row overflow-hidden rounded-lg sm:rounded-xl border border-border bg-popover shadow-lift h-[75vh] sm:h-auto sm:max-h-[85vh]">
          {/* Desktop sidebar (hidden on mobile) */}
          <div className="hidden sm:flex w-52 shrink-0 flex-col border-r border-border bg-card/60 py-5 px-3">
            <nav className="flex flex-col gap-0.5">
              {CONTROL_PANEL_TABS.map(({ id, icon: Icon, label }) => {
                const active = id === activeTab;
                return (
                  <button
                    key={id}
                    onClick={() => onTabChange(id)}
                    className={`group relative flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-left transition-colors ${
                      active
                        ? "text-foreground"
                        : "text-subtle hover:text-muted-foreground hover:bg-card"
                    }`}
                  >
                    {active && (
                      <motion.div
                        layoutId="panel-tab-bg"
                        className="absolute inset-0 rounded-lg bg-accent"
                        transition={SNAP}
                      />
                    )}
                    <Icon className="relative h-4 w-4 shrink-0" />
                    <span className="relative text-small font-medium">
                      {label}
                    </span>
                  </button>
                );
              })}
            </nav>
          </div>

          <div className="flex flex-1 flex-col min-h-0 sm:h-120">
            {/* Mobile header */}
            <div className="flex sm:hidden items-center justify-between px-4 pt-4 pb-2">
              <h2
                id="panel-dialog-title"
                className="text-small font-medium text-foreground"
              >
                {CONTROL_PANEL_TABS.find((t) => t.id === activeTab)?.label}
              </h2>
            </div>
            {/* Desktop header */}
            <div className="hidden sm:flex items-center justify-between px-5 pt-5 pb-2">
              <h2
                id="panel-dialog-title"
                className="text-body font-medium text-foreground"
              >
                {CONTROL_PANEL_TABS.find((t) => t.id === activeTab)?.label}
              </h2>
              <motion.button
                onClick={onClose}
                className="flex h-7 w-7 items-center justify-center rounded-full bg-card transition-colors hover:bg-accent"
                whileTap={{ scale: PRESS_SCALE }}
                aria-label="Close"
              >
                <X className="h-3.5 w-3.5 text-subtle" />
              </motion.button>
            </div>

            <div className="relative flex-1 overflow-hidden">
              <AnimatePresence mode="wait" initial={false}>
                {activeTab === "settings" && (
                  <TabContent key="settings">
                    <SettingsContent airspaceAvailable={airspaceAvailable} />
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
              {CONTROL_PANEL_TABS.map(({ id, icon: Icon, label }) => {
                const active = id === activeTab;
                return (
                  <button
                    key={id}
                    onClick={() => onTabChange(id)}
                    className={`relative flex flex-1 items-center justify-center rounded-md py-2.5 transition-colors ${
                      active
                        ? "text-foreground"
                        : "text-subtle active:bg-card"
                    }`}
                    aria-label={label}
                  >
                    {active && (
                      <motion.div
                        layoutId="panel-tab-bg-mobile"
                        className="absolute inset-0 rounded-md bg-accent"
                        transition={SNAP}
                      />
                    )}
                    <Icon className="relative h-4 w-4 shrink-0" />
                  </button>
                );
              })}
            </nav>
            <motion.button
              onClick={onClose}
              className="ml-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-card transition-colors active:bg-accent"
              whileTap={{ scale: PRESS_SCALE }}
              aria-label="Close"
            >
              <X className="h-3.5 w-3.5 text-subtle" />
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
