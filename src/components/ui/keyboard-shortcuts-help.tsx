"use client";

import { useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { X, Keyboard } from "lucide-react";

const SHORTCUTS = [
  { key: "N", description: "North up" },
  { key: "R", description: "Reset view" },
  { key: "O", description: "Toggle orbit" },
  { key: "/", description: "Open search" },
  { key: "?", description: "Shortcuts help" },
  { key: "Esc", description: "Close / Deselect" },
] as const;

type KeyboardShortcutsHelpProps = {
  open: boolean;
  onClose: () => void;
};

export function KeyboardShortcutsHelp({
  open,
  onClose,
}: KeyboardShortcutsHelpProps) {
  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-80 bg-black/60 backdrop-blur-md"
            onClick={onClose}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.92, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.92, y: 20 }}
            transition={{
              type: "spring",
              stiffness: 400,
              damping: 30,
              mass: 0.8,
            }}
            className="fixed left-1/2 top-1/2 z-90 w-72 -translate-x-1/2 -translate-y-1/2"
            role="dialog"
            aria-modal="true"
            aria-label="Keyboard shortcuts"
          >
            <div className="overflow-hidden rounded-2xl border border-white/8 bg-[#0c0c0e]/95 shadow-[0_40px_100px_rgba(0,0,0,0.8)] backdrop-blur-3xl">
              <div className="flex items-center justify-between px-5 pt-5 pb-3">
                <div className="flex items-center gap-2.5">
                  <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/6">
                    <Keyboard className="h-3.5 w-3.5 text-white/50" />
                  </div>
                  <h2 className="text-[14px] font-semibold tracking-tight text-white/90">
                    Keyboard Shortcuts
                  </h2>
                </div>
                <motion.button
                  onClick={onClose}
                  className="flex h-7 w-7 items-center justify-center rounded-full bg-white/6 transition-colors hover:bg-white/12"
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.9 }}
                  aria-label="Close"
                >
                  <X className="h-3.5 w-3.5 text-white/40" />
                </motion.button>
              </div>

              <div className="px-5 pb-5">
                <div className="space-y-1">
                  {SHORTCUTS.map(({ key, description }) => (
                    <div
                      key={key}
                      className="flex items-center justify-between py-1.5"
                    >
                      <span className="text-[13px] font-medium text-white/50">
                        {description}
                      </span>
                      <kbd className="flex h-6 min-w-6 items-center justify-center rounded-md bg-white/6 px-2 font-mono text-[11px] font-semibold text-white/70 ring-1 ring-white/8">
                        {key}
                      </kbd>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
