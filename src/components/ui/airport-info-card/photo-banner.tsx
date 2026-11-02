"use client";

import { useState } from "react";
import type { AirportPhoto } from "./types";

type Props = {
  photo: AirportPhoto | null;
  loading: boolean;
  errored: boolean;
  onError: () => void;
  airportName: string;
};

/**
 * The airport's Wikipedia photo. The 16:9 frame holds its space while the
 * photo loads; when there is none, there is no empty frame either.
 */
export function PhotoBanner({
  photo,
  loading,
  errored,
  onError,
  airportName,
}: Props) {
  const usable = photo !== null && !errored;
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null);
  const loaded = usable && loadedUrl === photo.thumbUrl;
  if (!loading && !usable) return null;

  return (
    <figure className="m-0">
      <div className="relative aspect-video w-full overflow-hidden bg-card">
        {usable && (
          // eslint-disable-next-line @next/next/no-img-element -- Wikimedia photos skip the next/image host allowlist.
          <img
            key={photo.thumbUrl}
            src={photo.thumbUrl}
            alt={airportName}
            width={photo.width}
            height={photo.height}
            decoding="async"
            onLoad={() => setLoadedUrl(photo.thumbUrl)}
            onError={onError}
            className={`absolute inset-0 size-full object-cover transition-opacity duration-300 ${loaded ? "opacity-100" : "opacity-0"}`}
          />
        )}
      </div>
      <figcaption className="h-7 truncate px-5 pt-2 text-micro text-subtle">
        {loaded ? (
          <>
            Photo:{" "}
            <a
              href={photo.pageUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="underline-offset-2 hover:text-foreground hover:underline"
            >
              Wikipedia
            </a>
          </>
        ) : null}
      </figcaption>
    </figure>
  );
}
