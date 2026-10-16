"use client";

import type { AirportPhoto } from "./types";

type Props = {
  photo: AirportPhoto | null;
  loading: boolean;
  errored: boolean;
  onError: () => void;
  airportName: string;
};

/**
 * The airport's Wikipedia photo. A card surface holds the space while the
 * lookup runs, and the banner collapses when there is no usable photo.
 */
export function PhotoBanner({
  photo,
  loading,
  errored,
  onError,
  airportName,
}: Props) {
  const showPhoto = photo !== null && !errored;
  if (!loading && !showPhoto) return null;

  return (
    <figure className="m-0">
      <div className="relative aspect-video w-full overflow-hidden bg-card">
        {showPhoto && (
          // eslint-disable-next-line @next/next/no-img-element -- Wikimedia photos skip the next/image host allowlist.
          <img
            src={photo.thumbUrl}
            alt={airportName}
            width={photo.width}
            height={photo.height}
            decoding="async"
            onError={onError}
            className="absolute inset-0 size-full object-cover"
          />
        )}
      </div>
      {showPhoto && (
        <figcaption className="px-6 pt-2 text-micro text-subtle">
          Photo:{" "}
          <a
            href={photo.pageUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="underline-offset-2 hover:text-foreground hover:underline"
          >
            Wikipedia
          </a>
        </figcaption>
      )}
    </figure>
  );
}
