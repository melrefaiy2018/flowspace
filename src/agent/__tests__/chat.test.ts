import { describe, it, expect, vi, beforeEach } from 'vitest';
import { applyPersonaContentRules, buildAutomaticSuggestions, chunkText, toolLabel, updateToolEvent, verboseRunningLabel, verboseCompletedDetail } from '../chat-utils';
import { validateApprovalFields } from '../approval-runtime';
import type { ToolEvent } from '../../shared/chat';
import type { Persona } from '../../lib/persona';

describe('chunkText', () => {
  it('returns empty array for empty string', () => {
    expect(chunkText('')).toEqual([]);
    expect(chunkText('  ')).toEqual([]);
    expect(chunkText('\n\t')).toEqual([]);
  });

  it('returns single chunk for short text', () => {
    expect(chunkText('Hello world')).toEqual(['Hello world']);
  });

  it('returns single chunk for exactly 140 chars', () => {
    const text = 'A'.repeat(140);
    expect(chunkText(text)).toEqual([text]);
  });

  it('splits long text at word boundaries', () => {
    const words = Array.from({ length: 30 }, () => 'hello').join(' ');
    const chunks = chunkText(words);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(140);
    }
    // Rejoining should reconstruct the original
    expect(chunks.join(' ')).toBe(words);
  });

  it('handles text with no spaces by splitting at 140', () => {
    const text = 'A'.repeat(300);
    const chunks = chunkText(text);
    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toBe('A'.repeat(140));
    expect(chunks[1]).toBe('A'.repeat(140));
    expect(chunks[2]).toBe('A'.repeat(20));
  });

  it('trims leading/trailing whitespace', () => {
    expect(chunkText('  hello  ')).toEqual(['hello']);
  });

  it('preserves content across chunks', () => {
    const text = 'The quick brown fox jumps over the lazy dog. '.repeat(10).trim();
    const chunks = chunkText(text);
    const reconstructed = chunks.join(' ');
    expect(reconstructed).toBe(text);
  });
});

describe('toolLabel', () => {
  it('returns human-readable labels for known tools', () => {
    expect(toolLabel('search_drive')).toBe('Searching Drive');
    expect(toolLabel('search_emails')).toBe('Searching Gmail');
    expect(toolLabel('list_calendar_events')).toBe('Checking calendar');
    expect(toolLabel('send_email')).toBe('Preparing email');
    expect(toolLabel('calendar_agenda')).toBe('Loading agenda');
    expect(toolLabel('gmail_triage')).toBe('Triaging inbox');
    expect(toolLabel('sheets_read')).toBe('Reading spreadsheet');
    expect(toolLabel('sheets_create')).toBe('Creating spreadsheet');
    expect(toolLabel('sheets_update')).toBe('Preparing spreadsheet edit');
    expect(toolLabel('docs_write')).toBe('Preparing document edit');
    expect(toolLabel('archive_email_threads')).toBe('Preparing email archive');
    expect(toolLabel('trash_email_threads')).toBe('Preparing email delete');
  });

  it('returns "Running <name>" for unknown tools', () => {
    expect(toolLabel('unknown_tool')).toBe('Running unknown_tool');
    expect(toolLabel('custom_action')).toBe('Running custom_action');
  });
});

describe('updateToolEvent', () => {
  const base: ToolEvent = {
    id: 'call-1',
    toolName: 'search_drive',
    label: 'Searching Drive',
    status: 'running',
  };

  it('appends a new event to empty array', () => {
    const result = updateToolEvent([], base);
    expect(result).toEqual([base]);
  });

  it('appends event with unknown ID', () => {
    const existing: ToolEvent = { ...base, id: 'call-0' };
    const result = updateToolEvent([existing], base);
    expect(result).toHaveLength(2);
    expect(result[0]).toBe(existing);
    expect(result[1]).toBe(base);
  });

  it('replaces event with matching ID', () => {
    const updated = { ...base, status: 'completed' as const, detail: 'Done' };
    const result = updateToolEvent([base], updated);
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe('completed');
    expect(result[0].detail).toBe('Done');
  });

  it('does not mutate the original array', () => {
    const original = [base];
    const updated = { ...base, status: 'completed' as const };
    const result = updateToolEvent(original, updated);
    expect(result).not.toBe(original);
    expect(original[0].status).toBe('running');
  });

  it('replaces the correct event among multiple', () => {
    const events: ToolEvent[] = [
      { id: 'a', toolName: 'search_drive', label: 'Searching', status: 'completed' },
      { id: 'b', toolName: 'read_email', label: 'Reading', status: 'running' },
      { id: 'c', toolName: 'list_tasks', label: 'Tasks', status: 'pending' },
    ];
    const updated: ToolEvent = { id: 'b', toolName: 'read_email', label: 'Reading', status: 'completed', detail: 'Found email' };
    const result = updateToolEvent(events, updated);
    expect(result).toHaveLength(3);
    expect(result[0].id).toBe('a');
    expect(result[1]).toEqual(updated);
    expect(result[2].id).toBe('c');
  });
});

describe('verboseRunningLabel', () => {
  it('includes query for search tools', () => {
    expect(verboseRunningLabel('search_drive', { query: 'budget report' })).toBe('Searching Drive for "budget report"');
    expect(verboseRunningLabel('search_emails', { query: 'from:alice' })).toBe('Searching Gmail for "from:alice"');
  });

  it('includes message ID snippet for read_email', () => {
    const label = verboseRunningLabel('read_email', { message_id: '19cdbb121d92711a' });
    expect(label).toContain('19cdbb121d92');
  });

  it('includes event title for create_calendar_event', () => {
    expect(verboseRunningLabel('create_calendar_event', { summary: 'Team standup' })).toContain('Team standup');
  });

  it('includes title for sheets_create', () => {
    expect(verboseRunningLabel('sheets_create', { title: 'Budget 2026' })).toContain('Budget 2026');
  });

  it('includes range for sheets_update', () => {
    expect(verboseRunningLabel('sheets_update', { range: 'Sheet1!A1:C3' })).toContain('Sheet1!A1:C3');
  });

  it('falls back to toolLabel for unknown tools', () => {
    expect(verboseRunningLabel('unknown_tool', {})).toBe('Running unknown_tool');
  });

  it('describes trash_email_threads counts', () => {
    expect(verboseRunningLabel('trash_email_threads', { thread_ids: ['thread-1', 'thread-2'] })).toBe('Trashing 2 email threads');
  });
});

describe('verboseCompletedDetail', () => {
  it('counts search results', () => {
    expect(verboseCompletedDetail('search_emails', JSON.stringify({ messages: [{}, {}, {}] }))).toBe('Found 3 emails');
    expect(verboseCompletedDetail('search_drive', JSON.stringify({ files: [{}] }))).toBe('Found 1 file');
  });

  it('shows when Gmail search results were truncated', () => {
    expect(
      verboseCompletedDetail(
        'search_emails',
        JSON.stringify({ messages: [{}, {}, {}, {}, {}], resultSizeEstimate: 24, truncated: true }),
      ),
    ).toBe('Found 5 of about 24 emails');
  });

  it('shows email subject for read_email', () => {
    const detail = verboseCompletedDetail('read_email', JSON.stringify({ subject: 'Weekly Seminar' }));
    expect(detail).toContain('Weekly Seminar');
  });

  it('counts calendar events', () => {
    expect(verboseCompletedDetail('list_calendar_events', JSON.stringify({ items: [{}, {}] }))).toBe('2 upcoming events');
  });

  it('summarizes archived thread counts', () => {
    expect(verboseCompletedDetail('archive_email_threads', JSON.stringify({ archived: 3 }))).toBe('Archived 3 email threads');
  });

  it('summarizes trashed thread counts', () => {
    expect(
      verboseCompletedDetail('trash_email_threads', JSON.stringify({ succeeded_count: 3 })),
    ).toBe('Trashed 3 email threads');
  });

  it('handles empty results', () => {
    expect(verboseCompletedDetail('search_emails', JSON.stringify({ messages: [] }))).toBe('No emails found');
    expect(verboseCompletedDetail('search_drive', JSON.stringify({ files: [] }))).toBe('No files found');
  });

  it('handles errors gracefully', () => {
    expect(verboseCompletedDetail('search_emails', 'Error: rate limited')).toBe('Error: rate limited');
  });

  it('summarizes sheets_create result', () => {
    expect(
      verboseCompletedDetail('sheets_create', JSON.stringify({ properties: { title: 'Budget' } })),
    ).toContain('Budget');
  });

  it('summarizes sheets_update result', () => {
    expect(
      verboseCompletedDetail('sheets_update', JSON.stringify({ updatedCells: 6 })),
    ).toContain('6');
  });

  it('returns Done for unknown tools', () => {
    expect(verboseCompletedDetail('unknown_tool', '{}')).toBe('Done');
  });
});

describe('applyPersonaContentRules', () => {
  it('leaves content unchanged when no red deadline preference is set', () => {
    const content = 'Deadline: Mar 16, 2026';
    expect(applyPersonaContentRules(content, undefined)).toBe(content);
  });

  it('highlights deadline dates using !! syntax when requested by persona', () => {
    const persona: Persona = {
      name: 'Custom',
      tone: 'balanced',
      style: 'structured',
      role: 'assistant',
      customInstructions: 'Always mention deadline in bold red color',
    };
    const content = 'Deadline: Mar 16, 2026';
    expect(applyPersonaContentRules(content, persona)).toContain('!!Mar 16, 2026!!');
  });

  it('does not double-wrap when content is already emphasized', () => {
    const persona: Persona = {
      name: 'Custom',
      tone: 'balanced',
      style: 'structured',
      role: 'assistant',
      customInstructions: 'Always mention deadline in red',
    };
    const content = 'Deadline: !!Mar 16, 2026!!';
    expect(applyPersonaContentRules(content, persona)).toBe(content);
  });
});

describe('validateApprovalFields', () => {
  it('returns invalid when a required field is empty string', () => {
    const result = validateApprovalFields('send_email', { to: '', subject: 'hi', body: 'text' });
    expect(result.valid).toBe(false);
    expect(result.error).toContain('to');
  });

  it('returns invalid when a required field is whitespace only', () => {
    const result = validateApprovalFields('send_email', { to: '   ', subject: 'hi', body: 'text' });
    expect(result.valid).toBe(false);
    expect(result.error).toContain('to');
  });

  it('returns invalid when a required field is missing', () => {
    const result = validateApprovalFields('send_email', { subject: 'hi', body: 'text' });
    expect(result.valid).toBe(false);
    expect(result.error).toContain('to');
  });

  it('returns valid when all required fields are present and non-empty', () => {
    const result = validateApprovalFields('send_email', { to: 'a@b.com', subject: 'hi', body: 'text' });
    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('returns valid for an unknown tool (no validation rules defined)', () => {
    const result = validateApprovalFields('unknown_tool', {});
    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('validates create_calendar_event required fields', () => {
    const missingSummary = validateApprovalFields('create_calendar_event', { start_time: '2026-01-01T10:00:00Z' });
    expect(missingSummary.valid).toBe(false);
    expect(missingSummary.error).toContain('summary');

    const missingStart = validateApprovalFields('create_calendar_event', { summary: 'Meeting' });
    expect(missingStart.valid).toBe(false);
    expect(missingStart.error).toContain('start_time');

    const valid = validateApprovalFields('create_calendar_event', { summary: 'Meeting', start_time: '2026-01-01T10:00:00Z' });
    expect(valid.valid).toBe(true);
  });

  it('validates create_task required fields', () => {
    const missing = validateApprovalFields('create_task', {});
    expect(missing.valid).toBe(false);
    expect(missing.error).toContain('title');

    const valid = validateApprovalFields('create_task', { title: 'Buy groceries' });
    expect(valid.valid).toBe(true);
  });

  it('validates docs_write required fields', () => {
    const missing = validateApprovalFields('docs_write', { content: 'hello' });
    expect(missing.valid).toBe(false);
    expect(missing.error).toContain('doc_id');

    const valid = validateApprovalFields('docs_write', { doc_id: 'abc123', content: 'hello' });
    expect(valid.valid).toBe(true);
  });

  it('validates sheets_create required fields', () => {
    const missing = validateApprovalFields('sheets_create', {});
    expect(missing.valid).toBe(false);
    expect(missing.error).toContain('title');

    const valid = validateApprovalFields('sheets_create', { title: 'Budget' });
    expect(valid.valid).toBe(true);
  });
});

// ── T078: truncateMessages wiring ────────────────────────────────────────────

describe('truncateMessages integration', () => {
  it('T078: truncateMessages is exported from context-assembler with correct MAX_CONTEXT_TOKENS', async () => {
    // We import the exported constant and function from context-assembler
    const { truncateMessages, MAX_CONTEXT_TOKENS } = await import('../context-assembler');

    expect(typeof truncateMessages).toBe('function');
    expect(MAX_CONTEXT_TOKENS).toBe(100_000);
  });

  it('T078: truncateMessages drops oldest messages when over budget', async () => {
    const { truncateMessages } = await import('../context-assembler');

    // Create a large set of messages that exceed a tiny budget
    // Use string role to work with the generic overload
    const messages: Array<{ role: string; content: string }> = [
      { role: 'system', content: 'System prompt.' },
      { role: 'user', content: 'First user message.' },
      { role: 'assistant', content: 'First assistant response.' },
      { role: 'user', content: 'Second user message.' },
      { role: 'assistant', content: 'Second assistant response.' },
      { role: 'user', content: 'Final user message.' },
    ];

    // Budget of 20 tokens (very tight) — should force truncation
    const truncated = truncateMessages(messages, 20);

    expect(truncated.length).toBeLessThan(messages.length);
    // First message (system prompt) should always be preserved
    expect(truncated[0]).toEqual(messages[0]);
    // Last user message should be preserved
    const lastUser = truncated[truncated.length - 1];
    expect(lastUser.role).toBe('user');
    expect(lastUser.content).toBe('Final user message.');
  });
});

describe('buildAutomaticSuggestions', () => {
  it('adds expansion suggestions for truncated email search results', () => {
    const suggestions = buildAutomaticSuggestions({
      content: 'Found some matching emails.',
      toolEvents: [],
      blocks: [
        {
          type: 'email_list',
          title: 'Email matches (showing 5 of about 24)',
          items: [],
        },
      ],
    });

    expect(suggestions).toEqual([
      'Show more matching emails',
      'Expand search to 50 unread emails',
      'Narrow these results by sender or subject',
    ]);
  });

  it('does not add suggestions for non-truncated results', () => {
    const suggestions = buildAutomaticSuggestions({
      content: 'Found some matching emails.',
      toolEvents: [],
      blocks: [
        {
          type: 'email_list',
          title: 'Email matches',
          items: [],
        },
      ],
    });

    expect(suggestions).toEqual([]);
  });
});
