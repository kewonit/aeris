import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { GoogleAnalytics } from "@next/third-parties/google";
import { ThemeProvider } from "@wrksz/themes/next";
import { Toaster } from "sonner";
import {
  DEFAULT_DESCRIPTION,
  DEFAULT_TITLE,
  SITE_NAME,
  SITE_URL,
} from "@/lib/seo";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const GA_ID = process.env.NEXT_PUBLIC_GA_ID;
const GA_ID_VALID = GA_ID && /^G-[A-Z0-9]+$/.test(GA_ID) ? GA_ID : null;

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: DEFAULT_TITLE,
    template: "%s | Aeris",
  },
  description: DEFAULT_DESCRIPTION,
  applicationName: SITE_NAME,
  keywords: [
    "flight tracker",
    "live flight tracker",
    "3D flight tracking",
    "real-time flight tracker",
    "flight radar",
    "aircraft tracker",
    "plane tracker",
    "ADS-B tracker",
    "live aircraft map",
    "flight tracking map",
    "airplane tracker live",
    "aviation tracker",
    "track flights live",
    "free flight tracker",
    "aeris flight tracker",
    "opensky network",
    "airplanes live",
    "adsb tracker",
    "live air traffic",
    "flight path tracker",
  ],
  authors: [{ name: "kewonit", url: "https://github.com/kewonit" }],
  creator: "kewonit",
  publisher: "kewonit",
  category: "travel",
  openGraph: {
    type: "website",
    locale: "en_US",
    url: SITE_URL,
    siteName: SITE_NAME,
    title: DEFAULT_TITLE,
    description: DEFAULT_DESCRIPTION,
  },
  twitter: {
    card: "summary_large_image",
    title: DEFAULT_TITLE,
    description: DEFAULT_DESCRIPTION,
  },
  robots: {
    index: true,
    follow: true,
    nocache: false,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  alternates: { canonical: SITE_URL },
  icons: {
    icon: [
      {
        url: "/favicon/favicon.svg",
        type: "image/svg+xml",
        sizes: "any",
      },
      {
        url: "/favicon/favicon-96x96.png",
        type: "image/png",
        sizes: "96x96",
      },
    ],
    shortcut: "/favicon/favicon.ico",
    apple: {
      url: "/favicon/apple-touch-icon.png",
      type: "image/png",
      sizes: "180x180",
    },
  },
  other: {
    "mobile-web-app-capable": "yes",
    "apple-mobile-web-app-capable": "yes",
    "apple-mobile-web-app-status-bar-style": "black-translucent",
    "apple-mobile-web-app-title": "Aeris",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#000000",
  colorScheme: "dark",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.variable} font-sans antialiased`}>
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem={false}
          disableTransitionOnChange
        >
          {children}
          <Toaster
            position="bottom-center"
            offset={16}
            mobileOffset={8}
            gap={8}
            style={{ "--toaster-z-index": "70" } as React.CSSProperties}
            toastOptions={{
              unstyled: true,
              className: "w-full",
            }}
          />
        </ThemeProvider>
        {/* Uses @next/third-parties, which patches router events to fire a
            gtag('config', id, { page_path }) on every App Router navigation.
            Without this, client-side URL changes (e.g. /city/bom → /city/lhr)
            would not register page_views in GA4. */}
        {GA_ID_VALID && <GoogleAnalytics gaId={GA_ID_VALID} />}
      </body>
    </html>
  );
}
