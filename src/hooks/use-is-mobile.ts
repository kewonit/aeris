"use client";

import { useSyncExternalStore } from "react";

function subscribe(callback: () => void): () => void {
  const mql = window.matchMedia("(max-width: 639px)");
  mql.addEventListener("change", callback);
  return () => mql.removeEventListener("change", callback);
}

function getSnapshot(): boolean {
  return window.matchMedia("(max-width: 639px)").matches;
}

function getServerSnapshot(): boolean {
  return false;
}

/**
 * Returns true when viewport width is below the sm breakpoint (640px).
 * SSR-safe — returns false on server.
 */
export function useIsMobile(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
