"use client";

import { forwardRef, type ComponentPropsWithoutRef } from "react";
import { motion } from "motion/react";
import { PRESS_SCALE } from "@/lib/motion";

/** The one surface for everything that floats over the map (globals.css). */
export const FLOATING_SURFACE = "aeris-float";
/** The frosted version, for navigation only (globals.css). */
export const NAV_SURFACE = "aeris-float aeris-glass";

/** A round 44px control that sits on the map. */
export const MapButton = forwardRef<
  HTMLButtonElement,
  ComponentPropsWithoutRef<typeof motion.button> & { active?: boolean }
>(function MapButton({ className = "", active = false, ...props }, ref) {
  return (
    <motion.button
      ref={ref}
      type="button"
      whileTap={{ scale: PRESS_SCALE }}
      className={`grid size-11 shrink-0 place-items-center rounded-full ${NAV_SURFACE} transition-colors ${
        active ? "text-tint" : "text-muted-foreground hover:text-foreground"
      } ${className}`}
      {...props}
    />
  );
});
