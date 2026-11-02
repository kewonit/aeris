import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export const metadata: Metadata = {
  title: "Page not found",
  description: "This page isn't here. Aeris is a live map of flights.",
  alternates: { canonical: null },
  robots: { index: false, follow: true },
};

/**
 * A missing page, in the house style: the name, one line, and the way back
 * to the map.
 */
export default function NotFound() {
  return (
    <main className="grid min-h-dvh place-items-center bg-background px-6 text-foreground">
      <div className="w-full max-w-96">
        <p className="aeris-wordmark text-muted-foreground">aeris</p>
        <h1 className="mt-8 text-title text-foreground">This page isn’t here.</h1>
        <p className="mt-2 text-body text-muted-foreground">
          The link may be old, or mistyped. The map is still live.
        </p>
        <Link
          href="/"
          className="mt-8 inline-flex h-11 items-center gap-2 rounded-full bg-foreground px-5 text-small text-background transition-opacity hover:opacity-90"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          Back to the map
        </Link>
      </div>
    </main>
  );
}
