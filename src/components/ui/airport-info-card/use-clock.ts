"use client";

import { useEffect, useState } from "react";

/** UTC + browser-local wall-clock, ticking every 30 s. */
export function useClock(): { utc: string; local: string } {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);
  const utc = `${String(now.getUTCHours()).padStart(2, "0")}:${String(
    now.getUTCMinutes(),
  ).padStart(2, "0")}Z`;
  const local = `${String(now.getHours()).padStart(2, "0")}:${String(
    now.getMinutes(),
  ).padStart(2, "0")}`;
  return { utc, local };
}
