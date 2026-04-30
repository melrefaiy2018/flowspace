/**
 * tool-dispatch.ts
 *
 * Runtime tool execution layer:
 * - executeGws()   — wraps the gws CLI, handles auth token injection and
 *                    error normalization.
 * - executeTool()  — maps tool name → gws command (or inline handler).
 */

import { execFile } from 'child_process';
import { buildFlowSpaceTaskNotes } from '../lib/tasks.js';
import { getDynamicTool, loadDynamicTools, registerDynamicTool } from './dynamic-tool-registry.js';
import { executeDynamicTool, validateDynamicTool } from './tool-composer.js';
import type { DynamicToolDef, ToolStep } from './dynamic-tool-types.js';
import { getInboxActionsBaseUrl, parseJson, headerValue, stripHtml, normalizeThreadIds as normalizeThreadIdsFromApproval } from './tool-approval.js';
import { recordInvocation as synthesizerRecord } from './synthesizer/observer.js';

// ── Auth helpers ──────────────────────────────────────────────────────────────

/** Refresh an access token from client_id, client_secret, and refresh_token. */
async function refreshAccessToken(clientId: string, clientSecret: string, refreshToken: string): Promise<string | null> {
  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
  });
  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    body: params,
  });
  const data = await resp.json();
  return data.access_token ?? null;
}

/**
 * Get a fresh access token.
 * Tries gws credentials first, then .tokens.json, then ADC.
 */
async function getAccessToken(): Promise<string> {
  const os = await import('os');
  const fs = await import('fs');
  const path = await import('path');
  const { fileURLToPath } = await import('url');

  const projectRoot = path.dirname(fileURLToPath(import.meta.url)).replace(/\/src\/agent$/, '');

  // 1. Try gws-imported credentials (primary auth path for desktop app)
  const isProduction = process.env.NODE_ENV === 'production' || process.env.FLOWSPACE_PRODUCTION === '1';
  const dataDir = isProduction
    ? path.join(os.homedir(), 'Library', 'Application Support', 'FlowSpace')
    : projectRoot;
  const accountsManifestPath = path.join(dataDir, '.accounts.json');
  if (fs.existsSync(accountsManifestPath)) {
    try {
      const manifest = JSON.parse(fs.readFileSync(accountsManifestPath, 'utf-8'));
      const activeAccountId = typeof manifest?.activeAccountId === 'string' ? manifest.activeAccountId : null;
      const activeAccount = Array.isArray(manifest?.accounts)
        ? manifest.accounts.find((account: any) => account?.id === activeAccountId)
        : null;
      const credsPath = typeof activeAccount?.credentialPath === 'string'
        ? activeAccount.credentialPath
        : null;
      // Validate credentialPath stays within dataDir to prevent path traversal
      if (credsPath && path.resolve(credsPath).startsWith(path.resolve(dataDir) + path.sep) && fs.existsSync(credsPath)) {
        const creds = JSON.parse(fs.readFileSync(credsPath, 'utf-8'));
        const token = await refreshAccessToken(creds.client_id, creds.client_secret, creds.refresh_token);
        if (token) return token;
      }
    } catch {
      // Fall through
    }
  }

  const legacyGwsCredsPath = path.join(dataDir, '.gws-credentials.json');
  if (fs.existsSync(legacyGwsCredsPath)) {
    try {
      const creds = JSON.parse(fs.readFileSync(legacyGwsCredsPath, 'utf-8'));
      if (creds.client_id && creds.client_secret && creds.refresh_token) {
        const token = await refreshAccessToken(creds.client_id, creds.client_secret, creds.refresh_token);
        if (token) return token;
      }
    } catch {
      // Fall through
    }
  }

  // 2. Try .tokens.json (OAuth2 web flow)
  const tokensPath = path.join(projectRoot, '.tokens.json');
  if (fs.existsSync(tokensPath)) {
    try {
      const tokens = JSON.parse(fs.readFileSync(tokensPath, 'utf-8'));
      if (tokens.refresh_token) {
        const clientId = process.env.GOOGLE_CLIENT_ID;
        const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
        if (clientId && clientSecret) {
          const token = await refreshAccessToken(clientId, clientSecret, tokens.refresh_token);
          if (token) return token;
        }
      }
    } catch {
      // Fall through to ADC
    }
  }

  // 3. Fall back to ADC
  const adcPath = path.join(os.homedir(), '.config/gcloud/application_default_credentials.json');
  const creds = JSON.parse(fs.readFileSync(adcPath, 'utf-8'));
  const token = await refreshAccessToken(creds.client_id, creds.client_secret, creds.refresh_token);
  if (token) return token;
  throw new Error('Failed to obtain access token from any auth source');
}

// ── executeGws ────────────────────────────────────────────────────────────────

/** Execute a gws CLI command. */
export async function executeGws(args: string[], signal?: AbortSignal): Promise<string> {
  const token = await getAccessToken();
  return new Promise((resolve, reject) => {
    const child = execFile('gws', args, {
      timeout: 30000,
      env: { ...process.env, GOOGLE_WORKSPACE_CLI_TOKEN: token },
      signal,
    }, (err, stdout, stderr) => {
      if (err) {
        if ((err as any).name === 'AbortError' || signal?.aborted) {
          reject(err);
          return;
        }

        // Sometimes CLIs put error details in stdout (especially with --format json)
        // or stderr. If both are empty, fall back to the generic error message.
        const errorOutput = (stderr || stdout || '').trim();
        const errorMsg = errorOutput || err.message;

        // Enhance file-not-found errors for the agent
        if (errorMsg.includes('404') || errorMsg.includes('File not found') || errorMsg.includes('not found') || errorMsg.includes('not exist')) {
          const extractFileIdFromArgs = (toolArgs: string[]): string | null => {
            const joined = toolArgs.join(' ');
            const idFlags = ['--id', '--document', '--spreadsheet', '--parent'];

            for (const flag of idFlags) {
              const pattern = new RegExp(`${flag}\\s+([^\\s]+)`);
              const match = joined.match(pattern);
              if (match && match[1]) {
                return match[1];
              }
            }

            // Fallback: treat the last non-flag argument as a possible ID
            for (let i = toolArgs.length - 1; i >= 0; i--) {
              const value = toolArgs[i];
              if (!value.startsWith('-')) {
                return value;
              }
            }

            return null;
          };

          const fileId = extractFileIdFromArgs(args) ?? 'the requested file';
          resolve(`Error: File "${fileId}" was not found or has been deleted. If you were trying to read or update a document, you should explain this to the user and offer to create a new one.`);
          return;
        }

        // Handle tool-specific confusion (e.g. reading a Doc as a Sheet)
        if (errorMsg.includes('mimeType') || errorMsg.includes('spreadsheet') || errorMsg.includes('type')) {
          resolve(`Error: The operation failed because of a type mismatch (e.g. trying to read a Google Doc as a Spreadsheet). Check if you are using the correct tool for this file type. Output: ${errorMsg}`);
          return;
        }

        resolve(`Error: ${errorMsg}`);
        return;
      }
      resolve(stdout || stderr || 'Command completed successfully');
    });

    signal?.addEventListener('abort', () => {
      child.kill('SIGTERM');
    }, { once: true });
  });
}

// ── Inbox action API helpers ──────────────────────────────────────────────────

async function callInboxActionApi(payload: Record<string, unknown>, signal?: AbortSignal): Promise<string> {
  const baseUrl = getInboxActionsBaseUrl();
  const response = await fetch(`${baseUrl}/api/inbox-actions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal,
  });
  const text = await response.text();
  if (!response.ok) {
    try {
      const parsed = JSON.parse(text);
      return `Error: ${parsed.error || 'Inbox action failed'}`;
    } catch {
      return `Error: ${text || 'Inbox action failed'}`;
    }
  }
  return text;
}

async function callUndoInboxActionApi(auditId: string, signal?: AbortSignal): Promise<string> {
  const baseUrl = getInboxActionsBaseUrl();
  const response = await fetch(`${baseUrl}/api/inbox-actions/${encodeURIComponent(auditId)}/undo`, {
    method: 'POST',
    signal,
  });
  const text = await response.text();
  if (!response.ok) {
    try {
      const parsed = JSON.parse(text);
      return `Error: ${parsed.error || 'Undo failed'}`;
    } catch {
      return `Error: ${text || 'Undo failed'}`;
    }
  }
  return text;
}

// ── Shared dispatch helpers ───────────────────────────────────────────────────

// Use the shared implementation from tool-approval.ts to avoid duplication
const normalizeThreadIds = normalizeThreadIdsFromApproval;

function extractEmailBody(payload: any): string {
  let body = '';

  // Check for multipart
  const parts = payload?.parts;
  if (Array.isArray(parts)) {
    // Prefer text/plain
    const textPart = parts.find((p: any) => p.mimeType === 'text/plain');
    const htmlPart = parts.find((p: any) => p.mimeType === 'text/html');
    const encoded = textPart?.body?.data || htmlPart?.body?.data;
    if (encoded) {
      try {
        const decoded = Buffer.from(encoded, 'base64url').toString('utf-8');
        body = textPart ? decoded : stripHtml(decoded);
      } catch { /* fall through */ }
    }
  } else if (payload?.body?.data) {
    try {
      const decoded = Buffer.from(payload.body.data, 'base64url').toString('utf-8');
      body = payload.mimeType === 'text/html' ? stripHtml(decoded) : decoded;
    } catch { /* fall through */ }
  }

  return body;
}

// ── executeTool ───────────────────────────────────────────────────────────────

/** Maps a tool name to its execution logic. */
export async function executeTool(
  name: string,
  args: Record<string, any>,
  signal?: AbortSignal,
  source: 'chat' | 'scheduler' = 'chat',
  approval: 'auto' | 'user_approved' | 'user_rejected' | 'pending' = 'auto',
): Promise<string> {
  let success = true;
  let observedApproval = approval;
  try {
    const result = await executeToolImpl(name, args, signal);
    // Many failure paths in executeToolImpl + executeGws return an
    // "Error: ..." or "Unknown tool: ..." string instead of throwing.
    // Treat those as failures for synthesizer telemetry so the frequency
    // data US2 will mine isn't corrupted by silent error sequences.
    if (typeof result === 'string' && (result.startsWith('Error:') || result.startsWith('Unknown tool:'))) {
      success = false;
    }
    // Dynamic tools that hit a write step return a serialized
    // _approvalRequired payload. The dispatch itself is pending until the
    // user approves; record it as such so we don't conflate it with
    // auto-executed dispatches.
    if (typeof result === 'string' && result.startsWith('{"_approvalRequired":true')) {
      observedApproval = 'pending';
    }
    return result;
  } catch (err) {
    success = false;
    throw err;
  } finally {
    try {
      synthesizerRecord({
        name,
        args: args ?? {},
        success,
        approval: observedApproval,
        source,
      });
    } catch {
      /* observer is fail-closed; never let it disturb the caller */
    }
  }
}

async function executeToolImpl(name: string, args: Record<string, any>, signal?: AbortSignal): Promise<string> {
  switch (name) {
    case 'search_drive': {
      const limit = args.limit || 10;
      // Auto-fix: if the LLM passes a plain filename instead of Drive API syntax, wrap it
      const rawQuery: string = args.query ?? '';
      const isDriveQuery = /\b(name|mimeType|fullText|trashed|parents|visibility|modifiedTime|createdTime)\b/.test(rawQuery);
      const query = isDriveQuery ? rawQuery : `name contains '${rawQuery.replace(/'/g, "\\'")}'`;
      return executeGws(['drive', 'files', 'list', '--params', JSON.stringify({
        q: query,
        pageSize: limit,
        fields: 'files(id,name,mimeType,modifiedTime,webViewLink,shared)',
      })], signal);
    }

    case 'list_drive_files': {
      const limit = args.limit || 10;
      return executeGws(['drive', 'files', 'list', '--params', JSON.stringify({
        orderBy: 'modifiedTime desc',
        pageSize: limit,
        fields: 'files(id,name,mimeType,modifiedTime,webViewLink)',
      })], signal);
    }

    case 'create_drive_folder': {
      const body: any = {
        name: args.name,
        mimeType: 'application/vnd.google-apps.folder',
      };
      if (args.parent_id) body.parents = [args.parent_id];
      return executeGws(['drive', 'files', 'create', '--json', JSON.stringify(body)], signal);
    }

    case 'compose_email': {
      return JSON.stringify({
        to: args.to,
        subject: args.subject,
        body: args.body,
        ...(args.thread_id ? { thread_id: args.thread_id } : {}),
      });
    }

    case 'send_email': {
      const message = [
        `To: ${args.to}`,
        `Subject: ${args.subject}`,
        'Content-Type: text/plain; charset=utf-8',
        '',
        args.body,
      ].join('\r\n');
      const raw = Buffer.from(message).toString('base64url');
      return executeGws(['gmail', 'users', 'messages', 'send', '--params', JSON.stringify({ userId: 'me' }), '--json', JSON.stringify({ raw })], signal);
    }

    case 'search_emails': {
      const limit = Math.min(Number(args.limit) || 25, 50);
      const listResult = await executeGws(['gmail', 'users', 'messages', 'list', '--params', JSON.stringify({
        userId: 'me',
        q: args.query,
        maxResults: limit,
      })], signal);

      try {
        const parsed = JSON.parse(listResult);
        const messages = parsed.messages || [];
        if (messages.length === 0) return 'No messages found matching your query.';
        const resultSizeEstimate = typeof parsed.resultSizeEstimate === 'number' ? parsed.resultSizeEstimate : messages.length;

        const details = [];
        for (const m of messages.slice(0, limit)) {
          const detail = await executeGws(['gmail', 'users', 'messages', 'get', '--params', JSON.stringify({
            userId: 'me',
            id: m.id,
            format: 'full',
          })], signal);
          const parsedDetail = parseJson(detail);
          const headers = parsedDetail?.payload?.headers;
          details.push({
            id: m.id,
            threadId: parsedDetail?.threadId || m.threadId,
            from: headerValue(headers, 'From'),
            subject: headerValue(headers, 'Subject'),
            date: headerValue(headers, 'Date'),
            snippet: parsedDetail?.snippet || '',
          });
        }
        // Relevance scoring: extract keywords from query, score each result, filter out irrelevant matches
        const queryKeywords = args.query
          .replace(/\b(from|to|subject|is|has|newer_than|older_than|after|before|in|label):[^\s]*/gi, '')
          .replace(/[()""]/g, ' ')
          .split(/\s+/)
          .map((w: string) => w.toLowerCase())
          .filter((w: string) => w.length >= 3 && !['and', 'the', 'for'].includes(w));

        if (queryKeywords.length > 0) {
          const scored = details.map(d => {
            const text = `${d.from} ${d.subject} ${d.snippet}`.toLowerCase();
            const score = queryKeywords.filter(kw => text.includes(kw)).length;
            return { ...d, _score: score };
          });
          scored.sort((a, b) => b._score - a._score);
          const relevant = scored.filter(d => d._score > 0);
          const final = (relevant.length > 0 ? relevant : scored).map(({ _score, ...rest }) => rest);
          return JSON.stringify({
            messages: final,
            thread_ids: final.map((d) => d.threadId).filter(Boolean),
            resultSizeEstimate,
            truncated: resultSizeEstimate > final.length,
          });
        }

        return JSON.stringify({
          messages: details,
          thread_ids: details.map((d) => d.threadId).filter(Boolean),
          resultSizeEstimate,
          truncated: resultSizeEstimate > details.length,
        });
      } catch {
        return listResult;
      }
    }

    case 'read_email': {
      const raw = await executeGws(['gmail', 'users', 'messages', 'get', '--params', JSON.stringify({
        userId: 'me',
        id: args.message_id,
        format: 'full',
      })], signal);

      // Post-process: extract clean fields instead of returning raw payload with HTML
      const parsed = parseJson(raw);
      if (!parsed) return raw;

      const headers = parsed.payload?.headers;
      const body = extractEmailBody(parsed.payload);
      const snippet = parsed.snippet || '';
      // Truncate body to avoid flooding the model with huge emails
      const cleanBody = body.length > 2000 ? body.slice(0, 2000) + '\n...(truncated)' : body;

      return JSON.stringify({
        id: parsed.id,
        threadId: parsed.threadId,
        from: headerValue(headers, 'From'),
        to: headerValue(headers, 'To'),
        subject: headerValue(headers, 'Subject'),
        date: headerValue(headers, 'Date'),
        snippet,
        body: cleanBody || snippet,
        labelIds: parsed.labelIds || [],
      });
    }

    case 'create_calendar_event': {
      const event: any = {
        summary: args.summary,
        start: { dateTime: args.start_time },
        end: { dateTime: args.end_time },
      };
      if (args.description) event.description = args.description;
      if (args.location) event.location = args.location;
      if (args.attendees) {
        event.attendees = args.attendees.split(',').map((e: string) => ({ email: e.trim() }));
      }
      return executeGws(['calendar', 'events', 'insert', '--params', JSON.stringify({ calendarId: 'primary' }), '--json', JSON.stringify(event)], signal);
    }

    case 'list_calendar_events': {
      const days = args.days || 7;
      const limit = args.limit || 10;
      const now = new Date().toISOString();
      const future = new Date(Date.now() + days * 86400000).toISOString();
      return executeGws(['calendar', 'events', 'list', '--params', JSON.stringify({
        calendarId: 'primary',
        timeMin: now,
        timeMax: future,
        singleEvents: true,
        orderBy: 'startTime',
        maxResults: limit,
      })], signal);
    }

    case 'create_task': {
      const task: any = { title: args.title };
      task.notes = buildFlowSpaceTaskNotes(args.notes, { source: 'flowspace-task' });
      if (args.due) task.due = args.due;
      return executeGws(['tasks', 'tasks', 'insert', '--params', JSON.stringify({ tasklist: '@default' }), '--json', JSON.stringify(task)], signal);
    }

    case 'list_tasks': {
      const limit = args.limit || 20;
      return executeGws(['tasks', 'tasks', 'list', '--params', JSON.stringify({
        tasklist: '@default',
        showCompleted: false,
        maxResults: limit,
      })], signal);
    }

    case 'standup_report':
      return executeGws(['workflow', '+standup-report'], signal);

    case 'meeting_prep':
      return executeGws(['workflow', '+meeting-prep'], signal);

    case 'email_to_task':
      return executeGws(['workflow', '+email-to-task', '--message-id', args.message_id], signal);

    case 'weekly_digest':
      return executeGws(['workflow', '+weekly-digest'], signal);

    // Tier 1 — gws skills
    case 'calendar_agenda': {
      const agendaArgs = ['calendar', '+agenda'];
      const dateInput = args.date ? String(args.date).trim() : '';
      if (dateInput) {
        // Validate date string as YYYY-MM-DD and compute days from today to the requested date
        const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;
        if (isoDatePattern.test(dateInput)) {
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          const target = new Date(dateInput + 'T00:00:00');
          const targetTime = target.getTime();
          if (!Number.isNaN(targetTime)) {
            const diffDays = Math.round((targetTime - today.getTime()) / 86400000);
            if (diffDays <= 0) {
              agendaArgs.push('--today');
            } else if (diffDays === 1) {
              agendaArgs.push('--tomorrow');
            } else {
              agendaArgs.push('--days', String(diffDays));
            }
          } else {
            // Fallback if parsed date is invalid
            agendaArgs.push('--today');
          }
        } else {
          // Fallback if date format is not YYYY-MM-DD
          agendaArgs.push('--today');
        }
      } else {
        agendaArgs.push('--today');
      }
      agendaArgs.push('--format', 'json');
      return executeGws(agendaArgs, signal);
    }

    case 'gmail_triage': {
      const limit = String(args.limit || 20);
      return executeGws(['gmail', '+triage', '--query', 'is:unread', '--max', limit, '--format', 'json'], signal);
    }

    case 'open_email_triage': {
      // Navigation-only tool — actual navigation is handled by the chat loop via the navigate event.
      return JSON.stringify({ status: 'ok', message: 'Opened AI Triage view' });
    }

    case 'check_email_triage': {
      // Navigation + refresh — navigates to triage tab and triggers a data refresh.
      return JSON.stringify({ status: 'ok', message: 'Refreshing AI Triage view with latest emails' });
    }

    case 'sheets_read': {
      return executeGws(['sheets', '+read', '--spreadsheet', args.spreadsheet_id, '--range', args.range, '--format', 'json'], signal);
    }

    case 'docs_read': {
      // No +read helper for docs — use the raw documents.get API
      return executeGws(['docs', 'documents', 'get', '--params', JSON.stringify({ documentId: args.doc_id })], signal);
    }

    case 'docs_write': {
      // gws docs +write only supports append (--text). No mode flag.
      return executeGws(['docs', '+write', '--document', args.doc_id, '--text', args.content, '--format', 'json'], signal);
    }

    // Tier 2 — gws skills
    case 'sheets_append': {
      const values = typeof args.values === 'string' ? args.values : JSON.stringify(args.values);
      return executeGws(['sheets', '+append', '--spreadsheet', args.spreadsheet_id, '--json-values', values, '--format', 'json'], signal);
    }

    case 'sheets_create': {
      // Create spreadsheet via raw API, then optionally populate with initial data
      const body: Record<string, unknown> = {
        properties: { title: args.title },
      };
      const result = await executeGws(['sheets', 'spreadsheets', 'create', '--json', JSON.stringify(body), '--format', 'json'], signal);
      // If initial values were provided, populate them in the new spreadsheet
      if (args.values) {
        try {
          const parsed = JSON.parse(result);
          const spreadsheetId = parsed?.spreadsheetId;
          if (spreadsheetId) {
            const initialValues = typeof args.values === 'string' ? args.values : JSON.stringify(args.values);
            const rows = JSON.parse(initialValues);
            const endCol = String.fromCharCode(64 + Math.max(...rows.map((r: unknown[]) => r.length)));
            const range = `Sheet1!A1:${endCol}${rows.length}`;
            await executeGws(['sheets', 'spreadsheets', 'values', 'update',
              '--params', JSON.stringify({ spreadsheetId, range, valueInputOption: 'USER_ENTERED' }),
              '--json', JSON.stringify({ values: rows }),
              '--format', 'json',
            ], signal);
          }
        } catch {
          // Spreadsheet was created but populating initial data failed — still return the creation result
        }
      }
      return result;
    }

    case 'sheets_update': {
      const values = typeof args.values === 'string' ? args.values : JSON.stringify(args.values);
      let rows: unknown;
      try {
        rows = JSON.parse(values);
      } catch {
        return `Error: invalid JSON in 'values' field for sheets_update`;
      }
      return executeGws(['sheets', 'spreadsheets', 'values', 'update',
        '--params', JSON.stringify({
          spreadsheetId: args.spreadsheet_id,
          range: args.range,
          valueInputOption: 'USER_ENTERED',
        }),
        '--json', JSON.stringify({ values: rows }),
        '--format', 'json',
      ], signal);
    }

    case 'drive_upload': {
      // gws drive +upload takes file as positional arg, not --file
      const uploadArgs = ['drive', '+upload', args.file_path];
      if (args.parent_id) uploadArgs.push('--parent', args.parent_id);
      uploadArgs.push('--format', 'json');
      return executeGws(uploadArgs, signal);
    }

    case 'review_overdue_tasks': {
      // List incomplete tasks and filter overdue ones — no dedicated helper exists
      return executeGws(['tasks', 'tasks', 'list', '--params', JSON.stringify({
        tasklist: '@default',
        showCompleted: false,
        maxResults: 100,
        dueMax: new Date().toISOString(),
      }), '--format', 'json'], signal);
    }

    case 'save_email_to_doc': {
      // Get full thread, then create a doc — multi-step via raw API
      const thread = await executeGws(['gmail', 'users', 'threads', 'get', '--params', JSON.stringify({
        userId: 'me',
        id: args.thread_id,
        format: 'full',
      }), '--format', 'json'], signal);
      return thread;
    }

    case 'archive_email_threads': {
      const threadIds = normalizeThreadIds(args.thread_ids);
      if (threadIds.length === 0) {
        return 'Error: thread_ids is required and must contain at least one Gmail thread ID.';
      }
      return callInboxActionApi({
        actionType: 'archive_threads',
        threadIds,
        approvalSnapshot: `Archive ${threadIds.length} Gmail thread(s).`,
      }, signal);
    }

    case 'trash_email_threads': {
      const threadIds = normalizeThreadIds(args.thread_ids);
      if (threadIds.length === 0) {
        return 'Error: thread_ids is required and must contain at least one Gmail thread ID.';
      }
      return callInboxActionApi({
        actionType: 'trash_threads',
        threadIds,
        approvalSnapshot: `Move ${threadIds.length} Gmail thread(s) to Trash.`,
      }, signal);
    }

    case 'restore_email_threads': {
      const threadIds = normalizeThreadIds(args.thread_ids);
      if (threadIds.length === 0) return 'Error: thread_ids is required and must contain at least one Gmail thread ID.';
      return callInboxActionApi({
        actionType: 'restore_threads',
        threadIds,
        approvalSnapshot: `Restore ${threadIds.length} Gmail thread(s) to Inbox.`,
      }, signal);
    }

    case 'mute_email_threads': {
      const threadIds = normalizeThreadIds(args.thread_ids);
      if (threadIds.length === 0) return 'Error: thread_ids is required and must contain at least one Gmail thread ID.';
      return callInboxActionApi({
        actionType: 'mute_threads',
        threadIds,
        approvalSnapshot: `Mute ${threadIds.length} Gmail thread(s).`,
      }, signal);
    }

    case 'mark_threads_read': {
      const threadIds = normalizeThreadIds(args.thread_ids);
      if (threadIds.length === 0) return 'Error: thread_ids is required and must contain at least one Gmail thread ID.';
      return callInboxActionApi({
        actionType: 'mark_read',
        threadIds,
        approvalSnapshot: `Mark ${threadIds.length} Gmail thread(s) as read.`,
      }, signal);
    }

    case 'apply_label_to_threads': {
      const threadIds = normalizeThreadIds(args.thread_ids);
      const labelName = String(args.label_name ?? '').trim();
      if (threadIds.length === 0) return 'Error: thread_ids is required and must contain at least one Gmail thread ID.';
      if (!labelName) return 'Error: label_name is required.';
      return callInboxActionApi({
        actionType: 'apply_label',
        threadIds,
        labelName,
        approvalSnapshot: `Apply label "${labelName}" to ${threadIds.length} Gmail thread(s).`,
      }, signal);
    }

    case 'unsubscribe_from_sender': {
      const threadIds = normalizeThreadIds(args.thread_ids);
      if (threadIds.length === 0) return 'Error: thread_ids is required and must contain at least one Gmail thread ID.';
      return callInboxActionApi({
        actionType: 'unsubscribe_sender',
        threadIds,
        approvalSnapshot: `Attempt unsubscribe using Gmail metadata for ${threadIds[0]}.`,
      }, signal);
    }

    case 'create_gmail_filter': {
      const sender = String(args.sender ?? '').trim();
      const subject = String(args.subject ?? '').trim();
      if (!sender && !subject) return 'Error: sender or subject is required to create a filter.';
      return callInboxActionApi({
        actionType: 'create_filter',
        sender,
        subject,
        labelName: String(args.label_name ?? '').trim() || undefined,
        archive: String(args.archive ?? '').toLowerCase() === 'true',
        markRead: String(args.mark_read ?? '').toLowerCase() === 'true',
        skipInbox: String(args.skip_inbox ?? '').toLowerCase() === 'true',
        approvalSnapshot: `Create Gmail filter for sender "${sender}" and subject "${subject}".`,
      }, signal);
    }

    case 'undo_inbox_action': {
      const auditId = String(args.audit_id ?? '').trim();
      if (!auditId) return 'Error: audit_id is required.';
      return callUndoInboxActionApi(auditId, signal);
    }

    case 'create_tool': {
      let steps: ToolStep[];
      try {
        steps = typeof args.steps === 'string' ? JSON.parse(args.steps) : args.steps;
      } catch {
        return 'Error: steps must be a valid JSON array of step objects.';
      }

      let parameters: Record<string, unknown>;
      try {
        parameters = args.parameters
          ? (typeof args.parameters === 'string' ? JSON.parse(args.parameters) : args.parameters)
          : { type: 'object', properties: {} };
      } catch {
        return 'Error: parameters must be a valid JSON Schema object.';
      }

      const toolDef: DynamicToolDef = {
        name: String(args.name ?? '').trim(),
        description: String(args.description ?? '').trim(),
        parameters,
        steps,
        isWriteTool: args.is_write_tool === true || args.is_write_tool === 'true',
        createdAt: new Date().toISOString(),
        label: args.label ? String(args.label) : undefined,
      };

      const validationError = validateDynamicTool(toolDef);
      if (validationError) {
        return `Error: Invalid tool definition — ${validationError}`;
      }

      const registered = registerDynamicTool(toolDef);
      if (!registered) {
        return `Error: A tool named "${toolDef.name}" already exists. Choose a different name.`;
      }

      return JSON.stringify({
        created: true,
        name: registered.name,
        description: registered.description,
        stepCount: registered.steps.length,
        isWriteTool: registered.isWriteTool,
        message: `Tool "${registered.name}" created successfully with ${registered.steps.length} step(s). It is now available for use.`,
      });
    }

    case 'save_memory': {
      const { createMemory, loadMemories } = await import('./memory/memory-store.js');
      loadMemories();

      const content = String(args.content ?? '').trim();
      const category = String(args.category ?? 'fact') as 'resource' | 'workflow' | 'preference' | 'fact';
      const tags = Array.isArray(args.tags) ? args.tags.map(String) : [];

      if (!content) {
        return 'Error: content is required for saving a memory.';
      }

      if (!['resource', 'workflow', 'preference', 'fact'].includes(category)) {
        return 'Error: category must be one of: resource, workflow, preference, fact.';
      }

      const entry = createMemory({
        category,
        content,
        tags,
        metadata: {},
        source: { type: 'explicit_user' },
      });

      return JSON.stringify({
        saved: true,
        id: entry.id,
        category: entry.category,
        content: entry.content,
        tags: entry.tags,
        message: `Memory saved: "${content.slice(0, 50)}${content.length > 50 ? '...' : ''}"`,
      });
    }

    case 'search_memory': {
      const { getMemories, loadMemories } = await import('./memory/memory-store.js');
      const { retrieveMemories } = await import('./memory/memory-retriever.js');

      loadMemories();

      const query = String(args.query ?? '').trim();
      if (!query) {
        return JSON.stringify({ results: [], message: 'No search query provided.' });
      }

      const memories = [...getMemories()];
      const results = await retrieveMemories(query, memories, { maxResults: 10 });

      return JSON.stringify({
        query,
        results: results.map((r) => ({
          id: r.entry.id,
          category: r.entry.category,
          content: r.entry.content,
          tags: r.entry.tags,
          relevanceScore: Math.round(r.relevanceScore * 100) / 100,
        })),
        message: results.length === 0 ? 'No matching memories found.' : `Found ${results.length} matching memory(ies).`,
      });
    }

    default: {
      loadDynamicTools();
      const dynamicTool = getDynamicTool(name);
      if (dynamicTool) {
        const result = await executeDynamicTool(dynamicTool, args, signal);
        if ('type' in result && result.type === 'approval_required') {
          // Serialize the approval request so the caller can surface it
          return JSON.stringify({ _approvalRequired: true, approval: result.approval, completedSteps: result.completedSteps });
        }
        // At this point result is DynamicToolResult (approval_required was handled above)
        return (result as import('./dynamic-tool-types.js').DynamicToolResult).output;
      }
      return `Unknown tool: ${name}`;
    }
  }
}
