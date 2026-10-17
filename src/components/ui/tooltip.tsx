"use client";

import type { ReactElement, ReactNode } from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";

/**
 * Shares the hover delay between the tooltips inside it: once one has
 * opened, moving to a neighbour opens the next one straight away.
 */
export function TooltipProvider({ children }: { children: ReactNode }) {
  return (
    <TooltipPrimitive.Provider delayDuration={400} skipDelayDuration={300}>
      {children}
    </TooltipPrimitive.Provider>
  );
}

/**
 * A short label for a control, shown on hover and keyboard focus, styled
 * like the map's own hover labels. The trigger must be a single element
 * that forwards its ref, such as a button. Touch screens never show it, so
 * the control still needs its own aria-label.
 */
export function Tooltip({
  label,
  hint,
  side = "top",
  children,
}: {
  label: string;
  /** A second, quieter line, such as a control's current state. */
  hint?: string;
  side?: "top" | "right" | "bottom" | "left";
  children: ReactElement;
}) {
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          sideOffset={8}
          collisionPadding={8}
          className="aeris-tooltip z-50 flex select-none flex-col rounded-sm border border-border bg-background px-2.5 py-1 text-label text-foreground shadow-lift"
        >
          {label}
          {hint && <span className="text-subtle">{hint}</span>}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
