import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  loadDrafts,
  loadLastScan,
  saveDrafts,
  upsertByMeetingId,
  purgeDrafts,
  findById,
  updateStatus,
  updateUseful,
  markSeen,
} from '../draft-store.js';
import type { StagedDraft, ScanMeta } from '../draft-types.js';

function tmpDir() {
  const dir = path.join(os.tmpdir(), `draft-store-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function makeDraft(overrides: Partial<StagedDraft> = {}): StagedDraft {
  return {
    id: overrides.id ?? `draft-${Math.random().toString(36).slice(2)}`,
    meetingId: overrides.meetingId ?? `evt-${Math.random().toString(36).slice(2)}`,
    meetingTitle: overrides.meetingTitle ?? 'Test Meeting',
    meetingTime: overrides.meetingTime ?? new Date(Date.now() + 3600000).toISOString(), // 1h from now
    attendees: overrides.attendees ?? ['alice@external.com'],
    summary: overrides.summary ?? 'Brief summary.',
    linkedDocs: overrides.linkedDocs ?? [],
    relatedEmails: overrides.relatedEmails ?? [],
    suggestedActions: overrides.suggestedActions ?? [],
    confidence: overrides.confidence ?? 1.0,
    confidenceReason: overrides.confidenceReason ?? '',
    createdAt: overrides.createdAt ?? new Date().toISOString(),
    status: overrides.status ?? 'pending',
    ...overrides,
  };
}

describe('draft-store', () => {
  let dir: string;
  const dirs: string[] = [];

  beforeEach(() => {
    dir = tmpDir();
    dirs.push(dir);
  });

  afterEach(() => {
    for (const d of dirs) {
      try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
    }
    dirs.length = 0;
  });

  describe('loadDrafts', () => {
    it('returns empty array when file does not exist', () => {
      expect(loadDrafts(dir)).toEqual([]);
    });
  });

  describe('saveDrafts / loadDrafts', () => {
    it('saves and retrieves drafts', () => {
      const draft = makeDraft();
      saveDrafts(dir, [draft]);
      expect(loadDrafts(dir)).toEqual([draft]);
    });

    it('saves lastScan metadata', () => {
      const meta: ScanMeta = { scannedAt: new Date().toISOString(), meetingsFound: 3, meetingsPrepped: 2, errors: [] };
      saveDrafts(dir, [], meta);
      expect(loadLastScan(dir)).toEqual(meta);
    });
  });

  describe('upsertByMeetingId', () => {
    it('appends new drafts', () => {
      const d1 = makeDraft({ meetingId: 'evt-1' });
      const d2 = makeDraft({ meetingId: 'evt-2' });
      upsertByMeetingId(dir, [d1]);
      upsertByMeetingId(dir, [d2]);
      expect(loadDrafts(dir)).toHaveLength(2);
    });

    it('replaces existing draft with same meetingId (dedup)', () => {
      const original = makeDraft({ meetingId: 'evt-1', meetingTitle: 'Original' });
      const updated = makeDraft({ meetingId: 'evt-1', meetingTitle: 'Updated' });
      upsertByMeetingId(dir, [original]);
      upsertByMeetingId(dir, [updated]);
      const drafts = loadDrafts(dir);
      expect(drafts).toHaveLength(1);
      expect(drafts[0].meetingTitle).toBe('Updated');
    });
  });

  describe('purgeDrafts', () => {
    it('removes drafts with meetingTime in the past', () => {
      const past = makeDraft({ meetingTime: new Date(Date.now() - 3600000).toISOString() });
      const future = makeDraft({ meetingTime: new Date(Date.now() + 3600000).toISOString() });
      saveDrafts(dir, [past, future]);
      const removed = purgeDrafts(dir);
      expect(removed).toBe(1);
      expect(loadDrafts(dir)).toHaveLength(1);
      expect(loadDrafts(dir)[0].meetingTime).toBe(future.meetingTime);
    });

    it('removes drafts older than 7 days', () => {
      const old = makeDraft({
        createdAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(),
        meetingTime: new Date(Date.now() + 3600000).toISOString(),
      });
      const recent = makeDraft();
      saveDrafts(dir, [old, recent]);
      const removed = purgeDrafts(dir);
      expect(removed).toBe(1);
      expect(loadDrafts(dir)).toHaveLength(1);
    });

    it('returns 0 when nothing to purge', () => {
      saveDrafts(dir, [makeDraft()]);
      expect(purgeDrafts(dir)).toBe(0);
    });
  });

  describe('findById', () => {
    it('finds draft by id', () => {
      const draft = makeDraft({ id: 'specific-id' });
      saveDrafts(dir, [draft]);
      expect(findById(dir, 'specific-id')).toEqual(draft);
    });

    it('returns undefined for unknown id', () => {
      expect(findById(dir, 'nonexistent')).toBeUndefined();
    });
  });

  describe('updateStatus', () => {
    it('updates draft status', () => {
      const draft = makeDraft({ id: 'test-id' });
      saveDrafts(dir, [draft]);
      const updated = updateStatus(dir, 'test-id', 'approved');
      expect(updated?.status).toBe('approved');
      expect(findById(dir, 'test-id')?.status).toBe('approved');
    });

    it('returns null for unknown id', () => {
      expect(updateStatus(dir, 'nonexistent', 'approved')).toBeNull();
    });
  });

  describe('updateUseful', () => {
    it('sets useful to true', () => {
      const draft = makeDraft({ id: 'test-id' });
      saveDrafts(dir, [draft]);
      updateUseful(dir, 'test-id', true);
      expect(findById(dir, 'test-id')?.useful).toBe(true);
    });

    it('toggles useful to false', () => {
      const draft = makeDraft({ id: 'test-id', useful: true });
      saveDrafts(dir, [draft]);
      updateUseful(dir, 'test-id', false);
      expect(findById(dir, 'test-id')?.useful).toBe(false);
    });
  });

  describe('markSeen', () => {
    it('sets seenAt on pending drafts', () => {
      const draft = makeDraft({ id: 'test-id', status: 'pending' });
      saveDrafts(dir, [draft]);
      markSeen(dir, ['test-id']);
      expect(findById(dir, 'test-id')?.seenAt).toBeTruthy();
    });

    it('does not overwrite existing seenAt', () => {
      const seenAt = '2026-01-01T00:00:00Z';
      const draft = makeDraft({ id: 'test-id', status: 'pending', seenAt });
      saveDrafts(dir, [draft]);
      markSeen(dir, ['test-id']);
      expect(findById(dir, 'test-id')?.seenAt).toBe(seenAt);
    });
  });
});
