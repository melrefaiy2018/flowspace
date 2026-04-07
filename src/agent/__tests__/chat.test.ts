import { describe, it, expect } from 'vitest';
import { applyPersonaContentRules, buildAutomaticSuggestions, chunkText, toolLabel, updateToolEvent, verboseRunningLabel, verboseCompletedDetail } from '../chat';
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
