"use client";

import { MapPin } from "lucide-react";

type Props = {
  lat: number;
  lng: number;
};

export function Coordinates({ lat, lng }: Props) {
  return (
    <div className="flex items-center gap-1.5 text-subtle">
      <MapPin className="size-3" aria-hidden="true" />
      <p className="font-mono text-micro">
        {Math.abs(lat).toFixed(4)}°{lat >= 0 ? "N" : "S"},{" "}
        {Math.abs(lng).toFixed(4)}°{lng >= 0 ? "E" : "W"}
      </p>
    </div>
  );
}
