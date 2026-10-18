import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_SETTINGS,
  migrateSettingsDefaults,
  normalizeSettings,
  trailCeilingMeters,
} from "./use-settings";

test("settings migration disables inherited auto-orbit once", () => {
  const migrated = migrateSettingsDefaults(
    { ...DEFAULT_SETTINGS, autoOrbit: true },
    5,
  );
  const explicitV6 = migrateSettingsDefaults(
    { ...DEFAULT_SETTINGS, autoOrbit: true },
    6,
  );

  assert.equal(migrated.autoOrbit, false);
  assert.equal(explicitV6.autoOrbit, true);
});

test("settings normalization clamps trail thickness and length to whole minutes", () => {
  const settings = normalizeSettings({
    ...DEFAULT_SETTINGS,
    trailThickness: 0.1,
    trailMinutes: 0.4,
  });

  assert.equal(settings.trailThickness, 0.5);
  assert.equal(settings.trailMinutes, 1);
});

test("trails default to three minutes and stop at ten", () => {
  assert.equal(DEFAULT_SETTINGS.trailMinutes, 3);
  assert.equal(
    normalizeSettings({ ...DEFAULT_SETTINGS, trailMinutes: 30 }).trailMinutes,
    10,
  );
});

test("settings migration lowers only legacy trail defaults", () => {
  const migratedLegacy = migrateSettingsDefaults(
    { ...DEFAULT_SETTINGS, trailThickness: 1.3 },
    3,
    80,
  );
  const migratedCustom = migrateSettingsDefaults(
    { ...DEFAULT_SETTINGS, trailThickness: 2 },
    3,
    96,
  );

  assert.equal(migratedLegacy.trailThickness, 1.0);
  assert.equal(migratedCustom.trailThickness, 2);
});

test("settings migration upgrades the old untouched default trail pair from version 4", () => {
  const migrated = migrateSettingsDefaults(
    { ...DEFAULT_SETTINGS, trailThickness: 0.5 },
    4,
    48,
  );

  assert.equal(migrated.trailThickness, 1.0);
});

test("settings migration preserves partial custom trail settings", () => {
  const customThickness = migrateSettingsDefaults(
    { ...DEFAULT_SETTINGS, trailThickness: 2 },
    3,
    80,
  );
  const customDistance = migrateSettingsDefaults(
    { ...DEFAULT_SETTINGS, trailThickness: 1.3 },
    3,
    96,
  );

  assert.equal(customThickness.trailThickness, 2);
  assert.equal(customDistance.trailThickness, 1.3);
});

test("trails above 20,000 ft are hidden by default", () => {
  assert.equal(DEFAULT_SETTINGS.hideHighTrails, true);
  assert.equal(DEFAULT_SETTINGS.trailCeilingFt, 20_000);
  assert.equal(trailCeilingMeters(DEFAULT_SETTINGS), 6_096);
  assert.equal(
    trailCeilingMeters({ ...DEFAULT_SETTINGS, hideHighTrails: false }),
    null,
  );
});

test("settings saved before version 8 hide high trails once", () => {
  const saved = { ...DEFAULT_SETTINGS, hideHighTrails: false };

  assert.equal(migrateSettingsDefaults(saved, 7).hideHighTrails, true);
  assert.equal(migrateSettingsDefaults(saved, 8).hideHighTrails, false);
});

test("the trail height limit is kept in range and to whole thousands of feet", () => {
  const limit = (trailCeilingFt: number) =>
    normalizeSettings({ ...DEFAULT_SETTINGS, trailCeilingFt }).trailCeilingFt;

  assert.equal(limit(12_345), 12_000);
  assert.equal(limit(100), 1_000);
  assert.equal(limit(60_000), 45_000);
  assert.equal(limit(Number.NaN), 20_000);
});
