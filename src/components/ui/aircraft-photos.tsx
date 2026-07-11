"use client";

import { useState, useCallback, useEffect, useRef, memo } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "motion/react";
import {
  Camera,
  ChevronLeft,
  ChevronRight,
  X,
  Plane,
  ImageOff,
  Plus,
} from "lucide-react";
import type {
  NormalizedPhoto,
  AircraftDetails,
} from "@/hooks/use-aircraft-photos";

const Thumbnail = memo(function Thumbnail({
  photo,
  index,
  onClick,
}: {
  photo: NormalizedPhoto;
  index: number;
  onClick: (index: number) => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "100px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  if (failed) return null;

  return (
    <button
      ref={ref}
      type="button"
      onClick={() => onClick(index)}
      className="group relative h-28 w-36 shrink-0 cursor-pointer overflow-hidden rounded-[16px] border border-foreground/[0.08] bg-foreground/[0.045] shadow-sm transition-all hover:border-foreground/18 hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/45"
      aria-label={`View photo ${index + 1}${photo.photographer ? ` by ${photo.photographer}` : ""}`}
    >
      {!loaded && (
        <span
          aria-hidden
          className="absolute inset-0 animate-pulse bg-linear-to-br from-foreground/[0.04] via-foreground/[0.08] to-foreground/[0.04]"
        />
      )}
      {visible && (
        <img
          src={photo.url}
          alt={`Aircraft photo ${index + 1}`}
          loading="lazy"
          decoding="async"
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
          className={`h-full w-full object-cover transition-opacity duration-300 ${loaded ? "opacity-100" : "opacity-0"}`}
        />
      )}
      <span className="pointer-events-none absolute inset-0 rounded-[16px] ring-1 ring-inset ring-foreground/[0.06] group-hover:ring-foreground/16" />
    </button>
  );
});

export function Lightbox({
  photos,
  index,
  onClose,
  onNavigate,
}: {
  photos: NormalizedPhoto[];
  index: number;
  onClose: () => void;
  onNavigate: (index: number) => void;
}) {
  const photo = photos[index];
  const [loaded, setLoaded] = useState(false);
  const [imgError, setImgError] = useState(false);

  useEffect(() => {
    // Reset image state when navigating between photos
    const reset = () => {
      setLoaded(false);
      setImgError(false);
    };
    reset();
  }, [index]);

  const goPrev = useCallback(() => {
    onNavigate(index > 0 ? index - 1 : photos.length - 1);
  }, [index, photos.length, onNavigate]);

  const goNext = useCallback(() => {
    onNavigate(index < photos.length - 1 ? index + 1 : 0);
  }, [index, photos.length, onNavigate]);

  useEffect(() => {
    function handleKey(e: globalThis.KeyboardEvent) {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft") goPrev();
      else if (e.key === "ArrowRight") goNext();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [goPrev, goNext, onClose]);

  if (!photo) return null;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      className="fixed inset-0 z-9999 flex items-center justify-center bg-background/92 backdrop-blur-2xl"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Aircraft photo viewer"
    >
      <button
        type="button"
        onClick={onClose}
        className="absolute right-3 top-3 z-10 flex h-11 w-11 items-center justify-center rounded-full bg-foreground/10 text-foreground/80 backdrop-blur-sm transition-all duration-200 hover:bg-foreground/20 hover:text-foreground sm:right-6 sm:top-6 sm:h-12 sm:w-12"
        aria-label="Close photo viewer"
      >
        <X className="h-5 w-5 sm:h-6 sm:w-6" />
      </button>

      <span className="absolute left-3 top-3 z-10 rounded-full bg-foreground/10 px-4 py-2 text-sm font-semibold tabular-nums text-foreground/80 backdrop-blur-sm sm:left-6 sm:top-6 sm:px-5 sm:text-base">
        {index + 1} / {photos.length}
      </span>

      <motion.div
        key={index}
        initial={{ opacity: 0, scale: 0.97 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.25, ease: "easeOut" }}
        className="relative flex max-h-[85vh] max-w-[94vw] items-center justify-center sm:max-w-[90vw]"
        onClick={(e) => e.stopPropagation()}
      >
        {!loaded && !imgError && (
          <div className="flex h-48 w-72 items-center justify-center sm:h-64 sm:w-96">
            <div className="h-9 w-9 animate-spin rounded-full border-2 border-foreground/20 border-t-foreground/60" />
          </div>
        )}

        {imgError ? (
          <div className="flex h-48 w-72 flex-col items-center justify-center gap-3 rounded-2xl border border-foreground/10 bg-foreground/5 sm:h-64 sm:w-96">
            <Camera className="h-8 w-8 text-foreground/20" />
            <p className="text-sm text-foreground/40">Failed to load image</p>
          </div>
        ) : (
          <img
            src={photo.url}
            alt={`Aircraft photo ${index + 1}${photo.photographer ? ` by ${photo.photographer}` : ""}`}
            onLoad={() => setLoaded(true)}
            onError={() => setImgError(true)}
            className={`max-h-[85vh] max-w-[94vw] rounded-xl object-contain shadow-2xl transition-opacity duration-300 sm:max-w-[90vw] ${loaded ? "opacity-100" : "opacity-0"}`}
            draggable={false}
          />
        )}
      </motion.div>

      {photos.length > 1 && (
        <>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              goPrev();
            }}
            className="absolute left-2 top-1/2 z-10 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-foreground/10 text-foreground/80 backdrop-blur-sm transition-all duration-200 hover:bg-foreground/25 hover:text-foreground sm:left-6 sm:h-14 sm:w-14"
            aria-label="Previous photo"
          >
            <ChevronLeft className="h-6 w-6 sm:h-7 sm:w-7" />
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              goNext();
            }}
            className="absolute right-2 top-1/2 z-10 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-foreground/10 text-foreground/80 backdrop-blur-sm transition-all duration-200 hover:bg-foreground/25 hover:text-foreground sm:right-6 sm:h-14 sm:w-14"
            aria-label="Next photo"
          >
            <ChevronRight className="h-6 w-6 sm:h-7 sm:w-7" />
          </button>
        </>
      )}

    </motion.div>
  );
}

type AircraftPhotosProps = {
  photos: NormalizedPhoto[];
  loading: boolean;
  aircraft: AircraftDetails | null;
  error: boolean;
  onPhotoClick?: (index: number) => void;
  defaultExpanded?: boolean;
  hideEmptyState?: boolean;
};

export function AircraftPhotos({
  photos,
  loading,
  aircraft,
  error,
  onPhotoClick,
  defaultExpanded = false,
  hideEmptyState = false,
}: AircraftPhotosProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [showAllPhotos, setShowAllPhotos] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const PREVIEW_COUNT = 3;

  // Reset "show all" when photos change (new aircraft selected)
  const photoKey = photos.map((p) => p.id).join(",");
  useEffect(() => {
    const reset = () => setShowAllPhotos(false);
    reset();
  }, [photoKey]);

  const handlePhotoClick = useCallback(
    (index: number) => {
      if (onPhotoClick) {
        onPhotoClick(index);
      } else {
        setLightboxIndex(index);
      }
    },
    [onPhotoClick],
  );

  const closeLightbox = useCallback(() => {
    setLightboxIndex(null);
  }, []);

  const hasPhotos = photos.length > 0;
  const hasAircraft = aircraft !== null;
  const showSection = hideEmptyState
    ? loading || hasPhotos
    : loading || hasPhotos || hasAircraft;

  const visiblePhotos = showAllPhotos ? photos : photos.slice(0, PREVIEW_COUNT);
  const hiddenCount = photos.length - PREVIEW_COUNT;
  const hasMore = hiddenCount > 0;

  if (!showSection) return null;

  const detailParts: string[] = [];
  if (aircraft?.manufacturer) detailParts.push(aircraft.manufacturer);
  if (aircraft?.type) detailParts.push(aircraft.type);
  if (aircraft?.airline && !detailParts.includes(aircraft.airline)) {
    detailParts.push(aircraft.airline);
  }
  const detailLine = detailParts.join(" · ");

  return (
    <>
      <div className="mt-4 overflow-hidden rounded-[22px] border border-foreground/[0.07] bg-foreground/[0.035] shadow-[inset_0_1px_0_rgba(255,255,255,0.035)]">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex min-h-11 w-full items-center gap-3 px-3.5 py-2.5 text-left transition-colors hover:bg-foreground/[0.04] active:bg-foreground/[0.07]"
          aria-expanded={expanded}
          aria-controls="aircraft-photo-strip"
        >
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[10px] border border-foreground/[0.06] bg-background/45 text-foreground/38 shadow-[inset_0_1px_0_rgba(255,255,255,0.035)]">
            <Camera className="h-3.5 w-3.5" />
          </span>
          <span className="min-w-0 flex-1 text-[13px] font-medium text-foreground/72">
            {loading ? "Loading\u2026" : hasPhotos ? "Photos" : "Aircraft"}
          </span>
          {hasPhotos && (
            <span className="rounded-full bg-background/35 px-2 py-0.5 text-[11px] font-medium tabular-nums text-foreground/42 ring-1 ring-foreground/[0.06]">
              ({photos.length})
            </span>
          )}
          {aircraft?.registration && (
            <span className="text-[11px] font-mono tracking-wide text-foreground/38">
              {aircraft.registration}
            </span>
          )}
          <ChevronRight
            className={`h-4 w-4 text-foreground/24 transition-transform duration-200 ${expanded ? "rotate-90" : ""}`}
          />
        </button>

        <AnimatePresence initial={false}>
          {expanded && (
            <motion.div
              id="aircraft-photo-strip"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2, ease: "easeInOut" }}
              className="overflow-hidden border-t border-foreground/[0.06]"
            >
              {loading && (
                <div className="flex gap-2 overflow-hidden p-3">
                  {[0, 1, 2].map((i) => (
                    <div
                      key={i}
                      className="h-28 w-36 shrink-0 animate-pulse rounded-[16px] bg-foreground/[0.055]"
                    />
                  ))}
                </div>
              )}

              {!loading && hasPhotos && (
                <div
                  ref={scrollRef}
                  className="flex gap-2 overflow-x-auto p-3 scrollbar-none"
                  style={{ scrollbarWidth: "none" }}
                >
                  {visiblePhotos.map((photo, i) => (
                    <Thumbnail
                      key={photo.id}
                      photo={photo}
                      index={i}
                      onClick={handlePhotoClick}
                    />
                  ))}
                  {hasMore && !showAllPhotos && (
                    <button
                      type="button"
                      onClick={() => setShowAllPhotos(true)}
                      className="flex h-28 w-24 shrink-0 flex-col items-center justify-center gap-1 rounded-[16px] border border-foreground/[0.08] bg-foreground/[0.045] text-foreground/45 transition-all hover:border-foreground/18 hover:bg-foreground/[0.07] hover:text-foreground/65 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/45"
                      aria-label={`Show ${hiddenCount} more photo${hiddenCount === 1 ? "" : "s"}`}
                    >
                      <Plus className="h-3.5 w-3.5" />
                      <span className="text-[9px] font-medium tabular-nums">
                        {hiddenCount} more
                      </span>
                    </button>
                  )}
                </div>
              )}

              {!loading && !hasPhotos && hasAircraft && (
                <div className="m-3 flex items-center gap-3 rounded-[16px] border border-foreground/[0.06] bg-background/35 px-3 py-2.5">
                  <Plane className="h-4 w-4 shrink-0 text-foreground/35" />
                  <div className="min-w-0 flex-1">
                    {detailLine && (
                      <p className="truncate text-[12px] font-medium text-foreground/58">
                        {detailLine}
                      </p>
                    )}
                    <p className="mt-0.5 flex items-center gap-1 text-[11px] text-foreground/38">
                      <ImageOff className="h-3 w-3" />
                      No photos available
                    </p>
                  </div>
                </div>
              )}

              {!loading && !hasPhotos && !hasAircraft && error && (
                <div className="m-3 flex items-center gap-2 px-1 py-1.5">
                  <ImageOff className="h-3.5 w-3.5 text-foreground/25" />
                  <p className="text-[11px] text-foreground/38">
                    Could not load aircraft data
                  </p>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {!onPhotoClick &&
        typeof document !== "undefined" &&
        createPortal(
          <AnimatePresence>
            {lightboxIndex !== null && (
              <Lightbox
                photos={photos}
                index={lightboxIndex}
                onClose={closeLightbox}
                onNavigate={setLightboxIndex}
              />
            )}
          </AnimatePresence>,
          document.body,
        )}
    </>
  );
}
