"use client";

import { useMemo } from "react";
import type { TrailEntry } from "@/hooks/use-trail-history";

const PROFILE_HEIGHT = 100;
const PROFILE_PADDING_TOP = 14;
const PROFILE_PADDING_BOTTOM = 20;
const PROFILE_PADDING_X = 6;
const MIN_POINTS_TO_RENDER = 3;
const FEET_PER_METER = 3.28084;
const MAX_ALTITUDE_METERS = 13_000;
const NM_PER_DEG = 60; // 1 degree latitude ≈ 60 nm

type RGB = [number, number, number];

const ALTITUDE_STOPS: { t: number; color: RGB }[] = [
  { t: 0.0, color: [72, 210, 160] },
  { t: 0.1, color: [100, 200, 120] },
  { t: 0.2, color: [160, 195, 80] },
  { t: 0.3, color: [210, 180, 60] },
  { t: 0.4, color: [235, 150, 60] },
  { t: 0.52, color: [240, 110, 80] },
  { t: 0.64, color: [220, 85, 130] },
  { t: 0.76, color: [180, 90, 190] },
  { t: 0.88, color: [120, 110, 220] },
  { t: 1.0, color: [100, 170, 240] },
];

function altColor(altMeters: number): string {
  const t = Math.max(0, Math.min(1, altMeters / MAX_ALTITUDE_METERS));
  let i = 0;
  while (i < ALTITUDE_STOPS.length - 1 && ALTITUDE_STOPS[i + 1].t <= t) i++;
  if (i >= ALTITUDE_STOPS.length - 1) {
    const c = ALTITUDE_STOPS[ALTITUDE_STOPS.length - 1].color;
    return `rgb(${c[0]},${c[1]},${c[2]})`;
  }
  const a = ALTITUDE_STOPS[i];
  const b = ALTITUDE_STOPS[i + 1];
  const lt = (t - a.t) / (b.t - a.t);
  const r = Math.round(a.color[0] + (b.color[0] - a.color[0]) * lt);
  const g = Math.round(a.color[1] + (b.color[1] - a.color[1]) * lt);
  const bl = Math.round(a.color[2] + (b.color[2] - a.color[2]) * lt);
  return `rgb(${r},${g},${bl})`;
}

function haversineNm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R_NM = 3440.065; // earth radius in nautical miles
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return 2 * R_NM * Math.asin(Math.sqrt(a));
}

type ProfilePoint = {
  distNm: number;
  altFt: number;
  altMeters: number;
};

type VerticalProfileProps = {
  trail: TrailEntry | null;
  /** Selected altitude on MCP/FCU in feet (drawn as dashed target line) */
  navAltitudeMcp?: number | null;
};

export function VerticalProfile({
  trail,
  navAltitudeMcp,
}: VerticalProfileProps) {
  const points = useMemo<ProfilePoint[]>(() => {
    if (!trail || trail.path.length < MIN_POINTS_TO_RENDER) return [];

    const result: ProfilePoint[] = [];
    let cumDist = 0;
    const len = Math.min(trail.path.length, trail.altitudes.length);

    for (let i = 0; i < len; i++) {
      const [lng, lat] = trail.path[i];

      // Always accumulate distance even for null-altitude points
      if (i > 0) {
        const [pLng, pLat] = trail.path[i - 1];
        cumDist += haversineNm(pLat, pLng, lat, lng);
      }

      const alt = trail.altitudes[i];
      if (alt === null || !Number.isFinite(alt)) continue;

      result.push({
        distNm: cumDist,
        altFt: Math.round(alt * FEET_PER_METER),
        altMeters: alt,
      });
    }

    return result;
  }, [trail]);

  if (points.length < MIN_POINTS_TO_RENDER) return null;

  const maxDist = points[points.length - 1].distNm || 1;
  const maxAlt = Math.max(
    ...points.map((p) => p.altFt),
    navAltitudeMcp ?? 0,
    1000,
  );
  // Round up to nearest 5000ft for clean axis
  const ceilAlt = Math.ceil(maxAlt / 5000) * 5000;

  const drawW = 200 - PROFILE_PADDING_X * 2;
  const drawH = PROFILE_HEIGHT - PROFILE_PADDING_TOP - PROFILE_PADDING_BOTTOM;

  const toX = (d: number) => PROFILE_PADDING_X + (d / maxDist) * drawW;
  const toY = (alt: number) =>
    PROFILE_PADDING_TOP + drawH - (alt / ceilAlt) * drawH;

  // Build SVG polyline points
  const polyPoints = points
    .map((p) => `${toX(p.distNm).toFixed(1)},${toY(p.altFt).toFixed(1)}`)
    .join(" ");

  // Build colored line segments
  const segments: {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    color: string;
  }[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const p = points[i];
    const q = points[i + 1];
    const avgAlt = (p.altMeters + q.altMeters) / 2;
    segments.push({
      x1: toX(p.distNm),
      y1: toY(p.altFt),
      x2: toX(q.distNm),
      y2: toY(q.altFt),
      color: altColor(avgAlt),
    });
  }

  // Altitude Y-axis tick labels
  const ticks: number[] = [];
  const tickStep = ceilAlt <= 10000 ? 5000 : 10000;
  for (let a = 0; a <= ceilAlt; a += tickStep) {
    ticks.push(a);
  }

  return (
    <div className="mt-3">
      <div className="h-px bg-linear-to-r from-transparent via-foreground/6 to-transparent" />
      <div className="mt-2">
        <div className="flex items-center justify-between">
          <p className="text-[11px] font-semibold tracking-widest text-foreground/30 uppercase">
            Vertical Profile
          </p>
          <p className="font-mono text-[10px] tabular-nums text-foreground/25">
            FL
            {Math.round(points[points.length - 1].altFt / 100)
              .toString()
              .padStart(3, "0")}
          </p>
        </div>
        <svg
          viewBox={`0 0 200 ${PROFILE_HEIGHT}`}
          className="mt-1.5 w-full"
          aria-label="Altitude profile chart"
          role="img"
        >
          <defs>
            {/* Gradient fill under the altitude line */}
            <linearGradient id="profile-fill-grad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="currentColor" stopOpacity={0.08} />
              <stop offset="100%" stopColor="currentColor" stopOpacity={0.01} />
            </linearGradient>
            {/* Glow filter for the current position dot */}
            <filter
              id="profile-glow"
              x="-50%"
              y="-50%"
              width="200%"
              height="200%"
            >
              <feGaussianBlur stdDeviation="1.5" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {/* Grid lines */}
          {ticks.map((a) => (
            <g key={a}>
              <line
                x1={PROFILE_PADDING_X}
                y1={toY(a)}
                x2={200 - PROFILE_PADDING_X}
                y2={toY(a)}
                stroke="currentColor"
                strokeOpacity={0.05}
                strokeWidth={0.4}
                strokeDasharray={a > 0 ? "2 3" : undefined}
              />
              <text
                x={PROFILE_PADDING_X + 1}
                y={toY(a) - 2.5}
                fill="currentColor"
                fillOpacity={0.22}
                fontSize={6}
                fontFamily="monospace"
              >
                {a >= 1000
                  ? `FL${Math.round(a / 100)
                      .toString()
                      .padStart(3, "0")}`
                  : a}
              </text>
            </g>
          ))}

          {/* Gradient fill under the altitude line */}
          <polygon
            points={`${toX(0).toFixed(1)},${toY(0).toFixed(1)} ${polyPoints} ${toX(maxDist).toFixed(1)},${toY(0).toFixed(1)}`}
            fill="url(#profile-fill-grad)"
          />

          {/* Colored altitude segments */}
          {segments.map((s, i) => (
            <line
              key={i}
              x1={s.x1}
              y1={s.y1}
              x2={s.x2}
              y2={s.y2}
              stroke={s.color}
              strokeWidth={2}
              strokeLinecap="round"
              strokeOpacity={0.9}
            />
          ))}

          {/* MCP selected altitude target line */}
          {navAltitudeMcp != null &&
            Number.isFinite(navAltitudeMcp) &&
            navAltitudeMcp > 0 &&
            navAltitudeMcp <= ceilAlt && (
              <>
                <line
                  x1={PROFILE_PADDING_X}
                  y1={toY(navAltitudeMcp)}
                  x2={200 - PROFILE_PADDING_X}
                  y2={toY(navAltitudeMcp)}
                  stroke="#34d399"
                  strokeWidth={0.5}
                  strokeDasharray="2 2.5"
                  strokeOpacity={0.45}
                />
                <text
                  x={200 - PROFILE_PADDING_X}
                  y={toY(navAltitudeMcp) - 2.5}
                  fill="#34d399"
                  fillOpacity={0.55}
                  fontSize={5.5}
                  fontFamily="monospace"
                  textAnchor="end"
                >
                  SEL FL
                  {Math.round(navAltitudeMcp / 100)
                    .toString()
                    .padStart(3, "0")}
                </text>
              </>
            )}

          {/* Current position dot (last point) */}
          {points.length > 0 &&
            (() => {
              const last = points[points.length - 1];
              const cx = toX(last.distNm);
              const cy = toY(last.altFt);
              const dotColor = altColor(last.altMeters);
              return (
                <g filter="url(#profile-glow)">
                  <circle
                    cx={cx}
                    cy={cy}
                    r={3}
                    fill={dotColor}
                    fillOpacity={0.9}
                  />
                  <circle
                    cx={cx}
                    cy={cy}
                    r={1.5}
                    fill="white"
                    fillOpacity={0.8}
                  />
                </g>
              );
            })()}

          {/* Distance labels */}
          <text
            x={PROFILE_PADDING_X}
            y={PROFILE_HEIGHT - 4}
            fill="currentColor"
            fillOpacity={0.22}
            fontSize={6}
            fontFamily="monospace"
          >
            0 nm
          </text>
          <text
            x={200 - PROFILE_PADDING_X}
            y={PROFILE_HEIGHT - 4}
            fill="currentColor"
            fillOpacity={0.22}
            fontSize={6}
            fontFamily="monospace"
            textAnchor="end"
          >
            {maxDist.toFixed(0)} nm
          </text>
        </svg>
      </div>
    </div>
  );
}
