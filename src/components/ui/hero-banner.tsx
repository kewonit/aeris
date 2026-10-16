"use client";

import { useMemo, useState } from "react";
import { Plane } from "lucide-react";
import type { NormalizedPhoto } from "@/hooks/use-aircraft-photos";

type HeroBannerProps = {
  photo: NormalizedPhoto | null;
  loading: boolean;
  alt: string;
};

/**
 * The aircraft photo at the top of the sidebar. The 16:9 frame and the
 * credit line always hold their space, so nothing below moves when the
 * lookup finishes, the image loads, or no photo exists. The full image is
 * tried first, then the thumbnail.
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
  const showPlaceholder = !loading && !source;

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
        {showPlaceholder && (
          <Plane
            className="absolute inset-0 m-auto size-8 -rotate-45 text-border"
            aria-hidden="true"
          />
        )}
      </div>
      <figcaption className="h-7 truncate px-6 pt-2 text-micro text-subtle">
        {showPlaceholder
          ? "No photo of this aircraft"
          : photo?.photographer && current.loaded
            ? `Photo: ${photo.photographer}`
            : null}
      </figcaption>
    </figure>
  );
}
