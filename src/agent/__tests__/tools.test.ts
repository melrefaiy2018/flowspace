import { describe, it, expect, vi, afterEach } from 'vitest';
import { parseJson, stripHtml, headerValue, isWriteTool, buildApprovalRequest, buildBlocksFromToolResult, decodeEntities, formatDate, getInboxActionsBaseUrl } from '../tools';

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.INBOX_ACTIONS_BASE_URL;
});

describe('parseJson', () => {
  it('parses valid JSON', () => {
    expect(parseJson('{"a":1}')).toEqual({ a: 1 });
    expect(parseJson('[1,2,3]')).toEqual([1, 2, 3]);
    expect(parseJson('"hello"')).toBe('hello');
    expect(parseJson('42')).toBe(42);
    expect(parseJson('null')).toBe(null);
  });

  it('returns null for invalid JSON', () => {
    expect(parseJson('')).toBe(null);
    expect(parseJson('{invalid')).toBe(null);
    expect(parseJson('undefined')).toBe(null);
    expect(parseJson("{'key': 'val'}")).toBe(null);
  });
});

describe('stripHtml', () => {
  it('removes HTML tags', () => {
    expect(stripHtml('<p>Hello</p>')).toBe('Hello');
    expect(stripHtml('<div><span>World</span></div>')).toBe('World');
  });

  it('removes style and script blocks', () => {
    expect(stripHtml('<style>.foo{color:red}</style>Hello')).toBe('Hello');
    expect(stripHtml('<script>alert("xss")</script>Content')).toBe('Content');
  });

  it('decodes HTML entities', () => {
    expect(stripHtml('a &amp; b')).toBe('a & b');
    expect(stripHtml('&lt;tag&gt;')).toBe('<tag>');
    expect(stripHtml('&quot;quoted&quot;')).toBe('"quoted"');
    expect(stripHtml('it&#39;s')).toBe("it's");
    expect(stripHtml('hello&nbsp;world')).toBe('hello world');
  });

  it('collapses whitespace', () => {
    expect(stripHtml('<p>hello</p>   <p>world</p>')).toBe('hello world');
  });

  it('trims result', () => {
    expect(stripHtml('  <b>hello</b>  ')).toBe('hello');
  });

  it('handles empty string', () => {
    expect(stripHtml('')).toBe('');
  });
});

describe('headerValue', () => {
  const headers = [
    { name: 'From', value: 'alice@example.com' },
    { name: 'Subject', value: 'Meeting notes' },
    { name: 'Content-Type', value: 'text/plain' },
  ];

  it('finds header by exact name', () => {
    expect(headerValue(headers, 'From')).toBe('alice@example.com');
    expect(headerValue(headers, 'Subject')).toBe('Meeting notes');
  });

  it('is case-insensitive', () => {
    expect(headerValue(headers, 'from')).toBe('alice@example.com');
    expect(headerValue(headers, 'SUBJECT')).toBe('Meeting notes');
    expect(headerValue(headers, 'content-type')).toBe('text/plain');
  });

  it('returns empty string for missing headers', () => {
    expect(headerValue(headers, 'Date')).toBe('');
    expect(headerValue(headers, 'X-Custom')).toBe('');
  });

  it('returns empty string for undefined headers', () => {
    expect(headerValue(undefined, 'From')).toBe('');
  });

  it('returns empty string for empty array', () => {
    expect(headerValue([], 'From')).toBe('');
  });
});

describe('isWriteTool', () => {
  it('returns true for write tools', () => {
    expect(isWriteTool('send_email')).toBe(true);
    expect(isWriteTool('create_calendar_event')).toBe(true);
    expect(isWriteTool('create_task')).toBe(true);
    expect(isWriteTool('create_drive_folder')).toBe(true);
    expect(isWriteTool('docs_write')).toBe(true);
    expect(isWriteTool('sheets_append')).toBe(true);
    expect(isWriteTool('sheets_create')).toBe(true);
    expect(isWriteTool('sheets_update')).toBe(true);
    expect(isWriteTool('drive_upload')).toBe(true);
    expect(isWriteTool('save_email_to_doc')).toBe(true);
    expect(isWriteTool('archive_email_threads')).toBe(true);
    expect(isWriteTool('trash_email_threads')).toBe(true);
  });

  it('returns false for read tools', () => {
    expect(isWriteTool('search_drive')).toBe(false);
    expect(isWriteTool('search_emails')).toBe(false);
    expect(isWriteTool('list_calendar_events')).toBe(false);
    expect(isWriteTool('read_email')).toBe(false);
    expect(isWriteTool('sheets_read')).toBe(false);
    expect(isWriteTool('gmail_triage')).toBe(false);
  });

  it('returns false for unknown tools', () => {
    expect(isWriteTool('unknown_tool')).toBe(false);
    expect(isWriteTool('')).toBe(false);
  });
});

describe('buildApprovalRequest', () => {
  it('builds send_email approval with correct fields', () => {
    const result = buildApprovalRequest('send_email', {
      to: 'bob@example.com',
      subject: 'Meeting',
      body: 'See you at 3pm',
    });
    expect(result.toolName).toBe('send_email');
    expect(result.title).toBeTruthy();
    expect(result.summary).toBeTruthy();
    expect(result.fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'to', value: 'bob@example.com' }),
      expect.objectContaining({ key: 'subject', value: 'Meeting' }),
      expect.objectContaining({ key: 'body', value: 'See you at 3pm' }),
    ]));
  });

  it('builds create_task approval with correct fields', () => {
    const result = buildApprovalRequest('create_task', {
      title: 'Follow up with Jane',
      notes: 'About the Q4 report',
    });
    expect(result.toolName).toBe('create_task');
    expect(result.title).toBeTruthy();
    expect(result.fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'title', value: 'Follow up with Jane' }),
    ]));
  });

  it('builds archive_email_threads approval with thread ids and count', () => {
    const result = buildApprovalRequest('archive_email_threads', {
      thread_ids: ['thread-1', 'thread-2'],
    });
    expect(result.toolName).toBe('archive_email_threads');
    expect(result.title).toContain('archive');
    expect(result.summary).toContain('2');
    expect(result.fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'thread_ids', value: 'thread-1, thread-2' }),
    ]));
  });

  it('builds trash_email_threads approval with trash wording', () => {
    const result = buildApprovalRequest('trash_email_threads', {
      thread_ids: ['thread-1', 'thread-2'],
    });
    expect(result.toolName).toBe('trash_email_threads');
    expect(result.title.toLowerCase()).toContain('trash');
    expect(result.summary).toContain('Trash');
    expect(result.fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'thread_ids', value: 'thread-1, thread-2' }),
    ]));
  });

  it('includes tool name in ID', () => {
    const r1 = buildApprovalRequest('send_email', { to: 'a@b.com' });
    expect(r1.id).toContain('send_email:');
    const r2 = buildApprovalRequest('create_task', { title: 'test' });
    expect(r2.id).toContain('create_task:');
  });

  it('builds sheets_create approval with title and optional values', () => {
    const result = buildApprovalRequest('sheets_create', {
      title: 'Applied Jobs Tracker',
      values: '[["Company","Position","Status"],["GSK","AI Engineer","Applied"]]',
    });
    expect(result.toolName).toBe('sheets_create');
    expect(result.title).toContain('spreadsheet');
    expect(result.fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'title', value: 'Applied Jobs Tracker' }),
      expect.objectContaining({ key: 'values' }),
    ]));
  });

  it('builds sheets_update approval with spreadsheet_id, range, and values', () => {
    const result = buildApprovalRequest('sheets_update', {
      spreadsheet_id: 'abc123',
      range: 'Sheet1!A1:C3',
      values: '[["A","B","C"]]',
    });
    expect(result.toolName).toBe('sheets_update');
    expect(result.title).toContain('spreadsheet');
    expect(result.fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'spreadsheet_id', value: 'abc123' }),
      expect.objectContaining({ key: 'range', value: 'Sheet1!A1:C3' }),
      expect.objectContaining({ key: 'values' }),
    ]));
  });

  it('has a confirm label', () => {
    const result = buildApprovalRequest('send_email', {});
    expect(result.confirmLabel).toBeTruthy();
  });
});

describe('getInboxActionsBaseUrl', () => {
  it('returns an empty base URL on localhost origins', () => {
    vi.stubGlobal('location', { origin: 'http://localhost:3000' });
    expect(getInboxActionsBaseUrl()).toBe('');
  });

  it('returns the local server URL for tauri origins', () => {
    vi.stubGlobal('location', { origin: 'tauri://localhost' });
    expect(getInboxActionsBaseUrl()).toBe('http://localhost:3000');
  });

  it('prefers the explicit override when configured', () => {
    process.env.INBOX_ACTIONS_BASE_URL = 'https://example.test';
    vi.stubGlobal('location', { origin: 'tauri://localhost' });
    expect(getInboxActionsBaseUrl()).toBe('https://example.test');
  });
});

describe('decodeEntities', () => {
  it('decodes all common HTML entities', () => {
    expect(decodeEntities('a &amp; b')).toBe('a & b');
    expect(decodeEntities('&lt;div&gt;')).toBe('<div>');
    expect(decodeEntities('&quot;hello&quot;')).toBe('"hello"');
    expect(decodeEntities("it&#39;s")).toBe("it's");
    expect(decodeEntities('a&nbsp;b')).toBe('a b');
  });

  it('handles strings with no entities', () => {
    expect(decodeEntities('plain text')).toBe('plain text');
  });

  it('handles empty string', () => {
    expect(decodeEntities('')).toBe('');
  });
});

describe('formatDate', () => {
  it('formats RFC 2822 dates', () => {
    const result = formatDate('Mon, 9 Mar 2026 19:28:13 +0000');
    expect(result).toMatch(/Mar/);
    expect(result).not.toContain('+0000');
  });

  it('formats ISO dates', () => {
    const result = formatDate('2026-03-11T05:59:11.710Z');
    expect(result).toMatch(/Mar/);
    expect(result).not.toContain('T');
  });

  it('returns raw string for unparseable dates', () => {
    expect(formatDate('not a date')).toBe('not a date');
    expect(formatDate('')).toBe('');
  });
});

describe('buildBlocksFromToolResult', () => {
  it('renders archive_email_threads success as a status block', () => {
    const raw = JSON.stringify({
      archived: 2,
      thread_ids: ['thread-1', 'thread-2'],
    });
    const blocks = buildBlocksFromToolResult('archive_email_threads', raw);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toEqual(expect.objectContaining({
      type: 'status',
      title: 'Threads archived',
    }));
    expect((blocks[0] as any).body).toContain('2');
  });

  it('renders trash_email_threads success as a status block', () => {
    const raw = JSON.stringify({
      action_type: 'trash_threads',
      requested_count: 2,
      succeeded_count: 2,
      failed_count: 0,
      undo_available: false,
      items: [
        { thread_id: 'thread-1', sender: 'Alice', subject: 'One', status: 'completed' },
        { thread_id: 'thread-2', sender: 'Bob', subject: 'Two', status: 'completed' },
      ],
      message: 'Completed 2 actions.',
    });
    const blocks = buildBlocksFromToolResult('trash_email_threads', raw);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toEqual(expect.objectContaining({
      type: 'status',
      title: 'Inbox action completed',
    }));
    expect((blocks[1] as any).actionType).toBe('trash_threads');
    expect((blocks[1] as any).effect).toContain('Trash');
  });

  describe('search_emails — snippet sanitization', () => {
    it('strips HTML entities from email snippets', () => {
      const raw = JSON.stringify({
        messages: [
          {
            id: 'msg1',
            from: 'Alice &lt;alice@example.com&gt;',
            subject: 'Test &amp; Demo',
            snippet: 'From: Peterson, Alyssa A &lt;Alyssa.Peterson@austin.utexas.edu&gt; Sent: Monday',
            date: 'Mon, 9 Mar 2026 19:28:13 +0000',
          },
        ],
      });
      const blocks = buildBlocksFromToolResult('search_emails', raw);
      expect(blocks).toHaveLength(1);
      expect(blocks[0].type).toBe('email_list');
      const items = (blocks[0] as any).items;
      expect(items[0].title).toBe('Test & Demo');
      expect(items[0].subtitle).toBe('Alice <alice@example.com>');
      expect(items[0].meta).not.toContain('&lt;');
      expect(items[0].meta).not.toContain('&gt;');
      expect(items[0].meta).not.toContain('&amp;');
    });

    it('handles clean snippets without double-decoding', () => {
      const raw = JSON.stringify({
        messages: [
          { id: 'msg2', from: 'Bob', subject: 'Clean subject', snippet: 'No entities here', date: '2026-03-10' },
        ],
      });
      const blocks = buildBlocksFromToolResult('search_emails', raw);
      const items = (blocks[0] as any).items;
      expect(items[0].meta).toBe('No entities here');
    });

    it('shows when only the first page of matching emails is displayed', () => {
      const raw = JSON.stringify({
        messages: [
          { id: 'msg1', from: 'Alice', subject: 'One', snippet: 'A' },
          { id: 'msg2', from: 'Bob', subject: 'Two', snippet: 'B' },
          { id: 'msg3', from: 'Carol', subject: 'Three', snippet: 'C' },
          { id: 'msg4', from: 'Dan', subject: 'Four', snippet: 'D' },
          { id: 'msg5', from: 'Eve', subject: 'Five', snippet: 'E' },
        ],
        resultSizeEstimate: 24,
        truncated: true,
      });
      const blocks = buildBlocksFromToolResult('search_emails', raw);
      expect(blocks[0]).toEqual(expect.objectContaining({
        type: 'email_list',
        title: 'Email matches (showing 5 of about 24)',
      }));
    });
  });

  describe('search_drive — deduplication by file ID', () => {
    it('deduplicates files with the same ID', () => {
      const raw = JSON.stringify({
        files: [
          { id: 'file1', name: 'TMI Notes', mimeType: 'application/vnd.google-apps.document', modifiedTime: '2026-03-11T05:59:11Z', webViewLink: 'https://docs.google.com/d/file1' },
          { id: 'file1', name: 'TMI Notes', mimeType: 'application/vnd.google-apps.document', modifiedTime: '2026-03-11T05:51:49Z', webViewLink: 'https://docs.google.com/d/file1' },
          { id: 'file2', name: 'Another Doc', mimeType: 'application/vnd.google-apps.document', modifiedTime: '2026-03-10T12:00:00Z', webViewLink: 'https://docs.google.com/d/file2' },
        ],
      });
      const blocks = buildBlocksFromToolResult('search_drive', raw);
      expect(blocks).toHaveLength(1);
      const items = (blocks[0] as any).items;
      expect(items).toHaveLength(2);
      expect(items[0].title).toBe('TMI Notes');
      expect(items[1].title).toBe('Another Doc');
    });

    it('keeps first occurrence when deduplicating', () => {
      const raw = JSON.stringify({
        files: [
          { id: 'f1', name: 'Doc v2', modifiedTime: '2026-03-11T06:00:00Z' },
          { id: 'f1', name: 'Doc v1', modifiedTime: '2026-03-11T05:00:00Z' },
        ],
      });
      const blocks = buildBlocksFromToolResult('search_drive', raw);
      const items = (blocks[0] as any).items;
      expect(items).toHaveLength(1);
      expect(items[0].title).toBe('Doc v2');
    });
  });

  describe('read_email — date formatting and body dedup', () => {
    it('formats raw RFC 2822 dates to human-readable format', () => {
      const raw = JSON.stringify({
        from: 'alice@example.com',
        subject: 'Test',
        date: 'Mon, 9 Mar 2026 19:28:13 +0000',
        body: 'Hello world',
      });
      const blocks = buildBlocksFromToolResult('read_email', raw);
      const factList = blocks.find((b) => b.type === 'fact_list');
      expect(factList).toBeDefined();
      const dateItem = (factList as any).items.find((i: any) => i.label === 'Date');
      expect(dateItem).toBeDefined();
      // Should be formatted, not raw RFC 2822
      expect(dateItem.value).not.toContain('+0000');
      expect(dateItem.value).toMatch(/Mar/);
    });

    it('skips the body status block when body matches snippet', () => {
      const raw = JSON.stringify({
        from: 'alice@example.com',
        subject: 'Test',
        date: 'Mon, 9 Mar 2026 19:28:13 +0000',
        snippet: 'Join us for the seminar',
        body: 'Join us for the seminar',
      });
      const blocks = buildBlocksFromToolResult('read_email', raw);
      const statusBlocks = blocks.filter((b) => b.type === 'status');
      expect(statusBlocks).toHaveLength(0);
    });

    it('shows body block when body has substantially more content than snippet', () => {
      const raw = JSON.stringify({
        from: 'alice@example.com',
        subject: 'Test',
        date: 'Mon, 9 Mar 2026 19:28:13 +0000',
        snippet: 'Join us for the seminar',
        body: 'Join us for the seminar this Wednesday. Dr. Sharon Hammes-Schiffer will present on electron transfer. The talk is in EER 1.528 from 12-1pm. Lunch will be provided.',
      });
      const blocks = buildBlocksFromToolResult('read_email', raw);
      const statusBlocks = blocks.filter((b) => b.type === 'status');
      expect(statusBlocks).toHaveLength(1);
    });
  });

  describe('sheets_create — renders spreadsheet creation result', () => {
    it('shows spreadsheet title, ID, and URL in status block', () => {
      const raw = JSON.stringify({
        spreadsheetId: 'abc123',
        properties: { title: 'Applied Jobs Tracker' },
        spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/abc123',
      });
      const blocks = buildBlocksFromToolResult('sheets_create', raw);
      expect(blocks).toHaveLength(1);
      expect(blocks[0]).toEqual(expect.objectContaining({
        type: 'status',
        title: 'Spreadsheet created',
      }));
      expect((blocks[0] as any).body).toContain('Applied Jobs Tracker');
      expect((blocks[0] as any).body).toContain('abc123');
      expect((blocks[0] as any).body).toContain('https://docs.google.com/spreadsheets/d/abc123');
    });

    it('shows generic message when title is missing', () => {
      const raw = JSON.stringify({ spreadsheetId: 'abc123' });
      const blocks = buildBlocksFromToolResult('sheets_create', raw);
      expect(blocks).toHaveLength(1);
      expect((blocks[0] as any).body).toContain('created');
      expect((blocks[0] as any).body).toContain('abc123');
    });
  });

  describe('sheets_update — renders cell update result', () => {
    it('shows updated cell count in status block', () => {
      const raw = JSON.stringify({
        updatedCells: 6,
        updatedRange: 'Sheet1!A1:C2',
        updatedRows: 2,
        updatedColumns: 3,
      });
      const blocks = buildBlocksFromToolResult('sheets_update', raw);
      expect(blocks).toHaveLength(1);
      expect(blocks[0]).toEqual(expect.objectContaining({
        type: 'status',
        title: 'Spreadsheet updated',
      }));
      expect((blocks[0] as any).body).toContain('6');
    });

    it('shows generic success message when counts are missing', () => {
      const raw = JSON.stringify({});
      const blocks = buildBlocksFromToolResult('sheets_update', raw);
      expect(blocks).toHaveLength(1);
      expect((blocks[0] as any).body).toContain('updated');
    });
  });
});
