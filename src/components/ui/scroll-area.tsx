"use client";

import {
  forwardRef,
  useEffect,
  useRef,
  type ComponentPropsWithoutRef,
  type Ref,
  type UIEvent,
} from "react";
import * as ScrollAreaPrimitive from "@radix-ui/react-scroll-area";

import { cn } from "@/lib/utils";

/** How long the scrollbar stays after the content last scrolled. */
const SCROLL_HIDE_DELAY_MS = 800;

type ScrollAreaProps = ComponentPropsWithoutRef<
  typeof ScrollAreaPrimitive.Root
> & {
  /**
   * Classes for the element that scrolls. A max-height goes here, not on
   * the root, or the content is clipped instead of scrolled.
   */
  viewportClassName?: string;
  viewportRef?: Ref<HTMLDivElement>;
};

/**
 * A vertical scroll area whose scrollbar floats over the content, so it
 * never takes width and nothing reflows when it appears. The scrollbar
 * exists only while the content overflows, shows while the pointer is over
 * the area or the content is scrolling, by wheel, touch or keyboard, and
 * its thumb can be dragged.
 *
 * The root is a flex column so the viewport fills it however the root gets
 * its height: a fixed height, a flex parent, or only a max-height.
 */
export const ScrollArea = forwardRef<HTMLDivElement, ScrollAreaProps>(
  ({ className, viewportClassName, viewportRef, children, ...props }, ref) => {
    const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(
      () => () => {
        if (hideTimer.current) clearTimeout(hideTimer.current);
      },
      [],
    );

    // Marked on the root directly, so scrolling never re-renders the content.
    const showWhileScrolling = (event: UIEvent<HTMLDivElement>) => {
      const root = event.currentTarget.parentElement;
      if (!root) return;
      root.dataset.scrolling = "";
      if (hideTimer.current) clearTimeout(hideTimer.current);
      hideTimer.current = setTimeout(() => {
        delete root.dataset.scrolling;
      }, SCROLL_HIDE_DELAY_MS);
    };

    return (
      <ScrollAreaPrimitive.Root
        ref={ref}
        type="auto"
        className={cn(
          "group/scroll relative flex flex-col overflow-hidden",
          className,
        )}
        {...props}
      >
        <ScrollAreaPrimitive.Viewport
          ref={viewportRef}
          onScroll={showWhileScrolling}
          // Radix lays the content out as a table, which lets long text widen
          // the area and stops it truncating; as a block it keeps to the width.
          className={cn(
            "min-h-0 w-full flex-1 overscroll-contain [&>div]:block!",
            viewportClassName,
          )}
        >
          {children}
        </ScrollAreaPrimitive.Viewport>
        <ScrollAreaPrimitive.Scrollbar
          orientation="vertical"
          className="flex w-2 touch-none select-none p-0.5 opacity-0 transition-opacity duration-300 group-hover/scroll:opacity-100 group-data-scrolling/scroll:opacity-100"
        >
          <ScrollAreaPrimitive.Thumb className="relative flex-1 rounded-full bg-border transition-colors hover:bg-subtle" />
        </ScrollAreaPrimitive.Scrollbar>
      </ScrollAreaPrimitive.Root>
    );
  },
);

ScrollArea.displayName = "ScrollArea";
