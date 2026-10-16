import test from "node:test";

import { checkAviationData } from "./check";

test("committed aviation data matches its manifest and index", async () => {
  await checkAviationData();
});
