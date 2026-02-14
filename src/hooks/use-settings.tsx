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
  showShadows: boolean;
  showAltitudeColors: boolean;
};

const DEFAULT_SETTINGS: Settings = {
  autoOrbit: true,
  orbitSpeed: 0.15,
  orbitDirection: "clockwise",
  showTrails: true,
  showShadows: true,
  showAltitudeColors: true,
};

const STORAGE_KEY = "aeris:settings";
const STORAGE_VERSION = 1;
const WRITE_DEBOUNCE_MS = 300;

type StorageEnvelope = {
  v: number;
  data: Settings;
};

/** Validate that a parsed value matches the Settings shape. */
function isValidSettings(obj: unknown): obj is Settings {
  if (typeof obj !== "object" || obj === null) return false;
  const s = obj as Record<string, unknown>;
  return (
    typeof s.autoOrbit === "boolean" &&
    typeof s.orbitSpeed === "number" &&
    (s.orbitDirection === "clockwise" ||
      s.orbitDirection === "counter-clockwise") &&
    typeof s.showTrails === "boolean" &&
    typeof s.showShadows === "boolean" &&
    typeof s.showAltitudeColors === "boolean"
  );
}

function loadSettings(): Settings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const envelope: StorageEnvelope = JSON.parse(raw);
    if (envelope.v !== STORAGE_VERSION || !isValidSettings(envelope.data)) {
      // Merge salvageable keys with defaults
      const merged = { ...DEFAULT_SETTINGS };
      if (typeof envelope.data === "object" && envelope.data !== null) {
        const d = envelope.data as Record<string, unknown>;
        for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
          if (key in d && typeof d[key] === typeof DEFAULT_SETTINGS[key]) {
            (merged as Record<string, unknown>)[key] = d[key];
          }
        }
      }
      return merged;
    }
    return { ...DEFAULT_SETTINGS, ...envelope.data };
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
    /* quota exceeded or blocked */
  }
}

type SettingsContextValue = {
  settings: Settings;
  update: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
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
        return { ...base, [key]: value };
      });
    },
    [],
  );

  return (
    <SettingsContext.Provider value={{ settings, update }}>
      {children}
    </SettingsContext.Provider>
  );
}
