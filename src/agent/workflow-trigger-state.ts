import path from 'path';
import fs from 'fs/promises';
import { getDataDir } from '../lib/data-dir.js';

export interface TriggerFailure {
  messageId: string;
  failedAt: number;
  error: string;
}

export interface TriggerState {
  version: 1;
  processedIds: Record<string, string[]>;
  lastPollAt: Record<string, number>;
  failures: Record<string, TriggerFailure[]>;
}

const STATE_FILE = '.workflow-trigger-state.json';
const MAX_PROCESSED_IDS = 500;
const MAX_FAILURES = 20;

function stateFilePath(): string {
  return path.join(getDataDir(), STATE_FILE);
}

function defaultState(): TriggerState {
  return { version: 1, processedIds: {}, lastPollAt: {}, failures: {} };
}

let cache: TriggerState | null = null;
// Per-workflow Set of processed ids, rebuilt from cache on demand.
// Keeps isProcessed() at O(1) instead of O(n) scanning a 500-item array.
let processedSetCache: Map<string, Set<string>> | null = null;

function processedSetFor(state: TriggerState, workflowName: string): Set<string> {
  if (!processedSetCache) processedSetCache = new Map();
  let set = processedSetCache.get(workflowName);
  if (!set) {
    set = new Set(state.processedIds[workflowName] ?? []);
    processedSetCache.set(workflowName, set);
  }
  return set;
}

export function _resetCacheForTests(): void {
  cache = null;
  processedSetCache = null;
}

export async function loadTriggerState(): Promise<TriggerState> {
  if (cache) return cache;

  const filePath = stateFilePath();
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.version !== 1) {
      console.warn('[trigger-state] corrupt or unknown version, using default');
      const def = defaultState();
      cache = def;
      return def;
    }
    if (
      typeof parsed.processedIds !== 'object' || parsed.processedIds === null || Array.isArray(parsed.processedIds) ||
      typeof parsed.lastPollAt !== 'object' || parsed.lastPollAt === null || Array.isArray(parsed.lastPollAt) ||
      typeof parsed.failures !== 'object' || parsed.failures === null || Array.isArray(parsed.failures)
    ) {
      console.warn('[trigger-state] corrupt or unknown version, using default');
      const def = defaultState();
      cache = def;
      return def;
    }
    cache = parsed as TriggerState;
    return cache;
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      const def = defaultState();
      cache = def;
      return def;
    }
    console.warn('[trigger-state] corrupt or unknown version, using default');
    const def = defaultState();
    cache = def;
    return def;
  }
}

export async function saveTriggerState(state: TriggerState): Promise<void> {
  const filePath = stateFilePath();
  const tmpPath = filePath + '.tmp';
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(tmpPath, JSON.stringify(state, null, 2), 'utf-8');
  await fs.rename(tmpPath, filePath);
  cache = state;
  // The processed-id Set is derived from cache; invalidate so it rebuilds on next read.
  processedSetCache = null;
}

export async function markProcessed(workflowName: string, ids: string[]): Promise<void> {
  const state = await loadTriggerState();
  const current = state.processedIds[workflowName] ?? [];
  const merged = [...current, ...ids];
  const trimmed = merged.length > MAX_PROCESSED_IDS ? merged.slice(-MAX_PROCESSED_IDS) : merged;
  await saveTriggerState({
    ...state,
    processedIds: { ...state.processedIds, [workflowName]: trimmed },
  });
}

export async function isProcessed(workflowName: string, id: string): Promise<boolean> {
  const state = await loadTriggerState();
  return processedSetFor(state, workflowName).has(id);
}

export async function getLastPollAt(workflowName: string): Promise<number | null> {
  const state = await loadTriggerState();
  return state.lastPollAt[workflowName] ?? null;
}

export async function setLastPollAt(workflowName: string, ts: number): Promise<void> {
  const state = await loadTriggerState();
  await saveTriggerState({
    ...state,
    lastPollAt: { ...state.lastPollAt, [workflowName]: ts },
  });
}

export async function recordFailure(workflowName: string, failure: TriggerFailure): Promise<void> {
  const state = await loadTriggerState();
  const current = state.failures[workflowName] ?? [];
  const merged = [...current, failure];
  const trimmed = merged.length > MAX_FAILURES ? merged.slice(-MAX_FAILURES) : merged;
  await saveTriggerState({
    ...state,
    failures: { ...state.failures, [workflowName]: trimmed },
  });
}

export async function clearFailures(workflowName: string): Promise<void> {
  const state = await loadTriggerState();
  await saveTriggerState({
    ...state,
    failures: { ...state.failures, [workflowName]: [] },
  });
}

export async function clearFailureForMessage(workflowName: string, messageId: string): Promise<void> {
  const state = await loadTriggerState();
  const current = state.failures[workflowName] ?? [];
  const next = current.filter((f) => f.messageId !== messageId);
  if (next.length === current.length) return;
  await saveTriggerState({
    ...state,
    failures: { ...state.failures, [workflowName]: next },
  });
}

export async function getProcessedCount(workflowName: string): Promise<number> {
  const state = await loadTriggerState();
  return state.processedIds[workflowName]?.length ?? 0;
}

export async function getFailures(workflowName: string): Promise<TriggerFailure[]> {
  const state = await loadTriggerState();
  return state.failures[workflowName] ?? [];
}
