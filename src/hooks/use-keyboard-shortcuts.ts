"use client";

import { useEffect, useRef } from "react";

type ShortcutActions = {
  onNorthUp: () => void;
  onResetView: () => void;
  onToggleOrbit: () => void;
  onOpenSearch: () => void;
  onToggleHelp: () => void;
  onDeselect: () => void;
  onToggleFpv: () => void;
  onToggleAtc?: () => void;
  isFpv?: boolean;
};

const INPUT_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);

export function useKeyboardShortcuts(actions: ShortcutActions) {
  const ref = useRef(actions);

  useEffect(() => {
    ref.current = actions;
  }, [actions]);

  useEffect(() => {
    function handler(e: KeyboardEvent) {
      const target = e.target as HTMLElement;

      const a = ref.current;

      // Ctrl/Cmd+K opens search from anywhere (even inside inputs)
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        a.onOpenSearch();
        return;
      }

      // Don't intercept other shortcuts when focused in input fields
      if (INPUT_TAGS.has(target.tagName) || target.isContentEditable) return;

      if (e.ctrlKey || e.metaKey || e.altKey) return;

      // Deferred dialog check — only query DOM when we actually need it
      // (most keydowns short-circuit above, avoiding unnecessary DOM traversal)
      const dialogOpen = !!document.querySelector(
        '[role="dialog"][aria-modal="true"]',
      );

      if (e.key === "Escape") {
        if (!dialogOpen) a.onDeselect();
        return;
      }

      if (dialogOpen) return;

      if (a.isFpv) {
        if (e.key === "f" || e.key === "F") {
          e.preventDefault();
          a.onToggleFpv();
        }
        return;
      }

      switch (e.key) {
        case "n":
        case "N":
          e.preventDefault();
          a.onNorthUp();
          break;
        case "r":
        case "R":
          e.preventDefault();
          a.onResetView();
          break;
        case "o":
        case "O":
          e.preventDefault();
          a.onToggleOrbit();
          break;
        case "/":
          e.preventDefault();
          a.onOpenSearch();
          break;
        case "f":
        case "F":
          e.preventDefault();
          a.onToggleFpv();
          break;
        case "?":
          e.preventDefault();
          a.onToggleHelp();
          break;
        case "a":
        case "A":
          e.preventDefault();
          a.onToggleAtc?.();
          break;
      }
    }

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
}
