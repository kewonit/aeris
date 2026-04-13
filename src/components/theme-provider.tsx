"use client";

import * as React from "react";
import { ThemeProvider as NextThemesProvider } from "@wrksz/themes";

export function ThemeProvider({
  children,
  ...props
}: React.ComponentProps<typeof NextThemesProvider>) {
  return <NextThemesProvider {...props}>{children}</NextThemesProvider>;
}
