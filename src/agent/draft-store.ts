/**
 * Draft Store — persistence layer for StagedDraft via SharedJsonFileStore.
 *
 * Storage: DATA_DIR/staged-drafts.json
 * Format: StagedDraftsFile { version: 1, drafts: StagedDraft[], lastScan?: ScanMeta }
 */

import path from 'path';
import { createJsonFileStore } from '../lib/json-file-store.js';
import type { StagedDraft, StagedDraftsFile, ScanMeta, DraftStatus } from './draft-types.js';

const DRAFT_TTL_DAYS = 7;

function getStore(dataDir: string) {
  const filePath = path.join(dataDir, 'staged-drafts.json');
  return createJsonFileStore<StagedDraftsFile>(filePath);
}

function emptyFile(): StagedDraftsFile {
  return { version: 1, drafts: [] };
}

function readFile(dataDir: string): StagedDraftsFile {
  const raw = getStore(dataDir).read();
  if (!raw || raw.version !== 1 || !Array.isArray(raw.drafts)) return emptyFile();
  return raw;
}

function writeFile(dataDir: string, data: StagedDraftsFile): void {
  getStore(dataDir).write(data);
}

// ── Public API ─────────────────────────────────────────────────────────────

export function loadDrafts(dataDir: string): StagedDraft[] {
  return readFile(dataDir).drafts;
}

export function loadLastScan(dataDir: string): ScanMeta | undefined {
  return readFile(dataDir).lastScan;
}

/**
 * Save drafts and optional scan metadata.
 * Does not modify existing drafts not included in `drafts`.
 */
export function saveDrafts(dataDir: string, drafts: StagedDraft[], lastScan?: ScanMeta): void {
  const file = readFile(dataDir);
  writeFile(dataDir, {
    ...file,
    drafts,
    ...(lastScan ? { lastScan } : {}),
  });
}

/**
 * Upsert a batch of drafts by meetingId (dedup).
 * If a draft with the same meetingId exists, it is replaced. Otherwise appended.
 */
export function upsertByMeetingId(dataDir: string, incoming: StagedDraft[], lastScan?: ScanMeta): StagedDraft[] {
  const file = readFile(dataDir);
  const existing = file.drafts;

  const byMeetingId = new Map<string, StagedDraft>(existing.map((d) => [d.meetingId, d]));
  for (const draft of incoming) {
    byMeetingId.set(draft.meetingId, draft);
  }

  const updated = Array.from(byMeetingId.values());
  writeFile(dataDir, { ...file, drafts: updated, ...(lastScan ? { lastScan } : {}) });
  return updated;
}

/**
 * Remove drafts older than DRAFT_TTL_DAYS or whose meetingTime is in the past.
 * Returns the number of drafts removed.
 */
export function purgeDrafts(dataDir: string): number {
  const file = readFile(dataDir);
  const now = new Date();
  const cutoff = new Date(now.getTime() - DRAFT_TTL_DAYS * 24 * 60 * 60 * 1000);

  const before = file.drafts.length;
  const kept = file.drafts.filter((d) => {
    const created = new Date(d.createdAt);
    const meetingTime = new Date(d.meetingTime);
    if (created < cutoff) return false;     // older than 7 days
    if (meetingTime < now) return false;    // meeting already happened
    return true;
  });

  if (kept.length !== before) {
    writeFile(dataDir, { ...file, drafts: kept });
  }

  return before - kept.length;
}

export function findById(dataDir: string, id: string): StagedDraft | undefined {
  return readFile(dataDir).drafts.find((d) => d.id === id);
}

export function updateStatus(dataDir: string, id: string, status: DraftStatus): StagedDraft | null {
  const file = readFile(dataDir);
  const idx = file.drafts.findIndex((d) => d.id === id);
  if (idx === -1) return null;

  const updated: StagedDraft = { ...file.drafts[idx], status };
  const drafts = [...file.drafts.slice(0, idx), updated, ...file.drafts.slice(idx + 1)];
  writeFile(dataDir, { ...file, drafts });
  return updated;
}

export function updateUseful(dataDir: string, id: string, useful: boolean): StagedDraft | null {
  const file = readFile(dataDir);
  const idx = file.drafts.findIndex((d) => d.id === id);
  if (idx === -1) return null;

  const updated: StagedDraft = { ...file.drafts[idx], useful };
  const drafts = [...file.drafts.slice(0, idx), updated, ...file.drafts.slice(idx + 1)];
  writeFile(dataDir, { ...file, drafts });
  return updated;
}

export function markSeen(dataDir: string, ids: string[]): void {
  const file = readFile(dataDir);
  const seenAt = new Date().toISOString();
  const idSet = new Set(ids);
  const drafts = file.drafts.map((d) =>
    idSet.has(d.id) && d.status === 'pending' && !d.seenAt
      ? { ...d, seenAt }
      : d,
  );
  writeFile(dataDir, { ...file, drafts });
}
