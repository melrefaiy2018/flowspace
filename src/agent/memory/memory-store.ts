import type { MemoryCategory, MemoryEntry, MemoryFile, MemorySource } from './memory-types';
import { MAX_MEMORY_ENTRIES } from './memory-types';

export interface MemoryFileIO {
  exists(path: string): boolean;
  read(path: string): string;
  write(path: string, data: string): void;
  rename(oldPath: string, newPath: string): void;
  getFilePath(): string;
}

function defaultFileIO(userHash: string): MemoryFileIO {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');

  const isProduction = process.env.NODE_ENV === 'production' || process.env.FLOWSPACE_PRODUCTION === '1';
  const dataDir = isProduction
    ? path.join(os.homedir(), 'Library', 'Application Support', 'FlowSpace')
    : path.resolve(__dirname, '..', '..', '..');
  const memoryDir = path.join(dataDir, '.memory');
  const filePath = path.join(memoryDir, `${userHash}.json`);

  return {
    exists: (p: string) => fs.existsSync(p),
    read: (p: string) => fs.readFileSync(p, 'utf-8'),
    write: (p: string, data: string) => {
      const dir = path.dirname(p);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(p, data, 'utf-8');
    },
    rename: (oldPath: string, newPath: string) => {
      const dir = path.dirname(newPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.renameSync(oldPath, newPath);
    },
    getFilePath: () => filePath,
  };
}

let fileIO: MemoryFileIO | null = null;
let currentUser: string | null = null;
let memoryCache: MemoryEntry[] = [];
let isInitialized = false;
let batchMode = false;
let pendingWrite = false;

export function setMemoryFileIO(io: MemoryFileIO | null, userHash: string): void {
  fileIO = io;
  currentUser = userHash;
  memoryCache = [];
  isInitialized = true;
}

export function resetMemoryStore(): void {
  memoryCache = [];
  isInitialized = false;
  batchMode = false;
  pendingWrite = false;
}

/** Begin a write batch — subsequent writeFile calls accumulate in cache without disk I/O. */
export function beginBatch(): void {
  batchMode = true;
  pendingWrite = false;
}

/** Flush a write batch — if any writes were deferred, commit them to disk now. */
export function flushBatch(): void {
  batchMode = false;
  if (pendingWrite) {
    const io = getIO();
    const filePath = io.getFilePath();
    const tmpPath = filePath + '.tmp';
    const data: MemoryFile = { version: 1, entries: [...memoryCache] };
    io.write(tmpPath, JSON.stringify(data, null, 2));
    io.rename(tmpPath, filePath);
    pendingWrite = false;
  }
}

export function isMemoryInitialized(): boolean {
  return isInitialized && fileIO !== null;
}

function getIO(): MemoryFileIO {
  if (!fileIO) {
    throw new Error('Memory store not initialized. Call setMemoryFileIO first.');
  }
  return fileIO;
}

function generateId(): string {
  return `mem-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function validateEntry(entry: unknown): entry is MemoryEntry {
  if (typeof entry !== 'object' || entry === null) return false;
  const e = entry as Partial<MemoryEntry>;
  return (
    typeof e.id === 'string' &&
    typeof e.category === 'string' &&
    ['resource', 'workflow', 'preference', 'fact'].includes(e.category) &&
    typeof e.content === 'string' &&
    Array.isArray(e.tags) &&
    e.tags.every(tag => typeof tag === 'string') &&
    e.metadata !== null &&
    typeof e.metadata === 'object' &&
    e.source !== null &&
    typeof e.source === 'object' &&
    typeof e.createdAt === 'string' &&
    typeof e.updatedAt === 'string' &&
    typeof e.lastAccessedAt === 'string' &&
    typeof e.accessCount === 'number'
  );
}

function readFile(): MemoryEntry[] {
  const io = getIO();
  const filePath = io.getFilePath();
  if (!io.exists(filePath)) {
    return [];
  }
  try {
    const raw = io.read(filePath);
    const parsed = JSON.parse(raw);
    if (parsed?.version !== 1 || !Array.isArray(parsed?.entries)) {
      return [];
    }
    return parsed.entries.filter(validateEntry);
  } catch {
    return [];
  }
}

function writeFile(entries: MemoryEntry[]): void {
  if (batchMode) {
    pendingWrite = true;
    memoryCache = entries;
    return;
  }
  const io = getIO();
  const filePath = io.getFilePath();
  const tmpPath = filePath + '.tmp';
  const data: MemoryFile = { version: 1, entries };
  io.write(tmpPath, JSON.stringify(data, null, 2));
  io.rename(tmpPath, filePath);
}

export function loadMemories(): readonly MemoryEntry[] {
  const entries = readFile();
  memoryCache = entries;
  return memoryCache;
}

export function getMemories(): readonly MemoryEntry[] {
  return memoryCache;
}

export function getMemory(id: string): MemoryEntry | undefined {
  return memoryCache.find((m) => m.id === id);
}

export function getMemoryByResourceId(resourceId: string): MemoryEntry | undefined {
  return memoryCache.find((m) => m.resourceIds?.includes(resourceId));
}

interface CreateMemoryInput {
  category: MemoryCategory;
  content: string;
  tags: string[];
  metadata: Record<string, unknown>;
  resourceIds?: string[];
  source: MemorySource;
}

export function createMemory(input: CreateMemoryInput): MemoryEntry {
  const now = new Date().toISOString();
  const entry: MemoryEntry = {
    id: generateId(),
    category: input.category,
    content: input.content,
    tags: input.tags,
    metadata: input.metadata,
    resourceIds: input.resourceIds,
    source: input.source,
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
    accessCount: 0,
  };

  memoryCache = [...memoryCache, entry];

  if (memoryCache.length > MAX_MEMORY_ENTRIES) {
    memoryCache = memoryCache
      .sort((a, b) => {
        if (a.accessCount !== b.accessCount) {
          return a.accessCount - b.accessCount;
        }
        return new Date(a.lastAccessedAt).getTime() - new Date(b.lastAccessedAt).getTime();
      })
      .slice(-MAX_MEMORY_ENTRIES);
  }

  writeFile([...memoryCache]);
  return entry;
}

export function updateMemory(
  id: string,
  updates: Partial<Omit<MemoryEntry, 'id' | 'createdAt'>>,
): MemoryEntry | null {
  const idx = memoryCache.findIndex((m) => m.id === id);
  if (idx === -1) return null;

  const existing = memoryCache[idx];
  const updated: MemoryEntry = {
    ...existing,
    ...updates,
    id: existing.id,
    createdAt: existing.createdAt,
    updatedAt: updates.updatedAt || new Date().toISOString(),
  };

  memoryCache = [...memoryCache.slice(0, idx), updated, ...memoryCache.slice(idx + 1)];
  writeFile([...memoryCache]);
  return updated;
}

export function deleteMemory(id: string): boolean {
  const before = memoryCache.length;
  memoryCache = memoryCache.filter((m) => m.id !== id);
  if (memoryCache.length === before) return false;
  writeFile([...memoryCache]);
  return true;
}

export function mergeMemory(input: CreateMemoryInput): MemoryEntry {
  if (input.resourceIds && input.resourceIds.length > 0) {
    for (const rid of input.resourceIds) {
      const existing = getMemoryByResourceId(rid);
      if (existing) {
        const mergedTags = Array.from(new Set([...existing.tags, ...input.tags]));
        const mergedMetadata = { ...existing.metadata, ...input.metadata };
        const merged: MemoryEntry = {
          ...existing,
          content: input.content,
          tags: mergedTags,
          metadata: mergedMetadata,
          source: input.source,
          updatedAt: new Date().toISOString(),
        };
        memoryCache = memoryCache.map((m) => (m.id === existing.id ? merged : m));
        writeFile([...memoryCache]);
        return merged;
      }
    }
  }

  return createMemory(input);
}

export function markStale(id: string): boolean {
  return updateMemory(id, { stale: true }) !== null;
}

export function incrementAccess(id: string): MemoryEntry | null {
  const memory = getMemory(id);
  if (!memory) return null;
  return updateMemory(id, {
    accessCount: memory.accessCount + 1,
    lastAccessedAt: new Date().toISOString(),
  });
}