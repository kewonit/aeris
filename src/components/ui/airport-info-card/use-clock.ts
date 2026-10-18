"use client";

import { useEffect, useState } from "react";

/**
 * The UTC wall clock, ticking every 30 s. Airport data has no time zone, so
 * there is no airport-local time to show next to it.
 */
export function useClock(): { utc: string } {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);
  const utc = `${String(now.getUTCHours()).padStart(2, "0")}:${String(
    now.getUTCMinutes(),
  ).padStart(2, "0")}Z`;
  return { utc };
}
