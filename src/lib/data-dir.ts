/**
 * Shared data directory resolution.
 *
 * Single source of truth for where FlowSpace stores config,
 * credentials, memory, and other persistent data.
 *
 * Resolution order:
 *   1. FLOWSPACE_DATA_DIR env var        → custom path (CLI / npx flowspace)
 *   2. NODE_ENV=production or
 *      FLOWSPACE_PRODUCTION=1            → ~/Library/Application Support/FlowSpace/
 *   3. Otherwise (dev mode)              → process.cwd() (project root)
 *
 *   ┌──────────────────────┐
 *   │  FLOWSPACE_DATA_DIR  │──set?──▶ use that path
 *   └──────────┬───────────┘
 *              │ not set
 *              ▼
 *   ┌──────────────────────┐
 *   │  IS_PRODUCTION?      │──yes──▶ ~/Library/Application Support/FlowSpace/
 *   └──────────┬───────────┘
 *              │ no
 *              ▼
 *        process.cwd()
 */

import path from 'node:path';
import os from 'node:os';

const MACOS_APP_SUPPORT = path.join(os.homedir(), 'Library', 'Application Support', 'FlowSpace');

function isProduction(): boolean {
  return process.env.NODE_ENV === 'production' || process.env.FLOWSPACE_PRODUCTION === '1';
}

export function getDataDir(): string {
  const explicit = process.env.FLOWSPACE_DATA_DIR;
  if (explicit) return path.resolve(explicit);

  if (isProduction()) return MACOS_APP_SUPPORT;

  return process.cwd();
}

export function isProductionMode(): boolean {
  return isProduction();
}
