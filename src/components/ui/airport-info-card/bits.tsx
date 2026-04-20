"use client";

import { MapPin } from "lucide-react";

type Props = {
  lat: number;
  lng: number;
};

export function Coordinates({ lat, lng }: Props) {
  return (
    <div className="flex items-center gap-1.5">
      <MapPin className="h-3 w-3 text-foreground/20" />
      <p className="font-mono text-[10px] tabular-nums text-foreground/25">
        {Math.abs(lat).toFixed(4)}°{lat >= 0 ? "N" : "S"},{" "}
        {Math.abs(lng).toFixed(4)}°{lng >= 0 ? "E" : "W"}
      </p>
    </div>
  );
}

export function Divider() {
  return (
    <div className="h-px bg-linear-to-r from-transparent via-foreground/6 to-transparent" />
  );
}
