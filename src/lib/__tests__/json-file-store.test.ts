import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createJsonFileStore } from '../json-file-store.js';

function tmpFile() {
  return path.join(os.tmpdir(), `json-file-store-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
}

describe('createJsonFileStore', () => {
  const createdFiles: string[] = [];

  function makeStore<T>(filePath: string) {
    createdFiles.push(filePath);
    return createJsonFileStore<T>(filePath);
  }

  afterEach(() => {
    for (const f of createdFiles) {
      try { fs.rmSync(f); } catch { /* ignore */ }
      try { fs.rmSync(`${f}.tmp`); } catch { /* ignore */ }
    }
    createdFiles.length = 0;
  });

  it('returns null when file does not exist', () => {
    const store = makeStore(tmpFile());
    expect(store.read()).toBeNull();
  });

  it('writes and reads back data correctly', () => {
    const store = makeStore<{ value: number }>(tmpFile());
    store.write({ value: 42 });
    expect(store.read()).toEqual({ value: 42 });
  });

  it('overwrites existing data on write', () => {
    const store = makeStore<{ x: string }>(tmpFile());
    store.write({ x: 'first' });
    store.write({ x: 'second' });
    expect(store.read()).toEqual({ x: 'second' });
  });

  it('creates parent directory if it does not exist', () => {
    const dir = path.join(os.tmpdir(), `jfs-test-dir-${Date.now()}`);
    const filePath = path.join(dir, 'nested', 'data.json');
    createdFiles.push(filePath);
    const store = createJsonFileStore<{ ok: boolean }>(filePath);
    store.write({ ok: true });
    expect(store.read()).toEqual({ ok: true });
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('returns null when file contains corrupt JSON', () => {
    const filePath = tmpFile();
    createdFiles.push(filePath);
    fs.writeFileSync(filePath, '{ broken json', 'utf-8');
    const store = createJsonFileStore(filePath);
    expect(store.read()).toBeNull();
  });

  it('no .tmp file left after successful write', () => {
    const filePath = tmpFile();
    createdFiles.push(filePath);
    const store = createJsonFileStore(filePath);
    store.write({ data: 'test' });
    expect(fs.existsSync(`${filePath}.tmp`)).toBe(false);
  });

  it('preserves complex nested objects', () => {
    interface Complex {
      version: number;
      items: { id: string; tags: string[] }[];
    }
    const store = makeStore<Complex>(tmpFile());
    const data: Complex = { version: 1, items: [{ id: 'a', tags: ['x', 'y'] }] };
    store.write(data);
    expect(store.read()).toEqual(data);
  });
});
