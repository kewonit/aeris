import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// The design system lives in globals.css. Components use its tokens, so
// these patterns mean a one-off value slipped back in.
const RULES: { pattern: RegExp; use: string }[] = [
  { pattern: /\btext-\[\d/, use: "a text-micro … text-title size" },
  {
    pattern: /\btext-(?:xs|sm|base|lg|[2-9]?xl)\b/,
    use: "a text-micro … text-title size",
  },
  {
    pattern: /\bfont-(?:thin|light|semibold|bold|extrabold|black)\b/,
    use: "font-normal or font-medium",
  },
  { pattern: /\b(?:uppercase|tracking-[\w[-]+)/, use: "sentence case" },
  {
    pattern: /\b(?:text|bg|border|ring|from|via|to|fill|stroke)-(?:foreground|background)\/[\d[]/,
    use: "foreground, muted-foreground, subtle, card, accent, or border",
  },
  { pattern: /\brounded(?:-\[|-(?:xs|2xl|3xl)\b|(?=["'\s`]))/, use: "rounded-sm, -md, -lg, -xl, or -full" },
  { pattern: /\bshadow-(?:\[|xs\b|sm\b|md\b|lg\b|xl\b|2xl\b|inner\b)/, use: "shadow-lift" },
  { pattern: /\bbackdrop-(?:blur|saturate)/, use: "a solid surface" },
  { pattern: /\b(?:duration|ease|delay)-\[/, use: "the default transition or --ease-pop" },
  { pattern: /rgb\(var\(--ui-/, use: "a color token" },
  {
    pattern:
      /\b(?:text|bg|border|ring|fill|stroke|from|via|to|shadow)-(?:emerald|amber|red|cyan|sky|blue|teal|orange|purple|violet|green|yellow|rose|pink|indigo|lime|fuchsia|neutral|slate|zinc|gray|stone)-\d/,
    use: "tint, arrival, departure, warning, or danger",
  },
  { pattern: /\b(?:text|bg|border|ring)-(?:white|black)\/\d/, use: "a solid color token" },
];

// Flight categories keep the conventional VFR, MVFR, IFR, LIFR colors.
const PALETTE_FILES = new Set(["components/ui/airport-info-card/formatters.ts"]);

// Canvas drawing, MapLibre paint, the altitude ramp, and browser theme
// metadata cannot read CSS variables, so they keep literal colors.
const LITERAL_COLOR_FILES = new Set([
  "app/layout.tsx",
  "components/map/airport-layer.tsx",
  "components/map/map.tsx",
  "components/map/user-location-marker.tsx",
  "components/ui/altitude-legend.tsx",
  "components/ui/atc-spectrum.tsx",
  "components/ui/atc-waveform.tsx",
  "components/ui/fpv-hud.tsx",
]);
const SATORI_FILES = new Set(["app/opengraph-image.tsx", "app/twitter-image.tsx"]);

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(fullPath);
    const isComponentModule =
      entry.name.endsWith(".ts") &&
      !entry.name.endsWith(".test.ts") &&
      fullPath.includes(`${path.sep}components${path.sep}`);
    return entry.name.endsWith(".tsx") || isComponentModule ? [fullPath] : [];
  });
}

test("components use design tokens instead of one-off styles", () => {
  const sourceRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
  );
  const violations: string[] = [];

  for (const file of sourceFiles(sourceRoot)) {
    const relative = path.relative(sourceRoot, file);
    if (SATORI_FILES.has(relative)) continue;
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((line, index) => {
      if (/^\s*(?:\/\/|\/?\*)/.test(line)) return;
      for (const { pattern, use } of RULES) {
        if (use.startsWith("tint") && PALETTE_FILES.has(relative)) continue;
        if (pattern.test(line)) {
          violations.push(`${relative}:${index + 1} use ${use}: ${line.trim()}`);
        }
      }
      // Plain modules under components draw on canvases and the map, so
      // only components are held to color tokens.
      if (
        relative.endsWith(".tsx") &&
        !LITERAL_COLOR_FILES.has(relative) &&
        /rgba?\(\s*\d|#[0-9a-f]{6}\b/i.test(line)
      ) {
        violations.push(`${relative}:${index + 1} use a color token: ${line.trim()}`);
      }
    });
  }

  assert.deepEqual(violations, []);
});
