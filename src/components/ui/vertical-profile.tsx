"use client";

import { useMemo, useCallback } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Dot,
} from "recharts";
import type { TrailEntry } from "@/hooks/use-trail-history";
import { useSettings } from "@/hooks/use-settings";
import { formatAltitude, formatDistanceAxisNm } from "@/lib/unit-formatters";

const FEET_PER_METER = 3.28084;
const MAX_ALTITUDE_METERS = 13_000;
const MIN_POINTS_TO_RENDER = 3;

const ALTITUDE_STOPS: { t: number; color: string }[] = [
  { t: 0.0, color: "#48d2a0" },
  { t: 0.1, color: "#64c878" },
  { t: 0.2, color: "#a0c350" },
  { t: 0.3, color: "#d2b43c" },
  { t: 0.4, color: "#eb963c" },
  { t: 0.52, color: "#f06e50" },
  { t: 0.64, color: "#dc5582" },
  { t: 0.76, color: "#b45abe" },
  { t: 0.88, color: "#786edc" },
  { t: 1.0, color: "#64aaf0" },
];

function altColor(altMeters: number): string {
  const t = Math.max(0, Math.min(1, altMeters / MAX_ALTITUDE_METERS));
  let i = 0;
  while (i < ALTITUDE_STOPS.length - 1 && ALTITUDE_STOPS[i + 1].t <= t) i++;
  if (i >= ALTITUDE_STOPS.length - 1) {
    return ALTITUDE_STOPS[ALTITUDE_STOPS.length - 1].color;
  }
  const a = ALTITUDE_STOPS[i];
  const b = ALTITUDE_STOPS[i + 1];
  const lt = (t - a.t) / (b.t - a.t);
  return interpolateColor(a.color, b.color, lt);
}

function interpolateColor(c1: string, c2: string, t: number): string {
  const r1 = parseInt(c1.slice(1, 3), 16);
  const g1 = parseInt(c1.slice(3, 5), 16);
  const b1 = parseInt(c1.slice(5, 7), 16);
  const r2 = parseInt(c2.slice(1, 3), 16);
  const g2 = parseInt(c2.slice(3, 5), 16);
  const b2 = parseInt(c2.slice(5, 7), 16);
  const r = Math.round(r1 + (r2 - r1) * t);
  const g = Math.round(g1 + (g2 - g1) * t);
  const b = Math.round(b1 + (b2 - b1) * t);
  return `rgb(${r},${g},${b})`;
}

function haversineNm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R_NM = 3440.065;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return 2 * R_NM * Math.asin(Math.sqrt(a));
}

type ChartPoint = {
  distNm: number;
  altFt: number;
  altMeters: number;
  color: string;
};

type VerticalProfileProps = {
  trail: TrailEntry | null;
  navAltitudeMcp?: number | null;
};

function CustomTooltip({
  active,
  payload,
  label,
  unitSystem,
}: {
  active?: boolean;
  payload?: Array<{ payload: ChartPoint }>;
  label?: number;
  unitSystem: string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const point = payload[0].payload;
  return (
    <div className="rounded-lg border border-foreground/10 bg-background/90 px-3 py-2 shadow-lg backdrop-blur-sm">
      <p className="text-[11px] font-semibold text-foreground/80">
        {formatAltitude(point.altMeters, unitSystem as never)}
      </p>
      <p className="text-[10px] text-foreground/50">
        {formatDistanceAxisNm(point.distNm, unitSystem as never)} from start
      </p>
    </div>
  );
}

function CurrentPositionDot(props: {
  cx?: number;
  cy?: number;
  payload?: ChartPoint;
}) {
  const { cx, cy, payload } = props;
  if (cx == null || cy == null || !payload) return null;
  return (
    <g>
      <circle cx={cx} cy={cy} r={5} fill={payload.color} fillOpacity={0.25} />
      <circle cx={cx} cy={cy} r={3} fill={payload.color} fillOpacity={0.9} />
      <circle cx={cx} cy={cy} r={1.5} fill="white" fillOpacity={0.9} />
    </g>
  );
}

export function VerticalProfile({
  trail,
  navAltitudeMcp,
}: VerticalProfileProps) {
  const { settings } = useSettings();

  const points = useMemo<ChartPoint[]>(() => {
    if (!trail || trail.path.length < MIN_POINTS_TO_RENDER) return [];

    const result: ChartPoint[] = [];
    let cumDist = 0;
    const len = Math.min(trail.path.length, trail.altitudes.length);

    for (let i = 0; i < len; i++) {
      const [lng, lat] = trail.path[i];
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
        color: altColor(alt),
      });
    }
    return result;
  }, [trail]);

  const yDomain = useMemo<[number, number]>(() => {
    if (points.length === 0) return [0, 5000];
    const maxAlt = Math.max(
      ...points.map((p) => p.altFt),
      navAltitudeMcp ?? 0,
      1000,
    );
    return [0, Math.ceil(maxAlt / 1000) * 1000];
  }, [points, navAltitudeMcp]);

  const showMcp =
    navAltitudeMcp != null &&
    Number.isFinite(navAltitudeMcp) &&
    navAltitudeMcp > 0;

  const tickFormatter = useCallback(
    (value: number) => {
      if (settings.unitSystem === "aviation" && value >= 1000) {
        return `FL${Math.round(value / 100).toString().padStart(3, "0")}`;
      }
      return formatAltitude(value / FEET_PER_METER, settings.unitSystem);
    },
    [settings.unitSystem],
  );

  const xTickFormatter = useCallback(
    (value: number) => formatDistanceAxisNm(value, settings.unitSystem),
    [settings.unitSystem],
  );

  if (points.length < MIN_POINTS_TO_RENDER) return null;

  const lastPoint = points[points.length - 1];

  return (
    <div className="mt-3 space-y-2">
      <div className="h-px bg-linear-to-r from-transparent via-foreground/6 to-transparent" />
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-semibold tracking-widest text-foreground/30 uppercase">
          Vertical Profile
        </p>
        <p className="font-mono text-[10px] tabular-nums text-foreground/25">
          {settings.unitSystem === "aviation"
            ? `FL${Math.round(lastPoint.altFt / 100)
                .toString()
                .padStart(3, "0")}`
            : formatAltitude(lastPoint.altMeters, settings.unitSystem)}
        </p>
      </div>
      <div className="h-[120px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={points}
            margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
          >
            <defs>
              <linearGradient
                id="altGradient"
                x1="0"
                y1="0"
                x2="0"
                y2="1"
              >
                <stop
                  offset="0%"
                  stopColor={lastPoint.color}
                  stopOpacity={0.15}
                />
                <stop
                  offset="100%"
                  stopColor={lastPoint.color}
                  stopOpacity={0.02}
                />
              </linearGradient>
            </defs>
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="currentColor"
              strokeOpacity={0.05}
              vertical={false}
            />
            <XAxis
              dataKey="distNm"
              tick={{ fontSize: 9, fill: "currentColor", fillOpacity: 0.3 }}
              tickFormatter={xTickFormatter}
              axisLine={{ stroke: "currentColor", strokeOpacity: 0.1 }}
              tickLine={false}
              domain={[0, "dataMax"]}
            />
            <YAxis
              tick={{ fontSize: 9, fill: "currentColor", fillOpacity: 0.3 }}
              tickFormatter={tickFormatter}
              axisLine={false}
              tickLine={false}
              domain={yDomain}
              width={55}
            />
            <Tooltip
              content={
                <CustomTooltip unitSystem={settings.unitSystem} />
              }
              cursor={{
                stroke: "currentColor",
                strokeOpacity: 0.15,
                strokeWidth: 1,
              }}
            />
            <Area
              type="monotone"
              dataKey="altFt"
              stroke={lastPoint.color}
              strokeWidth={2}
              fill="url(#altGradient)"
              dot={false}
              activeDot={<CurrentPositionDot />}
              strokeOpacity={0.85}
            />
            {showMcp && (
              <ReferenceLine
                y={navAltitudeMcp}
                stroke="#34d399"
                strokeDasharray="4 4"
                strokeOpacity={0.5}
                strokeWidth={1}
                label={{
                  value:
                    settings.unitSystem === "aviation"
                      ? `SEL FL${Math.round(navAltitudeMcp / 100)
                          .toString()
                          .padStart(3, "0")}`
                      : `SEL ${formatAltitude(
                          navAltitudeMcp / FEET_PER_METER,
                          settings.unitSystem,
                        )}`,
                  position: "insideTopRight",
                  fill: "#34d399",
                  fillOpacity: 0.7,
                  fontSize: 9,
                }}
              />
            )}
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
