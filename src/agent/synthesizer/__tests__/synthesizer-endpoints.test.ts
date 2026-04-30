import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';
import fs from 'fs';
import path from 'path';
import os from 'os';

import {
  loadSettings as loadSynthSettings,
  updateSettings as updateSynthSettings,
  _resetForTests as resetSynthSettings,
} from '../settings.js';
import { loadLog as loadSynthLog, clearLog as clearSynthLog, appendEntry } from '../invocation-log.js';
import { SYNTHESIS_SETTINGS_RANGES, DEFAULT_SYNTHESIS_SETTINGS } from '../types.js';

let tmpDir: string;
let app: Express;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flowspace-syn-ep-'));
  process.env.FLOWSPACE_DATA_DIR = tmpDir;
  resetSynthSettings();

  app = express();

  app.get('/api/synthesizer/settings', async (_req, res) => {
    try {
      res.json(await loadSynthSettings());
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? 'Internal error' });
    }
  });

  app.patch('/api/synthesizer/settings', express.json(), async (req, res) => {
    try {
      const body = req.body ?? {};
      const allowedKeys = new Set([
        'enabled',
        'minOccurrences',
        'lookBackDays',
        'maxSequenceLength',
        'dismissCooldownDays',
        'logCapEntries',
        'logRetentionDays',
      ]);
      const patch: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(body)) {
        if (!allowedKeys.has(k)) continue;
        if (k === 'enabled') {
          if (typeof v !== 'boolean') {
            return res.status(400).json({ error: '"enabled" must be a boolean' });
          }
          patch[k] = v;
          continue;
        }
        if (typeof v !== 'number' || !Number.isFinite(v)) {
          return res.status(400).json({ error: `"${k}" must be a finite number` });
        }
        const range = SYNTHESIS_SETTINGS_RANGES[k as keyof typeof SYNTHESIS_SETTINGS_RANGES];
        if (range && (v < range[0] || v > range[1])) {
          return res.status(400).json({ error: `"${k}" must be in [${range[0]}, ${range[1]}]` });
        }
        patch[k] = v;
      }
      const updated = await updateSynthSettings(patch);
      res.json(updated);
    } catch (err: any) {
      res.status(400).json({ error: err?.message ?? 'Invalid settings' });
    }
  });

  app.get('/api/synthesizer/log', async (req, res) => {
    try {
      const limitRaw = Number(req.query.limit ?? 200);
      const limit = Math.min(Math.max(Number.isFinite(limitRaw) ? limitRaw : 200, 1), 1000);
      const entries = await loadSynthLog();
      const newestFirst = [...entries].reverse().slice(0, limit);
      res.json({ totalEntries: entries.length, entries: newestFirst });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? 'Internal error' });
    }
  });

  app.delete('/api/synthesizer/log', async (_req, res) => {
    try {
      const deletedCount = await clearSynthLog();
      res.json({ cleared: true, deletedCount });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? 'Internal error' });
    }
  });
});

afterEach(() => {
  resetSynthSettings();
  delete process.env.FLOWSPACE_DATA_DIR;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('GET /api/synthesizer/settings', () => {
  it('returns defaults when no file exists', async () => {
    const res = await request(app).get('/api/synthesizer/settings');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(DEFAULT_SYNTHESIS_SETTINGS);
  });
});

describe('PATCH /api/synthesizer/settings', () => {
  it('updates enabled flag', async () => {
    const res = await request(app).patch('/api/synthesizer/settings').send({ enabled: true });
    expect(res.status).toBe(200);
    expect(res.body.enabled).toBe(true);
  });

  it('rejects out-of-range numeric values', async () => {
    const res = await request(app).patch('/api/synthesizer/settings').send({ minOccurrences: 1 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/minOccurrences/);
  });

  it('rejects non-boolean enabled', async () => {
    const res = await request(app).patch('/api/synthesizer/settings').send({ enabled: 'yes' });
    expect(res.status).toBe(400);
  });

  it('partial merge keeps unspecified fields', async () => {
    await request(app).patch('/api/synthesizer/settings').send({ enabled: true });
    const res = await request(app).patch('/api/synthesizer/settings').send({ minOccurrences: 4 });
    expect(res.status).toBe(200);
    expect(res.body.enabled).toBe(true);
    expect(res.body.minOccurrences).toBe(4);
    expect(res.body.lookBackDays).toBe(DEFAULT_SYNTHESIS_SETTINGS.lookBackDays);
  });

  it('ignores unknown keys silently (whitelist)', async () => {
    const res = await request(app)
      .patch('/api/synthesizer/settings')
      .send({ enabled: true, somethingElse: 'evil' });
    expect(res.status).toBe(200);
    expect(res.body.enabled).toBe(true);
    expect((res.body as Record<string, unknown>).somethingElse).toBeUndefined();
  });
});

describe('GET /api/synthesizer/log', () => {
  it('returns empty when no entries exist', async () => {
    const res = await request(app).get('/api/synthesizer/log');
    expect(res.status).toBe(200);
    expect(res.body.totalEntries).toBe(0);
    expect(res.body.entries).toEqual([]);
  });

  it('returns entries newest-first', async () => {
    for (let i = 0; i < 3; i++) {
      await appendEntry(
        {
          id: `id-${i}`,
          name: `tool-${i}`,
          argsHash: 'a'.repeat(16),
          timestamp: new Date(Date.now() + i * 1000).toISOString(),
          success: true,
          approval: 'auto',
          source: 'chat',
        },
        { logCapEntries: 100, logRetentionDays: 30 },
      );
    }
    const res = await request(app).get('/api/synthesizer/log');
    expect(res.status).toBe(200);
    expect(res.body.totalEntries).toBe(3);
    expect(res.body.entries.map((e: { name: string }) => e.name)).toEqual(['tool-2', 'tool-1', 'tool-0']);
  });

  it('clamps limit query param', async () => {
    for (let i = 0; i < 5; i++) {
      await appendEntry(
        {
          id: `id-${i}`,
          name: 't',
          argsHash: 'a'.repeat(16),
          timestamp: new Date().toISOString(),
          success: true,
          approval: 'auto',
          source: 'chat',
        },
        { logCapEntries: 100, logRetentionDays: 30 },
      );
    }
    const res = await request(app).get('/api/synthesizer/log').query({ limit: 2 });
    expect(res.status).toBe(200);
    expect(res.body.entries.length).toBe(2);
    expect(res.body.totalEntries).toBe(5);
  });
});

describe('DELETE /api/synthesizer/log', () => {
  it('clears entries and reports count', async () => {
    await appendEntry(
      {
        id: 'x',
        name: 't',
        argsHash: 'a'.repeat(16),
        timestamp: new Date().toISOString(),
        success: true,
        approval: 'auto',
        source: 'chat',
      },
      { logCapEntries: 100, logRetentionDays: 30 },
    );
    const res = await request(app).delete('/api/synthesizer/log');
    expect(res.status).toBe(200);
    expect(res.body.cleared).toBe(true);
    expect(res.body.deletedCount).toBe(1);
    const after = await request(app).get('/api/synthesizer/log');
    expect(after.body.totalEntries).toBe(0);
  });
});
