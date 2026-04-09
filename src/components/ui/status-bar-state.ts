export type StatusBarDropdownState = {
  feedDropdownOpen: boolean;
  providerDropdownOpen: boolean;
  handledAtcToggle: number | undefined;
};

export function resolveDropdownState(
  state: StatusBarDropdownState,
  atcToggle?: number,
): Pick<StatusBarDropdownState, "feedDropdownOpen" | "providerDropdownOpen"> {
  if (
    atcToggle === undefined ||
    state.handledAtcToggle === undefined ||
    atcToggle <= state.handledAtcToggle
  ) {
    return {
      feedDropdownOpen: state.feedDropdownOpen,
      providerDropdownOpen: state.providerDropdownOpen,
    };
  }

  const toggleDelta = atcToggle - state.handledAtcToggle;

  return {
    feedDropdownOpen:
      toggleDelta % 2 === 0 ? state.feedDropdownOpen : !state.feedDropdownOpen,
    providerDropdownOpen: false,
  };
}
