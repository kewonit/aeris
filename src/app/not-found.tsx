import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Page Not Found",
  description:
    "The page you are looking for does not exist. Return to Aeris to track live flights in 3D.",
  alternates: { canonical: null },
  robots: { index: false, follow: true },
};

export default function NotFound() {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100dvh",
        background: "hsl(0 0% 0%)",
        color: "hsl(0 0% 100%)",
        fontFamily: "Inter, system-ui, sans-serif",
        textAlign: "center",
        padding: "2rem",
      }}
    >
      <h1
        style={{
          fontSize: "6rem",
          fontWeight: 700,
          margin: 0,
          letterSpacing: "-2px",
          opacity: 0.15,
        }}
      >
        404
      </h1>
      <h2
        style={{
          fontSize: "1.5rem",
          fontWeight: 600,
          margin: "0.5rem 0",
        }}
      >
        Page not found
      </h2>
      <p
        style={{
          fontSize: "1rem",
          color: "hsl(0 0% 60%)",
          maxWidth: "28rem",
          marginTop: "0.5rem",
        }}
      >
        The page you&apos;re looking for doesn&apos;t exist or has been moved.
      </p>
      <Link
        href="/"
        style={{
          marginTop: "2rem",
          padding: "0.75rem 2rem",
          borderRadius: "0.5rem",
          background: "hsl(0 0% 100%)",
          color: "hsl(0 0% 0%)",
          fontSize: "0.875rem",
          fontWeight: 600,
          textDecoration: "none",
        }}
      >
        Back to Aeris
      </Link>
    </div>
  );
}
