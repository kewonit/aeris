import assert from "node:assert/strict";
import test from "node:test";

import { resolveDropdownState } from "./status-bar-state";

test("resolveDropdownState toggles feed dropdown once per external increment", () => {
  const initialState = {
    feedDropdownOpen: false,
    providerDropdownOpen: true,
    handledAtcToggle: 0,
  };

  assert.deepEqual(resolveDropdownState(initialState, 1), {
    feedDropdownOpen: true,
    providerDropdownOpen: false,
  });

  assert.deepEqual(resolveDropdownState(initialState, 2), {
    feedDropdownOpen: false,
    providerDropdownOpen: false,
  });

  assert.deepEqual(
    resolveDropdownState(
      {
        feedDropdownOpen: false,
        providerDropdownOpen: false,
        handledAtcToggle: 1,
      },
      2,
    ),
    {
      feedDropdownOpen: true,
      providerDropdownOpen: false,
    },
  );
});

test("resolveDropdownState ignores undefined toggle updates", () => {
  const initialState = {
    feedDropdownOpen: true,
    providerDropdownOpen: false,
    handledAtcToggle: 3,
  };

  assert.deepEqual(resolveDropdownState(initialState, undefined), {
    feedDropdownOpen: true,
    providerDropdownOpen: false,
  });
});
