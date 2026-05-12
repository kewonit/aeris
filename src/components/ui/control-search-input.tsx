"use client";

import * as React from "react";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * ControlSearchInput
 *
 * The beloved search input from the Search tab, extracted for reuse
 * across all control panel tabs.
 *
 * Features:
 * - rounded-2xl with subtle bg/border
 * - Focus states with bg-foreground/[0.05] + border-foreground/[0.12]
 * - Clear button (X) when text is present
 * - Auto-focus support via ref
 * - Full accessibility labels
 * - shadcn/ui Input-style API compatibility
 */

export interface ControlSearchInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange"> {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  label?: string;
  wrapperClassName?: string;
  iconClassName?: string;
}

export const ControlSearchInput = React.forwardRef<
  HTMLInputElement,
  ControlSearchInputProps
>(
  (
    {
      value,
      onChange,
      placeholder = "Search…",
      label,
      wrapperClassName,
      iconClassName,
      className,
      ...props
    },
    ref,
  ) => {
    const hasValue = value.length > 0;

    return (
      <div
        className={cn(
          "flex items-center gap-3 rounded-2xl bg-foreground/[0.035] border border-foreground/[0.06] px-4 py-3.5 transition-colors focus-within:bg-foreground/[0.05] focus-within:border-foreground/[0.12]",
          wrapperClassName,
        )}
      >
        <Search
          className={cn(
            "h-[18px] w-[18px] shrink-0 text-foreground/25",
            iconClassName,
          )}
          aria-hidden="true"
        />
        <input
          ref={ref}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          aria-label={label ?? placeholder}
          className={cn(
            "flex-1 bg-transparent text-[15px] font-normal text-foreground/85 placeholder:text-foreground/25 outline-none min-w-0",
            className,
          )}
          {...props}
        />
        {hasValue && (
          <button
            type="button"
            onClick={() => onChange("")}
            className="shrink-0 flex h-6 w-6 items-center justify-center rounded-full bg-foreground/10 text-foreground/30 hover:bg-foreground/15 hover:text-foreground/50 transition-all"
            aria-label="Clear search"
            tabIndex={-1}
          >
            <X className="h-3 w-3" strokeWidth={2.5} />
          </button>
        )}
      </div>
    );
  },
);

ControlSearchInput.displayName = "ControlSearchInput";

/**
 * SearchEmptyState
 *
 * Consistent empty state used when a tab's search returns no results.
 */
export function SearchEmptyState({
  icon: Icon,
  title = "No results found",
  description,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  title?: string;
  description?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-5">
      <div className="flex h-14 w-14 items-center justify-center rounded-[22px] bg-foreground/[0.04]">
        {Icon ? (
          <Icon className="h-6 w-6 text-foreground/12" />
        ) : (
          <Search className="h-6 w-6 text-foreground/12" />
        )}
      </div>
      <div className="text-center space-y-2">
        <p className="text-[15px] font-medium text-foreground/25">{title}</p>
        {description && (
          <p className="text-[13px] text-foreground/15 max-w-[220px] leading-relaxed">
            {description}
          </p>
        )}
      </div>
    </div>
  );
}

