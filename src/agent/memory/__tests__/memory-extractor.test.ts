import { describe, it, expect } from 'vitest';
import {
  extractFromToolResult,
  extractResourceIds,
  summarizeArgs,
} from '../memory-extractor';
import type { ToolResultInfo } from '../memory-extractor';

// ---------------------------------------------------------------------------
// extractFromToolResult — default (unknown tool) fallback
// ---------------------------------------------------------------------------

describe('extractFromToolResult — default fallback for unknown tools', () => {
  it('returns a fact-category entry for an unknown tool name', () => {
    const info: ToolResultInfo = {
      toolName: 'unknown_future_tool',
      args: { query: 'test query', limit: 5 },
      result: JSON.stringify({ status: 'ok', count: 2 }),
    };

    const results = extractFromToolResult(info);

    expect(results).toHaveLength(1);
    const entry = results[0];
    expect(entry.category).toBe('fact');
    expect(entry.content).toContain('unknown_future_tool');
    expect(entry.tags).toContain('unknown_future_tool');
    expect(entry.source.type).toBe('auto_extraction');
    expect(entry.source.toolName).toBe('unknown_future_tool');
  });

  it('includes metadata with toolName and timestamp', () => {
    const info: ToolResultInfo = {
      toolName: 'custom_tool',
      args: { fileId: 'abc123' },
      result: JSON.stringify({ success: true }),
    };

    const results = extractFromToolResult(info);

    expect(results).toHaveLength(1);
    const { metadata } = results[0];
    expect(metadata.toolName).toBe('custom_tool');
    expect(typeof metadata.timestamp).toBe('string');
  });

  it('extracts resourceIds from args for unknown tools', () => {
    const info: ToolResultInfo = {
      toolName: 'mystery_tool',
      args: { fileId: 'file-xyz', threadId: 'thread-abc' },
      result: JSON.stringify({ ok: true }),
    };

    const results = extractFromToolResult(info);

    expect(results[0].resourceIds).toContain('file-xyz');
    expect(results[0].resourceIds).toContain('thread-abc');
  });

  it('returns empty array when result is an Error string', () => {
    const info: ToolResultInfo = {
      toolName: 'unknown_tool',
      args: {},
      result: 'Error: something went wrong',
    };

    expect(extractFromToolResult(info)).toEqual([]);
  });

  it('returns empty array when result is not valid JSON', () => {
    const info: ToolResultInfo = {
      toolName: 'unknown_tool',
      args: {},
      result: 'not json at all',
    };

    expect(extractFromToolResult(info)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// extractFromToolResult — known tool (search_drive) uses specific extractor
// ---------------------------------------------------------------------------

describe('extractFromToolResult — known tool uses specific extractor', () => {
  it('uses the search_drive extractor, not the generic fallback', () => {
    const info: ToolResultInfo = {
      toolName: 'search_drive',
      args: { query: 'budget' },
      result: JSON.stringify({
        files: [
          { id: 'file1', name: 'Budget 2024', mimeType: 'application/vnd.google-apps.spreadsheet', webViewLink: 'https://drive.google.com/file1' },
        ],
      }),
    };

    const results = extractFromToolResult(info);

    expect(results).toHaveLength(1);
    expect(results[0].category).toBe('resource');
    expect(results[0].content).toContain('Budget 2024');
    // search_drive specific metadata
    expect(results[0].metadata.fileId).toBe('file1');
  });
});

// ---------------------------------------------------------------------------
// extractResourceIds
// ---------------------------------------------------------------------------

describe('extractResourceIds', () => {
  it('extracts well-known ID keys', () => {
    const args = {
      fileId: 'f1',
      spreadsheetId: 's1',
      docId: 'd1',
      threadId: 't1',
      eventId: 'e1',
    };
    const ids = extractResourceIds(args);
    expect(ids).toContain('f1');
    expect(ids).toContain('s1');
    expect(ids).toContain('d1');
    expect(ids).toContain('t1');
    expect(ids).toContain('e1');
  });

  it('extracts generic "id" key', () => {
    const ids = extractResourceIds({ id: 'generic-id', name: 'something' });
    expect(ids).toContain('generic-id');
  });

  it('extracts keys ending in Id (camelCase)', () => {
    const ids = extractResourceIds({ folderId: 'folder-1', randomId: 'rand-1' });
    expect(ids).toContain('folder-1');
    expect(ids).toContain('rand-1');
  });

  it('extracts keys ending in _id (snake_case)', () => {
    const ids = extractResourceIds({ task_id: 'task-1', message_id: 'msg-1' });
    expect(ids).toContain('task-1');
    expect(ids).toContain('msg-1');
  });

  it('skips empty string values', () => {
    const ids = extractResourceIds({ fileId: '', docId: 'valid' });
    expect(ids).not.toContain('');
    expect(ids).toContain('valid');
  });

  it('skips non-string values', () => {
    const ids = extractResourceIds({ fileId: 42 as unknown as string, docId: null as unknown as string });
    expect(ids).toHaveLength(0);
  });

  it('returns empty array when no ID keys found', () => {
    const ids = extractResourceIds({ query: 'budget', limit: 5 });
    expect(ids).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// summarizeArgs
// ---------------------------------------------------------------------------

describe('summarizeArgs', () => {
  it('returns JSON string for short args', () => {
    const result = summarizeArgs({ key: 'value' }, 200);
    expect(result).toBe(JSON.stringify({ key: 'value' }));
  });

  it('truncates to maxLen and appends ...', () => {
    const args = { a: 'a'.repeat(200) };
    const result = summarizeArgs(args, 50);
    expect(result.length).toBe(53); // 50 chars + '...'
    expect(result.endsWith('...')).toBe(true);
  });

  it('does not append ... when not truncated', () => {
    const result = summarizeArgs({ x: 1 }, 100);
    expect(result.endsWith('...')).toBe(false);
  });
});
