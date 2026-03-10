"use client";

import { useState, useEffect } from "react";
import { Camera, ImageOff } from "lucide-react";
import type { NormalizedPhoto } from "@/hooks/use-aircraft-photos";

type HeroBannerProps = {
  photo: NormalizedPhoto | null;
  loading: boolean;
};

export function HeroBanner({ photo, loading }: HeroBannerProps) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setLoaded(false);
    setFailed(false);
  }, [photo?.id]);

  const hasPhoto = photo != null && !failed;

  return (
    <div className="relative h-36 w-full overflow-hidden bg-white/5">
      {/* Skeleton while loading */}
      {loading && !hasPhoto && (
        <span
          aria-hidden
          className="absolute inset-0 animate-pulse bg-linear-to-br from-white/5 via-white/8 to-white/5"
        />
      )}

      {/* No image placeholder */}
      {!loading && !hasPhoto && (
        <div className="flex h-full w-full flex-col items-center justify-center gap-1.5 text-white/20">
          <ImageOff className="h-6 w-6" />
          <span className="text-[10px] font-medium">No photo available</span>
        </div>
      )}

      {/* Actual image */}
      {photo && !failed && (
        <>
          {!loaded && (
            <span
              aria-hidden
              className="absolute inset-0 animate-pulse bg-linear-to-br from-white/5 via-white/8 to-white/5"
            />
          )}
          <img
            src={photo.thumbnail}
            alt="Aircraft"
            onLoad={() => setLoaded(true)}
            onError={() => setFailed(true)}
            className={`h-full w-full object-cover transition-opacity duration-300 ${loaded ? "opacity-100" : "opacity-0"}`}
            draggable={false}
          />
          <span className="pointer-events-none absolute inset-0 bg-linear-to-t from-black/40 via-black/5 to-transparent" />
          {photo.photographer && loaded && (
            <span className="absolute bottom-2 right-2.5 flex items-center gap-1 rounded-full bg-black/40 px-2 py-0.5 text-[9px] font-medium text-white/60 backdrop-blur-sm">
              <Camera className="h-2.5 w-2.5" />
              {photo.photographer}
            </span>
          )}
        </>
      )}
    </div>
  );
}
