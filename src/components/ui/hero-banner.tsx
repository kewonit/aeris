"use client";

import { useMemo, useState } from "react";
import type { NormalizedPhoto } from "@/hooks/use-aircraft-photos";

type HeroBannerProps = {
  photo: NormalizedPhoto | null;
  loading: boolean;
  alt: string;
};

/**
 * The aircraft photo at the top of the sidebar. While the lookup runs it
 * holds the space with a plain card surface; with no usable photo it
 * collapses. The full image is tried first, then the thumbnail.
 */
export function HeroBanner({ photo, loading, alt }: HeroBannerProps) {
  const candidates = useMemo(
    () => [
      ...new Set(
        [photo?.url, photo?.thumbnail]
          .map((url) => url?.trim())
          .filter((url): url is string => Boolean(url)),
      ),
    ],
    [photo?.thumbnail, photo?.url],
  );
  const candidateKey = candidates.join("|");
  const [state, setState] = useState({ key: candidateKey, index: 0, loaded: false });
  const current =
    state.key === candidateKey
      ? state
      : { key: candidateKey, index: 0, loaded: false };
  const source = candidates[current.index] ?? null;

  if (!loading && !source) return null;

  return (
    <figure className="m-0">
      <div className="relative aspect-video w-full overflow-hidden bg-card">
        {source && (
          // eslint-disable-next-line @next/next/no-img-element -- Photo hosts are not known at build time.
          <img
            key={source}
            src={source}
            alt={alt}
            decoding="async"
            referrerPolicy="no-referrer"
            draggable={false}
            onLoad={() => setState({ ...current, loaded: true })}
            onError={() =>
              setState({ ...current, index: current.index + 1, loaded: false })
            }
            className={`absolute inset-0 size-full object-cover transition-opacity duration-300 ${current.loaded ? "opacity-100" : "opacity-0"}`}
          />
        )}
      </div>
      {photo?.photographer && current.loaded && (
        <figcaption className="px-6 pt-2 text-micro text-subtle">
          Photo: {photo.photographer}
        </figcaption>
      )}
    </figure>
  );
}
