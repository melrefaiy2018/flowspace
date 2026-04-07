/**
 * Dynamic Tool Registry
 *
 * Manages persistence and in-memory access to user-created
 * compositional tools. Tools are stored in DATA_DIR/.dynamic-tools.json
 * and loaded on startup.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import type { DynamicToolDef, DynamicToolsFile } from './dynamic-tool-types.js';

const __filename_local = fileURLToPath(import.meta.url);
const __dirname_local = path.dirname(__filename_local);

// ── In-memory store ──────────────────────────────────────────────────

let registry: DynamicToolDef[] = [];

// ── File I/O (injectable for testing) ────────────────────────────────

export interface FileIO {
  exists(path: string): boolean;
  read(path: string): string;
  write(path: string, data: string): void;
  getFilePath(): string;
}

function defaultFileIO(): FileIO {
  const isProduction = process.env.NODE_ENV === 'production' || process.env.FLOWSPACE_PRODUCTION === '1';
  const dataDir = isProduction
    ? path.join(os.homedir(), 'Library', 'Application Support', 'FlowSpace')
    : path.resolve(__dirname_local, '..', '..');
  const filePath = path.join(dataDir, '.dynamic-tools.json');

  return {
    exists: (p: string) => fs.existsSync(p),
    read: (p: string) => fs.readFileSync(p, 'utf-8'),
    write: (p: string, data: string) => {
      const dir = path.dirname(p);
      // Ensure parent directory exists to avoid ENOENT on first run
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      // Atomic write: write to temp file then rename
      const tmpPath = p + '.tmp';
      fs.writeFileSync(tmpPath, data, 'utf-8');
      fs.renameSync(tmpPath, p);
    },
    getFilePath: () => filePath,
  };
}

let fileIO: FileIO | null = null;

function getIO(): FileIO {
  if (!fileIO) fileIO = defaultFileIO();
  return fileIO;
}

/** Inject custom file I/O (for testing). */
export function setFileIO(io: FileIO | null): void {
  fileIO = io;
}

// ── File helpers ─────────────────────────────────────────────────────

function readFile(): DynamicToolsFile {
  const io = getIO();
  const filePath = io.getFilePath();
  if (!io.exists(filePath)) {
    return { version: 1, tools: [] };
  }
  try {
    const raw = io.read(filePath);
    const parsed = JSON.parse(raw);
    if (parsed?.version !== 1 || !Array.isArray(parsed?.tools)) {
      return { version: 1, tools: [] };
    }
    const validTools = parsed.tools.filter(
      (t: unknown) =>
        typeof t === 'object' &&
        t !== null &&
        typeof (t as DynamicToolDef).name === 'string' &&
        typeof (t as DynamicToolDef).description === 'string' &&
        Array.isArray((t as DynamicToolDef).steps),
    );
    return { version: 1, tools: validTools };
  } catch {
    return { version: 1, tools: [] };
  }
}

function writeFile(data: DynamicToolsFile): void {
  const io = getIO();
  io.write(io.getFilePath(), JSON.stringify(data, null, 2));
}

// ── Public API ───────────────────────────────────────────────────────

/** Reset registry state (for testing only). */
export function resetRegistry(): void {
  registry = [];
}

/** Load all dynamic tools from disk into memory. Call once at startup. */
export function loadDynamicTools(): readonly DynamicToolDef[] {
  const file = readFile();
  registry = [...file.tools];
  return registry;
}

/** Get all currently registered dynamic tools. */
export function getDynamicTools(): readonly DynamicToolDef[] {
  return registry;
}

/** Get a single dynamic tool by name. */
export function getDynamicTool(name: string): DynamicToolDef | undefined {
  return registry.find((t) => t.name === name);
}

/** Check if a dynamic tool with the given name exists. */
export function hasDynamicTool(name: string): boolean {
  return registry.some((t) => t.name === name);
}

/**
 * Register a new dynamic tool. Persists to disk.
 * Returns the created tool, or null if the name already exists.
 */
export function registerDynamicTool(tool: DynamicToolDef): DynamicToolDef | null {
  if (registry.some((t) => t.name === tool.name)) {
    return null;
  }
  const newTool: DynamicToolDef = {
    ...tool,
    createdAt: tool.createdAt || new Date().toISOString(),
  };
  registry = [...registry, newTool];
  writeFile({ version: 1, tools: registry });
  return newTool;
}

/**
 * Remove a dynamic tool by name. Persists to disk.
 * Returns true if the tool was found and removed.
 */
export function removeDynamicTool(name: string): boolean {
  const before = registry.length;
  registry = registry.filter((t) => t.name !== name);
  if (registry.length === before) return false;
  writeFile({ version: 1, tools: registry });
  return true;
}

/**
 * Replace a dynamic tool (update). Persists to disk.
 * Returns the updated tool, or null if not found.
 */
export function updateDynamicTool(name: string, updates: Partial<Omit<DynamicToolDef, 'name' | 'createdAt'>>): DynamicToolDef | null {
  const idx = registry.findIndex((t) => t.name === name);
  if (idx === -1) return null;
  const existing = registry[idx];
  const updated: DynamicToolDef = { ...existing, ...updates };
  registry = [...registry.slice(0, idx), updated, ...registry.slice(idx + 1)];
  writeFile({ version: 1, tools: registry });
  return updated;
}
