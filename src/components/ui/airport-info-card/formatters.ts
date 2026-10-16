/** Flight category in the conventional VFR green, MVFR blue, IFR red, LIFR magenta. */
export function decodeFltCat(cat: string | undefined): {
  label: string;
  color: string;
} {
  switch (cat?.toUpperCase()) {
    case "VFR":
      return { label: "VFR", color: "text-arrival" };
    case "MVFR":
      return { label: "MVFR", color: "text-sky-700 dark:text-sky-400" };
    case "IFR":
      return { label: "IFR", color: "text-danger" };
    case "LIFR":
      return { label: "LIFR", color: "text-fuchsia-700 dark:text-fuchsia-400" };
    default:
      return { label: "-", color: "text-subtle" };
  }
}

export function cloudCoverLabel(cover: string): string {
  switch (cover.toUpperCase()) {
    case "SKC":
    case "CLR":
    case "NCD":
      return "Clear";
    case "FEW":
      return "Few";
    case "SCT":
      return "Scattered";
    case "BKN":
      return "Broken";
    case "OVC":
      return "Overcast";
    case "OVX":
      return "Obscured";
    default:
      return cover;
  }
}

export function surfaceLabel(surface: string | null): string {
  if (!surface) return "Unknown";
  const s = surface.toUpperCase().trim();
  if (s.includes("ASPH")) return "Asphalt";
  if (s.includes("CON")) return "Concrete";
  if (s.includes("GRAVEL") || s === "GRV") return "Gravel";
  if (s.includes("GRASS") || s === "GRS" || s === "TURF") return "Grass";
  if (s.includes("WATER") || s === "WTR") return "Water";
  if (s.includes("DIRT")) return "Dirt";
  if (s.includes("SNOW") || s === "SNW") return "Snow/Ice";
  return surface;
}

export function formatRunwayLength(ft: number | null, metric: boolean): string {
  if (ft == null) return "-";
  if (metric) return `${Math.round(ft * 0.3048).toLocaleString()} m`;
  return `${ft.toLocaleString()} ft`;
}

export function formatElevation(
  ft: number | null,
  unitSystem: "aviation" | "metric" | "imperial",
): string {
  if (ft == null) return "-";
  if (unitSystem === "metric") {
    return `${Math.round(ft * 0.3048).toLocaleString()} m`;
  }
  return `${ft.toLocaleString()} ft`;
}
