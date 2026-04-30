import fs from 'node:fs';
import path from 'node:path';
import type { ThreadEnrichment } from '../shared/gmail-enrichment-types.js';
import type { EnrichmentCacheFile, EnrichmentCacheEntry } from './enrichment-cache-types.js';

const TTL_MS = 24 * 60 * 60 * 1000;
const CURRENT_VERSION = 2;

function getCacheFilePath(accountKey: string, getScopedDataPath: (kind: string, key?: string) => string): string {
  return getScopedDataPath('gmail-enrichment', accountKey);
}

function emptyCacheFile(): EnrichmentCacheFile {
  return { version: CURRENT_VERSION, updatedAt: new Date().toISOString(), entries: {} };
}

function loadCache(cachePath: string): EnrichmentCacheFile {
  try {
    if (!fs.existsSync(cachePath)) return emptyCacheFile();
    const raw = fs.readFileSync(cachePath, 'utf-8');
    const parsed = JSON.parse(raw) as EnrichmentCacheFile;
    if (parsed.version !== CURRENT_VERSION) return emptyCacheFile();
    return parsed;
  } catch {
    return emptyCacheFile();
  }
}

function saveCache(cachePath: string, cache: EnrichmentCacheFile): void {
  cache.updatedAt = new Date().toISOString();
  // Ensure the parent dir exists — getDataDir() resolves to
  // ~/Library/Application Support/FlowSpace in production, which may
  // not exist on a fresh install before any other write has run.
  fs.mkdirSync(path.dirname(cachePath), { recursive: true });
  const tmpPath = cachePath + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(cache, null, 2));
  fs.renameSync(tmpPath, cachePath);
}

export function loadEnrichmentCache(
  accountKey: string,
  getScopedDataPath: (kind: string, key?: string) => string,
): EnrichmentCacheFile {
  const cachePath = getCacheFilePath(accountKey, getScopedDataPath);
  return loadCache(cachePath);
}

export function saveEnrichmentCache(
  accountKey: string,
  cache: EnrichmentCacheFile,
  getScopedDataPath: (kind: string, key?: string) => string,
): void {
  const cachePath = getCacheFilePath(accountKey, getScopedDataPath);
  saveCache(cachePath, cache);
}

export function getEnrichment(
  accountKey: string,
  threadId: string,
  lastMessageId: string,
  getScopedDataPath: (kind: string, key?: string) => string,
): ThreadEnrichment | null {
  const cachePath = getCacheFilePath(accountKey, getScopedDataPath);
  const cache = loadCache(cachePath);
  const key = `${threadId}:${lastMessageId}`;
  const entry = cache.entries[key];
  if (!entry) return null;
  if (entry.invalidatedAt) return null;
  const now = Date.now();
  const expiresAt = new Date(entry.expiresAt).getTime();
  if (now > expiresAt) return null;
  return entry.enrichment;
}

export function putEnrichment(
  accountKey: string,
  threadId: string,
  lastMessageId: string,
  enrichment: ThreadEnrichment,
  getScopedDataPath: (kind: string, key?: string) => string,
): void {
  const cachePath = getCacheFilePath(accountKey, getScopedDataPath);
  const cache = loadCache(cachePath);
  const key = `${threadId}:${lastMessageId}`;
  const now = new Date();
  cache.entries[key] = {
    enrichment,
    cachedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + TTL_MS).toISOString(),
  };
  saveCache(cachePath, cache);
}

export function invalidateEnrichmentForThread(
  accountKey: string,
  threadId: string,
  getScopedDataPath: (kind: string, key?: string) => string,
): void {
  const cachePath = getCacheFilePath(accountKey, getScopedDataPath);
  const cache = loadCache(cachePath);
  const prefix = `${threadId}:`;
  let changed = false;
  for (const key of Object.keys(cache.entries)) {
    if (key.startsWith(prefix)) {
      delete cache.entries[key];
      changed = true;
    }
  }
  if (changed) saveCache(cachePath, cache);
}
