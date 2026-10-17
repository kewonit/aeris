"use client";

import type { ReactNode, SVGProps } from "react";
import { motion } from "motion/react";

import { Tooltip, TooltipProvider } from "@/components/ui/tooltip";
import { useSettings } from "@/hooks/use-settings";
import { formatAltitude } from "@/lib/unit-formatters";

const METERS_PER_FOOT = 0.3048;

// Drawn on lucide's grid and stroke so they match the camera controls.
function Glyph({ children, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="h-3.5 w-3.5"
      {...props}
    >
      {children}
    </svg>
  );
}

/** A trail sweeping up to the aircraft at its end. */
function TrailGlyph() {
  return (
    <Glyph>
      <path d="M3 20c7 0 7-12 14-12" />
      <circle cx="20" cy="8" r="2" fill="currentColor" stroke="none" />
    </Glyph>
  );
}

/** The same trail, held under a ceiling. */
function CeilingGlyph() {
  return (
    <Glyph>
      <path d="M3 4h18" />
      <path d="M3 20c7 0 7-8 14-8" />
      <circle cx="20" cy="12" r="2" fill="currentColor" stroke="none" />
    </Glyph>
  );
}

/** The altitude legend's bar, in three bands. */
function BandsGlyph() {
  return (
    <Glyph>
      <rect x="9" y="3" width="6" height="18" rx="3" />
      <path d="M9 9h6" />
      <path d="M9 15h6" />
    </Glyph>
  );
}

/** Heights stretched up off the ground. */
function LiftGlyph() {
  return (
    <Glyph>
      <path d="M4 21h16" />
      <path d="M12 17V4" />
      <path d="m8 8 4-4 4 4" />
    </Glyph>
  );
}

function ToggleButton({
  label,
  hint,
  pressed,
  disabled = false,
  onToggle,
  children,
}: {
  label: string;
  /** Shown under the label; the on or off state when left out. */
  hint?: string;
  pressed: boolean;
  disabled?: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  // aria-disabled rather than disabled, so the tooltip can still say why.
  return (
    <Tooltip label={label} hint={hint ?? (pressed ? "On" : "Off")} side="right">
      <motion.button
        type="button"
        className={`flex h-8 w-8 items-center justify-center select-none transition-colors aria-disabled:cursor-not-allowed aria-disabled:opacity-35 ${
          pressed ? "text-foreground" : "text-subtle"
        }`}
        whileHover={disabled ? undefined : { scale: 1.12 }}
        whileTap={disabled ? undefined : { scale: 0.88 }}
        aria-label={label}
        aria-pressed={pressed}
        aria-disabled={disabled || undefined}
        onClick={disabled ? undefined : onToggle}
        onContextMenu={(e) => e.preventDefault()}
      >
        {children}
      </motion.button>
    </Tooltip>
  );
}

// The same separators as the camera controls.
function Divider() {
  return <div className="mx-auto h-px w-4 bg-card" />;
}

function GroupDivider() {
  return <div className="mx-auto my-0.5 h-px w-6 bg-border" />;
}

/**
 * Quick toggles for the trail and altitude settings people flip most,
 * mirroring the camera controls on the other side of the map. Everything
 * else stays in Settings.
 */
export function MapToggles() {
  const { settings, update } = useSettings();
  const ceiling = formatAltitude(
    settings.trailCeilingFt * METERS_PER_FOOT,
    settings.unitSystem,
  );

  return (
    <motion.div
      initial={{ opacity: 0, x: -12 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{
        type: "spring",
        stiffness: 300,
        damping: 24,
        delay: 0.55,
      }}
      className="flex flex-col items-center rounded-lg border border-border bg-background"
      role="toolbar"
      aria-label="Map layers"
      aria-orientation="vertical"
    >
      <TooltipProvider>
        <ToggleButton
          label="Flight trails"
          pressed={settings.showTrails}
          onToggle={() => update("showTrails", !settings.showTrails)}
        >
          <TrailGlyph />
        </ToggleButton>
        <Divider />
        <ToggleButton
          label="Hide high trails"
          hint={
            settings.showTrails
              ? `${settings.hideHighTrails ? "On" : "Off"} · above ${ceiling}`
              : "Needs flight trails"
          }
          pressed={settings.showTrails && settings.hideHighTrails}
          disabled={!settings.showTrails}
          onToggle={() => update("hideHighTrails", !settings.hideHighTrails)}
        >
          <CeilingGlyph />
        </ToggleButton>

        <GroupDivider />

        <ToggleButton
          label="Altitude colors"
          pressed={settings.showAltitudeColors}
          onToggle={() =>
            update("showAltitudeColors", !settings.showAltitudeColors)
          }
        >
          <BandsGlyph />
        </ToggleButton>
        <Divider />
        <ToggleButton
          label="Exaggerated heights"
          pressed={settings.altitudeDisplayMode === "presentation"}
          onToggle={() =>
            update(
              "altitudeDisplayMode",
              settings.altitudeDisplayMode === "presentation"
                ? "realistic"
                : "presentation",
            )
          }
        >
          <LiftGlyph />
        </ToggleButton>
      </TooltipProvider>
    </motion.div>
  );
}
