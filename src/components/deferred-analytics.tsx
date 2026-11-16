"use client";

import { GoogleAnalytics } from "@next/third-parties/google";
import { useEffect, useState } from "react";

/** Long enough for the map's own scripts and first flights to come first. */
const AFTER_LOAD_MS = 2_000;

/**
 * Google Analytics, mounted once the page has loaded and the browser is
 * idle, so its 180 KB script doesn't compete with the map's on a slow
 * connection. Mounted, it reports the page view and later route changes
 * as before.
 */
export function DeferredAnalytics({ gaId }: { gaId: string }) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let timer: number | undefined;
    let idle: number | undefined;
    const start = () => {
      timer = window.setTimeout(() => {
        if ("requestIdleCallback" in window) {
          idle = window.requestIdleCallback(() => setReady(true), {
            timeout: 3_000,
          });
        } else {
          setReady(true);
        }
      }, AFTER_LOAD_MS);
    };
    if (document.readyState === "complete") start();
    else window.addEventListener("load", start, { once: true });
    return () => {
      window.removeEventListener("load", start);
      if (timer !== undefined) window.clearTimeout(timer);
      if (idle !== undefined) window.cancelIdleCallback(idle);
    };
  }, []);

  return ready ? <GoogleAnalytics gaId={gaId} /> : null;
}
