import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { DEFAULT_SYNTHESIS_SETTINGS } from '../types.js';

let tmpDir: string;
const settingsModule = () => import('../settings.js');

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flowspace-syn-settings-'));
  process.env.FLOWSPACE_DATA_DIR = tmpDir;
  const mod = await settingsModule();
  mod._resetForTests();
});

afterEach(async () => {
  const mod = await settingsModule();
  mod._resetForTests();
  delete process.env.FLOWSPACE_DATA_DIR;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('settings', () => {
  it('returns defaults when file does not exist', async () => {
    const { loadSettings } = await settingsModule();
    expect(await loadSettings()).toEqual(DEFAULT_SYNTHESIS_SETTINGS);
  });

  it('persists settings via atomic write (file appears, no .tmp left)', async () => {
    const { saveSettings } = await settingsModule();
    await saveSettings({ ...DEFAULT_SYNTHESIS_SETTINGS, enabled: true });
    const files = fs.readdirSync(tmpDir);
    expect(files).toContain('.synthesizer-settings.default.json');
    expect(files.find((f) => f.endsWith('.tmp'))).toBeUndefined();
  });

  it('loadSettings reflects what was saved', async () => {
    const { saveSettings, loadSettings } = await settingsModule();
    await saveSettings({ ...DEFAULT_SYNTHESIS_SETTINGS, enabled: true, minOccurrences: 4 });
    const reloaded = await loadSettings();
    expect(reloaded.enabled).toBe(true);
    expect(reloaded.minOccurrences).toBe(4);
  });

  it('partial update merges with current values', async () => {
    const { updateSettings, loadSettings } = await settingsModule();
    await updateSettings({ enabled: true });
    await updateSettings({ minOccurrences: 5 });
    const s = await loadSettings();
    expect(s.enabled).toBe(true);
    expect(s.minOccurrences).toBe(5);
    expect(s.lookBackDays).toBe(DEFAULT_SYNTHESIS_SETTINGS.lookBackDays);
  });

  it('rejects out-of-range values', async () => {
    const { updateSettings } = await settingsModule();
    await expect(updateSettings({ minOccurrences: 1 })).rejects.toThrow();
    await expect(updateSettings({ minOccurrences: 11 })).rejects.toThrow();
    await expect(updateSettings({ lookBackDays: 0 })).rejects.toThrow();
    await expect(updateSettings({ logCapEntries: 50 })).rejects.toThrow();
    await expect(updateSettings({ maxSequenceLength: 1 })).rejects.toThrow();
  });

  it('accepts edges of valid ranges', async () => {
    const { updateSettings } = await settingsModule();
    await expect(updateSettings({ minOccurrences: 2 })).resolves.toBeDefined();
    await expect(updateSettings({ minOccurrences: 10 })).resolves.toBeDefined();
    await expect(updateSettings({ logCapEntries: 100 })).resolves.toBeDefined();
    await expect(updateSettings({ logCapEntries: 10000 })).resolves.toBeDefined();
  });

  it('falls back to defaults when file is malformed', async () => {
    fs.writeFileSync(path.join(tmpDir, '.synthesizer-settings.default.json'), 'not json');
    const { loadSettings } = await settingsModule();
    expect(await loadSettings()).toEqual(DEFAULT_SYNTHESIS_SETTINGS);
  });

  it('falls back to defaults when persisted enabled is not a boolean', async () => {
    fs.writeFileSync(
      path.join(tmpDir, '.synthesizer-settings.default.json'),
      JSON.stringify({ version: 1, settings: { ...DEFAULT_SYNTHESIS_SETTINGS, enabled: 'true' } }),
    );
    const { loadSettings } = await settingsModule();
    const loaded = await loadSettings();
    expect(loaded.enabled).toBe(false);
    expect(loaded).toEqual(DEFAULT_SYNTHESIS_SETTINGS);
  });

  it('falls back to defaults when persisted numeric setting has wrong type', async () => {
    fs.writeFileSync(
      path.join(tmpDir, '.synthesizer-settings.default.json'),
      JSON.stringify({
        version: 1,
        settings: { ...DEFAULT_SYNTHESIS_SETTINGS, logCapEntries: '1000' },
      }),
    );
    const { loadSettings } = await settingsModule();
    expect(await loadSettings()).toEqual(DEFAULT_SYNTHESIS_SETTINGS);
  });

  it('rejects saving a non-boolean enabled', async () => {
    const { saveSettings } = await settingsModule();
    await expect(
      saveSettings({ ...DEFAULT_SYNTHESIS_SETTINGS, enabled: 'true' as unknown as boolean }),
    ).rejects.toThrow(/enabled/);
  });
});
