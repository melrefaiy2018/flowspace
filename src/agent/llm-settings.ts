/**
 * LLM settings persistence — read/write .llm-settings.json in DATA_DIR.
 *
 * Settings are cached in memory after first read and invalidated on write.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { LLMProviderConfig, LLMSettings } from './llm-types.js';
import { getDataDir } from '../lib/data-dir.js';

function getSettingsPath(): string {
  return path.join(getDataDir(), '.llm-settings.json');
}

// ── Validation ──────────────────────────────────────────────────────

function isValidProvider(id: unknown): id is string {
  return typeof id === 'string' && id.length > 0;
}

function isValidProviderConfig(config: unknown): config is LLMProviderConfig {
  if (!config || typeof config !== 'object') return false;
  const c = config as Record<string, unknown>;
  return (
    isValidProvider(c.provider) &&
    typeof c.apiKey === 'string' &&
    typeof c.model === 'string'
  );
}

function isValidSettings(data: unknown): data is LLMSettings {
  if (!data || typeof data !== 'object') return false;
  const d = data as Record<string, unknown>;
  if (!isValidProvider(d.activeProvider)) return false;
  if (!d.providers || typeof d.providers !== 'object') return false;
  // Validate each configured provider entry
  for (const val of Object.values(d.providers as object)) {
    if (val !== undefined && !isValidProviderConfig(val)) return false;
  }
  return true;
}

// ── In-memory cache ─────────────────────────────────────────────────

let settingsCache: LLMSettings | null | undefined = undefined; // undefined = not yet loaded

// ── Read ────────────────────────────────────────────────────────────

export function readLLMSettings(): LLMSettings | null {
  if (settingsCache !== undefined) return settingsCache;

  const settingsPath = getSettingsPath();

  if (fs.existsSync(settingsPath)) {
    try {
      const raw = fs.readFileSync(settingsPath, 'utf-8');
      const parsed = JSON.parse(raw);
      if (isValidSettings(parsed)) {
        settingsCache = parsed;
        return settingsCache;
      }
    } catch {
      // Corrupt file — fall through to null
    }
  }

  settingsCache = null;
  return null;
}

export function getActiveProviderConfig(): LLMProviderConfig | null {
  const settings = readLLMSettings();
  if (!settings) return null;
  return settings.providers[settings.activeProvider] ?? null;
}

// ── Write ───────────────────────────────────────────────────────────

export function writeLLMSettings(settings: LLMSettings): void {
  if (!isValidSettings(settings)) {
    throw new Error('Invalid LLM settings shape');
  }

  const settingsPath = getSettingsPath();
  const dir = path.dirname(settingsPath);

  // Ensure directory exists
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), { mode: 0o600 });
  settingsCache = settings; // update cache after write
}

// ── API key masking ─────────────────────────────────────────────────

const MASKED_PREFIX = '••••';

export function maskApiKey(key: string): string {
  if (!key || key.length < 8) return MASKED_PREFIX;
  return `${MASKED_PREFIX}${key.slice(-4)}`;
}

export function isMaskedKey(key: string): boolean {
  return key.startsWith(MASKED_PREFIX);
}

/**
 * Return settings with all API keys masked (safe for frontend).
 */
export function readLLMSettingsMasked(): LLMSettings | null {
  const settings = readLLMSettings();
  if (!settings) return null;

  const maskedProviders: LLMSettings['providers'] = {};
  for (const [id, config] of Object.entries(settings.providers)) {
    if (config) {
      maskedProviders[id] = {
        ...config,
        apiKey: maskApiKey(config.apiKey),
      };
    }
  }

  return { ...settings, providers: maskedProviders };
}

/**
 * Merge incoming settings with existing ones, preserving API keys
 * when the frontend sends back masked values.
 */
export function mergeSettings(incoming: LLMSettings): LLMSettings {
  const existing = readLLMSettings();

  const mergedProviders: LLMSettings['providers'] = {};
  for (const [id, config] of Object.entries(incoming.providers)) {
    if (!config) continue;
    // If the key is masked, preserve the existing key from disk
    if (isMaskedKey(config.apiKey)) {
      const preservedKey = existing?.providers[id]?.apiKey;
      if (!preservedKey) {
        // No existing key to fall back to — skip this provider
        continue;
      }
      mergedProviders[id] = {
        ...config,
        apiKey: preservedKey,
      };
    } else {
      mergedProviders[id] = config;
    }
  }

  return {
    activeProvider: incoming.activeProvider,
    providers: mergedProviders,
  };
}

/**
 * Update a single provider config and optionally set it as active.
 */
export function upsertProvider(
  config: LLMProviderConfig,
  setActive: boolean = false,
): LLMSettings {
  const current = readLLMSettings() ?? {
    activeProvider: config.provider,
    providers: {},
  };

  const updated: LLMSettings = {
    activeProvider: setActive ? config.provider : current.activeProvider,
    providers: {
      ...current.providers,
      [config.provider]: config,
    },
  };

  writeLLMSettings(updated);
  return updated;
}

/**
 * Remove a provider from settings. Cannot remove the active provider.
 */
export function removeProvider(providerId: string): LLMSettings {
  const current = readLLMSettings();
  if (!current) throw new Error('No LLM settings to modify');
  if (current.activeProvider === providerId) {
    throw new Error('Cannot remove the active provider. Switch to another provider first.');
  }

  const { [providerId]: _removed, ...remaining } = current.providers;
  const updated: LLMSettings = {
    activeProvider: current.activeProvider,
    providers: remaining,
  };

  writeLLMSettings(updated);
  return updated;
}
