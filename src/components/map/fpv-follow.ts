/** Dragging the map pauses following; it resumes this long after you stop. */
export const FOLLOW_RESUME_IDLE_MS = 1_500;
/** The camera eases back to following over about this long. */
export const FOLLOW_RETURN_MS = 1_000;

/**
 * Whether following should hold off because the map is being moved by hand.
 * Each interaction restarts the idle wait, so a drag that pauses and goes on
 * is one interaction.
 */
export function createFollowPause(idleMs = FOLLOW_RESUME_IDLE_MS) {
  let lastInteractionAt: number | null = null;

  return {
    interact(now: number): void {
      lastInteractionAt = now;
    },
    paused(now: number): boolean {
      if (lastInteractionAt === null) return false;
      if (now - lastInteractionAt < idleMs) return true;
      lastInteractionAt = null;
      return false;
    },
  };
}

export type FollowPause = ReturnType<typeof createFollowPause>;
