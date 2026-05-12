"use client";

import { memo } from "react";

/**
 * HighlightMatch
 *
 * Safely highlights the portion of `text` that matches `query`.
 * Case-insensitive. Returns plain text if no query or no match.
 *
 * Used across all control panel tabs for consistent search highlighting.
 */
export const HighlightMatch = memo(function HighlightMatch({
  text,
  query,
}: {
  text: string;
  query: string;
}) {
  if (!query) return <>{text}</>;
  const q = query.trim().toLowerCase();
  if (!q) return <>{text}</>;

  const idx = text.toLowerCase().indexOf(q);
  if (idx === -1) return <>{text}</>;

  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-transparent text-foreground/90 font-medium">
        {text.slice(idx, idx + q.length)}
      </mark>
      {text.slice(idx + q.length)}
    </>
  );
});
