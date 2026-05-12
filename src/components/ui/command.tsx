"use client";

import * as React from "react";
import { Command as CommandPrimitive } from "cmdk";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Aeris Command components
 *
 * shadcn/ui-style composition wrappers around cmdk v1.1.x.
 * Styled with the Aeris design system (foreground/opacity tokens,
 * rounded-2xl inputs, spring animations, etc.).
 *
 * Uses the existing `.aeris-cmdk` and `.search-item` CSS in globals.css.
 */

/* ─────────────────────────────────────────────────────────────────────── */

const Command = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive>
>(({ className, ...props }, ref) => (
  <CommandPrimitive
    ref={ref}
    className={cn(
      "flex h-full w-full flex-col overflow-hidden rounded-md bg-transparent text-foreground",
      "aeris-cmdk",
      className,
    )}
    {...props}
  />
));
Command.displayName = CommandPrimitive.displayName ?? "Command";

/* ─────────────────────────────────────────────────────────────────────── */

interface CommandInputProps
  extends React.ComponentPropsWithoutRef<typeof CommandPrimitive.Input> {
  wrapperClassName?: string;
}

const CommandInput = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Input>,
  CommandInputProps
>(({ className, wrapperClassName, ...props }, ref) => (
  <div
    className={cn(
      "flex items-center gap-3 rounded-2xl bg-foreground/[0.035] border border-foreground/[0.06] px-4 py-3.5 transition-colors focus-within:bg-foreground/[0.05] focus-within:border-foreground/[0.12]",
      wrapperClassName,
    )}
    cmdk-input-wrapper=""
  >
    <Search
      className="h-[18px] w-[18px] shrink-0 text-foreground/25"
      aria-hidden="true"
    />
    <CommandPrimitive.Input
      ref={ref}
      className={cn(
        "flex-1 bg-transparent text-[15px] font-normal text-foreground/85 placeholder:text-foreground/25 outline-none",
        className,
      )}
      {...props}
    />
  </div>
));
CommandInput.displayName = CommandPrimitive.Input.displayName ?? "CommandInput";

/* ─────────────────────────────────────────────────────────────────────── */

const CommandList = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.List>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.List
    ref={ref}
    className={cn(
      "flex-1 overflow-y-auto overflow-x-hidden scrollbar-none px-3 pb-4",
      className,
    )}
    {...props}
  />
));
CommandList.displayName = CommandPrimitive.List.displayName ?? "CommandList";

/* ─────────────────────────────────────────────────────────────────────── */

const CommandEmpty = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Empty>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Empty>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.Empty
    ref={ref}
    className={cn(
      "flex flex-col items-center justify-center py-16 gap-5",
      className,
    )}
    {...props}
  />
));
CommandEmpty.displayName = CommandPrimitive.Empty.displayName ?? "CommandEmpty";

/* ─────────────────────────────────────────────────────────────────────── */

const CommandGroup = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Group>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Group>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.Group
    ref={ref}
    className={cn(
      "overflow-hidden p-1 text-foreground",
      "[&_[cmdk-group-heading]]:px-4 [&_[cmdk-group-heading]]:py-1.5",
      "[&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-medium",
      "[&_[cmdk-group-heading]]:text-foreground/35",
      className,
    )}
    {...props}
  />
));
CommandGroup.displayName = CommandPrimitive.Group.displayName ?? "CommandGroup";

/* ─────────────────────────────────────────────────────────────────────── */

const CommandSeparator = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.Separator
    ref={ref}
    className={cn("-mx-1 h-px bg-border", className)}
    {...props}
  />
));
CommandSeparator.displayName =
  CommandPrimitive.Separator.displayName ?? "CommandSeparator";

/* ─────────────────────────────────────────────────────────────────────── */

const CommandItem = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Item>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.Item
    ref={ref}
    className={cn("search-item", className)}
    {...props}
  />
));
CommandItem.displayName = CommandPrimitive.Item.displayName ?? "CommandItem";

/* ─────────────────────────────────────────────────────────────────────── */

function CommandShortcut({
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        "ml-auto text-xs tracking-widest text-foreground/40",
        className,
      )}
      {...props}
    />
  );
}
CommandShortcut.displayName = "CommandShortcut";

/* ─────────────────────────────────────────────────────────────────────── */

export {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandSeparator,
  CommandShortcut,
};
