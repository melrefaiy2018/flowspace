import path from 'node:path';
import fs from 'node:fs/promises';
import { getDataDir } from '../../lib/data-dir.js';
import {
  DEFAULT_SYNTHESIS_SETTINGS,
  SYNTHESIS_SETTINGS_RANGES,
  type SynthesisSettings,
  type SynthesisSettingsFile,
} from './types.js';

const FILE_BASENAME = '.synthesizer-settings.default.json';

let cache: SynthesisSettings | null = null;

function filePath(): string {
  return path.join(getDataDir(), FILE_BASENAME);
}

export function _resetForTests(): void {
  cache = null;
}

export async function loadSettings(): Promise<SynthesisSettings> {
  if (cache) return cache;
  try {
    const raw = await fs.readFile(filePath(), 'utf-8');
    const parsed = JSON.parse(raw) as SynthesisSettingsFile;
    if (parsed?.version !== 1 || typeof parsed.settings !== 'object' || parsed.settings === null) {
      cache = DEFAULT_SYNTHESIS_SETTINGS;
      return cache;
    }
    const merged: SynthesisSettings = { ...DEFAULT_SYNTHESIS_SETTINGS, ...parsed.settings };
    // Fail closed on type/range mismatch. A hand-edited file with
    // `enabled: "true"` (string-truthy) or `logCapEntries: "1000"` (string)
    // must not be allowed to flip the privacy flag or pass invalid numbers
    // into pruneByCapAndAge.
    try {
      validate(merged);
    } catch {
      cache = DEFAULT_SYNTHESIS_SETTINGS;
      return cache;
    }
    cache = merged;
    return cache;
  } catch {
    cache = DEFAULT_SYNTHESIS_SETTINGS;
    return cache;
  }
}

export function loadSettingsSync(): SynthesisSettings {
  return cache ?? DEFAULT_SYNTHESIS_SETTINGS;
}

/** True if loadSettings has not yet populated the cache. */
export function isSettingsHydrated(): boolean {
  return cache !== null;
}

function validate(settings: SynthesisSettings): void {
  if (typeof settings.enabled !== 'boolean') {
    throw new Error(`synthesizer settings: enabled must be a boolean, got ${typeof settings.enabled}`);
  }
  for (const [key, [min, max]] of Object.entries(SYNTHESIS_SETTINGS_RANGES) as [
    keyof typeof SYNTHESIS_SETTINGS_RANGES,
    readonly [number, number],
  ][]) {
    const v = settings[key] as number;
    if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) {
      throw new Error(`synthesizer settings: ${key}=${v} out of range [${min}, ${max}]`);
    }
  }
}

export async function saveSettings(settings: SynthesisSettings): Promise<SynthesisSettings> {
  validate(settings);
  const fp = filePath();
  const tmp = fp + '.tmp';
  const dir = path.dirname(fp);
  await fs.mkdir(dir, { recursive: true });
  const body: SynthesisSettingsFile = { version: 1, settings };
  await fs.writeFile(tmp, JSON.stringify(body, null, 2), 'utf-8');
  await fs.rename(tmp, fp);
  cache = settings;
  return settings;
}

export async function updateSettings(
  patch: Partial<SynthesisSettings>,
): Promise<SynthesisSettings> {
  const current = await loadSettings();
  const merged: SynthesisSettings = { ...current, ...patch };
  return saveSettings(merged);
}
