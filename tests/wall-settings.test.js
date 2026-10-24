import test from 'node:test';
import assert from 'node:assert/strict';
import { loadWallSettings, saveWallSettings, WALL_SETTINGS_KEY } from '../src/wall-settings.js';
const memory = () => {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
};
test('saved tuning overrides changed release defaults while new controls use defaults', () => {
  const storage = memory();
  saveWallSettings({ edgeWidth: .38, resinDensity: .72, bottomFusion: 0 }, storage);
  assert.deepEqual(loadWallSettings({ edgeWidth: .1, resinDensity: .1, bottomFusion: .9, newControl: .6 }, storage),
    { edgeWidth: .38, resinDensity: .72, bottomFusion: 0, newControl: .6 });
  saveWallSettings({ edgeWidth: .41 }, storage);
  assert.equal(JSON.parse(storage.getItem(WALL_SETTINGS_KEY)).resinDensity, .72);
});
test('corrupt values, old ranges and unavailable storage cannot break startup', () => {
  const storage = memory(), defaults = { edgeWidth: .25, resinDensity: .5 };
  storage.setItem(WALL_SETTINGS_KEY, '{');
  assert.deepEqual(loadWallSettings(defaults, storage), defaults);
  storage.setItem(WALL_SETTINGS_KEY, JSON.stringify({ edgeWidth: 1.9, resinDensity: '0.7' }));
  assert.deepEqual(loadWallSettings(defaults, storage), { edgeWidth: .5, resinDensity: .5 });
  const blocked = { getItem() { throw Error('blocked'); }, setItem() { throw Error('blocked'); } };
  assert.deepEqual(loadWallSettings(defaults, blocked), defaults);
  assert.equal(saveWallSettings(defaults, blocked), false);
  storage.setItem(WALL_SETTINGS_KEY, '{');
  assert.equal(saveWallSettings(defaults, storage), true);
});
