export function decodeFltCat(cat: string | undefined): {
  label: string;
  color: string;
  dotColor: string;
} {
  switch (cat?.toUpperCase()) {
    case "VFR":
      return {
        label: "VFR",
        color: "text-emerald-400",
        dotColor: "bg-emerald-400",
      };
    case "MVFR":
      return { label: "MVFR", color: "text-blue-400", dotColor: "bg-blue-400" };
    case "IFR":
      return { label: "IFR", color: "text-red-400", dotColor: "bg-red-400" };
    case "LIFR":
      return {
        label: "LIFR",
        color: "text-purple-400",
        dotColor: "bg-purple-400",
      };
    default:
      return {
        label: "—",
        color: "text-foreground/40",
        dotColor: "bg-foreground/20",
      };
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
  if (ft == null) return "—";
  if (metric) return `${Math.round(ft * 0.3048).toLocaleString()} m`;
  return `${ft.toLocaleString()} ft`;
}

export function formatElevation(
  ft: number | null,
  unitSystem: "aviation" | "metric" | "imperial",
): string {
  if (ft == null) return "—";
  if (unitSystem === "metric") {
    return `${Math.round(ft * 0.3048).toLocaleString()} m`;
  }
  return `${ft.toLocaleString()} ft`;
}
