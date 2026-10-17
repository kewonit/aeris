import { TextLayer } from "@deck.gl/layers";

import type { FlightState } from "@/lib/opensky";

/** Traffic within this many metres of the cockpit is labelled. */
const LABEL_RANGE_METERS = 20_000;
/** At most this many, nearest first, so a busy sky stays readable. */
const MAX_LABELS = 12;
/** Closer than this, an aircraft is beside the cockpit, not ahead of it. */
const MIN_LABEL_DISTANCE_METERS = 300;
const FEET = 0.3048;

export type FpvTrafficLabel = {
  position: [number, number, number];
  text: string;
  /** Half the aircraft's drawn size, to sit the label just above it. */
  lift: number;
};

/**
 * "UAL302 +12": the callsign, and how far above or below the cockpit the
 * aircraft is in hundreds of feet, as a collision-avoidance display shows.
 */
export function fpvTrafficLabelText(
  flight: Pick<FlightState, "callsign" | "icao24">,
  heightAboveCockpitMeters: number,
): string {
  const hundreds = Math.round(heightAboveCockpitMeters / FEET / 100);
  const sign = hundreds < 0 ? "-" : "+";
  const relative = `${sign}${String(Math.abs(hundreds)).padStart(2, "0")}`;
  const name = flight.callsign?.trim() || flight.icao24.toUpperCase();
  return `${name} ${relative}`;
}

/**
 * Picks the traffic to label: airborne, in view, within range of the
 * cockpit, nearest first. Aircraft on the ground crowd an airport into one
 * unreadable clump, and a traffic display leaves them out too. Traffic out
 * of view, say far below the cockpit, gets no label: projected from beside
 * the camera, it would sprawl across the screen.
 *
 * @param elevationOf The aircraft's drawn height, in metres.
 * @param distanceOf Straight-line metres from the cockpit.
 * @param isInView Whether the cockpit camera can see the aircraft.
 */
export function pickFpvTrafficLabels(
  flights: FlightState[],
  cockpitAltitudeMeters: number,
  elevationOf: (flight: FlightState) => number,
  distanceOf: (flight: FlightState) => number,
  footprintOf: (flight: FlightState) => number,
  isInView: (flight: FlightState) => boolean,
): FpvTrafficLabel[] {
  return flights
    .filter(
      (flight) =>
        !flight.onGround && flight.longitude != null && flight.latitude != null,
    )
    .map((flight) => ({ flight, distance: distanceOf(flight) }))
    .filter(
      ({ flight, distance }) =>
        distance >= MIN_LABEL_DISTANCE_METERS &&
        distance <= LABEL_RANGE_METERS &&
        isInView(flight),
    )
    .sort((first, second) => first.distance - second.distance)
    .slice(0, MAX_LABELS)
    .map(({ flight }) => {
      const elevation = elevationOf(flight);
      return {
        position: [flight.longitude!, flight.latitude!, elevation],
        text: fpvTrafficLabelText(flight, elevation - cockpitAltitudeMeters),
        lift: footprintOf(flight) / 2,
      };
    });
}

let fontFamily: string | null = null;

/** The app's mono font, whose real name next/font hashes. */
function monoFontFamily(): string {
  if (fontFamily === null) {
    const loaded = getComputedStyle(document.body)
      .getPropertyValue("--font-fragment")
      .trim();
    fontFamily = loaded ? `${loaded}, monospace` : "monospace";
  }
  return fontFamily;
}

export function buildFpvTrafficLabelLayer(
  labels: FpvTrafficLabel[],
  theme: "dark" | "light",
): TextLayer<FpvTrafficLabel> {
  return new TextLayer<FpvTrafficLabel>({
    id: "fpv-traffic-labels",
    data: labels,
    getPosition: (label) => label.position,
    getText: (label) => label.text,
    getPixelOffset: (label) => [0, -label.lift - 10],
    getSize: 12,
    sizeUnits: "pixels",
    getColor: theme === "dark" ? [226, 232, 240, 235] : [17, 24, 39, 235],
    fontFamily: monoFontFamily(),
    fontSettings: { sdf: true },
    outlineWidth: 3,
    outlineColor: theme === "dark" ? [8, 13, 22, 220] : [255, 255, 255, 220],
    getTextAnchor: "middle",
    getAlignmentBaseline: "bottom",
    billboard: true,
    pickable: false,
  });
}
