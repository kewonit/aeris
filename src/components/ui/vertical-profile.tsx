"use client";

import { useId, useMemo } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  XAxis,
  YAxis,
} from "recharts";
import type { TrailEntry } from "@/hooks/use-trail-history";
import { useSettings } from "@/hooks/use-settings";
import type { UnitSystem } from "@/hooks/use-settings";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { formatAltitude, formatDistanceAxisNm } from "@/lib/unit-formatters";

const MIN_POINTS_TO_RENDER = 3;
const FEET_PER_METER = 3.28084;
const MAX_PROFILE_POINTS = 180;

type ProfilePoint = {
  distNm: number;
  altFt: number;
  altMeters: number;
};

type VerticalProfileProps = {
  trail: TrailEntry | null;
  /** Selected altitude on MCP/FCU in feet. */
  navAltitudeMcp?: number | null;
};

const chartConfig = {
  altitude: {
    label: "Altitude",
    color: "rgb(96 165 250)",
  },
} satisfies ChartConfig;

function haversineNm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const radiusNm = 3440.065;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;

  return 2 * radiusNm * Math.asin(Math.sqrt(a));
}

function downsamplePoints(points: ProfilePoint[]): ProfilePoint[] {
  if (points.length <= MAX_PROFILE_POINTS) return points;

  const sampled: ProfilePoint[] = [];
  const step = (points.length - 1) / (MAX_PROFILE_POINTS - 1);
  let previousIndex = -1;

  for (let i = 0; i < MAX_PROFILE_POINTS; i++) {
    const index = Math.min(points.length - 1, Math.round(i * step));
    if (index === previousIndex) continue;
    sampled.push(points[index]);
    previousIndex = index;
  }

  if (sampled[sampled.length - 1] !== points[points.length - 1]) {
    sampled.push(points[points.length - 1]);
  }

  return sampled;
}

function formatAxisAltitude(feet: number, unitSystem: UnitSystem): string {
  if (unitSystem === "aviation" && feet >= 1000) {
    return `FL${Math.round(feet / 100)
      .toString()
      .padStart(3, "0")}`;
  }

  return formatAltitude(feet / FEET_PER_METER, unitSystem).replace(/\s/g, "");
}

function formatSelectedAltitude(feet: number, unitSystem: UnitSystem): string {
  if (unitSystem === "aviation") {
    return `SEL FL${Math.round(feet / 100)
      .toString()
      .padStart(3, "0")}`;
  }

  return `SEL ${formatAltitude(feet / FEET_PER_METER, unitSystem)}`;
}

export function VerticalProfile({
  trail,
  navAltitudeMcp,
}: VerticalProfileProps) {
  const { settings } = useSettings();
  const gradientId = useId().replace(/:/g, "");

  const rawPoints = useMemo<ProfilePoint[]>(() => {
    if (!trail || trail.path.length < MIN_POINTS_TO_RENDER) return [];

    const result: ProfilePoint[] = [];
    let cumulativeDistance = 0;
    const length = Math.min(trail.path.length, trail.altitudes.length);

    for (let i = 0; i < length; i++) {
      const [lng, lat] = trail.path[i];
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;

      if (i > 0) {
        const [prevLng, prevLat] = trail.path[i - 1];
        if (
          Number.isFinite(prevLng) &&
          Number.isFinite(prevLat) &&
          Number.isFinite(lng) &&
          Number.isFinite(lat)
        ) {
          cumulativeDistance += haversineNm(prevLat, prevLng, lat, lng);
        }
      }

      const altitudeMeters = trail.altitudes[i];
      if (altitudeMeters === null || !Number.isFinite(altitudeMeters)) {
        continue;
      }

      result.push({
        distNm: cumulativeDistance,
        altFt: Math.max(0, Math.round(altitudeMeters * FEET_PER_METER)),
        altMeters: Math.max(0, altitudeMeters),
      });
    }

    return result;
  }, [trail]);

  const points = useMemo(() => downsamplePoints(rawPoints), [rawPoints]);
  if (points.length < MIN_POINTS_TO_RENDER) return null;

  const maxDistance = Math.max(points[points.length - 1].distNm, 1);
  const maxAltitude = Math.max(
    ...rawPoints.map((point) => point.altFt),
    navAltitudeMcp ?? 0,
    1000,
  );
  const altitudeCeiling = Math.max(1000, Math.ceil(maxAltitude / 5000) * 5000);
  const lastPoint = points[points.length - 1];
  const selectedAltitudeVisible =
    navAltitudeMcp != null &&
    Number.isFinite(navAltitudeMcp) &&
    navAltitudeMcp > 0 &&
    navAltitudeMcp <= altitudeCeiling;

  return (
    <div className="mt-3">
      <div className="flex items-center justify-between gap-3">
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

      <ChartContainer
        config={chartConfig}
        className="mt-2 h-[124px] w-full text-foreground"
        initialDimension={{ width: 320, height: 124 }}
      >
        <AreaChart
          accessibilityLayer
          data={points}
          margin={{ top: 10, right: 8, bottom: 0, left: -14 }}
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop
                offset="8%"
                stopColor="var(--color-altitude)"
                stopOpacity={0.24}
              />
              <stop
                offset="92%"
                stopColor="var(--color-altitude)"
                stopOpacity={0.02}
              />
            </linearGradient>
          </defs>
          <CartesianGrid
            vertical={false}
            stroke="currentColor"
            strokeOpacity={0.07}
            strokeDasharray="2 4"
          />
          <XAxis
            type="number"
            dataKey="distNm"
            domain={[0, maxDistance]}
            tickLine={false}
            axisLine={false}
            tickMargin={4}
            minTickGap={30}
            tickFormatter={(value) =>
              formatDistanceAxisNm(Number(value), settings.unitSystem)
            }
          />
          <YAxis
            type="number"
            domain={[0, altitudeCeiling]}
            tickLine={false}
            axisLine={false}
            width={42}
            tickFormatter={(value) =>
              formatAxisAltitude(Number(value), settings.unitSystem)
            }
          />
          <ChartTooltip
            cursor={{
              stroke: "currentColor",
              strokeOpacity: 0.18,
              strokeWidth: 1,
            }}
            content={
              <ChartTooltipContent
                indicator="line"
                hideIndicator
                labelFormatter={(_, payload) => {
                  const point = payload?.[0]?.payload as
                    | ProfilePoint
                    | undefined;
                  return point
                    ? formatDistanceAxisNm(point.distNm, settings.unitSystem)
                    : null;
                }}
                formatter={(value) => (
                  <span className="font-mono font-semibold tabular-nums text-foreground">
                    {formatAltitude(
                      Number(value) / FEET_PER_METER,
                      settings.unitSystem,
                    )}
                  </span>
                )}
              />
            }
          />
          {selectedAltitudeVisible && (
            <ReferenceLine
              y={navAltitudeMcp}
              stroke="#34d399"
              strokeDasharray="3 4"
              strokeOpacity={0.55}
              label={{
                value: formatSelectedAltitude(
                  navAltitudeMcp,
                  settings.unitSystem,
                ),
                position: "insideTopRight",
                fill: "#34d399",
                fontSize: 9,
              }}
            />
          )}
          <Area
            type="monotone"
            dataKey="altFt"
            name="altitude"
            stroke="var(--color-altitude)"
            strokeWidth={2.25}
            fill={`url(#${gradientId})`}
            dot={false}
            activeDot={{
              r: 3,
              stroke: "var(--background)",
              strokeWidth: 1.5,
            }}
            isAnimationActive={false}
          />
        </AreaChart>
      </ChartContainer>
    </div>
  );
}
