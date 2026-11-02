"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  animate,
  motion,
  useDragControls,
  useMotionValue,
  type PanInfo,
} from "motion/react";
import { SHEET } from "@/lib/motion";
import { nearestDetent, sheetDetents, type Detent } from "./sheet-math";

/** How far past the lowest height a release has to land to close the sheet. */
const DISMISS_PAST_PX = 56;
/** Before a card marks its peek, the sheet rests this high. */
const FALLBACK_PEEK_PX = 240;
/** Room left under the last thing the peek shows. */
const PEEK_BREATHING_PX = 8;

/**
 * The phone's place card: a sheet that rests low enough to leave the map
 * in view, with the card's header, status and actions showing. Pulled up
 * it shows half the screen, then all of it, where the card scrolls. A
 * flick goes as far as it was thrown. It never blocks the map above it.
 *
 * The card marks where its peek ends with `data-sheet-peek`.
 */
export function PlaceSheet({
  label,
  contentKey,
  onDismiss,
  onPeekChange,
  children,
}: {
  label: string;
  /** Changes when the card shows something else, to measure it again. */
  contentKey: string;
  onDismiss: () => void;
  /** Reports how much of the screen the sheet covers at rest. */
  onPeekChange?: (px: number) => void;
  children: ReactNode;
}) {
  const sheetRef = useRef<HTMLElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const controls = useDragControls();
  const y = useMotionValue(10_000);
  const [detent, setDetent] = useState<Detent>("peek");
  const metrics = useRef({ height: 0, viewport: 0, peek: 0 });
  const opened = useRef(false);

  const yFor = useCallback((target: Detent) => {
    const { height, viewport, peek } = metrics.current;
    return sheetDetents({ height, viewport, peek })[target];
  }, []);

  const settle = useCallback(
    (target: Detent, velocity = 0) => {
      setDetent(target);
      animate(y, yFor(target), { ...SHEET, velocity });
      if (target !== "full") contentRef.current?.scrollTo({ top: 0 });
    },
    [y, yFor],
  );

  // Measures the sheet and where the card's peek ends, then comes up to it
  // the first time, or moves to the new peek if it was resting there.
  useLayoutEffect(() => {
    const sheet = sheetRef.current;
    const content = contentRef.current;
    if (!sheet || !content) return;
    const measure = () => {
      // The sheet and the card move together, so the distance from the
      // sheet's top to the end of the card's peek holds at any offset.
      const marker = content.querySelector<HTMLElement>("[data-sheet-peek]");
      const sheetTop = sheet.getBoundingClientRect().top;
      const peekEnd = marker
        ? marker.getBoundingClientRect().bottom + content.scrollTop
        : sheetTop + FALLBACK_PEEK_PX;
      const peek = Math.round(peekEnd - sheetTop + PEEK_BREATHING_PX);
      metrics.current = {
        height: sheet.offsetHeight,
        viewport: window.innerHeight,
        peek,
      };
      onPeekChange?.(peek);
      if (!opened.current) {
        opened.current = true;
        y.set(sheet.offsetHeight);
        settle("peek");
      } else if (detent === "peek") {
        animate(y, yFor("peek"), SHEET);
      }
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(sheet);
    // The card's own size changes as the route and photo arrive, which
    // moves its peek, so the whole card is watched.
    if (content.firstElementChild) observer.observe(content.firstElementChild);
    return () => observer.disconnect();
    // Re-measure for new content; the detent is read when it runs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contentKey, onPeekChange, settle, y, yFor]);

  useEffect(() => () => onPeekChange?.(0), [onPeekChange]);

  const onDragEnd = useCallback(
    (_: unknown, info: PanInfo) => {
      const current = y.get();
      const projected = current + info.velocity.y * 0.2;
      const peekY = yFor("peek");
      if (projected > peekY + DISMISS_PAST_PX) {
        animate(y, metrics.current.height, { ...SHEET, velocity: info.velocity.y });
        onDismiss();
        return;
      }
      const { height, viewport, peek } = metrics.current;
      settle(nearestDetent(sheetDetents({ height, viewport, peek }), projected), info.velocity.y);
    },
    [onDismiss, settle, y, yFor],
  );

  const startDrag = (event: React.PointerEvent) => {
    // Buttons and links inside keep their taps.
    if ((event.target as HTMLElement).closest("button, a, input, summary, [role='tab']")) {
      return;
    }
    controls.start(event);
  };

  return (
    <motion.section
      ref={sheetRef}
      aria-label={label}
      className="aeris-float pointer-events-auto fixed inset-x-0 bottom-0 z-40 flex h-[calc(100dvh-env(safe-area-inset-top)-0.5rem)] flex-col rounded-t-xl"
      style={{ y }}
      exit={{ y: "100%" }}
      transition={SHEET}
      drag="y"
      dragListener={false}
      dragControls={controls}
      dragConstraints={{ top: 0, bottom: 10_000 }}
      dragElastic={{ top: 0.04, bottom: 0.3 }}
      dragMomentum={false}
      onDragEnd={onDragEnd}
    >
      <button
        type="button"
        onPointerDown={(event) => controls.start(event)}
        onClick={() => settle(detent === "full" ? "peek" : "full")}
        className="flex h-6 shrink-0 cursor-grab touch-none justify-center pt-2 active:cursor-grabbing"
        aria-label={detent === "full" ? "Show less" : "Show more"}
        aria-expanded={detent === "full"}
      >
        <span className="h-1 w-9 rounded-full bg-border" aria-hidden="true" />
      </button>
      <div
        ref={contentRef}
        onPointerDown={detent === "full" ? undefined : startDrag}
        className={`min-h-0 flex-1 overscroll-contain pb-[env(safe-area-inset-bottom)] ${
          detent === "full" ? "overflow-y-auto" : "touch-none overflow-hidden"
        }`}
      >
        {children}
      </div>
    </motion.section>
  );
}
