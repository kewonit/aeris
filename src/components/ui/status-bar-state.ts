export type StatusBarDropdownState = {
  feedDropdownOpen: boolean;
  providerDropdownOpen: boolean;
  handledAtcToggle: number | undefined;
};

export function resolveDropdownState(
  state: StatusBarDropdownState,
  atcToggle?: number,
): Pick<StatusBarDropdownState, "feedDropdownOpen" | "providerDropdownOpen"> {
  if (atcToggle === undefined) {
    return {
      feedDropdownOpen: state.feedDropdownOpen,
      providerDropdownOpen: state.providerDropdownOpen,
    };
  }

  // Treat an undefined handledAtcToggle as a baseline one step behind
  // the incoming value so the first increment correctly toggles.
  const baseline = state.handledAtcToggle ?? atcToggle - 1;
  if (atcToggle <= baseline) {
    return {
      feedDropdownOpen: state.feedDropdownOpen,
      providerDropdownOpen: state.providerDropdownOpen,
    };
  }

  const toggleDelta = atcToggle - baseline;

  return {
    feedDropdownOpen:
      toggleDelta % 2 === 0 ? state.feedDropdownOpen : !state.feedDropdownOpen,
    providerDropdownOpen: false,
  };
}
