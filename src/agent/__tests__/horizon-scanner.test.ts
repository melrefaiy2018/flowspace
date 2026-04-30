import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock executeTool before importing scanner
vi.mock('../tools.js', () => ({
  executeTool: vi.fn(),
}));

vi.mock('../llm-client.js', () => ({
  createLLMClient: vi.fn(),
}));

vi.mock('../memory/memory-store.js', () => ({
  mergeMemory: vi.fn(),
  setMemoryFileIO: vi.fn(),
  loadMemories: vi.fn(),
  beginBatch: vi.fn(),
  flushBatch: vi.fn(),
  isMemoryInitialized: vi.fn(() => true),
}));

vi.mock('../conversation-index.js', () => ({
  isEventAlreadyPrepped: vi.fn(() => false),
}));

vi.mock('../../lib/user-hash.js', () => ({
  getUserHash: vi.fn(() => 'fakehash1234'),
}));

vi.mock('../../lib/data-dir.js', () => ({
  getDataDir: vi.fn(() => '/fake/data'),
}));

vi.mock('fs', () => ({
  default: { existsSync: vi.fn(() => true), mkdirSync: vi.fn(), readFileSync: vi.fn(), writeFileSync: vi.fn(), renameSync: vi.fn() },
  existsSync: vi.fn(() => true),
  mkdirSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  renameSync: vi.fn(),
}));

import { executeTool } from '../tools.js';
import { createLLMClient } from '../llm-client.js';
import { mergeMemory } from '../memory/memory-store.js';
import {
  ALLOWED_SCANNER_TOOLS,
  guardedExecuteTool,
  filterMeetings,
  runHorizonScan,
} from '../horizon-scanner.js';

const mockedExecuteTool = vi.mocked(executeTool);
const mockedCreateLLMClient = vi.mocked(createLLMClient);
const mockedMergeMemory = vi.mocked(mergeMemory);

// ── Tool guard tests (T005) ───────────────────────────────────────────────

describe('ALLOWED_SCANNER_TOOLS', () => {
  it('contains exactly the 4 read-only tools', () => {
    expect(ALLOWED_SCANNER_TOOLS.has('calendar_agenda')).toBe(true);
    expect(ALLOWED_SCANNER_TOOLS.has('search_drive')).toBe(true);
    expect(ALLOWED_SCANNER_TOOLS.has('search_emails')).toBe(true);
    expect(ALLOWED_SCANNER_TOOLS.has('docs_read')).toBe(true);
    expect(ALLOWED_SCANNER_TOOLS.size).toBe(4);
  });
});

describe('guardedExecuteTool', () => {
  beforeEach(() => {
    mockedExecuteTool.mockResolvedValue('{}');
  });

  it('allows calendar_agenda', async () => {
    await expect(guardedExecuteTool('calendar_agenda', {})).resolves.not.toThrow();
    expect(mockedExecuteTool).toHaveBeenCalledWith('calendar_agenda', {}, undefined);
  });

  it('allows search_drive', async () => {
    await expect(guardedExecuteTool('search_drive', { query: 'test' })).resolves.not.toThrow();
  });

  it('allows search_emails', async () => {
    await expect(guardedExecuteTool('search_emails', { query: 'test' })).resolves.not.toThrow();
  });

  it('allows docs_read', async () => {
    await expect(guardedExecuteTool('docs_read', { doc_id: '123' })).resolves.not.toThrow();
  });

  it('throws for write tools (docs_write)', async () => {
    await expect(guardedExecuteTool('docs_write', { doc_id: '123', content: 'x' })).rejects.toThrow(
      'Scanner: tool "docs_write" is not in ALLOWED_SCANNER_TOOLS',
    );
  });

  it('throws for send_email', async () => {
    await expect(guardedExecuteTool('send_email', {})).rejects.toThrow(
      'Scanner: tool "send_email" is not in ALLOWED_SCANNER_TOOLS',
    );
  });

  it('throws for unknown tools', async () => {
    await expect(guardedExecuteTool('nonexistent_tool', {})).rejects.toThrow(
      'Scanner: tool "nonexistent_tool" is not in ALLOWED_SCANNER_TOOLS',
    );
  });
});

// ── Meeting filter tests (T010) ───────────────────────────────────────────

function makeEvent(overrides: {
  id?: string;
  summary?: string;
  startOffset?: number; // hours from now
  durationMinutes?: number;
  attendees?: Array<{ email: string; self?: boolean }>;
}) {
  const start = new Date(Date.now() + (overrides.startOffset ?? 2) * 3600000);
  const end = new Date(start.getTime() + (overrides.durationMinutes ?? 60) * 60000);
  return {
    id: overrides.id ?? 'evt-1',
    summary: overrides.summary ?? 'Test Meeting',
    start: { dateTime: start.toISOString() },
    end: { dateTime: end.toISOString() },
    attendees: overrides.attendees ?? [
      { email: 'alice@external.com' },
      { email: 'bob@external.com' },
      { email: 'me@mycompany.com', self: true },
    ],
  };
}

describe('filterMeetings', () => {
  it('includes meetings >= 30 min with >= 2 external attendees', () => {
    const event = makeEvent({ durationMinutes: 60 });
    const result = filterMeetings([event], 'mycompany.com');
    expect(result).toHaveLength(1);
    expect(result[0].externalAttendees).toEqual(['alice@external.com', 'bob@external.com']);
  });

  it('excludes meetings shorter than 30 min', () => {
    const event = makeEvent({ durationMinutes: 20 });
    expect(filterMeetings([event], 'mycompany.com')).toHaveLength(0);
  });

  it('excludes meetings with < 2 external attendees', () => {
    const event = makeEvent({
      attendees: [
        { email: 'alice@external.com' },
        { email: 'me@mycompany.com', self: true },
      ],
    });
    expect(filterMeetings([event], 'mycompany.com')).toHaveLength(0);
  });

  it('does not count same-domain attendees as external', () => {
    const event = makeEvent({
      attendees: [
        { email: 'colleague1@mycompany.com' },
        { email: 'colleague2@mycompany.com' },
        { email: 'alice@external.com' },
        { email: 'me@mycompany.com', self: true },
      ],
    });
    // Only 1 external attendee (alice) — should be excluded
    expect(filterMeetings([event], 'mycompany.com')).toHaveLength(0);
  });

  it('caps at 10 meetings', () => {
    const events = Array.from({ length: 15 }, (_, i) =>
      makeEvent({ id: `evt-${i}`, startOffset: i + 1 }),
    );
    expect(filterMeetings(events, 'mycompany.com')).toHaveLength(10);
  });

  it('returns empty array for empty calendar', () => {
    expect(filterMeetings([], 'mycompany.com')).toHaveLength(0);
  });

  it('includes meeting title and times in result', () => {
    const event = makeEvent({ summary: 'Q3 Review' });
    const [meeting] = filterMeetings([event], 'mycompany.com');
    expect(meeting.title).toBe('Q3 Review');
    expect(meeting.startTime).toBeTruthy();
    expect(meeting.endTime).toBeTruthy();
  });
});

// ── Scan orchestrator tests (T010) ───────────────────────────────────────

describe('runHorizonScan', () => {
  const mockLLMClient = {
    model: 'test-model',
    provider: 'openai' as const,
    complete: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockedCreateLLMClient.mockReturnValue(mockLLMClient as any);
  });

  const calendarEvent = makeEvent({
    id: 'evt-meeting-1',
    summary: 'Q3 Board Review',
    durationMinutes: 60,
  });

  it('returns empty scan result for empty calendar', async () => {
    mockedExecuteTool.mockResolvedValueOnce(JSON.stringify({ events: [] }));
    const result = await runHorizonScan({ selfDomain: 'mycompany.com' });
    expect(result.drafts).toHaveLength(0);
    expect(result.meta.meetingsFound).toBe(0);
    expect(result.meta.meetingsPrepped).toBe(0);
  });

  it('generates a draft for each qualifying meeting', async () => {
    // calendar_agenda → 1 meeting
    mockedExecuteTool.mockResolvedValueOnce(JSON.stringify({ events: [calendarEvent] }));
    // search_emails
    mockedExecuteTool.mockResolvedValueOnce(JSON.stringify({ messages: [] }));
    // search_drive
    mockedExecuteTool.mockResolvedValueOnce(JSON.stringify({ files: [] }));

    mockLLMClient.complete.mockResolvedValueOnce({
      choices: [{ message: { content: '## Brief\n\nSome content.' } }],
    });

    const result = await runHorizonScan({ selfDomain: 'mycompany.com' });
    expect(result.drafts).toHaveLength(1);
    expect(result.drafts[0].meetingId).toBe('evt-meeting-1');
    expect(result.drafts[0].status).toBe('pending');
    expect(result.drafts[0].confidence).toBe(1.0);
    expect(result.meta.meetingsFound).toBe(1);
    expect(result.meta.meetingsPrepped).toBe(1);
    expect(result.meta.errors).toHaveLength(0);
  });

  it('skips meeting and logs error when LLM fails', async () => {
    mockedExecuteTool.mockResolvedValueOnce(JSON.stringify({ events: [calendarEvent] }));
    mockedExecuteTool.mockResolvedValueOnce(JSON.stringify({ messages: [] }));
    mockedExecuteTool.mockResolvedValueOnce(JSON.stringify({ files: [] }));

    mockLLMClient.complete.mockRejectedValueOnce(new Error('LLM unavailable'));

    const result = await runHorizonScan({ selfDomain: 'mycompany.com' });
    expect(result.drafts).toHaveLength(0);
    expect(result.meta.errors).toHaveLength(1);
    expect(result.meta.errors[0].meetingId).toBe('evt-meeting-1');
    expect(result.meta.errors[0].error).toContain('LLM unavailable');
  });

  it('returns scan metadata with accurate counts', async () => {
    const events = [
      makeEvent({ id: 'evt-a', durationMinutes: 60 }),
      makeEvent({ id: 'evt-b', durationMinutes: 60 }),
    ];
    mockedExecuteTool.mockResolvedValueOnce(JSON.stringify({ events }));
    // For evt-a: emails + drive
    mockedExecuteTool.mockResolvedValueOnce(JSON.stringify({ messages: [] }));
    mockedExecuteTool.mockResolvedValueOnce(JSON.stringify({ files: [] }));
    // For evt-b: emails + drive
    mockedExecuteTool.mockResolvedValueOnce(JSON.stringify({ messages: [] }));
    mockedExecuteTool.mockResolvedValueOnce(JSON.stringify({ files: [] }));

    mockLLMClient.complete
      .mockResolvedValueOnce({ choices: [{ message: { content: 'Brief A' } }] })
      .mockRejectedValueOnce(new Error('LLM error'));

    const result = await runHorizonScan({ selfDomain: 'mycompany.com' });
    expect(result.meta.meetingsFound).toBe(2);
    expect(result.meta.meetingsPrepped).toBe(1);
    expect(result.meta.errors).toHaveLength(1);
  });

  it('returns error meta when calendar fetch fails', async () => {
    mockedExecuteTool.mockRejectedValueOnce(new Error('Calendar unavailable'));
    const result = await runHorizonScan({ selfDomain: 'mycompany.com' });
    expect(result.drafts).toHaveLength(0);
    expect(result.meta.errors[0].error).toContain('Calendar unavailable');
  });
});

// ── Memory indexing tests (US3) ─────────────────────────────────────────────

describe('runHorizonScan — memory indexing', () => {
  const mockLLMClient = {
    model: 'test-model',
    provider: 'openai' as const,
    complete: vi.fn(),
  };

  const twoLinkedDocsTwoEmails = makeEvent({
    id: 'evt-memory-1',
    summary: 'Partner Sync',
    durationMinutes: 60,
  });

  function setupMocksForOneEvent() {
    mockedExecuteTool.mockResolvedValueOnce(
      JSON.stringify({ events: [twoLinkedDocsTwoEmails] }),
    );
    // search_emails — 1 email
    mockedExecuteTool.mockResolvedValueOnce(
      JSON.stringify({
        messages: [
          { subject: 'Follow-up on proposal', from: 'alice@external.com', snippet: 'See attached.' },
        ],
      }),
    );
    // search_drive — 2 docs
    mockedExecuteTool.mockResolvedValueOnce(
      JSON.stringify({
        files: [
          { name: 'Q3 Proposal', webViewLink: 'https://docs.google.com/d/abc' },
          { name: 'Partner Agreement', webViewLink: 'https://docs.google.com/d/def' },
        ],
      }),
    );
    mockLLMClient.complete.mockResolvedValueOnce({
      choices: [{ message: { content: '## Brief\nPartner Sync prep.' } }],
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockedCreateLLMClient.mockReturnValue(mockLLMClient as any);
    mockedMergeMemory.mockImplementation(() => ({
      id: 'mem-test',
      category: 'resource',
      content: '',
      tags: [],
      metadata: {},
      source: { type: 'auto_extraction', toolName: 'horizon_scanner' },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastAccessedAt: new Date().toISOString(),
      accessCount: 0,
    }));
  });

  it('calls mergeMemory once per linkedDoc and once per relatedEmail when userEmail is provided', async () => {
    setupMocksForOneEvent();

    const result = await runHorizonScan({
      selfDomain: 'mycompany.com',
      userEmail: 'me@mycompany.com',
    });

    expect(result.drafts).toHaveLength(1);
    // 2 linkedDocs + 1 relatedEmail = 3 mergeMemory calls
    expect(mockedMergeMemory).toHaveBeenCalledTimes(3);

    // Doc calls should have category 'resource'
    const docCalls = mockedMergeMemory.mock.calls.filter(
      ([input]) => input.category === 'resource',
    );
    expect(docCalls).toHaveLength(2);
    expect(docCalls[0][0].content).toBe('Q3 Proposal');
    expect(docCalls[0][0].tags).toContain('meeting-prep');
    expect(docCalls[1][0].content).toBe('Partner Agreement');

    // Email calls should have category 'fact'
    const emailCalls = mockedMergeMemory.mock.calls.filter(
      ([input]) => input.category === 'fact',
    );
    expect(emailCalls).toHaveLength(1);
    expect(emailCalls[0][0].content).toContain('Follow-up on proposal');
    expect(emailCalls[0][0].tags).toContain('email');
    expect(emailCalls[0][0].tags).toContain('meeting-prep');
  });

  it('does not call mergeMemory when userEmail is absent', async () => {
    setupMocksForOneEvent();

    const result = await runHorizonScan({ selfDomain: 'mycompany.com' });

    expect(result.drafts).toHaveLength(1);
    expect(mockedMergeMemory).not.toHaveBeenCalled();
  });

  it('mergeMemory called with source toolName horizon_scanner', async () => {
    setupMocksForOneEvent();

    await runHorizonScan({
      selfDomain: 'mycompany.com',
      userEmail: 'me@mycompany.com',
    });

    for (const [input] of mockedMergeMemory.mock.calls) {
      expect(input.source.toolName).toBe('horizon_scanner');
      expect(input.source.type).toBe('auto_extraction');
    }
  });

  it('includes meetingId in metadata for all memory entries', async () => {
    setupMocksForOneEvent();

    await runHorizonScan({
      selfDomain: 'mycompany.com',
      userEmail: 'me@mycompany.com',
    });

    for (const [input] of mockedMergeMemory.mock.calls) {
      expect(input.metadata.meetingId).toBe('evt-memory-1');
    }
  });
});
