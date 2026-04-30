import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import os from 'node:os';

describe('getDataDir', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Clear all FlowSpace env vars before each test
    delete process.env.FLOWSPACE_DATA_DIR;
    delete process.env.FLOWSPACE_PRODUCTION;
    delete process.env.NODE_ENV;
  });

  afterEach(() => {
    // Restore original env
    process.env = { ...originalEnv };
  });

  async function loadGetDataDir() {
    // Dynamic import to pick up fresh env vars each time.
    // Vitest module cache is per-test by default in isolated mode.
    const mod = await import('../data-dir.js');
    return mod.getDataDir;
  }

  it('uses FLOWSPACE_DATA_DIR when set', async () => {
    process.env.FLOWSPACE_DATA_DIR = '/tmp/test-flowspace';
    const getDataDir = (await import('../data-dir.js')).getDataDir;
    expect(getDataDir()).toBe('/tmp/test-flowspace');
  });

  it('resolves relative FLOWSPACE_DATA_DIR to absolute path', async () => {
    process.env.FLOWSPACE_DATA_DIR = './relative-dir';
    const getDataDir = (await import('../data-dir.js')).getDataDir;
    expect(path.isAbsolute(getDataDir())).toBe(true);
  });

  it('uses macOS App Support in production mode (NODE_ENV)', async () => {
    process.env.NODE_ENV = 'production';
    const getDataDir = (await import('../data-dir.js')).getDataDir;
    const expected = path.join(os.homedir(), 'Library', 'Application Support', 'FlowSpace');
    expect(getDataDir()).toBe(expected);
  });

  it('uses macOS App Support in production mode (FLOWSPACE_PRODUCTION)', async () => {
    process.env.FLOWSPACE_PRODUCTION = '1';
    const getDataDir = (await import('../data-dir.js')).getDataDir;
    const expected = path.join(os.homedir(), 'Library', 'Application Support', 'FlowSpace');
    expect(getDataDir()).toBe(expected);
  });

  it('FLOWSPACE_DATA_DIR takes precedence over production mode', async () => {
    process.env.FLOWSPACE_DATA_DIR = '/custom/path';
    process.env.NODE_ENV = 'production';
    const getDataDir = (await import('../data-dir.js')).getDataDir;
    expect(getDataDir()).toBe('/custom/path');
  });

  it('defaults to cwd in dev mode', async () => {
    const getDataDir = (await import('../data-dir.js')).getDataDir;
    expect(getDataDir()).toBe(process.cwd());
  });
});

describe('isProductionMode', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.FLOWSPACE_PRODUCTION;
    delete process.env.NODE_ENV;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('returns false in dev mode', async () => {
    const { isProductionMode } = await import('../data-dir.js');
    expect(isProductionMode()).toBe(false);
  });

  it('returns true when NODE_ENV is production', async () => {
    process.env.NODE_ENV = 'production';
    const { isProductionMode } = await import('../data-dir.js');
    expect(isProductionMode()).toBe(true);
  });

  it('returns true when FLOWSPACE_PRODUCTION is 1', async () => {
    process.env.FLOWSPACE_PRODUCTION = '1';
    const { isProductionMode } = await import('../data-dir.js');
    expect(isProductionMode()).toBe(true);
  });
});
