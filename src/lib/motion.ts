import type { Transition } from "motion/react";

/**
 * The only springs in the interface. Bounce stays at zero, as Apple
 * recommends for interface motion, so things arrive without wobbling.
 * Components import these instead of writing their own constants; the
 * design token test rejects a stiffness written anywhere else.
 */

/** Controls, chips, highlights and menus: quick, settles without overshoot. */
export const SNAP: Transition = {
  type: "spring",
  visualDuration: 0.2,
  bounce: 0,
};

/**
 * Sheets and panels that follow a finger. A physics spring, so the speed of
 * the release carries into the settle.
 */
export const SHEET: Transition = {
  type: "spring",
  stiffness: 420,
  damping: 42,
  mass: 0.9,
};

/** Content that swaps in place, such as a tab's body. */
export const FADE: Transition = {
  duration: 0.15,
  ease: [0, 0, 0.2, 1],
};

/** How far a pressed control gives under the finger. */
export const PRESS_SCALE = 0.96;
