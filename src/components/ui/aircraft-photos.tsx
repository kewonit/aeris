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
      className="group relative h-20 w-32 shrink-0 cursor-pointer overflow-hidden rounded-lg border border-white/8 bg-white/5 transition-all hover:border-white/20 hover:brightness-110 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/30"
      aria-label={`View photo ${index + 1}${photo.photographer ? ` by ${photo.photographer}` : ""}`}
    >
      {!loaded && (
        <span
          aria-hidden
          className="absolute inset-0 animate-pulse bg-linear-to-br from-white/5 via-white/8 to-white/5"
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
      <span className="pointer-events-none absolute inset-0 rounded-lg ring-1 ring-inset ring-white/5 group-hover:ring-white/15" />
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
      className="fixed inset-0 z-9999 flex items-center justify-center bg-black/92 backdrop-blur-2xl"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Aircraft photo viewer"
    >
      <button
        type="button"
        onClick={onClose}
        className="absolute right-3 top-3 z-10 flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white/80 backdrop-blur-sm transition-all duration-200 hover:bg-white/20 hover:text-white sm:right-6 sm:top-6 sm:h-12 sm:w-12"
        aria-label="Close photo viewer"
      >
        <X className="h-5 w-5 sm:h-6 sm:w-6" />
      </button>

      <span className="absolute left-3 top-3 z-10 rounded-full bg-white/10 px-4 py-2 text-sm font-semibold tabular-nums text-white/80 backdrop-blur-sm sm:left-6 sm:top-6 sm:px-5 sm:text-base">
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
            <div className="h-9 w-9 animate-spin rounded-full border-2 border-white/20 border-t-white/60" />
          </div>
        )}

        {imgError ? (
          <div className="flex h-48 w-72 flex-col items-center justify-center gap-3 rounded-2xl border border-white/10 bg-white/5 sm:h-64 sm:w-96">
            <Camera className="h-8 w-8 text-white/20" />
            <p className="text-sm text-white/40">Failed to load image</p>
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
            className="absolute left-2 top-1/2 z-10 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white/80 backdrop-blur-sm transition-all duration-200 hover:bg-white/25 hover:text-white sm:left-6 sm:h-14 sm:w-14"
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
            className="absolute right-2 top-1/2 z-10 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white/80 backdrop-blur-sm transition-all duration-200 hover:bg-white/25 hover:text-white sm:right-6 sm:h-14 sm:w-14"
            aria-label="Next photo"
          >
            <ChevronRight className="h-6 w-6 sm:h-7 sm:w-7" />
          </button>
        </>
      )}

      {(photo.photographer ||
        photo.location ||
        photo.dateTaken ||
        photo.link) && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.15 }}
          className="absolute bottom-3 left-1/2 z-10 w-[92vw] max-w-lg -translate-x-1/2 sm:bottom-8"
        >
          <span className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 rounded-xl bg-black/60 px-5 py-3 text-sm text-white/70 backdrop-blur-sm sm:text-base">
            {photo.photographer && (
              <span className="font-medium text-white/85">
                {photo.photographer}
              </span>
            )}
            {photo.photographer && photo.location && (
              <span className="text-white/25">|</span>
            )}
            {photo.location && (
              <span className="text-white/55">{photo.location}</span>
            )}
            {(photo.photographer || photo.location) && photo.dateTaken && (
              <span className="text-white/25">|</span>
            )}
            {photo.dateTaken && (
              <span className="text-white/45">{photo.dateTaken}</span>
            )}
            {photo.link && (
              <>
                {(photo.photographer || photo.location || photo.dateTaken) && (
                  <span className="text-white/25">|</span>
                )}
                <a
                  href={photo.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-white/40 underline decoration-white/20 underline-offset-2 transition-colors hover:text-white/60"
                  onClick={(e) => e.stopPropagation()}
                >
                  Source
                </a>
              </>
            )}
          </span>
        </motion.div>
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
      <div className="mt-3">
        <div className="h-px bg-linear-to-r from-transparent via-white/6 to-transparent" />

        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-2.5 flex w-full items-center gap-1.5 text-left"
          aria-expanded={expanded}
          aria-controls="aircraft-photo-strip"
        >
          <Camera className="h-3 w-3 text-white/25" />
          <span className="text-[10px] font-medium tracking-wider text-white/30 uppercase">
            {loading ? "Loading…" : hasPhotos ? "Photos" : "Aircraft"}
          </span>
          {hasPhotos && (
            <span className="text-[10px] tabular-nums text-white/20">
              ({photos.length})
            </span>
          )}
          {aircraft?.registration && (
            <span className="ml-auto text-[10px] font-mono tracking-wider text-white/20">
              {aircraft.registration}
            </span>
          )}
          <ChevronRight
            className={`h-2.5 w-2.5 text-white/20 transition-transform duration-200 ${expanded ? "rotate-90" : ""}`}
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
              className="overflow-hidden"
            >
              {loading && (
                <div className="mt-2 flex gap-2 overflow-hidden">
                  {[0, 1, 2].map((i) => (
                    <div
                      key={i}
                      className="h-20 w-32 shrink-0 animate-pulse rounded-lg bg-white/5"
                    />
                  ))}
                </div>
              )}

              {!loading && hasPhotos && (
                <div
                  ref={scrollRef}
                  className="mt-2 flex gap-2 overflow-x-auto pb-1 scrollbar-none"
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
                      className="flex h-20 w-20 shrink-0 flex-col items-center justify-center gap-0.5 rounded-lg border border-white/8 bg-white/5 text-white/40 transition-all hover:border-white/20 hover:bg-white/8 hover:text-white/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/30"
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
                <div className="mt-2 flex items-center gap-2 rounded-lg border border-white/6 bg-white/2 px-3 py-2.5">
                  <Plane className="h-3.5 w-3.5 shrink-0 text-white/20" />
                  <div className="min-w-0 flex-1">
                    {detailLine && (
                      <p className="truncate text-[11px] font-medium text-white/45">
                        {detailLine}
                      </p>
                    )}
                    <p className="mt-0.5 flex items-center gap-1 text-[10px] text-white/25">
                      <ImageOff className="h-2.5 w-2.5" />
                      No photos available
                    </p>
                  </div>
                </div>
              )}

              {!loading && !hasPhotos && !hasAircraft && error && (
                <div className="mt-2 flex items-center gap-2 px-1 py-1.5">
                  <ImageOff className="h-3 w-3 text-white/15" />
                  <p className="text-[10px] text-white/25">
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
