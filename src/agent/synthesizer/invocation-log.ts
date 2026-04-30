import path from 'node:path';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { getDataDir } from '../../lib/data-dir.js';
import type { InvocationLogFile, ToolInvocation } from './types.js';

const FILE_BASENAME_PREFIX = '.tool-invocation-log';
const ACCOUNT_KEY_DEFAULT = 'default';

function filePath(accountKey: string = ACCOUNT_KEY_DEFAULT): string {
  return path.join(getDataDir(), `${FILE_BASENAME_PREFIX}.${accountKey}.json`);
}

let writeLock: Promise<void> = Promise.resolve();

export function newInvocationId(): string {
  return crypto.randomUUID();
}

async function readLog(accountKey: string): Promise<InvocationLogFile> {
  const fp = filePath(accountKey);
  try {
    const raw = await fs.readFile(fp, 'utf-8');
    const parsed = JSON.parse(raw) as InvocationLogFile;
    if (parsed?.version !== 1 || !Array.isArray(parsed.entries)) {
      return { version: 1, entries: [] };
    }
    return parsed;
  } catch {
    return { version: 1, entries: [] };
  }
}

async function writeLog(file: InvocationLogFile, accountKey: string): Promise<void> {
  const fp = filePath(accountKey);
  const tmp = fp + '.tmp';
  const dir = path.dirname(fp);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(tmp, JSON.stringify(file, null, 2), 'utf-8');
  await fs.rename(tmp, fp);
}

function pruneByCapAndAge(
  entries: readonly ToolInvocation[],
  capEntries: number,
  retentionDays: number,
): readonly ToolInvocation[] {
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  const aged = entries.filter((e) => {
    const t = Date.parse(e.timestamp);
    return Number.isFinite(t) && t >= cutoff;
  });
  if (aged.length <= capEntries) return aged;
  return aged.slice(aged.length - capEntries);
}

export async function appendEntry(
  entry: ToolInvocation,
  options: { logCapEntries: number; logRetentionDays: number; accountKey?: string },
): Promise<void> {
  const accountKey = options.accountKey ?? ACCOUNT_KEY_DEFAULT;
  const next = writeLock.then(async () => {
    const current = await readLog(accountKey);
    const merged = [...current.entries, entry];
    const pruned = pruneByCapAndAge(merged, options.logCapEntries, options.logRetentionDays);
    await writeLog({ version: 1, entries: pruned }, accountKey);
  });
  // Replace lock with a swallow-error continuation so a single failure doesn't poison subsequent writes.
  writeLock = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

export async function loadLog(accountKey: string = ACCOUNT_KEY_DEFAULT): Promise<readonly ToolInvocation[]> {
  const file = await readLog(accountKey);
  return file.entries;
}

export async function clearLog(accountKey: string = ACCOUNT_KEY_DEFAULT): Promise<number> {
  // Serialize with appendEntry on the same writeLock so a clear cannot be
  // overwritten by an in-flight append that read the pre-clear file.
  let count = 0;
  const next = writeLock.then(async () => {
    const file = await readLog(accountKey);
    count = file.entries.length;
    await writeLog({ version: 1, entries: [] }, accountKey);
  });
  writeLock = next.then(
    () => undefined,
    () => undefined,
  );
  await next;
  return count;
}

export async function _flushPendingForTests(): Promise<void> {
  await writeLock;
}
