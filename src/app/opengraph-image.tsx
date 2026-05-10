import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const alt = "Aeris - Real-Time 3D Flight Tracking";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image() {
  const imageData = await readFile(
    join(process.cwd(), "public", "aeris-hero.png"),
  );
  const base64 = imageData.toString("base64");
  const heroSrc = `data:image/png;base64,${base64}`;

  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        position: "relative",
        overflow: "hidden",
        fontFamily: "Inter, system-ui, sans-serif",
      }}
    >
      {/* Hero background image */}
      <img
        src={heroSrc}
        alt=""
        width={1200}
        height={630}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: "100%",
          objectFit: "cover",
        }}
      />

      {/* Full dark vignette overlay */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: "100%",
          background:
            "linear-gradient(to top right, rgba(0,0,0,0.95) 0%, rgba(0,0,0,0.7) 25%, rgba(0,0,0,0.15) 50%, rgba(0,0,0,0.05) 100%)",
          display: "flex",
        }}
      />

      {/* Content overlay pinned to bottom */}
      <div
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          width: "100%",
          padding: "0 60px 44px 60px",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Title */}
        <div
          style={{
            fontSize: "56px",
            fontWeight: 700,
            color: "#ffffff",
            letterSpacing: "-1.5px",
            lineHeight: 1,
            display: "flex",
          }}
        >
          Aeris
        </div>

        {/* Tagline */}
        <div
          style={{
            fontSize: "24px",
            fontWeight: 400,
            color: "rgba(255,255,255,0.85)",
            marginTop: "10px",
            display: "flex",
          }}
        >
          Real-Time 3D Flight Tracking
        </div>

        {/* Divider + pills row */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "12px",
            marginTop: "20px",
          }}
        >
          {["Altitude-Aware", "Live ADS-B Data", "Free & Open Source"].map(
            (label) => (
              <div
                key={label}
                style={{
                  padding: "6px 18px",
                  borderRadius: "100px",
                  background: "rgba(0,0,0,0.75)",
                  border: "1px solid rgba(255,255,255,0.18)",
                  color: "rgba(255,255,255,0.85)",
                  fontSize: "14px",
                  fontWeight: 500,
                  display: "flex",
                }}
              >
                {label}
              </div>
            ),
          )}
        </div>
      </div>

      {/* URL badge top-right */}
      <div
        style={{
          position: "absolute",
          top: "48px",
          right: "56px",
          fontSize: "15px",
          fontWeight: 600,
          color: "rgba(255,255,255,0.9)",
          display: "flex",
          padding: "8px 18px",
          borderRadius: "100px",
          background: "rgba(0,0,0,0.65)",
          border: "1px solid rgba(255,255,255,0.2)",
        }}
      >
        aeris.edbn.me
      </div>
    </div>,
    { ...size },
  );
}
