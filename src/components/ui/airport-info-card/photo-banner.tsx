"use client";

import { ExternalLink, X } from "lucide-react";
import type { AirportPhoto } from "./types";

type Props = {
  photo: AirportPhoto | null;
  loading: boolean;
  errored: boolean;
  onError: () => void;
  /** Renders a floating close button on top of the image. Omit for read-only usage. */
  onClose?: () => void;
};

/**
 * Photo banner — 16:9 hero image at top of the airport card.
 * Hides itself (returns null) when there's nothing to show, letting the
 * card fall back to a header-first layout automatically.
 *
 * When `onClose` is provided, a floating close button sits in the top-right
 * corner over a subtle dark scrim so it's always legible regardless of photo.
 */
export function PhotoBanner({
  photo,
  loading,
  errored,
  onError,
  onClose,
}: Props) {
  // Nothing to render once everything failed/absent — caller still gets a clean card.
  if (errored) return null;
  if (!loading && !photo) return null;

  return (
    <div className="relative aspect-video w-full overflow-hidden bg-foreground/5">
      {loading && !photo && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="h-6 w-6 animate-pulse rounded-full bg-foreground/10" />
        </div>
      )}

      {photo && (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element -- Wikimedia photos; skip next/image optimizer/remotePatterns gate. */}
          <img
            src={photo.thumbUrl}
            alt={photo.pageTitle}
            width={photo.width}
            height={photo.height}
            loading="lazy"
            decoding="async"
            onError={onError}
            className="h-full w-full object-cover outline outline-1 -outline-offset-1 outline-black/10 dark:outline-white/10"
          />

          {/* Bottom gradient for Wikipedia credit */}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-linear-to-t from-background/80 via-background/20 to-transparent" />

          <a
            href={photo.pageUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="absolute bottom-2 left-3 inline-flex items-center gap-1 rounded-md bg-background/40 px-1.5 py-0.5 text-[9px] font-medium text-foreground/70 backdrop-blur-sm transition-colors hover:bg-background/60 hover:text-foreground/90"
          >
            <span>Wikipedia</span>
            <ExternalLink className="h-2.5 w-2.5" />
          </a>
        </>
      )}

      {/* Floating close — always rendered so the skeleton is also dismissible. */}
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          className="absolute top-2 right-2 flex h-10 w-10 items-center justify-center rounded-full bg-background/60 text-foreground/80 ring-1 ring-foreground/10 backdrop-blur-md [transition-property:background-color,color,scale] [transition-duration:180ms] hover:bg-background/80 hover:text-foreground active:scale-[0.96]"
          aria-label="Close airport info"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
