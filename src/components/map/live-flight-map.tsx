"use client";

import { useRef, useSyncExternalStore } from "react";
import type { PickingInfo } from "@deck.gl/core";
import { loadMapStyle } from "@/components/flight-tracker-utils";
import { MapAttribution } from "@/components/ui/map-attribution";
import { useFlights } from "@/hooks/use-flights";
import {
  flightLayerSettings,
  SettingsProvider,
  useSettings,
  type Settings,
} from "@/hooks/use-settings";
import { useTrailSystem } from "@/hooks/use-trail-system";
import type { City } from "@/lib/cities";
import { DEFAULT_STYLE } from "@/lib/map-styles";
import type { FlightState } from "@/lib/opensky";
import { CameraController } from "./camera-controller";
import type { FpvDrawnPosition } from "./flight-layer-constants";
import { FlightLayers } from "./flight-layers";
import { Map as MapView } from "./map";
import { CLOSED_MAP_PANEL_CAMERA_STATE } from "./panel-camera";

const subscribeNoop = () => () => {};

function LiveFlightMapInner({
  city,
  onFlightClick,
  attributionClassName,
}: LiveFlightMapProps) {
  const { settings } = useSettings();
  const style = useSyncExternalStore(subscribeNoop, loadMapStyle, () => DEFAULT_STYLE);
  const { flights } = useFlights(city);
  const { trails } = useTrailSystem({ flights, selectedIcao24: null, historyEnabled: false });
  const drawnRef = useRef<FpvDrawnPosition | null>(null);

  return (
    <>
      <MapView
        mapStyle={style.style}
        terrainProfile={style.terrainProfile}
        isDark={style.dark}
        globeMode={settings.globeMode}
      >
        <CameraController
          city={city}
          fpvDrawnRef={drawnRef}
          panelCamera={CLOSED_MAP_PANEL_CAMERA_STATE}
        />
        <FlightLayers
          flights={flights}
          trails={trails}
          onClick={(info: PickingInfo<FlightState> | null) => {
            if (info?.object) onFlightClick?.(info.object);
          }}
          selectedIcao24={null}
          {...flightLayerSettings(settings)}
          fpvDrawnRef={drawnRef}
        />
      </MapView>
      <div className={attributionClassName}>
        <MapAttribution styleId={style.id} startCollapsed />
      </div>
    </>
  );
}

type LiveFlightMapProps = {
  /** Where the camera sits; changing it flies there. */
  city: City;
  onFlightClick?: (flight: FlightState) => void;
  /** Positions the map's attribution, which every page showing it must keep. */
  attributionClassName?: string;
};

/**
 * The Aeris 3D map with live traffic around one place, and none of the
 * tracker's controls: the same map, camera, flight layers and trails as the
 * home page, in the visitor's chosen map style. Pages that want it as a
 * backdrop, like /atc, pass `overrides` to fix settings such as orbiting.
 */
export function LiveFlightMap({
  overrides,
  ...props
}: LiveFlightMapProps & { overrides?: Partial<Settings> }) {
  return (
    <SettingsProvider overrides={overrides}>
      <LiveFlightMapInner {...props} />
    </SettingsProvider>
  );
}
