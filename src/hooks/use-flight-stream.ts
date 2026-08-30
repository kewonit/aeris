"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import type { City } from "@/lib/cities";
import type { FlightState } from "@/lib/opensky";
import {
  applyRelayStreamMessage,
  createRelayClientState,
  parseRelayStreamMessage,
  relayBoundingBoxAround,
  relayBoundingBoxKey,
  relayStateToFlights,
  type RelayAttribution,
  type RelayBoundingBox,
  type RelayClientState,
  type RelaySourceStatus,
} from "@/lib/relay/protocol";

const STREAM_URL = process.env.NEXT_PUBLIC_FLIGHT_STREAM_URL?.trim() ?? "";
const FPV_RADIUS_DEGREES = 2;
const FPV_CENTER_SNAP_DEGREES = 0.5;
const STALE_AIRCRAFT_HIDE_MS = 120_000;
const MAX_MESSAGE_CHARS = 8 * 1024 * 1024;

type TicketResponse = {
  ticket: string;
  expiresAt: number;
  attribution: RelayAttribution | null;
};

export type FlightStreamResult = {
  enabled: boolean;
  connected: boolean;
  hasSnapshot: boolean;
  flights: FlightState[];
  sourceStatus: RelaySourceStatus;
  sourceAgeMs: number | null;
  attribution: RelayAttribution | null;
  bbox: RelayBoundingBox | null;
  error: string | null;
};

function validAttribution(value: unknown): value is RelayAttribution | null {
  if (value === null) return true;
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<RelayAttribution>;
  return (
    typeof candidate.provider === "string" &&
    candidate.provider.length > 0 &&
    candidate.provider.length <= 64 &&
    (candidate.label === undefined ||
      (typeof candidate.label === "string" && candidate.label.length <= 128)) &&
    (candidate.url === undefined ||
      (typeof candidate.url === "string" && candidate.url.length <= 2_048))
  );
}

function parseTicketResponse(value: unknown): TicketResponse | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<TicketResponse>;
  if (
    typeof candidate.ticket !== "string" ||
    candidate.ticket.length < 32 ||
    candidate.ticket.length > 4_096 ||
    !/^[-_A-Za-z0-9]+\.[-_A-Za-z0-9]+$/.test(candidate.ticket) ||
    !Number.isSafeInteger(candidate.expiresAt) ||
    candidate.expiresAt! <= Math.floor(Date.now() / 1000) ||
    !validAttribution(candidate.attribution ?? null)
  ) {
    return null;
  }
  return {
    ticket: candidate.ticket,
    expiresAt: candidate.expiresAt!,
    attribution: candidate.attribution ?? null,
  };
}

export function createRelaySubscribeMessage(
  bbox: RelayBoundingBox,
  subscriptionRevision: number,
) {
  return {
    type: "subscribe",
    protocolVersion: 1,
    subscriptionRevision,
    bbox,
  } as const;
}

export function relayReconnectDelayMs(attempt: number, random = Math.random()): number {
  const base = Math.min(30_000, 1_000 * 2 ** Math.min(5, Math.max(0, attempt)));
  return Math.round(base * (0.75 + Math.max(0, Math.min(1, random)) * 0.5));
}

function displayedSourceStatus(
  connected: boolean,
  state: RelayClientState,
): RelaySourceStatus {
  if (!connected && state.hasSnapshot) return "stale";
  return state.sourceStatus;
}

export function useFlightStream(
  city: City | null,
  fpvIcao24: string | null,
  fpvSeedCenter: { lng: number; lat: number } | null,
): FlightStreamResult {
  const enabled = Boolean(STREAM_URL && city);
  const [clientState, setClientState] = useState(createRelayClientState);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attribution, setAttribution] = useState<RelayAttribution | null>(null);
  const [staleNow, setStaleNow] = useState(0);
  const socketRef = useRef<WebSocket | null>(null);
  const bboxRef = useRef<RelayBoundingBox | null>(null);
  const bboxKeyRef = useRef("");
  const revisionRef = useRef(1);

  const unfilteredFlights = useMemo(
    () => relayStateToFlights(clientState.aircraft),
    [clientState.aircraft],
  );

  const bbox = useMemo(() => {
    if (!city) return null;
    let longitude = city.coordinates[0];
    let latitude = city.coordinates[1];
    let radius = city.radius;

    if (fpvIcao24) {
      const target = fpvIcao24.toLowerCase();
      const tracked = unfilteredFlights.find(
        (flight) => flight.icao24.toLowerCase() === target,
      );
      longitude = tracked?.longitude ?? fpvSeedCenter?.lng ?? longitude;
      latitude = tracked?.latitude ?? fpvSeedCenter?.lat ?? latitude;
      longitude =
        Math.round(longitude / FPV_CENTER_SNAP_DEGREES) *
        FPV_CENTER_SNAP_DEGREES;
      latitude =
        Math.round(latitude / FPV_CENTER_SNAP_DEGREES) *
        FPV_CENTER_SNAP_DEGREES;
      radius = FPV_RADIUS_DEGREES;
    }

    return relayBoundingBoxAround(latitude, longitude, radius);
  }, [city, fpvIcao24, fpvSeedCenter, unfilteredFlights]);

  useEffect(() => {
    bboxRef.current = bbox;
    const nextKey = bbox ? relayBoundingBoxKey(bbox) : "";
    if (!bbox || !nextKey || nextKey === bboxKeyRef.current) return;
    const hadPrevious = bboxKeyRef.current !== "";
    bboxKeyRef.current = nextKey;
    const socket = socketRef.current;
    if (!hadPrevious || !socket || socket.readyState !== WebSocket.OPEN) return;

    revisionRef.current += 1;
    socket.send(
      JSON.stringify(createRelaySubscribeMessage(bbox, revisionRef.current)),
    );
  }, [bbox]);

  useEffect(() => {
    if (!enabled) {
      socketRef.current?.close(1000, "stream disabled");
      socketRef.current = null;
      return;
    }

    let stopped = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;
    let connecting = false;

    const scheduleReconnect = () => {
      if (stopped || reconnectTimer) return;
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        void connect();
      }, relayReconnectDelayMs(attempt++));
    };

    const connect = async () => {
      if (
        stopped ||
        connecting ||
        !bboxRef.current ||
        (socketRef.current &&
          (socketRef.current.readyState === WebSocket.CONNECTING ||
            socketRef.current.readyState === WebSocket.OPEN))
      ) {
        return;
      }
      connecting = true;
      setError(null);
      try {
        const response = await fetch("/api/flights/stream-ticket", {
          method: "POST",
          cache: "no-store",
          credentials: "same-origin",
          headers: { Accept: "application/json" },
        });
        if (!response.ok) throw new Error(`ticket request returned ${response.status}`);
        const ticket = parseTicketResponse(await response.json());
        if (!ticket) throw new Error("ticket response was invalid");
        if (stopped) return;

        setAttribution(ticket.attribution);
        revisionRef.current = 1;
        const socket = new WebSocket(STREAM_URL, [
          "aeris.v1",
          `aeris.ticket.${ticket.ticket}`,
        ]);
        socketRef.current = socket;

        socket.onopen = () => {
          if (stopped || !bboxRef.current) {
            socket.close(1000, "stream no longer needed");
            return;
          }
          attempt = 0;
          setConnected(true);
          setError(null);
          setClientState((previous) => ({
            ...previous,
            sourceStatus: "starting",
            needsResnapshot: true,
          }));
          socket.send(
            JSON.stringify(
              createRelaySubscribeMessage(
                bboxRef.current,
                revisionRef.current,
              ),
            ),
          );
        };

        socket.onmessage = (event) => {
          if (typeof event.data !== "string" || event.data.length > MAX_MESSAGE_CHARS) {
            socket.close(1009, "message too large");
            return;
          }
          let parsed: unknown;
          try {
            parsed = JSON.parse(event.data);
          } catch {
            socket.close(1007, "invalid message");
            return;
          }
          const message = parseRelayStreamMessage(parsed);
          if (!message) {
            socket.close(1008, "invalid protocol message");
            return;
          }
          setClientState((previous) => {
            const next = applyRelayStreamMessage(
              previous,
              message,
              revisionRef.current,
            );
            if (next.needsResnapshot) {
              queueMicrotask(() => socket.close(1012, "resnapshot required"));
            }
            return next;
          });
        };

        socket.onerror = () => socket.close();
        socket.onclose = () => {
          if (socketRef.current === socket) socketRef.current = null;
          setConnected(false);
          scheduleReconnect();
        };
      } catch {
        if (stopped) return;
        setConnected(false);
        setError("Live flight stream unavailable");
        scheduleReconnect();
      } finally {
        connecting = false;
      }
    };

    const handleOnline = () => {
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = null;
      void connect();
    };

    void connect();
    window.addEventListener("online", handleOnline);
    return () => {
      stopped = true;
      window.removeEventListener("online", handleOnline);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      const socket = socketRef.current;
      socketRef.current = null;
      if (socket) socket.close(1000, "component unmounted");
    };
  }, [enabled]);

  const sourceStatus = displayedSourceStatus(connected, clientState);
  useEffect(() => {
    if (sourceStatus === "live") return;
    const update = () => setStaleNow(Date.now());
    const initial = setTimeout(update, 0);
    const timer = setInterval(update, 5_000);
    return () => {
      clearTimeout(initial);
      clearInterval(timer);
    };
  }, [sourceStatus]);

  const flights = useMemo(() => {
    if (sourceStatus !== "stale") return unfilteredFlights;
    if (staleNow === 0) return unfilteredFlights;
    return unfilteredFlights.filter((flight) => {
      const fixTime = flight.provenance.observationTime;
      return fixTime !== null && staleNow - fixTime < STALE_AIRCRAFT_HIDE_MS;
    });
  }, [sourceStatus, unfilteredFlights, staleNow]);

  return {
    enabled,
    connected,
    hasSnapshot: clientState.hasSnapshot,
    flights,
    sourceStatus,
    sourceAgeMs: clientState.sourceAgeMs,
    attribution,
    bbox,
    error,
  };
}
