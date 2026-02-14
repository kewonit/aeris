"use client";

import { motion } from "motion/react";

export function AltitudeLegend() {
  return (
    <motion.div
      initial={{ opacity: 0, x: 12 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ type: "spring", stiffness: 300, damping: 24, delay: 0.6 }}
      className="flex flex-col gap-2 rounded-xl border p-3 backdrop-blur-2xl"
      style={{
        borderColor: "rgb(var(--ui-fg) / 0.06)",
        backgroundColor: "rgb(var(--ui-bg) / 0.5)",
      }}
      role="img"
      aria-label="Altitude color scale from 0 feet (green) to 43,000 feet (blue)"
    >
      <p
        className="text-[10px] font-semibold tracking-widest uppercase"
        style={{ color: "rgb(var(--ui-fg) / 0.3)" }}
      >
        Altitude
      </p>
      <div className="flex items-center gap-2">
        <div
          className="h-32 w-1.5 rounded-full"
          style={{
            background:
              "linear-gradient(to top, rgb(72,210,160), rgb(160,195,80), rgb(235,150,60), rgb(240,110,80), rgb(220,85,130), rgb(180,90,190), rgb(120,110,220), rgb(100,170,240))",
          }}
        />
        <div className="flex h-32 flex-col justify-between">
          <span
            className="text-[10px] font-medium"
            style={{ color: "rgb(var(--ui-fg) / 0.5)" }}
          >
            43,000 ft
          </span>
          <span
            className="text-[10px] font-medium"
            style={{ color: "rgb(var(--ui-fg) / 0.5)" }}
          >
            20,000 ft
          </span>
          <span
            className="text-[10px] font-medium"
            style={{ color: "rgb(var(--ui-fg) / 0.5)" }}
          >
            10,000 ft
          </span>
          <span
            className="text-[10px] font-medium"
            style={{ color: "rgb(var(--ui-fg) / 0.5)" }}
          >
            5,000 ft
          </span>
          <span
            className="text-[10px] font-medium"
            style={{ color: "rgb(var(--ui-fg) / 0.5)" }}
          >
            2,000 ft
          </span>
          <span
            className="text-[10px] font-medium"
            style={{ color: "rgb(var(--ui-fg) / 0.5)" }}
          >
            500 ft
          </span>
          <span
            className="text-[10px] font-medium"
            style={{ color: "rgb(var(--ui-fg) / 0.5)" }}
          >
            0 ft
          </span>
        </div>
      </div>
    </motion.div>
  );
}
