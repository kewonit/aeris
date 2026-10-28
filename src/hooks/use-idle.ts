"use client";

import { useEffect, useState } from "react";

const ACTIVITY = ["pointermove", "pointerdown", "wheel", "keydown"] as const;

/** True once nobody has moved, pressed, scrolled or typed for `ms`. */
export function useIdle(ms: number): boolean {
  const [idle, setIdle] = useState(false);

  useEffect(() => {
    let timer = 0;
    const wake = () => {
      setIdle(false);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setIdle(true), ms);
    };
    for (const type of ACTIVITY) window.addEventListener(type, wake, { passive: true });
    timer = window.setTimeout(() => setIdle(true), ms);
    return () => {
      window.clearTimeout(timer);
      for (const type of ACTIVITY) window.removeEventListener(type, wake);
    };
  }, [ms]);

  return idle;
}
