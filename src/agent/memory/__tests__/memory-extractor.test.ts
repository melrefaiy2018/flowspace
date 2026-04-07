import { describe, it, expect, vi, beforeEach } from 'vitest';
import { extractFromToolResult, type ToolResultInfo } from '../memory-extractor';
import type { MemoryEntry } from '../memory-types';
import { loadMemories, getMemories, resetMemoryStore, setMemoryFileIO, type MemoryFileIO } from '../memory-store';

function createMockFileIO(): MemoryFileIO &{ written: string | null; seed: (data: string) => void } {
  const state = { content: null as string | null, written: null as string | null };
  return {
    get written() { return state.written; },
    exists: vi.fn(() => state.content !== null),
    read: vi.fn(() => state.content ?? ''),
    write: vi.fn((_path: string, data: string) => { state.content = data; state.written = data; }),
    rename: vi.fn(),
    getFilePath: () => '/mock/.memory/test-user.json',
    seed(data: string) { state.content = data; },
  } as MemoryFileIO & { written: string | null; seed: (data: string) => void };
}

let mockIO: ReturnType<typeof createMockFileIO>;

beforeEach(() => {
  mockIO = createMockFileIO();
  setMemoryFileIO(mockIO, 'test-user');
  resetMemoryStore();
});

describe('extractFromToolResult', () => {
  describe('sheets_create', () => {
    it('should extract resource memory from successful spreadsheet creation', () => {
      const toolResult: ToolResultInfo = {
        toolName: 'sheets_create',
        args: { title: 'Job Applications' },
        result: JSON.stringify({
          spreadsheetId: 'abc123',
          spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/abc123',
          properties: { title: 'Job Applications' },
        }),
      };

      const memories = extractFromToolResult(toolResult);

      expect(memories).toHaveLength(1);
      expect(memories[0].category).toBe('resource');
      expect(memories[0].content).toBe('Job Applications spreadsheet');
      expect(memories[0].resourceIds).toEqual(['abc123']);
      expect(memories[0].metadata.spreadsheetId).toBe('abc123');
      expect(memories[0].metadata.url).toBe('https://docs.google.com/spreadsheets/d/abc123');
      expect(memories[0].tags).toContain('spreadsheet');
      expect(memories[0].source.type).toBe('auto_extraction');
    });

    it('should return empty array for error result', () => {
      const toolResult: ToolResultInfo = {
        toolName: 'sheets_create',
        args: { title: 'Test' },
        result: 'Error: Could not create spreadsheet',
      };

      const memories = extractFromToolResult(toolResult);
      expect(memories).toEqual([]);
    });
  });

  describe('send_email', () => {
    it('should extract fact memory from sent email', () => {
      const toolResult: ToolResultInfo = {
        toolName: 'send_email',
        args: { to: 'recruiter@amazon.com', subject: 'Re: SDE II Position', body: 'Thanks for reaching out...' },
        result: JSON.stringify({ id: 'msg-123', threadId: 'thread-abc' }),
      };

      const memories = extractFromToolResult(toolResult);

      expect(memories).toHaveLength(1);
      expect(memories[0].category).toBe('fact');
      expect(memories[0].content).toContain('amazon.com');
      expect(memories[0].tags).toContain('email');
    });
  });

  describe('create_calendar_event', () => {
    it('should extract fact memory from created event', () => {
      const toolResult: ToolResultInfo = {
        toolName: 'create_calendar_event',
        args: { summary: 'Weekly standup', start_time: '2026-03-17T10:00:00-06:00', end_time: '2026-03-17T10:30:00-06:00' },
        result: JSON.stringify({ id: 'evt-123', summary: 'Weekly standup', htmlLink: 'https://calendar.google.com/...' }),
      };

      const memories = extractFromToolResult(toolResult);

      expect(memories).toHaveLength(1);
      expect(memories[0].category).toBe('fact');
      expect(memories[0].content).toContain('Weekly standup');
      expect(memories[0].tags).toContain('calendar');
    });
  });

  describe('create_task', () => {
    it('should extract fact memory from created task', () => {
      const toolResult: ToolResultInfo = {
        toolName: 'create_task',
        args: { title: 'Review PR from Alice', due: '2026-03-20T00:00:00Z' },
        result: JSON.stringify({ id: 'task-123', title: 'Review PR from Alice', selfLink: 'https://tasks.googleapis.com/...' }),
      };

      const memories = extractFromToolResult(toolResult);

      expect(memories).toHaveLength(1);
      expect(memories[0].category).toBe('fact');
      expect(memories[0].content).toContain('Review PR from Alice');
      expect(memories[0].tags).toContain('task');
    });
  });

  describe('create_drive_folder', () => {
    it('should extract resource memory from created folder', () => {
      const toolResult: ToolResultInfo = {
        toolName: 'create_drive_folder',
        args: { name: 'Project Documents' },
        result: JSON.stringify({ id: 'folder-123', name: 'Project Documents', webViewLink: 'https://drive.google.com/drive/folders/folder-123' }),
      };

      const memories = extractFromToolResult(toolResult);

      expect(memories).toHaveLength(1);
      expect(memories[0].category).toBe('resource');
      expect(memories[0].content).toContain('Project Documents');
      expect(memories[0].resourceIds).toEqual(['folder-123']);
      expect(memories[0].tags).toContain('drive');
      expect(memories[0].tags).toContain('folder');
    });
  });

  describe('docs_write', () => {
    it('should extract resource memory for document edits', () => {
      const toolResult: ToolResultInfo = {
        toolName: 'docs_write',
        args: { doc_id: 'doc-123', content: 'Meeting notes from sync', mode: 'append' },
        result: JSON.stringify({ documentId: 'doc-123', title: 'Meeting Notes' }),
      };

      const memories = extractFromToolResult(toolResult);

      expect(memories).toHaveLength(1);
      expect(memories[0].category).toBe('resource');
      expect(memories[0].content).toContain('Meeting Notes');
      expect(memories[0].resourceIds).toEqual(['doc-123']);
    });
  });

  describe('sheets_append', () => {
    it('should extract resource memory from spreadsheet append', () => {
      const toolResult: ToolResultInfo = {
        toolName: 'sheets_append',
        args: { spreadsheet_id: 'sheet-123', range: 'Sheet1!A2:D2', values: [['Amazon', 'SDE II', '2026-03-17', 'Applied']] },
        result: JSON.stringify({ updates: { updatedRows: 1 } }),
      };

      const memories = extractFromToolResult(toolResult);

      expect(memories).toHaveLength(1);
      expect(memories[0].category).toBe('resource');
      expect(memories[0].content).toContain('appended 1 row');
      expect(memories[0].resourceIds).toEqual(['sheet-123']);
      expect(memories[0].tags).toContain('spreadsheet');
      expect(memories[0].metadata.spreadsheetId).toBe('sheet-123');
    });

    it('should return empty when no spreadsheet_id in args', () => {
      const toolResult: ToolResultInfo = {
        toolName: 'sheets_append',
        args: { range: 'Sheet1!A2:D2', values: [[]] },
        result: JSON.stringify({ updates: { updatedRows: 1 } }),
      };

      expect(extractFromToolResult(toolResult)).toEqual([]);
    });
  });

  describe('sheets_update', () => {
    it('should extract resource memory from spreadsheet update', () => {
      const toolResult: ToolResultInfo = {
        toolName: 'sheets_update',
        args: { spreadsheet_id: 'sheet-123', range: 'Sheet1!A1', values: [['Updated']] },
        result: JSON.stringify({ updatedCells: 1 }),
      };

      const memories = extractFromToolResult(toolResult);

      expect(memories).toHaveLength(1);
      expect(memories[0].category).toBe('resource');
      expect(memories[0].content).toContain('updated 1 cell');
      expect(memories[0].resourceIds).toEqual(['sheet-123']);
      expect(memories[0].tags).toContain('spreadsheet');
    });

    it('should return empty when no spreadsheet_id in args', () => {
      const toolResult: ToolResultInfo = {
        toolName: 'sheets_update',
        args: { range: 'Sheet1!A1', values: [[]] },
        result: JSON.stringify({ updatedCells: 1 }),
      };

      expect(extractFromToolResult(toolResult)).toEqual([]);
    });
  });

  describe('drive_upload', () => {
    it('should extract resource memory for uploaded file', () => {
      const toolResult: ToolResultInfo = {
        toolName: 'drive_upload',
        args: { file_path: '/home/user/report.pdf', parent_id: 'folder-123' },
        result: JSON.stringify({ id: 'file-456', name: 'report.pdf', webViewLink: 'https://drive.google.com/file/d/file-456' }),
      };

      const memories = extractFromToolResult(toolResult);

      expect(memories).toHaveLength(1);
      expect(memories[0].category).toBe('resource');
      expect(memories[0].content).toContain('report.pdf');
      expect(memories[0].resourceIds).toEqual(['file-456']);
    });
  });

  describe('save_email_to_doc', () => {
    it('should extract fact memory for email archival', () => {
      const toolResult: ToolResultInfo = {
        toolName: 'save_email_to_doc',
        args: { thread_id: 'thread-abc' },
        result: JSON.stringify({ docId: 'doc-789', docUrl: 'https://docs.google.com/document/d/doc-789' }),
      };

      const memories = extractFromToolResult(toolResult);

      expect(memories).toHaveLength(1);
      expect(memories[0].category).toBe('fact');
      expect(memories[0].tags).toContain('email');
      expect(memories[0].tags).toContain('archive');
    });
  });

  describe('unknown tools', () => {
    it('should return empty array for unknown tool', () => {
      const toolResult: ToolResultInfo = {
        toolName: 'unknown_tool',
        args: {},
        result: 'Some result',
      };

      const memories = extractFromToolResult(toolResult);
      expect(memories).toEqual([]);
    });
  });

  describe('error results', () => {
    it('should return empty array when result starts with Error:', () => {
      const toolResult: ToolResultInfo = {
        toolName: 'sheets_create',
        args: { title: 'Test' },
        result: 'Error: Spreadsheet creation failed',
      };

      const memories = extractFromToolResult(toolResult);
      expect(memories).toEqual([]);
    });
  });

  describe('empty results', () => {
    it('should handle empty JSON result gracefully', () => {
      const toolResult: ToolResultInfo = {
        toolName: 'sheets_create',
        args: { title: 'Test' },
        result: '{}',
      };

      const memories = extractFromToolResult(toolResult);
      expect(memories).toEqual([]);
    });

    it('should handle non-JSON result gracefully', () => {
      const toolResult: ToolResultInfo = {
        toolName: 'send_email',
        args: { to: 'test@example.com' },
        result: 'Success',
      };

      const memories = extractFromToolResult(toolResult);
      expect(memories).toEqual([]);
    });
  });

  describe('search_drive', () => {
    it('should extract resource memories from Drive search results', () => {
      const toolResult: ToolResultInfo = {
        toolName: 'search_drive',
        args: { query: 'job tracking' },
        result: JSON.stringify({
          files: [
            { id: 'file-1', name: 'Job Applications Tracker', mimeType: 'application/vnd.google-apps.spreadsheet', webViewLink: 'https://docs.google.com/spreadsheets/d/file-1' },
            { id: 'file-2', name: 'Resume 2026', mimeType: 'application/vnd.google-apps.document', webViewLink: 'https://docs.google.com/document/d/file-2' },
          ],
        }),
      };

      const memories = extractFromToolResult(toolResult);

      expect(memories).toHaveLength(2);
      expect(memories[0].category).toBe('resource');
      expect(memories[0].content).toContain('Job Applications Tracker');
      expect(memories[0].content).toContain('spreadsheet');
      expect(memories[0].resourceIds).toEqual(['file-1']);
      expect(memories[0].tags).toContain('spreadsheet');
      expect(memories[0].tags).toContain('job');

      expect(memories[1].category).toBe('resource');
      expect(memories[1].content).toContain('Resume 2026');
      expect(memories[1].resourceIds).toEqual(['file-2']);
    });

    it('should return empty for no results', () => {
      const toolResult: ToolResultInfo = {
        toolName: 'search_drive',
        args: { query: 'nonexistent' },
        result: JSON.stringify({ files: [] }),
      };

      expect(extractFromToolResult(toolResult)).toEqual([]);
    });

    it('should cap at 3 results to avoid noise', () => {
      const files = Array.from({ length: 10 }, (_, i) => ({
        id: `file-${i}`, name: `File ${i}`, mimeType: 'application/pdf', webViewLink: `https://example.com/${i}`,
      }));
      const toolResult: ToolResultInfo = {
        toolName: 'search_drive',
        args: { query: 'test' },
        result: JSON.stringify({ files }),
      };

      expect(extractFromToolResult(toolResult)).toHaveLength(3);
    });
  });

  describe('sheets_read', () => {
    it('should extract resource memory from spreadsheet read', () => {
      const toolResult: ToolResultInfo = {
        toolName: 'sheets_read',
        args: { spreadsheet_id: 'abc123' },
        result: JSON.stringify({ title: 'Job Tracker', range: 'Sheet1!A1:E10', values: [['Company', 'Role']] }),
      };

      const memories = extractFromToolResult(toolResult);

      expect(memories).toHaveLength(1);
      expect(memories[0].category).toBe('resource');
      expect(memories[0].content).toContain('Job Tracker');
      expect(memories[0].resourceIds).toEqual(['abc123']);
      expect(memories[0].metadata).toMatchObject({ spreadsheetId: 'abc123', title: 'Job Tracker' });
    });

    it('should return empty when no spreadsheet_id', () => {
      const toolResult: ToolResultInfo = {
        toolName: 'sheets_read',
        args: {},
        result: JSON.stringify({ values: [] }),
      };

      expect(extractFromToolResult(toolResult)).toEqual([]);
    });
  });

  describe('archive_email_threads', () => {
    it('should extract fact memory for email archival', () => {
      const toolResult: ToolResultInfo = {
        toolName: 'archive_email_threads',
        args: { thread_ids: ['thread-1', 'thread-2'] },
        result: JSON.stringify({ succeeded_count: 2, failed_count: 0 }),
      };

      const memories = extractFromToolResult(toolResult);

      expect(memories).toHaveLength(1);
      expect(memories[0].category).toBe('fact');
      expect(memories[0].content).toContain('2 email thread');
      expect(memories[0].tags).toContain('email');
    });
  });
});