"use client";

import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Camera } from "lucide-react";
import type { NormalizedPhoto } from "@/hooks/use-aircraft-photos";

type HeroBannerProps = {
  photo: NormalizedPhoto | null;
  loading: boolean;
  alt: string;
};

export function HeroBanner({
  photo,
  loading,
  alt,
}: HeroBannerProps) {
  const candidates = useMemo(() => {
    const urls = [photo?.url, photo?.thumbnail]
      .map((url) => url?.trim())
      .filter((url): url is string => Boolean(url));

    return Array.from(new Set(urls));
  }, [photo?.thumbnail, photo?.url]);
  const candidateKey = candidates.join("|");
  const [imageState, setImageState] = useState({
    key: candidateKey,
    loaded: false,
    failed: false,
    sourceIndex: 0,
  });
  const activeImageState =
    imageState.key === candidateKey
      ? imageState
      : {
          key: candidateKey,
          loaded: false,
          failed: false,
          sourceIndex: 0,
        };
  const { loaded, failed, sourceIndex } = activeImageState;
  const source = candidates[sourceIndex] ?? null;

  const hasPhoto = source != null && !failed;
  const visible = shouldRenderHeroBanner(photo, loading, failed);

  return (
    <AnimatePresence initial={false}>
      {visible && (
        <motion.div
          key="aircraft-hero"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
          className="relative h-52 w-full overflow-hidden bg-foreground/[0.04] sm:h-56"
        >
          {(loading || (hasPhoto && !loaded)) && (
            <span
              aria-hidden
              className="absolute inset-0 animate-pulse bg-linear-to-br from-foreground/[0.04] via-foreground/[0.08] to-foreground/[0.04]"
            />
          )}

          {source && !failed && (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element -- Photo sources can use external hosts that are not known at build time. */}
              <img
                key={source}
                src={source}
                alt={alt}
                loading="eager"
                decoding="async"
                referrerPolicy="no-referrer"
                onLoad={() =>
                  setImageState((current) => ({
                    ...current,
                    key: candidateKey,
                    loaded: true,
                    failed: false,
                    sourceIndex,
                  }))
                }
                onError={() => {
                  const nextIndex = sourceIndex + 1;
                  if (nextIndex < candidates.length) {
                    setImageState({
                      key: candidateKey,
                      loaded: false,
                      failed: false,
                      sourceIndex: nextIndex,
                    });
                    return;
                  }
                  setImageState({
                    key: candidateKey,
                    loaded: false,
                    failed: true,
                    sourceIndex,
                  });
                }}
                className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] ${loaded ? "opacity-100" : "opacity-0"}`}
                draggable={false}
              />
              <span className="pointer-events-none absolute inset-0 bg-linear-to-t from-background/55 via-background/5 to-transparent" />
              {photo?.photographer && loaded && (
                <span className="absolute bottom-2 right-2.5 flex items-center gap-1 rounded-full border border-foreground/[0.06] bg-background/55 px-2.5 py-1 text-[9px] font-medium text-foreground/65 shadow-sm backdrop-blur-md">
                  <Camera className="h-2.5 w-2.5" aria-hidden="true" />
                  Photo: {photo.photographer}
                </span>
              )}
            </>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function shouldRenderHeroBanner(
  photo: NormalizedPhoto | null,
  loading: boolean,
  failed: boolean,
): boolean {
  return loading || (photo !== null && !failed);
}
