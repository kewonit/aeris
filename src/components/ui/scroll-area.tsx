"use client";

import {
  forwardRef,
  useRef,
  useState,
  useEffect,
  useCallback,
  type HTMLAttributes,
} from "react";
import { cn } from "@/lib/utils";

type ScrollAreaProps = HTMLAttributes<HTMLDivElement>;

export const ScrollArea = forwardRef<HTMLDivElement, ScrollAreaProps>(
  ({ className, children, ...props }, ref) => {
    const viewportRef = useRef<HTMLDivElement>(null);
    const thumbRef = useRef<HTMLDivElement>(null);
    const [thumbHeight, setThumbHeight] = useState(0);
    const [thumbTop, setThumbTop] = useState(0);
    const [visible, setVisible] = useState(false);
    const hideTimer = useRef<ReturnType<typeof setTimeout>>(null);

    const updateThumb = useCallback(() => {
      const vp = viewportRef.current;
      if (!vp) return;

      const ratio = vp.clientHeight / vp.scrollHeight;
      if (ratio >= 1) {
        setVisible(false);
        return;
      }

      setThumbHeight(Math.max(ratio * vp.clientHeight, 24));
      setThumbTop(
        (vp.scrollTop / (vp.scrollHeight - vp.clientHeight)) *
          (vp.clientHeight - Math.max(ratio * vp.clientHeight, 24)),
      );
      setVisible(true);

      if (hideTimer.current) clearTimeout(hideTimer.current);
      hideTimer.current = setTimeout(() => setVisible(false), 1200);
    }, []);

    useEffect(() => {
      const vp = viewportRef.current;
      if (!vp) return;

      const onScroll = () => updateThumb();
      vp.addEventListener("scroll", onScroll, { passive: true });

      const observer = new ResizeObserver(() => updateThumb());
      observer.observe(vp);

      return () => {
        vp.removeEventListener("scroll", onScroll);
        observer.disconnect();
      };
    }, [updateThumb]);

    return (
      <div
        ref={ref}
        className={cn("relative overflow-hidden", className)}
        {...props}
      >
        <div
          ref={viewportRef}
          className="h-full w-full overflow-y-auto overflow-x-hidden scrollbar-none"
          style={{ scrollbarWidth: "none" }}
          onMouseEnter={updateThumb}
        >
          {children}
        </div>
        <div
          className={cn(
            "absolute right-0.5 top-0 bottom-0 w-1.5 transition-opacity duration-300",
            visible ? "opacity-100" : "opacity-0",
          )}
        >
          <div
            ref={thumbRef}
            className="absolute w-full rounded-full bg-white/15 transition-[background-color] duration-150 hover:bg-white/25"
            style={{
              height: thumbHeight,
              transform: `translateY(${thumbTop}px)`,
            }}
          />
        </div>
      </div>
    );
  },
);

ScrollArea.displayName = "ScrollArea";
