"use client";

import { useState } from "react";
import { Camera, ImageOff } from "lucide-react";
import type { NormalizedPhoto } from "@/hooks/use-aircraft-photos";

type HeroBannerProps = {
  photos: NormalizedPhoto[];
  loading: boolean;
};

export function HeroBanner({ photos, loading }: HeroBannerProps) {
  const photoKey = photos.map((p) => p.id).join(",");

  return <HeroBannerInner key={photoKey} photos={photos} loading={loading} />;
}

function HeroBannerInner({ photos, loading }: HeroBannerProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [failedIds, setFailedIds] = useState<Set<string>>(() => new Set());
  const [loadedPhotoId, setLoadedPhotoId] = useState<string | null>(null);
  const photo = photos[activeIndex] ?? null;
  const loaded = photo != null && loadedPhotoId === photo.id;

  function handleImageError() {
    if (!photo) return;
    const nextFailedIds = new Set(failedIds);
    nextFailedIds.add(photo.id);
    setFailedIds(nextFailedIds);
    setLoadedPhotoId(null);

    const nextIndex = photos.findIndex(
      (candidate, index) =>
        index > activeIndex && !nextFailedIds.has(candidate.id),
    );
    setActiveIndex(nextIndex === -1 ? photos.length : nextIndex);
  }

  const hasPhoto = photo != null;

  return (
    <div className="relative h-36 w-full shrink-0 overflow-hidden bg-foreground/5">
      {/* Skeleton while loading */}
      {loading && !hasPhoto && (
        <span
          aria-hidden
          className="absolute inset-0 animate-pulse bg-linear-to-br from-foreground/5 via-foreground/8 to-white/5"
        />
      )}

      {/* No image placeholder */}
      {!loading && !hasPhoto && (
        <div className="flex h-full w-full flex-col items-center justify-center gap-1.5 text-foreground/20">
          <ImageOff className="h-6 w-6" />
          <span className="text-[10px] font-medium">No photo available</span>
        </div>
      )}

      {/* Actual image */}
      {photo && (
        <>
          {!loaded && (
            <span
              aria-hidden
              className="absolute inset-0 animate-pulse bg-linear-to-br from-foreground/5 via-foreground/8 to-white/5"
            />
          )}
          {/* eslint-disable-next-line @next/next/no-img-element -- Provider URLs are already sanitized and not configured for Next image optimization. */}
          <img
            src={photo.url}
            alt="Aircraft"
            onLoad={() => setLoadedPhotoId(photo.id)}
            onError={handleImageError}
            className={`h-full w-full object-cover transition-opacity duration-300 ${loaded ? "opacity-100" : "opacity-0"}`}
            draggable={false}
          />
          <span className="pointer-events-none absolute inset-0 bg-linear-to-t from-background/40 via-background/5 to-transparent" />
          {photo.photographer && loaded && (
            <span className="absolute bottom-2 right-2.5 flex items-center gap-1 rounded-full bg-background/40 px-2 py-0.5 text-[9px] font-medium text-foreground/60 backdrop-blur-sm">
              <Camera className="h-2.5 w-2.5" />
              {photo.photographer}
            </span>
          )}
        </>
      )}
    </div>
  );
}
