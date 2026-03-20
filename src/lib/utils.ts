import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Clamp a number to [min, max]. */
export const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);
