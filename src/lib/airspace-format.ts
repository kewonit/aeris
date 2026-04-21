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
 *   { 0, ft, SFC } → "SFC" (surface — used by some ICAO datasets)
 *   { 245, ft, STD } → "FL245"
 *   { 2500, ft, AMSL } → "2500 ft AMSL"
 *   null / invalid → "—"
 */
export function formatAirspaceLimit(
  limit: AirspaceLimit | null | undefined,
): string {
  if (!limit) return "—";
  const { value, unit, referenceDatum } = limit;
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  if (referenceDatum === "GND" && value === 0) return "GND";
  if (referenceDatum === "SFC" && value === 0) return "SFC";
  if (referenceDatum === "STD") return `FL${value}`;
  if (!unit || !referenceDatum) return "—";
  return `${value} ${unit} ${referenceDatum}`;
}

/**
 * Formats the popup title: "<CLASS> — <Name>" or "<TYPE> — <Name>".
 * Omits the em-dash and name if `name` is empty or whitespace.
 */
export function formatAirspaceTitle(input: AirspaceTitleInput): string {
  const cls = (input.icao_class ?? "").trim();
  const type = (input.type ?? "").trim();
  const name = (input.name ?? "").trim();
  const prefix =
    cls && cls.toLowerCase() !== "unclassified"
      ? cls.toUpperCase()
      : type.toUpperCase();
  return name ? `${prefix} — ${name}` : prefix;
}
