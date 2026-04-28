import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_SETTINGS,
  migrateSettingsDefaults,
  normalizeSettings,
} from "./use-settings";

test("default settings use a 1.0px shorter trail", () => {
  assert.equal(DEFAULT_SETTINGS.trailThickness, 1.0);
  assert.equal(DEFAULT_SETTINGS.trailDistance, 48);
});

test("settings normalization keeps 0.5px as the minimum selectable trail thickness", () => {
  const settings = normalizeSettings({
    ...DEFAULT_SETTINGS,
    trailThickness: 0.1,
    trailDistance: 12.4,
  });

  assert.equal(settings.trailThickness, 0.5);
  assert.equal(settings.trailDistance, 12);
});

test("settings migration lowers only legacy trail defaults", () => {
  const migratedLegacy = migrateSettingsDefaults(
    {
      ...DEFAULT_SETTINGS,
      trailThickness: 1.3,
      trailDistance: 80,
    },
    3,
  );
  const migratedCustom = migrateSettingsDefaults(
    {
      ...DEFAULT_SETTINGS,
      trailThickness: 2,
      trailDistance: 96,
    },
    3,
  );

  assert.equal(migratedLegacy.trailThickness, 1.0);
  assert.equal(migratedLegacy.trailDistance, 48);
  assert.equal(migratedCustom.trailThickness, 2);
  assert.equal(migratedCustom.trailDistance, 96);
});

test("settings migration upgrades the old untouched default trail pair from version 4", () => {
  const migrated = migrateSettingsDefaults(
    {
      ...DEFAULT_SETTINGS,
      trailThickness: 0.5,
      trailDistance: 48,
    },
    4,
  );

  assert.equal(migrated.trailThickness, 1.0);
  assert.equal(migrated.trailDistance, 48);
});

test("settings migration preserves partial custom trail settings", () => {
  const customThickness = migrateSettingsDefaults(
    {
      ...DEFAULT_SETTINGS,
      trailThickness: 2,
      trailDistance: 80,
    },
    3,
  );
  const customDistance = migrateSettingsDefaults(
    {
      ...DEFAULT_SETTINGS,
      trailThickness: 1.3,
      trailDistance: 96,
    },
    3,
  );

  assert.equal(customThickness.trailThickness, 2);
  assert.equal(customThickness.trailDistance, 80);
  assert.equal(customDistance.trailThickness, 1.3);
  assert.equal(customDistance.trailDistance, 96);
});
