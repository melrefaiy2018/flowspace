import type { MemoryCategory, MemoryEntry, MemorySource } from './memory-types';

export interface ExtractedMemory {
  category: MemoryCategory;
  content: string;
  tags: string[];
  metadata: Record<string, unknown>;
  resourceIds?: string[];
  source: MemorySource;
}

export interface ToolResultInfo {
  toolName: string;
  args: Record<string, unknown>;
  result: string;
}

function parseJsonSafe(text: string): unknown | null {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function extractTagsFromText(text: string): string[] {
  const words = text.toLowerCase().split(/\s+/);
  const stopWords = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by']);
  return words
    .filter((w) => w.length > 2 && !stopWords.has(w))
    .slice(0, 5);
}

function mimeToResourceLabel(mimeType: string): string {
  if (mimeType.includes('spreadsheet')) return 'spreadsheet';
  if (mimeType.includes('document')) return 'document';
  if (mimeType.includes('presentation')) return 'presentation';
  if (mimeType.includes('folder')) return 'folder';
  if (mimeType.includes('pdf')) return 'pdf';
  return 'file';
}

/** Extract memories from Drive search results — remembers files the user explicitly searched for. */
function extractSearchDrive(result: unknown, args: Record<string, unknown>): ExtractedMemory[] {
  const data = result as { files?: Array<{ id?: string; name?: string; mimeType?: string; webViewLink?: string }> } | null;
  if (!data?.files || data.files.length === 0) return [];

  const query = String(args.query || '');
  const memories: ExtractedMemory[] = [];

  // Only memorize the first 3 results to avoid noise
  for (const file of data.files.slice(0, 3)) {
    if (!file.id || !file.name) continue;
    const label = mimeToResourceLabel(file.mimeType || '');
    memories.push({
      category: 'resource',
      content: `${file.name} (${label})`,
      tags: [...extractTagsFromText(file.name), label, ...(query ? extractTagsFromText(query) : [])],
      metadata: { fileId: file.id, name: file.name, mimeType: file.mimeType, url: file.webViewLink },
      resourceIds: [file.id],
      source: { type: 'auto_extraction', toolName: 'search_drive' },
    });
  }

  return memories;
}

/** Extract memory from sheets_read — remembers the spreadsheet that was read. */
function extractSheetsRead(result: unknown, args: Record<string, unknown>): ExtractedMemory | null {
  const spreadsheetId = String(args.spreadsheet_id || '');
  if (!spreadsheetId) return null;

  const data = result as { title?: string; range?: string; values?: unknown[][] } | null;
  const title = data?.title || 'Spreadsheet';
  const url = `https://docs.google.com/spreadsheets/d/${spreadsheetId}`;

  return {
    category: 'resource',
    content: `${title} spreadsheet`,
    tags: [...extractTagsFromText(title), 'spreadsheet'],
    metadata: { spreadsheetId, url, title },
    resourceIds: [spreadsheetId],
    source: { type: 'auto_extraction', toolName: 'sheets_read' },
  };
}

function extractSheetsCreate(result: unknown, args: Record<string, unknown>): ExtractedMemory | null {
  const data = result as { spreadsheetId?: string; spreadsheetUrl?: string; properties?: { title?: string } } | null;
  if (!data?.spreadsheetId) return null;

  const title = data.properties?.title || String(args.title || 'Untitled');
  const spreadsheetId = data.spreadsheetId;
  const url = data.spreadsheetUrl || `https://docs.google.com/spreadsheets/d/${spreadsheetId}`;

  return {
    category: 'resource',
    content: `${title} spreadsheet`,
    tags: [...extractTagsFromText(title), 'spreadsheet'],
    metadata: { spreadsheetId, url, title },
    resourceIds: [spreadsheetId],
    source: { type: 'auto_extraction', toolName: 'sheets_create' },
  };
}

function extractSendEmail(result: unknown, args: Record<string, unknown>): ExtractedMemory | null {
  const data = result as { id?: string; threadId?: string } | null;
  if (!data?.id) return null;

  const to = String(args.to || '');
  const subject = String(args.subject || '');
  const domain = to.split('@')[1]?.split('.')[0] || '';

  const content = subject
    ? `Sent email to ${to}: "${subject.slice(0, 50)}${subject.length > 50 ? '...' : ''}"`
    : `Sent email to ${to}`;

  const tags = ['email'];
  if (domain) tags.push(domain);

  return {
    category: 'fact',
    content,
    tags,
    metadata: { messageId: data.id, threadId: data.threadId, to, subject: subject.slice(0, 100) },
    source: { type: 'auto_extraction', toolName: 'send_email' },
  };
}

function extractCreateCalendarEvent(result: unknown, args: Record<string, unknown>): ExtractedMemory | null {
  const data = result as { id?: string; summary?: string; htmlLink?: string } | null;
  if (!data?.id) return null;

  const summary = data.summary || String(args.summary || 'Untitled event');

  return {
    category: 'fact',
    content: `Created calendar event: "${summary}"`,
    tags: [...extractTagsFromText(summary), 'calendar', 'event'],
    metadata: { eventId: data.id, summary, htmlLink: data.htmlLink },
    source: { type: 'auto_extraction', toolName: 'create_calendar_event' },
  };
}

function extractCreateTask(result: unknown, args: Record<string, unknown>): ExtractedMemory | null {
  const data = result as { id?: string; title?: string; selfLink?: string } | null;
  if (!data?.id) return null;

  const title = data.title || String(args.title || 'Untitled task');

  return {
    category: 'fact',
    content: `Created task: "${title}"`,
    tags: [...extractTagsFromText(title), 'task'],
    metadata: { taskId: data.id, title, selfLink: data.selfLink },
    source: { type: 'auto_extraction', toolName: 'create_task' },
  };
}

function extractCreateDriveFolder(result: unknown, args: Record<string, unknown>): ExtractedMemory | null {
  const data = result as { id?: string; name?: string; webViewLink?: string } | null;
  if (!data?.id) return null;

  const name = data.name || String(args.name || 'Untitled folder');

  return {
    category: 'resource',
    content: `Drive folder: "${name}"`,
    tags: [...extractTagsFromText(name), 'drive', 'folder'],
    metadata: { folderId: data.id, name, webViewLink: data.webViewLink },
    resourceIds: [data.id],
    source: { type: 'auto_extraction', toolName: 'create_drive_folder' },
  };
}

function extractDocsWrite(result: unknown, args: Record<string, unknown>): ExtractedMemory | null {
  const data = result as { documentId?: string; title?: string } | null;
  if (!data?.documentId) return null;

  const docId = data.documentId || String(args.doc_id || '');
  const title = data.title || 'Untitled document';

  return {
    category: 'resource',
    content: `Document edited: "${title}"`,
    tags: [...extractTagsFromText(title), 'document', 'docs'],
    metadata: { docId, title },
    resourceIds: [docId],
    source: { type: 'auto_extraction', toolName: 'docs_write' },
  };
}

function extractDriveUpload(result: unknown, args: Record<string, unknown>): ExtractedMemory | null {
  const data = result as { id?: string; name?: string; webViewLink?: string } | null;
  if (!data?.id) return null;

  const name = data.name || 'Uploaded file';
  const filePath = String(args.file_path || '');
  const fileName = filePath.split('/').pop() || name;

  return {
    category: 'resource',
    content: `Uploaded file: "${fileName}"`,
    tags: [...extractTagsFromText(fileName), 'drive', 'file', 'upload'],
    metadata: { fileId: data.id, name: fileName, webViewLink: data.webViewLink },
    resourceIds: [data.id],
    source: { type: 'auto_extraction', toolName: 'drive_upload' },
  };
}

function extractSaveEmailToDoc(result: unknown, args: Record<string, unknown>): ExtractedMemory | null {
  const data = result as { docId?: string; docUrl?: string } | null;
  if (!data?.docId) return null;

  return {
    category: 'fact',
    content: 'Archived email thread to Google Doc',
    tags: ['email', 'archive', 'document'],
    metadata: { docId: data.docId, docUrl: data.docUrl, threadId: args.thread_id },
    source: { type: 'auto_extraction', toolName: 'save_email_to_doc' },
  };
}

function extractSheetsAppend(result: unknown, args: Record<string, unknown>): ExtractedMemory | null {
  const spreadsheetId = String(args.spreadsheet_id || '');
  if (!spreadsheetId) return null;

  const data = result as { updates?: { updatedRows?: number } } | null;
  const rowCount = data?.updates?.updatedRows ?? 0;
  const url = `https://docs.google.com/spreadsheets/d/${spreadsheetId}`;

  return {
    category: 'resource',
    content: `Spreadsheet (appended ${rowCount} row${rowCount === 1 ? '' : 's'})`,
    tags: ['spreadsheet', 'append'],
    metadata: { spreadsheetId, url },
    resourceIds: [spreadsheetId],
    source: { type: 'auto_extraction', toolName: 'sheets_append' },
  };
}

function extractSheetsUpdate(result: unknown, args: Record<string, unknown>): ExtractedMemory | null {
  const spreadsheetId = String(args.spreadsheet_id || '');
  if (!spreadsheetId) return null;

  const data = result as { updatedCells?: number } | null;
  const url = `https://docs.google.com/spreadsheets/d/${spreadsheetId}`;

  return {
    category: 'resource',
    content: `Spreadsheet (updated ${data?.updatedCells ?? 0} cell${(data?.updatedCells ?? 0) === 1 ? '' : 's'})`,
    tags: ['spreadsheet', 'update'],
    metadata: { spreadsheetId, url },
    resourceIds: [spreadsheetId],
    source: { type: 'auto_extraction', toolName: 'sheets_update' },
  };
}

function extractArchiveEmailThreads(result: unknown, args: Record<string, unknown>): ExtractedMemory | null {
  const data = result as { succeeded_count?: number; failed_count?: number } | null;
  const succeeded = data?.succeeded_count ?? 0;
  const threadIds = Array.isArray(args.thread_ids) ? args.thread_ids : [];

  if (succeeded === 0) return null;

  const count = succeeded;
  const plural = count === 1 ? '' : 's';

  return {
    category: 'fact',
    content: `Archived ${count} email thread${plural}`,
    tags: ['email', 'archive'],
    metadata: { count, threadIds },
    source: { type: 'auto_extraction', toolName: 'archive_email_threads' },
  };
}

export function extractFromToolResult(info: ToolResultInfo): ExtractedMemory[] {
  const { toolName, args, result } = info;

  if (result.startsWith('Error:')) {
    return [];
  }

  const parsed = parseJsonSafe(result);
  if (!parsed) {
    return [];
  }

  // search_drive returns multiple memories, handle separately
  if (toolName === 'search_drive') {
    return extractSearchDrive(parsed, args);
  }

  let extracted: ExtractedMemory | null = null;

  switch (toolName) {
    case 'sheets_create':
      extracted = extractSheetsCreate(parsed, args);
      break;
    case 'sheets_read':
      extracted = extractSheetsRead(parsed, args);
      break;
    case 'send_email':
      extracted = extractSendEmail(parsed, args);
      break;
    case 'create_calendar_event':
      extracted = extractCreateCalendarEvent(parsed, args);
      break;
    case 'create_task':
      extracted = extractCreateTask(parsed, args);
      break;
    case 'create_drive_folder':
      extracted = extractCreateDriveFolder(parsed, args);
      break;
    case 'docs_write':
      extracted = extractDocsWrite(parsed, args);
      break;
    case 'drive_upload':
      extracted = extractDriveUpload(parsed, args);
      break;
    case 'save_email_to_doc':
      extracted = extractSaveEmailToDoc(parsed, args);
      break;
    case 'sheets_append':
      extracted = extractSheetsAppend(parsed, args);
      break;
    case 'sheets_update':
      extracted = extractSheetsUpdate(parsed, args);
      break;
    case 'archive_email_threads':
      extracted = extractArchiveEmailThreads(parsed, args);
      break;
    default:
      return [];
  }

  if (!extracted) {
    return [];
  }

  return [extracted];
}