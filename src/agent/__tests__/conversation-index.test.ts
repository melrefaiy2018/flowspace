import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock fs and getDataDir before importing the module under test ─────────────

const { mockFs } = vi.hoisted(() => {
  const mockFs = {
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    renameSync: vi.fn(),
  };
  return { mockFs };
});

vi.mock('fs', () => ({ default: mockFs, ...mockFs }));

vi.mock('../../lib/data-dir.js', () => ({
  getDataDir: vi.fn(() => '/fake/data'),
}));

import {
  loadConversationIndex,
  saveConversationIndex,
  upsertConversation,
  isEventAlreadyPrepped,
  getConversationTitle,
} from '../conversation-index.js';
import type { ConversationIndex } from '../conversation-index.js';

// ── Helpers ────────────────────────────────────────────────────────────────────

const USER_HASH = 'abc123';
const FILE_PATH = `/fake/data/.conversations.${USER_HASH}.json`;
const TMP_PATH = FILE_PATH + '.tmp';

function makeIndex(partial: Partial<ConversationIndex['entries']> = {}): ConversationIndex {
  return { version: 1, entries: partial };
}

function resetMocks() {
  mockFs.existsSync.mockReset();
  mockFs.readFileSync.mockReset();
  mockFs.writeFileSync.mockReset();
  mockFs.renameSync.mockReset();
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('loadConversationIndex', () => {
  beforeEach(resetMocks);

  it('returns empty index when file does not exist', () => {
    mockFs.existsSync.mockReturnValue(false);
    const result = loadConversationIndex(USER_HASH);
    expect(result).toEqual({ version: 1, entries: {} });
  });

  it('returns empty index on JSON parse error', () => {
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue('not-json');
    const result = loadConversationIndex(USER_HASH);
    expect(result).toEqual({ version: 1, entries: {} });
  });

  it('returns empty index on version mismatch', () => {
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue(JSON.stringify({ version: 2, entries: {} }));
    const result = loadConversationIndex(USER_HASH);
    expect(result).toEqual({ version: 1, entries: {} });
  });

  it('returns stored index when file is valid', () => {
    const stored = makeIndex({
      'conv-1': {
        id: 'conv-1',
        lastMessageAt: 1000,
        messageCount: 3,
        title: 'Hello',
      },
    });
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue(JSON.stringify(stored));
    const result = loadConversationIndex(USER_HASH);
    expect(result.entries['conv-1'].title).toBe('Hello');
    expect(result.entries['conv-1'].messageCount).toBe(3);
  });
});

describe('saveConversationIndex', () => {
  beforeEach(resetMocks);

  it('writes to tmp path and renames atomically', () => {
    const index = makeIndex();
    saveConversationIndex(USER_HASH, index);
    expect(mockFs.writeFileSync).toHaveBeenCalledWith(
      TMP_PATH,
      expect.stringContaining('"version": 1'),
      'utf-8',
    );
    expect(mockFs.renameSync).toHaveBeenCalledWith(TMP_PATH, FILE_PATH);
  });
});

describe('upsertConversation', () => {
  beforeEach(resetMocks);

  it('creates new entry with all provided fields', () => {
    mockFs.existsSync.mockReturnValue(false);
    upsertConversation(USER_HASH, {
      id: 'conv-1',
      title: 'My Conversation',
      eventId: 'event-123',
      threadBrief: 'A brief summary',
      origin: 'meeting_prep',
    });

    const written = JSON.parse(mockFs.writeFileSync.mock.calls[0][1]);
    const entry = written.entries['conv-1'];
    expect(entry.id).toBe('conv-1');
    expect(entry.title).toBe('My Conversation');
    expect(entry.eventId).toBe('event-123');
    expect(entry.threadBrief).toBe('A brief summary');
    expect(entry.origin).toBe('meeting_prep');
    expect(entry.messageCount).toBe(1);
    expect(entry.createdAt).toBeDefined();
    expect(entry.lastMessageAt).toBeDefined();
  });

  it('updates lastMessageAt and increments messageCount on existing entry', () => {
    const existing: ConversationIndex = {
      version: 1,
      entries: {
        'conv-1': {
          id: 'conv-1',
          lastMessageAt: 1000,
          messageCount: 2,
          title: 'Existing Title',
        },
      },
    };
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue(JSON.stringify(existing));

    upsertConversation(USER_HASH, { id: 'conv-1' });

    const written = JSON.parse(mockFs.writeFileSync.mock.calls[0][1]);
    const entry = written.entries['conv-1'];
    expect(entry.messageCount).toBe(3);
    expect(entry.lastMessageAt).toBeGreaterThan(1000);
  });

  it('does NOT overwrite existing title', () => {
    const existing: ConversationIndex = {
      version: 1,
      entries: {
        'conv-1': {
          id: 'conv-1',
          lastMessageAt: 1000,
          messageCount: 1,
          title: 'Original Title',
        },
      },
    };
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue(JSON.stringify(existing));

    upsertConversation(USER_HASH, { id: 'conv-1', title: 'New Title' });

    const written = JSON.parse(mockFs.writeFileSync.mock.calls[0][1]);
    expect(written.entries['conv-1'].title).toBe('Original Title');
  });

  it('does NOT overwrite existing eventId', () => {
    const existing: ConversationIndex = {
      version: 1,
      entries: {
        'conv-1': {
          id: 'conv-1',
          lastMessageAt: 1000,
          messageCount: 1,
          eventId: 'event-original',
        },
      },
    };
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue(JSON.stringify(existing));

    upsertConversation(USER_HASH, { id: 'conv-1', eventId: 'event-new' });

    const written = JSON.parse(mockFs.writeFileSync.mock.calls[0][1]);
    expect(written.entries['conv-1'].eventId).toBe('event-original');
  });

  it('truncates threadBrief to 500 chars', () => {
    mockFs.existsSync.mockReturnValue(false);
    const longBrief = 'x'.repeat(600);
    upsertConversation(USER_HASH, { id: 'conv-1', threadBrief: longBrief });

    const written = JSON.parse(mockFs.writeFileSync.mock.calls[0][1]);
    expect(written.entries['conv-1'].threadBrief.length).toBe(500);
  });

  it('does nothing when id is empty string', () => {
    upsertConversation(USER_HASH, { id: '' });
    expect(mockFs.writeFileSync).not.toHaveBeenCalled();
  });
});

describe('isEventAlreadyPrepped', () => {
  beforeEach(resetMocks);

  it('returns true for a known event with messageCount > 0', () => {
    const index: ConversationIndex = {
      version: 1,
      entries: {
        'conv-1': { id: 'conv-1', lastMessageAt: 1000, messageCount: 2, eventId: 'event-123' },
      },
    };
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue(JSON.stringify(index));

    expect(isEventAlreadyPrepped(USER_HASH, 'event-123')).toBe(true);
  });

  it('returns false for unknown event', () => {
    const index: ConversationIndex = {
      version: 1,
      entries: {
        'conv-1': { id: 'conv-1', lastMessageAt: 1000, messageCount: 2, eventId: 'event-abc' },
      },
    };
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue(JSON.stringify(index));

    expect(isEventAlreadyPrepped(USER_HASH, 'event-unknown')).toBe(false);
  });

  it('returns false when event exists but messageCount is 0', () => {
    const index: ConversationIndex = {
      version: 1,
      entries: {
        'conv-1': { id: 'conv-1', lastMessageAt: 1000, messageCount: 0, eventId: 'event-123' },
      },
    };
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue(JSON.stringify(index));

    expect(isEventAlreadyPrepped(USER_HASH, 'event-123')).toBe(false);
  });

  it('returns false when file does not exist', () => {
    mockFs.existsSync.mockReturnValue(false);
    expect(isEventAlreadyPrepped(USER_HASH, 'event-123')).toBe(false);
  });
});

describe('getConversationTitle', () => {
  beforeEach(resetMocks);

  it('returns title for known conversation', () => {
    const index: ConversationIndex = {
      version: 1,
      entries: {
        'conv-1': { id: 'conv-1', lastMessageAt: 1000, messageCount: 1, title: 'Q1 Review Prep' },
      },
    };
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue(JSON.stringify(index));

    expect(getConversationTitle(USER_HASH, 'conv-1')).toBe('Q1 Review Prep');
  });

  it('returns undefined for unknown conversation', () => {
    mockFs.existsSync.mockReturnValue(false);
    expect(getConversationTitle(USER_HASH, 'conv-nonexistent')).toBeUndefined();
  });

  it('returns undefined for conversation without title', () => {
    const index: ConversationIndex = {
      version: 1,
      entries: {
        'conv-1': { id: 'conv-1', lastMessageAt: 1000, messageCount: 1 },
      },
    };
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue(JSON.stringify(index));

    expect(getConversationTitle(USER_HASH, 'conv-1')).toBeUndefined();
  });
});

describe('Index persists across load/save cycles', () => {
  beforeEach(resetMocks);

  it('round-trips data correctly', () => {
    // Start with empty
    mockFs.existsSync.mockReturnValueOnce(false);

    upsertConversation(USER_HASH, {
      id: 'conv-roundtrip',
      title: 'Round Trip Test',
      eventId: 'evt-rt',
    });

    // Capture what was written
    const writtenJson = mockFs.writeFileSync.mock.calls[0][1];

    // Now simulate loading that back
    mockFs.existsSync.mockReturnValueOnce(true);
    mockFs.readFileSync.mockReturnValueOnce(writtenJson);

    const loaded = loadConversationIndex(USER_HASH);
    expect(loaded.entries['conv-roundtrip'].title).toBe('Round Trip Test');
    expect(loaded.entries['conv-roundtrip'].eventId).toBe('evt-rt');
    expect(loaded.entries['conv-roundtrip'].messageCount).toBe(1);
  });
});
