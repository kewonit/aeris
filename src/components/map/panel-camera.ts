export type MapPanelCameraKind = "flight" | "airport";

export type MapPanelCameraState = {
  open: boolean;
  kind: MapPanelCameraKind | null;
  focusKey: string | null;
  coordinates: [number, number] | null;
  altitudeMeters: number | null;
};

export const CLOSED_MAP_PANEL_CAMERA_STATE: MapPanelCameraState = {
  open: false,
  kind: null,
  focusKey: null,
  coordinates: null,
  altitudeMeters: null,
};

export function createMapPanelCameraState({
  kind,
  focusKey,
  longitude,
  latitude,
  altitudeMeters,
}: {
  kind: MapPanelCameraKind;
  focusKey: string | null | undefined;
  longitude: number | null | undefined;
  latitude: number | null | undefined;
  altitudeMeters?: number | null;
}): MapPanelCameraState {
  return {
    open: true,
    kind,
    focusKey: cleanFocusKey(focusKey),
    coordinates: validCoordinates(longitude, latitude),
    altitudeMeters:
      altitudeMeters != null && Number.isFinite(altitudeMeters)
        ? Math.max(0, altitudeMeters)
        : null,
  };
}

export function panelVisualOffset(
  delta: { dx: number; dy: number },
  width: number,
  height: number,
): [number, number] {
  const maxOffset = Math.max(0, Math.min(width, height) * 0.85);
  return [
    Math.max(-maxOffset, Math.min(maxOffset, -delta.dx)),
    Math.max(-maxOffset, Math.min(maxOffset, -delta.dy)),
  ];
}

export function shouldCenterMapPanel(
  previousFocusKey: string | null,
  state: MapPanelCameraState,
): boolean {
  return Boolean(
    state.open &&
      state.focusKey &&
      state.coordinates &&
      state.focusKey !== previousFocusKey,
  );
}

export function coordinatesMatch(
  first: [number, number] | null,
  second: [number, number] | null,
): boolean {
  if (!first || !second) return false;
  return (
    Math.abs(first[0] - second[0]) < 0.000001 &&
    Math.abs(first[1] - second[1]) < 0.000001
  );
}

function cleanFocusKey(value: string | null | undefined): string | null {
  const cleaned = value?.trim();
  return cleaned ? cleaned : null;
}

function validCoordinates(
  longitude: number | null | undefined,
  latitude: number | null | undefined,
): [number, number] | null {
  const valid =
    longitude != null &&
    latitude != null &&
    Number.isFinite(longitude) &&
    Number.isFinite(latitude) &&
    longitude >= -180 &&
    longitude <= 180 &&
    latitude >= -90 &&
    latitude <= 90;

  return valid ? [longitude, latitude] : null;
}
