"use client";

import { useEffect, useRef } from "react";

type ShortcutActions = {
  onNorthUp: () => void;
  onResetView: () => void;
  onToggleOrbit: () => void;
  onOpenSearch: () => void;
  onToggleHelp: () => void;
  onDeselect: () => void;
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
      if (INPUT_TAGS.has(target.tagName) || target.isContentEditable) return;

      const dialogOpen = !!document.querySelector(
        '[role="dialog"][aria-modal="true"]',
      );

      if (e.ctrlKey || e.metaKey || e.altKey) return;

      const a = ref.current;

      if (e.key === "Escape") {
        if (!dialogOpen) a.onDeselect();
        return;
      }

      if (dialogOpen) return;

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
        case "?":
          e.preventDefault();
          a.onToggleHelp();
          break;
      }
    }

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
}
