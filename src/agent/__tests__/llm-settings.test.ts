import fs from 'node:fs';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { maskApiKey, isMaskedKey, readLLMSettings, writeLLMSettings, mergeSettings, removeProvider } from '../llm-settings';
import type { LLMSettings } from '../llm-types';

vi.mock('../../lib/data-dir.js', () => ({
  getDataDir: () => '/tmp/flowspace-test-settings',
}));

describe('maskApiKey', () => {
  it('masks a standard API key showing only last 4 chars', () => {
    expect(maskApiKey('sk-ant-api03-abcdefghijklmnop')).toBe('••••mnop');
  });

  it('masks a short key (< 8 chars)', () => {
    expect(maskApiKey('short')).toBe('••••');
    expect(maskApiKey('')).toBe('••••');
  });

  it('masks exactly 8-char key', () => {
    expect(maskApiKey('12345678')).toBe('••••5678');
  });
});

describe('isMaskedKey', () => {
  it('detects masked keys', () => {
    expect(isMaskedKey('••••mnop')).toBe(true);
    expect(isMaskedKey('••••')).toBe(true);
  });

  it('returns false for real keys', () => {
    expect(isMaskedKey('sk-ant-api03-abcdef')).toBe(false);
    expect(isMaskedKey('sk-abc123')).toBe(false);
    expect(isMaskedKey('')).toBe(false);
  });
});

const SETTINGS_DIR = '/tmp/flowspace-test-settings';
const SETTINGS_PATH = `${SETTINGS_DIR}/.llm-settings.json`;

describe('custom provider IDs', () => {
  beforeEach(() => {
    if (!fs.existsSync(SETTINGS_DIR)) {
      fs.mkdirSync(SETTINGS_DIR, { recursive: true });
    }
    // Clean up any existing settings file
    if (fs.existsSync(SETTINGS_PATH)) {
      fs.unlinkSync(SETTINGS_PATH);
    }
    // Clear GLM_API_KEY to avoid fallback
    delete process.env.GLM_API_KEY;
  });

  afterEach(() => {
    if (fs.existsSync(SETTINGS_PATH)) {
      fs.unlinkSync(SETTINGS_PATH);
    }
  });

  it('validates settings with a custom string provider ID', () => {
    const settings: LLMSettings = {
      activeProvider: 'groq',
      providers: {
        groq: {
          provider: 'groq',
          apiKey: 'gsk_test1234567890abcdef',
          model: 'llama-3.3-70b-versatile',
          baseURL: 'https://api.groq.com/openai/v1',
        },
      },
    };

    writeLLMSettings(settings);
    const loaded = readLLMSettings();
    expect(loaded).not.toBeNull();
    expect(loaded!.activeProvider).toBe('groq');
    expect(loaded!.providers.groq?.provider).toBe('groq');
    expect(loaded!.providers.groq?.model).toBe('llama-3.3-70b-versatile');
  });

  it('round-trips custom provider settings through write/read', () => {
    const settings: LLMSettings = {
      activeProvider: 'together',
      providers: {
        together: {
          provider: 'together',
          apiKey: 'tog_key_abcdefgh12345678',
          model: 'meta-llama/Llama-3-70b',
          baseURL: 'https://api.together.xyz/v1',
          name: 'Together AI',
        },
        groq: {
          provider: 'groq',
          apiKey: 'gsk_test1234567890abcdef',
          model: 'mixtral-8x7b-32768',
        },
      },
    };

    writeLLMSettings(settings);
    const loaded = readLLMSettings();
    expect(loaded).toEqual(settings);
  });
});

describe('mergeSettings with custom providers', () => {
  beforeEach(() => {
    if (!fs.existsSync(SETTINGS_DIR)) {
      fs.mkdirSync(SETTINGS_DIR, { recursive: true });
    }
    if (fs.existsSync(SETTINGS_PATH)) {
      fs.unlinkSync(SETTINGS_PATH);
    }
    delete process.env.GLM_API_KEY;
  });

  afterEach(() => {
    if (fs.existsSync(SETTINGS_PATH)) {
      fs.unlinkSync(SETTINGS_PATH);
    }
  });

  it('preserves custom provider configs when merging', () => {
    const existing: LLMSettings = {
      activeProvider: 'groq',
      providers: {
        groq: {
          provider: 'groq',
          apiKey: 'gsk_real_key_1234567890',
          model: 'llama-3.3-70b-versatile',
        },
      },
    };
    writeLLMSettings(existing);

    const incoming: LLMSettings = {
      activeProvider: 'groq',
      providers: {
        groq: {
          provider: 'groq',
          apiKey: 'gsk_new_key_0987654321',
          model: 'mixtral-8x7b-32768',
        },
      },
    };

    const merged = mergeSettings(incoming);
    expect(merged.providers.groq?.apiKey).toBe('gsk_new_key_0987654321');
    expect(merged.providers.groq?.model).toBe('mixtral-8x7b-32768');
  });

  it('preserves masked keys for custom providers', () => {
    const existing: LLMSettings = {
      activeProvider: 'groq',
      providers: {
        groq: {
          provider: 'groq',
          apiKey: 'gsk_real_key_1234567890',
          model: 'llama-3.3-70b-versatile',
        },
      },
    };
    writeLLMSettings(existing);

    const incoming: LLMSettings = {
      activeProvider: 'groq',
      providers: {
        groq: {
          provider: 'groq',
          apiKey: '••••7890',
          model: 'llama-3.3-70b-versatile',
        },
      },
    };

    const merged = mergeSettings(incoming);
    expect(merged.providers.groq?.apiKey).toBe('gsk_real_key_1234567890');
  });
});

describe('removeProvider', () => {
  beforeEach(() => {
    if (!fs.existsSync(SETTINGS_DIR)) {
      fs.mkdirSync(SETTINGS_DIR, { recursive: true });
    }
    if (fs.existsSync(SETTINGS_PATH)) {
      fs.unlinkSync(SETTINGS_PATH);
    }
    delete process.env.GLM_API_KEY;
  });

  afterEach(() => {
    if (fs.existsSync(SETTINGS_PATH)) {
      fs.unlinkSync(SETTINGS_PATH);
    }
  });

  it('removes a custom provider', () => {
    const settings: LLMSettings = {
      activeProvider: 'openai',
      providers: {
        openai: {
          provider: 'openai',
          apiKey: 'sk-test1234567890abcdef',
          model: 'gpt-4o',
        },
        groq: {
          provider: 'groq',
          apiKey: 'gsk_test1234567890abcdef',
          model: 'llama-3.3-70b-versatile',
        },
      },
    };
    writeLLMSettings(settings);

    const updated = removeProvider('groq');
    expect(updated.providers.groq).toBeUndefined();
    expect(updated.providers.openai).toBeDefined();
    expect(updated.activeProvider).toBe('openai');
  });

  it('throws when trying to remove the active provider', () => {
    const settings: LLMSettings = {
      activeProvider: 'groq',
      providers: {
        groq: {
          provider: 'groq',
          apiKey: 'gsk_test1234567890abcdef',
          model: 'llama-3.3-70b-versatile',
        },
      },
    };
    writeLLMSettings(settings);

    expect(() => removeProvider('groq')).toThrow(
      'Cannot remove the active provider',
    );
  });
});
