import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

let tmpDir: string;
const observerModule = () => import('../observer.js');
const settingsModule = () => import('../settings.js');

const SENTINELS = [
  '__SENTINEL_EMAIL_BODY__',
  '__SENTINEL_RECIPIENT@example.com',
  '__SENTINEL_SUBJECT_LINE__',
  '__SENTINEL_DOCUMENT_CONTENT__',
];

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flowspace-syn-priv-'));
  process.env.FLOWSPACE_DATA_DIR = tmpDir;
  const obs = await observerModule();
  obs._resetForTests();
  const set = await settingsModule();
  set._resetForTests();
});

afterEach(async () => {
  const obs = await observerModule();
  obs._resetForTests();
  const set = await settingsModule();
  set._resetForTests();
  delete process.env.FLOWSPACE_DATA_DIR;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('SC-006: privacy invariant — no PII in invocation log', () => {
  it('persisted invocation log does not contain raw arg values', async () => {
    const { updateSettings } = await settingsModule();
    await updateSettings({ enabled: true });

    const { recordInvocation, _flushPendingForTests } = await observerModule();
    recordInvocation({
      name: 'send_email',
      args: {
        to: SENTINELS[1],
        subject: SENTINELS[2],
        body: SENTINELS[0],
      },
      success: true,
      approval: 'user_approved',
      source: 'chat',
    });
    recordInvocation({
      name: 'docs_write',
      args: { content: SENTINELS[3], document_id: 'doc-abc' },
      success: true,
      approval: 'user_approved',
      source: 'chat',
    });
    await _flushPendingForTests();

    const fp = path.join(tmpDir, '.tool-invocation-log.default.json');
    const raw = fs.readFileSync(fp, 'utf-8');

    for (const sentinel of SENTINELS) {
      expect(
        raw.includes(sentinel),
        `sentinel "${sentinel}" leaked into invocation log`,
      ).toBe(false);
    }
    // The log should still contain the tool names (not PII).
    expect(raw).toContain('send_email');
    expect(raw).toContain('docs_write');
  });
});
