"use client";

import { Github, Star } from "lucide-react";
import {
  GITHUB_REPO_URL,
  formatStarCount,
} from "@/components/flight-tracker-utils";

export function Brand({ isDark: _isDark }: { isDark: boolean }) {
  return (
    <span className="text-sm font-semibold tracking-wide text-foreground/70">
      aeris
    </span>
  );
}

export function GitHubBadge({ stars }: { stars: number | null }) {
  return (
    <a
      href={GITHUB_REPO_URL}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Open GitHub repository"
      className="relative inline-flex h-9 w-9 items-center justify-center rounded-xl backdrop-blur-2xl transition-colors"
      style={{
        borderWidth: 1,
        borderColor: "rgb(var(--ui-fg) / 0.06)",
        backgroundColor: "rgb(var(--ui-fg) / 0.03)",
        color: "rgb(var(--ui-fg) / 0.5)",
      }}
      title={
        stars != null
          ? `GitHub · ${formatStarCount(stars)} stars`
          : "Open GitHub repository"
      }
    >
      <Github className="h-4 w-4" />
      {stars != null && (
        <span
          className="pointer-events-none absolute -bottom-1 -right-1 rounded-full px-1.5 py-0.5 text-[9px] font-semibold tabular-nums"
          style={{
            backgroundColor: "rgb(var(--ui-bg) / 0.95)",
            border: "1px solid rgb(var(--ui-fg) / 0.1)",
            color: "rgb(var(--ui-fg) / 0.55)",
          }}
        >
          <span className="flex items-center gap-0.5">
            <Star className="h-2 w-2" />
            {formatStarCount(stars)}
          </span>
        </span>
      )}
    </a>
  );
}
