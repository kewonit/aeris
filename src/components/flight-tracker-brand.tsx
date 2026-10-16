"use client";

import { Github, Star } from "lucide-react";
import {
  GITHUB_REPO_URL,
  formatStarCount,
} from "@/components/flight-tracker-utils";

export function Brand() {
  return (
    <h1 className="text-small font-medium text-muted-foreground">
      aeris
    </h1>
  );
}

export function GitHubBadge({ stars }: { stars: number | null }) {
  return (
    <a
      href={GITHUB_REPO_URL}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Open GitHub repository"
      className="inline-flex h-9 items-center gap-1.5 rounded-full border border-border bg-background px-3 text-label text-muted-foreground transition-colors hover:text-foreground"
    >
      <Github className="size-4" aria-hidden="true" />
      {stars != null && (
        <span className="flex items-center gap-0.5">
          <Star className="size-3" aria-hidden="true" />
          {formatStarCount(stars)}
          <span className="sr-only">stars</span>
        </span>
      )}
    </a>
  );
}
