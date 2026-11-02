"use client";

import { memo, useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import {
  ArrowUpRight,
  Dices,
  Layers,
  Maximize,
  Minimize,
  RotateCcw,
} from "lucide-react";
import { useSettings } from "@/hooks/use-settings";
import { MAP_STYLES, type MapStyle } from "@/lib/map-styles";
import {
  GITHUB_REPO_URL,
  formatStarCount,
} from "@/components/flight-tracker-utils";
import { useFullscreen } from "@/components/ui/camera-controls";
import { MapButton, FLOATING_SURFACE } from "./map-button";

export type PanelTab = "settings" | "shortcuts" | "changelog" | "about";

type MapMenuProps = {
  activeStyle: MapStyle;
  onSelectStyle: (style: MapStyle) => void;
  airspaceAvailable: boolean;
  onRandomAirport: () => void;
  onResetView: () => void;
  repoStars: number | null;
  /** Inside the search field on a phone, rather than floating on its own. */
  inline?: boolean;
};

/** Opens a tab of the settings dialog. */
export function openPanel(tab: PanelTab) {
  window.dispatchEvent(new CustomEvent("aeris:open-panel", { detail: { tab } }));
}

/**
 * Everything about the map in one place: how it looks, what it draws, and
 * the way to settings. A style or a layer applies the moment it is picked,
 * with the map in view behind the menu.
 */
export const MapMenu = memo(function MapMenu({
  activeStyle,
  onSelectStyle,
  airspaceAvailable,
  onRandomAirport,
  onResetView,
  repoStars,
  inline = false,
}: MapMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const { settings, update } = useSettings();
  const fullscreen = useFullscreen();

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    const toggle = () => setOpen((value) => !value);
    window.addEventListener("aeris:toggle-menu", toggle);
    return () => window.removeEventListener("aeris:toggle-menu", toggle);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) close();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        close();
        buttonRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [close, open]);

  const act = (action: () => void) => () => {
    action();
    close();
  };

  return (
    <div ref={rootRef} className="relative">
      {inline ? (
        <button
          ref={buttonRef}
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-haspopup="dialog"
          aria-label="Map"
          aria-keyshortcuts="M"
          className="grid size-9 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-card hover:text-foreground aria-expanded:bg-card aria-expanded:text-foreground"
        >
          <Layers className="size-4" aria-hidden="true" />
        </button>
      ) : (
        <MapButton
          ref={buttonRef}
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-haspopup="dialog"
          aria-label="Map"
          aria-keyshortcuts="M"
          active={open}
          title="Map (M)"
        >
          <Layers className="size-4" aria-hidden="true" />
        </MapButton>
      )}

      {open && (
        <div
          role="dialog"
          aria-label="Map"
          className={`aeris-pop absolute top-full right-0 z-20 mt-2 w-[min(22rem,calc(100vw-1.5rem))] origin-top-right overflow-hidden rounded-xl ${FLOATING_SURFACE}`}
        >
          <div className="max-h-[min(75dvh,40rem)] overflow-y-auto overscroll-contain">
            <section aria-label="Map style" className="grid grid-cols-3 gap-2 p-3">
              {MAP_STYLES.map((style) => (
                <StyleTile
                  key={style.id}
                  style={style}
                  active={style.id === activeStyle.id}
                  onSelect={() => onSelectStyle(style)}
                />
              ))}
            </section>

            <section aria-label="Layers" className="border-t border-border py-1">
              <Switch
                label="Traffic trails"
                checked={settings.showTrails}
                onChange={(value) => update("showTrails", value)}
              />
              <Switch
                label="Altitude colors"
                checked={settings.showAltitudeColors}
                onChange={(value) => update("showAltitudeColors", value)}
              />
              <Switch
                label="Exaggerated heights"
                checked={settings.altitudeDisplayMode === "presentation"}
                onChange={(value) =>
                  update("altitudeDisplayMode", value ? "presentation" : "realistic")
                }
              />
              {airspaceAvailable && (
                <Switch
                  label="Airspace"
                  checked={settings.showAirspace}
                  onChange={(value) => update("showAirspace", value)}
                />
              )}
              <Switch
                label="Weather radar"
                checked={settings.showWeatherRadar}
                onChange={(value) => update("showWeatherRadar", value)}
              />
              <Switch
                label="Globe"
                checked={settings.globeMode}
                onChange={(value) => update("globeMode", value)}
              />
            </section>

            <section className="border-t border-border py-1">
              <Row onClick={act(onRandomAirport)} icon={<Dices className="size-4" />}>
                Random airport
              </Row>
              <Row
                onClick={act(onResetView)}
                icon={<RotateCcw className="size-4" />}
                shortcut="R"
              >
                Reset view
              </Row>
              {fullscreen.mounted && fullscreen.supported && (
                <Row
                  onClick={act(fullscreen.toggle)}
                  icon={
                    fullscreen.isFullscreen ? (
                      <Minimize className="size-4" />
                    ) : (
                      <Maximize className="size-4" />
                    )
                  }
                >
                  {fullscreen.isFullscreen ? "Exit full screen" : "Full screen"}
                </Row>
              )}
            </section>

            <section className="border-t border-border py-1">
              <Row onClick={act(() => openPanel("settings"))}>Settings</Row>
              <Row onClick={act(() => openPanel("shortcuts"))} shortcut="?">
                Shortcuts
              </Row>
              <Row onClick={act(() => openPanel("changelog"))}>Changelog</Row>
              <Row onClick={act(() => openPanel("about"))}>About</Row>
              <a
                href={GITHUB_REPO_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="flex min-h-11 items-center justify-between px-4 text-small text-foreground transition-colors hover:bg-card"
              >
                <span>
                  GitHub
                  <ArrowUpRight className="ml-1 inline size-3.5 text-subtle" aria-hidden="true" />
                </span>
                {repoStars !== null && (
                  <span className="text-label text-subtle">
                    ★ {formatStarCount(repoStars)}
                  </span>
                )}
              </a>
            </section>
          </div>
        </div>
      )}
    </div>
  );
});

function StyleTile({
  style,
  active,
  onSelect,
}: {
  style: MapStyle;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      className="group flex flex-col gap-1.5 text-left"
    >
      <span
        className={`relative block aspect-4/3 w-full overflow-hidden rounded-md transition-shadow ${
          active ? "ring-2 ring-tint" : "ring-1 ring-border group-hover:ring-subtle"
        }`}
        style={{ background: style.preview }}
      >
        <Image
          src={style.previewUrl}
          alt=""
          fill
          sizes="7rem"
          unoptimized
          draggable={false}
          className="object-cover"
        />
      </span>
      <span
        className={`truncate text-label ${active ? "text-foreground" : "text-muted-foreground"}`}
      >
        {style.name}
      </span>
    </button>
  );
}

function Switch({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex min-h-11 w-full items-center justify-between gap-3 px-4 text-left text-small text-foreground transition-colors hover:bg-card"
    >
      {label}
      <span
        className={`relative h-6 w-10 shrink-0 rounded-full transition-colors ${
          checked ? "bg-tint" : "bg-accent ring-1 ring-subtle ring-inset"
        }`}
        aria-hidden="true"
      >
        <span
          className={`absolute top-0.5 left-0.5 size-5 rounded-full bg-white shadow-lift transition-transform ${
            checked ? "translate-x-4" : ""
          }`}
        />
      </span>
    </button>
  );
}

function Row({
  onClick,
  icon,
  shortcut,
  children,
}: {
  onClick: () => void;
  icon?: React.ReactNode;
  shortcut?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-keyshortcuts={shortcut}
      className="flex min-h-11 w-full items-center gap-3 px-4 text-left text-small text-foreground transition-colors hover:bg-card"
    >
      {icon && (
        <span className="text-subtle" aria-hidden="true">
          {icon}
        </span>
      )}
      <span className="flex-1">{children}</span>
      {shortcut && (
        <kbd className="hidden font-mono text-label text-subtle pointer-fine:inline">
          {shortcut}
        </kbd>
      )}
    </button>
  );
}
