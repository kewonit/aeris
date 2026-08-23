import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const WORKFLOW_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../.github/workflows/refresh-aviation-data.yml",
);

test("refresh workflow keeps the required source cadence and review boundary", async () => {
  const workflow = await readFile(WORKFLOW_PATH, "utf8");

  assert.match(workflow, /cron: "17 3 \* \* \*"/);
  assert.match(workflow, /echo "week=\$\(date -u \+%G-%V\)"/);
  assert.match(workflow, /uses: actions\/cache@v4/);
  assert.match(workflow, /path: \.cache\/aviation\/mictronics\.zip/);
  assert.match(
    workflow,
    /key: aviation-mictronics-v1-\$\{\{ steps\.schedule\.outputs\.week \}\}/,
  );
  assert.match(
    workflow,
    /if: steps\.mictronics-cache\.outputs\.cache-hit != 'true'/,
  );
  assert.match(
    workflow,
    /https:\/\/raw\.githubusercontent\.com\/Mictronics\/aircraft-database\/main\/aircraft_db\.zip/,
  );
  assert.match(
    workflow,
    /AERIS_MICTRONICS_SOURCE_FILE: \.cache\/aviation\/mictronics\.zip/,
  );

  const dailyStep = workflow.match(
    /- name: Build and validate the daily snapshot\n(?<body>[\s\S]*?)\n      - name:/,
  )?.groups?.body;
  assert.ok(dailyStep);
  assert.doesNotMatch(dailyStep, /^\s*if:/m);
  assert.match(dailyStep, /pnpm data:refresh/);
  assert.match(dailyStep, /pnpm data:check/);
  assert.match(dailyStep, /pnpm test:data/);

  const reviewStep = workflow.match(
    /- name: Open or update the weekly review PR\n(?<body>[\s\S]*)$/,
  )?.groups?.body;
  assert.ok(reviewStep);
  assert.match(
    reviewStep,
    /if: steps\.schedule\.outputs\.weekday == '1' \|\| github\.event_name == 'workflow_dispatch'/,
  );
  assert.match(reviewStep, /branch: chore\/refresh-open-aviation-data/);
  assert.match(reviewStep, /base: main/);
  assert.match(reviewStep, /draft: true/);
  assert.match(
    reviewStep,
    /title: "Refresh open aviation data \(\$\{\{ steps\.schedule\.outputs\.date \}\}\)"/,
  );
});
