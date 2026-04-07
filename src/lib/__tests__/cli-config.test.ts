import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Tests for CLI config read/write logic.
 * These test the config file format and validation
 * that the CLI launcher uses for ~/.flowspace/config.json.
 */

const TEST_DIR = path.join(os.tmpdir(), `flowspace-test-${Date.now()}`);
const CONFIG_PATH = path.join(TEST_DIR, 'config.json');

interface FlowSpaceConfig {
  version: number;
  google: { clientSecretPath: string; configured: boolean };
  ai: { configured: boolean; provider?: string };
  port: number;
}

// Inline the pure config functions from bin/cli.ts for testing
function readConfig(configPath: string): FlowSpaceConfig | null {
  if (!fs.existsSync(configPath)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    if (raw && typeof raw === 'object' && raw.version === 1) {
      return raw as FlowSpaceConfig;
    }
  } catch {
    // Corrupt config
  }
  return null;
}

function writeConfig(configPath: string, config: FlowSpaceConfig): void {
  const dir = path.dirname(configPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  const tmp = configPath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(config, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, configPath);
}

function validConfig(): FlowSpaceConfig {
  return {
    version: 1,
    google: { clientSecretPath: '/path/to/secret.json', configured: true },
    ai: { configured: true, provider: 'openai' },
    port: 3000,
  };
}

describe('CLI config', () => {
  beforeEach(() => {
    fs.mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  describe('readConfig', () => {
    it('returns null when config file does not exist', () => {
      expect(readConfig(CONFIG_PATH)).toBeNull();
    });

    it('returns null for invalid JSON', () => {
      fs.writeFileSync(CONFIG_PATH, '{not valid json}');
      expect(readConfig(CONFIG_PATH)).toBeNull();
    });

    it('returns null for wrong version', () => {
      fs.writeFileSync(CONFIG_PATH, JSON.stringify({ version: 99 }));
      expect(readConfig(CONFIG_PATH)).toBeNull();
    });

    it('returns null for non-object content', () => {
      fs.writeFileSync(CONFIG_PATH, '"just a string"');
      expect(readConfig(CONFIG_PATH)).toBeNull();
    });

    it('reads valid config', () => {
      const config = validConfig();
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(config));
      const result = readConfig(CONFIG_PATH);
      expect(result).toEqual(config);
    });
  });

  describe('writeConfig', () => {
    it('creates config file with correct content', () => {
      const config = validConfig();
      writeConfig(CONFIG_PATH, config);
      const written = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
      expect(written).toEqual(config);
    });

    it('creates parent directory if missing', () => {
      const nestedPath = path.join(TEST_DIR, 'nested', 'dir', 'config.json');
      writeConfig(nestedPath, validConfig());
      expect(fs.existsSync(nestedPath)).toBe(true);
    });

    it('is atomic (uses temp file + rename)', () => {
      // Write config, verify no .tmp file remains
      writeConfig(CONFIG_PATH, validConfig());
      expect(fs.existsSync(CONFIG_PATH + '.tmp')).toBe(false);
      expect(fs.existsSync(CONFIG_PATH)).toBe(true);
    });

    it('overwrites existing config', () => {
      writeConfig(CONFIG_PATH, validConfig());
      const updated = { ...validConfig(), port: 4000 };
      writeConfig(CONFIG_PATH, updated);
      const result = readConfig(CONFIG_PATH);
      expect(result?.port).toBe(4000);
    });
  });

  describe('roundtrip', () => {
    it('write then read returns identical config', () => {
      const config = validConfig();
      writeConfig(CONFIG_PATH, config);
      expect(readConfig(CONFIG_PATH)).toEqual(config);
    });

    it('handles config without optional AI provider', () => {
      const config: FlowSpaceConfig = {
        version: 1,
        google: { clientSecretPath: '/path/secret.json', configured: true },
        ai: { configured: false },
        port: 3000,
      };
      writeConfig(CONFIG_PATH, config);
      expect(readConfig(CONFIG_PATH)).toEqual(config);
    });
  });
});
