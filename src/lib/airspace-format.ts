// ── Airspace property formatting helpers ───────────────────────────
//
// The OpenAIP MVT `airspaces` source layer exposes per-feature properties:
//   - icao_class: "a" | "b" | ... | "g" | "unclassified"
//   - type: "ctr" | "tma" | "restricted" | "tfr" | "adiz" | ...
//   - name: string
//   - lower_limit_value / lower_limit_unit / lower_limit_reference_datum
//   - upper_limit_value / upper_limit_unit / upper_limit_reference_datum
//
// These helpers format those properties for the click-popup UI.
// ────────────────────────────────────────────────────────────────────

export type AirspaceLimit = {
  value: number;
  unit: string;
  referenceDatum: string;
};

export type AirspaceTitleInput = {
  icao_class: string;
  type: string;
  name: string;
};

/**
 * Formats a single altitude limit.
 *   { 0, ft, GND } → "GND"
 *   { 0, ft, SFC } → "SFC" (surface - used by some ICAO datasets)
 *   { 245, ft, STD } → "FL245"
 *   { 2500, ft, AMSL } → "2500 ft AMSL"
 *   null / invalid → "-"
 */
export function formatAirspaceLimit(
  limit: AirspaceLimit | null | undefined,
): string {
  if (!limit) return "-";
  const { value, unit, referenceDatum } = limit;
  if (typeof value !== "number" || !Number.isFinite(value)) return "-";
  if (referenceDatum === "GND" && value === 0) return "GND";
  if (referenceDatum === "SFC" && value === 0) return "SFC";
  if (referenceDatum === "STD") return `FL${value}`;
  if (!unit || !referenceDatum) return "-";
  return `${value} ${unit} ${referenceDatum}`;
}

/**
 * The popup's two title lines: what kind of airspace it is, "Class C" or
 * "Restricted", and its name when it has one.
 */
export function formatAirspaceTitle(input: AirspaceTitleInput): {
  kind: string;
  name: string | null;
} {
  const cls = (input.icao_class ?? "").trim();
  const type = (input.type ?? "").trim();
  const name = (input.name ?? "").trim();
  const kind =
    cls && cls.toLowerCase() !== "unclassified"
      ? `Class ${cls.toUpperCase()}`
      : type.length <= 3
        ? type.toUpperCase()
        : type.charAt(0).toUpperCase() + type.slice(1).toLowerCase();
  return { kind, name: name || null };
}
