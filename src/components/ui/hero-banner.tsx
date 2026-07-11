"use client";

import { useMemo, useState, useEffect } from "react";
import { Camera } from "lucide-react";
import type { NormalizedPhoto } from "@/hooks/use-aircraft-photos";

type HeroBannerProps = {
  photo: NormalizedPhoto | null;
  loading: boolean;
};

export function HeroBanner({
  photo,
  loading,
}: HeroBannerProps) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [sourceIndex, setSourceIndex] = useState(0);
  const candidates = useMemo(() => {
    const urls = [photo?.url, photo?.thumbnail]
      .map((url) => url?.trim())
      .filter((url): url is string => Boolean(url));

    return Array.from(new Set(urls));
  }, [photo?.thumbnail, photo?.url]);
  const source = candidates[sourceIndex] ?? null;
  const candidateKey = candidates.join("|");

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setLoaded(false);
      setFailed(false);
      setSourceIndex(0);
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [photo?.id, candidateKey]);

  const hasPhoto = source != null && !failed;

  return (
    <div className="relative h-52 w-full overflow-hidden bg-foreground/[0.04] sm:h-56">
      {(loading || (hasPhoto && !loaded)) && (
        <span
          aria-hidden
          className="absolute inset-0 animate-pulse bg-linear-to-br from-foreground/[0.04] via-foreground/[0.08] to-foreground/[0.04]"
        />
      )}

      {source && !failed && (
        <>
          <img
            key={source}
            src={source}
            alt="Aircraft"
            loading="eager"
            decoding="async"
            referrerPolicy="no-referrer"
            onLoad={() => setLoaded(true)}
            onError={() => {
              const nextIndex = sourceIndex + 1;
              if (nextIndex < candidates.length) {
                setLoaded(false);
                setSourceIndex(nextIndex);
                return;
              }
              setFailed(true);
            }}
            className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] ${loaded ? "opacity-100" : "opacity-0"}`}
            draggable={false}
          />
          <span className="pointer-events-none absolute inset-0 bg-linear-to-t from-background/55 via-background/5 to-transparent" />
          {photo?.photographer && loaded && (
            <span className="absolute bottom-2 right-2.5 flex items-center gap-1 rounded-full border border-foreground/[0.06] bg-background/55 px-2.5 py-1 text-[9px] font-medium text-foreground/65 shadow-sm backdrop-blur-md">
              <Camera className="h-2.5 w-2.5" />
              {photo?.photographer}
            </span>
          )}
        </>
      )}
    </div>
  );
}
