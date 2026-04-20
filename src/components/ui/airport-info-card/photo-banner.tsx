"use client";

import { ExternalLink, X } from "lucide-react";
import type { AirportPhoto } from "./types";

type Props = {
  photo: AirportPhoto | null;
  loading: boolean;
  errored: boolean;
  onError: () => void;
  airportName: string;
  iata: string;
  icao: string | null;
  city: string;
  country: string;
  /** Renders a floating close button on top of the image. Omit for read-only usage. */
  onClose?: () => void;
};

/**
 * Photo banner — 16:9 hero image at top of the airport card.
 * Always renders the banner container. When no usable photo is available,
 * it falls back to the non-photo hero presentation instead of returning null.
 *
 * When `onClose` is provided, a floating close button sits in the top-right
 * corner over a subtle dark scrim so it's always legible regardless of photo.
 */
export function PhotoBanner({
  photo,
  loading,
  errored,
  onError,
  airportName,
  iata,
  icao,
  city,
  country,
  onClose,
}: Props) {
  const showPhoto = !!photo && !errored;
  const location = country ? `${city} • ${country}` : city;

  return (
    <div className="relative aspect-video w-full overflow-hidden bg-background">
      <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(255,255,255,0.05),rgba(255,255,255,0.02)_42%,rgba(255,255,255,0.01))]" />
      <div className="absolute inset-0 opacity-50 [background-image:linear-gradient(to_right,rgba(255,255,255,0.06)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.06)_1px,transparent_1px)] [background-size:26px_26px] [mask-image:linear-gradient(to_bottom,rgba(255,255,255,0.85),transparent)]" />
      <div className="absolute -left-6 top-5 h-28 w-28 rounded-full bg-white/10 blur-2xl" />
      <div className="absolute left-8 top-8 h-10 w-10 rounded-full bg-white/20 ring-1 ring-white/10 shadow-[0_0_40px_rgba(255,255,255,0.32)]" />
      <div className="absolute inset-x-0 bottom-0 h-20 bg-linear-to-t from-background via-background/70 to-transparent" />

      <div className="absolute inset-0 flex flex-col justify-end p-4 sm:p-5">
        <div className="max-w-[16rem]">
          <div className="flex items-end gap-3">
            <span className="text-[2.6rem] font-semibold tracking-tight text-foreground sm:text-5xl">
              {iata}
            </span>
            {icao && (
              <span className="mb-1 font-mono text-[0.72rem] font-medium uppercase tracking-[0.32em] text-foreground/38 sm:text-xs">
                {icao}
              </span>
            )}
          </div>
          <p className="mt-2 text-sm font-medium leading-tight text-foreground/72 sm:text-[15px]">
            {airportName}
          </p>
          <p className="mt-1 text-[10px] font-medium uppercase tracking-[0.3em] text-foreground/34 sm:text-[11px]">
            {location}
          </p>
        </div>
      </div>

      {loading && !showPhoto && (
        <div className="absolute inset-0 bg-white/[0.03] animate-pulse" />
      )}

      {showPhoto && (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element -- Wikimedia photos; skip next/image optimizer/remotePatterns gate. */}
          <img
            src={photo!.thumbUrl}
            alt={photo!.pageTitle}
            width={photo!.width}
            height={photo!.height}
            loading="lazy"
            decoding="async"
            onError={onError}
            className="absolute inset-0 h-full w-full object-cover outline outline-1 -outline-offset-1 outline-black/10 dark:outline-white/10"
          />

          {/* Bottom gradient for Wikipedia credit */}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-14 bg-linear-to-t from-background/90 via-background/35 to-transparent" />

          <a
            href={photo!.pageUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="absolute bottom-2 left-3 z-20 inline-flex items-center gap-1 rounded-md bg-background/45 px-1.5 py-0.5 text-[9px] font-medium text-foreground/72 backdrop-blur-sm transition-colors hover:bg-background/60 hover:text-foreground/92"
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
          className="absolute top-2 right-2 z-20 flex h-10 w-10 items-center justify-center rounded-full bg-background/60 text-foreground/80 ring-1 ring-foreground/10 backdrop-blur-md [transition-property:background-color,color,scale] [transition-duration:180ms] hover:bg-background/80 hover:text-foreground active:scale-[0.96]"
          aria-label="Close airport info"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
