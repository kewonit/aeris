"use client";

import { Github, Star } from "lucide-react";
import {
  GITHUB_REPO_URL,
  formatStarCount,
} from "@/components/flight-tracker-utils";

export function Brand() {
  return (
    <h1 className="aeris-wordmark text-muted-foreground">aeris</h1>
  );
}

/** The repository's icon, with its star count tucked under one corner. */
export function GitHubBadge({ stars }: { stars: number | null }) {
  return (
    <a
      href={GITHUB_REPO_URL}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={
        stars != null
          ? `Open GitHub repository, ${formatStarCount(stars)} stars`
          : "Open GitHub repository"
      }
      className="relative grid size-9 place-items-center rounded-full border border-border bg-background text-muted-foreground transition-colors hover:text-foreground"
    >
      <Github className="size-4" aria-hidden="true" />
      {stars != null && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -right-1 -bottom-1 flex items-center gap-0.5 rounded-full border border-border bg-background px-1.5 py-px text-micro font-medium tabular-nums text-muted-foreground"
        >
          <Star className="size-2" />
          {formatStarCount(stars)}
        </span>
      )}
    </a>
  );
}
