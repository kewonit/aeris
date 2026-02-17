const CATEGORY_LABELS: Record<number, string> = {
  2: "Light aircraft",
  3: "Small aircraft",
  4: "Large aircraft",
  5: "High vortex large",
  6: "Heavy aircraft",
  7: "High-performance aircraft",
  8: "Rotorcraft",
  9: "Glider / sailplane",
  10: "Lighter-than-air",
  11: "Parachutist / skydiver",
  12: "Ultralight / hang-glider",
  13: "Reserved",
  14: "Unmanned aerial vehicle",
  15: "Space / trans-atmospheric",
  16: "Surface emergency vehicle",
  17: "Surface service vehicle",
  18: "Point obstacle",
  19: "Cluster obstacle",
  20: "Line obstacle",
};

export function categoryToAircraftLabel(category: number | null): string | null {
  if (category === null) return null;
  return CATEGORY_LABELS[category] ?? null;
}

export function aircraftModelHint(category: number | null): string | null {
  const label = categoryToAircraftLabel(category);
  if (!label) return null;
  return `${label} class`;
}

export function aircraftTypeHint(category: number | null): string | null {
  return aircraftModelHint(category);
}
