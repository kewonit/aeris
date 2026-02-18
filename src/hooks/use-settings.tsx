"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from "react";

export type OrbitDirection = "clockwise" | "counter-clockwise";

export type Settings = {
  autoOrbit: boolean;
  orbitSpeed: number;
  orbitDirection: OrbitDirection;
  showTrails: boolean;
  trailThickness: number;
  trailDistance: number;
  showShadows: boolean;
  showAltitudeColors: boolean;
  fpvChaseDistance: number;
  fpvPitch: number;
  fpvFreeCamera: boolean;
};

const TRAIL_THICKNESS_MIN = 1;
const TRAIL_THICKNESS_MAX = 8;
const TRAIL_DISTANCE_MIN = 12;
const TRAIL_DISTANCE_MAX = 100;
const FPV_CHASE_DISTANCE_MIN = 0.003;
const FPV_CHASE_DISTANCE_MAX = 0.01;
const FPV_PITCH_MIN = 20;
const FPV_PITCH_MAX = 45;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function normalizeSettings(input: Settings): Settings {
  return {
    ...input,
    orbitSpeed: clamp(input.orbitSpeed, 0.02, 0.5),
    trailThickness: clamp(
      input.trailThickness,
      TRAIL_THICKNESS_MIN,
      TRAIL_THICKNESS_MAX,
    ),
    trailDistance: Math.round(
      clamp(input.trailDistance, TRAIL_DISTANCE_MIN, TRAIL_DISTANCE_MAX),
    ),
    fpvChaseDistance: clamp(
      input.fpvChaseDistance,
      FPV_CHASE_DISTANCE_MIN,
      FPV_CHASE_DISTANCE_MAX,
    ),
    fpvPitch: Math.round(clamp(input.fpvPitch, FPV_PITCH_MIN, FPV_PITCH_MAX)),
  };
}

const DEFAULT_SETTINGS: Settings = {
  autoOrbit: true,
  orbitSpeed: 0.06,
  orbitDirection: "clockwise",
  showTrails: true,
  trailThickness: 2,
  trailDistance: 40,
  showShadows: true,
  showAltitudeColors: true,
  fpvChaseDistance: 0.0048,
  fpvPitch: 34,
  fpvFreeCamera: false,
};

const STORAGE_KEY = "aeris:settings";
const STORAGE_VERSION = 1;
const WRITE_DEBOUNCE_MS = 300;

type StorageEnvelope = {
  v: number;
  data: Settings;
};

function isValidSettings(obj: unknown): obj is Settings {
  if (typeof obj !== "object" || obj === null) return false;
  const s = obj as Record<string, unknown>;
  return (
    typeof s.autoOrbit === "boolean" &&
    typeof s.orbitSpeed === "number" &&
    (s.orbitDirection === "clockwise" ||
      s.orbitDirection === "counter-clockwise") &&
    typeof s.showTrails === "boolean" &&
    typeof s.trailThickness === "number" &&
    Number.isFinite(s.trailThickness) &&
    s.trailThickness >= TRAIL_THICKNESS_MIN &&
    s.trailThickness <= TRAIL_THICKNESS_MAX &&
    typeof s.trailDistance === "number" &&
    Number.isFinite(s.trailDistance) &&
    s.trailDistance >= TRAIL_DISTANCE_MIN &&
    s.trailDistance <= TRAIL_DISTANCE_MAX &&
    typeof s.showShadows === "boolean" &&
    typeof s.showAltitudeColors === "boolean" &&
    typeof s.fpvChaseDistance === "number" &&
    Number.isFinite(s.fpvChaseDistance) &&
    s.fpvChaseDistance >= FPV_CHASE_DISTANCE_MIN &&
    s.fpvChaseDistance <= FPV_CHASE_DISTANCE_MAX &&
    typeof s.fpvPitch === "number" &&
    Number.isFinite(s.fpvPitch) &&
    s.fpvPitch >= FPV_PITCH_MIN &&
    s.fpvPitch <= FPV_PITCH_MAX &&
    typeof s.fpvFreeCamera === "boolean"
  );
}

function loadSettings(): Settings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const envelope: StorageEnvelope = JSON.parse(raw);
    if (envelope.v !== STORAGE_VERSION || !isValidSettings(envelope.data)) {
      const merged = { ...DEFAULT_SETTINGS };
      if (typeof envelope.data === "object" && envelope.data !== null) {
        const d = envelope.data as Record<string, unknown>;
        for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
          if (key in d && typeof d[key] === typeof DEFAULT_SETTINGS[key]) {
            (merged as Record<string, unknown>)[key] = d[key];
          }
        }
      }
      return normalizeSettings(merged);
    }
    return normalizeSettings({ ...DEFAULT_SETTINGS, ...envelope.data });
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function saveSettings(settings: Settings): void {
  if (typeof window === "undefined") return;
  try {
    const envelope: StorageEnvelope = { v: STORAGE_VERSION, data: settings };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(envelope));
  } catch {
    /* noop */
  }
}

type SettingsContextValue = {
  settings: Settings;
  update: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  reset: () => void;
};

const SettingsContext = createContext<SettingsContextValue | null>(null);

const subscribeNoop = () => () => {};
let settingsCache: Settings | undefined;

function getSettingsSnapshot(): Settings {
  if (!settingsCache) settingsCache = loadSettings();
  return settingsCache;
}

export function useSettings() {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("useSettings must be used within SettingsProvider");
  return ctx;
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const hydrated = useSyncExternalStore(
    subscribeNoop,
    getSettingsSnapshot,
    () => DEFAULT_SETTINGS,
  );

  const [override, setOverride] = useState<Settings | undefined>();
  const settings = override ?? hydrated;
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!override) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(
      () => saveSettings(override),
      WRITE_DEBOUNCE_MS,
    );
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [override]);

  const update = useCallback(
    <K extends keyof Settings>(key: K, value: Settings[K]) => {
      setOverride((prev) => {
        const base = prev ?? getSettingsSnapshot();
        return normalizeSettings({ ...base, [key]: value });
      });
    },
    [],
  );

  const reset = useCallback(() => {
    setOverride({ ...DEFAULT_SETTINGS });
  }, []);

  return (
    <SettingsContext.Provider value={{ settings, update, reset }}>
      {children}
    </SettingsContext.Provider>
  );
}
