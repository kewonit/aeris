"use client";

import { useState } from "react";
import Image from "next/image";
import { motion, AnimatePresence } from "motion/react";
import { Check } from "lucide-react";
import { MAP_STYLES, type MapStyle } from "@/lib/map-styles";
import { ScrollArea } from "@/components/ui/scroll-area";

export function StyleContent({
  activeStyle,
  onSelect,
}: {
  activeStyle: MapStyle;
  onSelect: (style: MapStyle) => void;
}) {
  return (
    <ScrollArea className="h-full">
      <div className="grid grid-cols-2 gap-2.5 sm:gap-3 p-4 sm:p-5 pt-2">
        {MAP_STYLES.map((style, i) => (
          <StyleTile
            key={style.id}
            style={style}
            isActive={style.id === activeStyle.id}
            index={i}
            onSelect={() => onSelect(style)}
          />
        ))}
      </div>
      <div className="border-t border-border px-5 py-3">
        <p className="text-caption text-subtle">
          Satellite © Esri · Terrain © AWS/Mapzen Terrain Tiles · Base maps ©
          CARTO
        </p>
      </div>
    </ScrollArea>
  );
}

function StyleTile({
  style,
  isActive,
  index,
  onSelect,
}: {
  style: MapStyle;
  isActive: boolean;
  index: number;
  onSelect: () => void;
}) {
  const [imgLoaded, setImgLoaded] = useState(false);

  return (
    <motion.button
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.04 * index, duration: 0.25, ease: "easeOut" }}
      onClick={onSelect}
      aria-pressed={isActive}
      aria-label={`${style.name} map style`}
      className="group relative flex flex-col gap-2 text-left"
    >
      <div
        className={`relative aspect-16/10 w-full overflow-hidden rounded-lg transition-all duration-200 ${
          isActive
            ? "ring-2 ring-primary/50 ring-offset-2 ring-offset-background/80 shadow-lift"
            : "ring-1 ring-border group-hover:ring-border"
        }`}
      >
        <div
          className="absolute inset-0"
          style={{ background: style.preview }}
        />
        <Image
          src={style.previewUrl}
          alt={`${style.name} preview`}
          fill
          unoptimized
          onLoad={() => setImgLoaded(true)}
          onError={() => setImgLoaded(true)}
          className={`object-cover transition-all duration-500 group-hover:scale-105 ${
            imgLoaded ? "opacity-100" : "opacity-0"
          }`}
          draggable={false}
        />
        <div className="absolute inset-0 rounded-lg" />

        <AnimatePresence>
          {isActive && (
            <motion.div
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0, opacity: 0 }}
              transition={{
                type: "spring",
                stiffness: 500,
                damping: 28,
              }}
              className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-foreground shadow-lift shadow-background/30"
            >
              <Check className="h-3 w-3 text-background" strokeWidth={3} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="flex items-center gap-1.5 px-0.5">
        <span
          className={`text-label transition-colors ${
            isActive
              ? "text-foreground"
              : "text-muted-foreground group-hover:text-foreground"
          }`}
        >
          {style.name}
        </span>
        {style.dark && (
          <span className="h-0.5 w-0.5 rounded-full bg-border" />
        )}
      </div>
    </motion.button>
  );
}
