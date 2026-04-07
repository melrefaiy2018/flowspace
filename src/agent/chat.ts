import type { ApprovalRequest, AssistantPayload, ChatMessageInput, ChatStreamEvent, ToolEvent } from '../shared/chat.js';
import { executeTool, isWriteTool, buildApprovalRequest, buildBlocksFromToolResult } from './tools.js';
import { getAllToolDefinitions, dynamicToolLabel } from './dynamic-tool-bridge.js';
import { createLLMClient } from './llm-client.js';
import type { ChatMessage, LLMClient } from './llm-types.js';
import { parseSuggestions } from '../lib/suggestions.js';
import { buildPersonaPrompt, DEFAULT_PERSONA, type Persona } from '../lib/persona.js';
import { AGENT_NAME } from '../lib/branding.js';
import { setMemoryFileIO, loadMemories, getMemories, mergeMemory, isMemoryInitialized } from './memory/memory-store.js';
import { extractFromToolResult } from './memory/memory-extractor.js';
import { retrieveMemories, formatMemoriesForPrompt } from './memory/memory-retriever.js';
import type { MemoryEntry } from './memory/memory-types.js';
import type { ExtractedMemory } from './memory/memory-extractor.js';
import { getUserHash } from '../lib/user-hash.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

function getDataDir(): string {
  const isProduction = process.env.NODE_ENV === 'production' || process.env.FLOWSPACE_PRODUCTION === '1';
  return isProduction
    ? path.join(os.homedir(), 'Library', 'Application Support', 'FlowSpace')
    : path.resolve(process.cwd());
}

function initMemoryForUser(userEmail: string | undefined): boolean {
  if (!userEmail) {
    console.warn('[memory] No userEmail provided - memory system disabled');
    return false;
  }

  if (isMemoryInitialized()) {
    console.log('[memory] Already initialized');
    return true;
  }

  try {
    const userHash = getUserHash(userEmail);
    const memoryDir = path.join(getDataDir(), '.memory');
    if (!fs.existsSync(memoryDir)) {
      fs.mkdirSync(memoryDir, { recursive: true });
      console.log('[memory] Created memory directory:', memoryDir);
    }
    const memoryPath = path.join(memoryDir, `${userHash}.json`);
    console.log('[memory] Initializing for user:', userEmail, '-> hash:', userHash, '-> path:', memoryPath);

    setMemoryFileIO({
      exists: (p: string) => fs.existsSync(p),
      read: (p: string) => fs.readFileSync(p, 'utf-8'),
      write: (p: string, data: string) => fs.writeFileSync(p, data, 'utf-8'),
      rename: (oldP: string, newP: string) => fs.renameSync(oldP, newP),
      getFilePath: () => memoryPath,
    }, userHash);

    loadMemories();
    console.log('[memory] Loaded', getMemories().length, 'memories');
    return true;
  } catch (err) {
    console.error('[memory] Failed to initialize:', err);
    return false;
  }
}

function generateThreadBriefSuggestion(extractedMemories: ExtractedMemory[]): string | undefined {
  const resourceMemories = extractedMemories.filter((m) => m.category === 'resource');
  if (resourceMemories.length === 0) return undefined;

  const mostRecent = resourceMemories[resourceMemories.length - 1];
  if (!mostRecent.metadata) return undefined;

  const { spreadsheetId, docId, fileId, folderId, url, title } = mostRecent.metadata as Record<string, unknown>;
  const resourceId = spreadsheetId || docId || fileId || folderId;
  if (!resourceId && !url) return undefined;

  const resourceName = mostRecent.content || title || 'resource';
  return `This thread created/modified ${resourceName}.`;
}

function buildSystemPrompt(userTz?: string, persona?: Persona, threadBrief?: string, memories?: MemoryEntry[]): string {
  const tz = userTz || Intl.DateTimeFormat().resolvedOptions().timeZone;
  const now = new Date().toLocaleString('en-US', { timeZone: tz, weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
  const threadContext = threadBrief?.trim()
    ? `\nOptional thread brief:\n${threadBrief.trim()}\n\nUse this as persistent context for this thread only. Treat it as background guidance, not as a replacement for the user's latest request.\n`
    : '';

  const memoryContext = memories && memories.length > 0
    ? `\n${formatMemoriesForPrompt(memories)}\n\nMemory usage rules:
- When you use a memory to take action, be transparent: tell the user which resource you found and include its URL as a clickable link so they can verify. Example: "I found your **Job Applications** spreadsheet ([open](URL)) — I'll add this entry there."
- NEVER show raw resource IDs, spreadsheet IDs, doc IDs, or folder IDs in your messages. Use titles/names and URLs instead.
- Always show the user WHERE data will go before proposing a write action — include the resource name and link.\n`
    : '';

  return `You are ${AGENT_NAME}, an AI agent that helps users manage their Google Workspace.
You have access to tools that can read and write to Google Drive, Gmail, Calendar, and Tasks.

Current date and time: ${now} (${tz})
${threadContext}${memoryContext}

Guidelines:
- Be concise, warm, and helpful. Write like a trusted human assistant, not a robot.
- NEVER dump raw JSON in your responses. When you receive JSON data from tools, interpret it and present the information in natural language with markdown formatting.
- Use headers (##), bullet points, bold text, and tables to make responses scannable.
- For calendar summaries: show each event with its time, title, and any relevant details — use a clean list format.
- For email summaries: group by priority or sender, highlight what needs action.
- Treat write actions as proposals until the user explicitly approves them.
- When the user asks you to draft, compose, or write an email reply, use compose_email (NOT send_email). compose_email shows an editable draft card that the user can review, edit, and send directly. Only use send_email when the user explicitly says "send it now" and has already reviewed the content. For replies to existing email threads, always include the thread_id in compose_email so the reply is threaded correctly. If the user asks you to revise a draft, call compose_email again with the updated content.
- When showing search results, include relevant details like dates, senders, file types.
- Use the standup_report, meeting_prep, weekly_digest workflows when users ask for summaries or reports.
- Use calendar_agenda for meeting prep and daily overviews — it returns attendees, linked docs, and prep notes (richer than list_calendar_events).
- Use gmail_triage when users ask about their inbox or want email prioritization — it auto-categorizes emails by urgency.
- Use sheets_read, sheets_append, sheets_create, and sheets_update for spreadsheet operations. sheets_create creates a new spreadsheet (optionally with initial data via the values parameter). IMPORTANT: when creating a spreadsheet, always include both headers AND any data rows the user mentioned or that you can extract from conversation context in the values parameter — never create a sheet with only headers if the user provided actual data to populate. sheets_update writes values to specific cells. sheets_append adds rows after existing data. All three write tools require approval.
- Use docs_read to read the content of a Google Doc.
- Use docs_write to append content to Google Docs (requires approval). Only append mode is supported.
- Use review_overdue_tasks to surface tasks that are past due.
- Use save_email_to_doc to archive email threads as Google Docs (requires approval).
- Use archive_email_threads to archive Gmail threads by removing them from Inbox (requires approval).
- Use trash_email_threads to move Gmail threads to Trash (requires approval).
- Use restore_email_threads, mute_email_threads, mark_threads_read, apply_label_to_threads, unsubscribe_from_sender, and create_gmail_filter for bulk Gmail inbox actions (all require approval).
- Use drive_upload to upload files to Drive (requires approval).
- Use create_tool when the user asks for something no existing tool can do but that CAN be done by chaining existing tools together. For example, if they want "create an expense tracker", you can create a tool that calls sheets_create and sheets_update in sequence. The new tool is saved for future reuse. Always explain what tool you're creating and what steps it contains.
- If a tool returns a "File not found" or 404 error (e.g., if a doc_id is invalid or the file was deleted), explain this to the user and offer to create a new file instead of continuing with the old ID.
- Keep responses focused — don't repeat back the raw data you received.

- When searching emails, construct precise Gmail queries using operators:
  from:sender, subject:keyword, "exact phrase", is:unread, has:attachment, newer_than:7d
  Combine with spaces (AND) or OR. Example: from:amex subject:(warranty OR "purchase protection")
  Start specific. Only broaden if no results found.
  For inbox sweeps such as "check urgent emails" or "review unread email", request a larger search limit like 25 unless the user asked for a smaller sample.
- STRICT RELEVANCE RULE: After receiving search results, ONLY present items directly relevant to the user's request.
  Discard old, duplicate, or tangential matches entirely — do not mention them, do not list them, do not show "related" items.
  For meeting prep: only show the specific upcoming meeting, its docs, and its most relevant email. Ignore past seminars or events from other dates.
- When results appear in structured cards (EMAIL MATCHES, DRIVE MATCHES, etc.), do NOT repeat them in your text.
  Write a brief 1-sentence reference (e.g. "Found the seminar announcement email") and let the card show details.
- Avoid showing raw email headers, forwarded-email metadata, or HTML artifacts in your response.
  Extract and present only the meaningful content (date, time, location, speaker, topic).

PROACTIVE SUGGESTIONS (MANDATORY):
At the end of EVERY response, add 2-3 follow-up action suggestions using this exact format:
[SUGGEST: action text here]

These become clickable buttons for the user. Choose actions that are:
- Concrete next steps based on what you just found/did
- Actionable (things you can actually do with your tools)
- Varied (mix of read actions, write actions, and queries)

Examples:
  After finding an email about a meeting:
    [SUGGEST: Add this to my calendar]
    [SUGGEST: Create prep notes]
    [SUGGEST: Draft a reply to the organizer]
  After showing a standup report:
    [SUGGEST: Send this as an email]
    [SUGGEST: Create tasks from action items]
  After triaging inbox:
    [SUGGEST: Draft replies to urgent emails]
    [SUGGEST: Create tasks from action-required items]

NEVER skip the [SUGGEST: ...] markers. Always provide at least 2.

${buildPersonaPrompt(persona ?? DEFAULT_PERSONA)}`;
}

interface HandleChatOptions {
  onEvent?: (event: ChatStreamEvent) => void;
  signal?: AbortSignal;
  userTz?: string;
  runId?: string;
  sourceMessageId?: string;
  persona?: Persona;
  threadBrief?: string;
  userEmail?: string;
}

function emit(onEvent: HandleChatOptions['onEvent'], event: ChatStreamEvent) {
  onEvent?.(event);
}

export function chunkText(text: string): string[] {
  const normalized = text.trim();
  if (!normalized) return [];

  const chunks: string[] = [];
  let remaining = normalized;
  while (remaining.length > 0) {
    const slice = remaining.slice(0, 140);
    const lastSpace = slice.lastIndexOf(' ');
    const next = remaining.length <= 140
      ? remaining
      : slice.slice(0, lastSpace > 40 ? lastSpace : 140);
    chunks.push(next);
    remaining = remaining.slice(next.length).trimStart();
  }
  return chunks;
}

export function toolLabel(toolName: string): string {
  switch (toolName) {
    case 'search_drive': return 'Searching Drive';
    case 'list_drive_files': return 'Listing recent Drive files';
    case 'search_emails': return 'Searching Gmail';
    case 'read_email': return 'Reading email';
    case 'list_calendar_events': return 'Checking calendar';
    case 'list_tasks': return 'Checking tasks';
    case 'standup_report': return 'Building standup report';
    case 'meeting_prep': return 'Preparing meeting brief';
    case 'weekly_digest': return 'Building weekly digest';
    case 'send_email': return 'Preparing email';
    case 'compose_email': return 'Composing email draft';
    case 'create_calendar_event': return 'Preparing calendar event';
    case 'create_task': return 'Preparing task';
    case 'create_drive_folder': return 'Preparing Drive folder';
    case 'calendar_agenda': return 'Loading agenda';
    case 'gmail_triage': return 'Triaging inbox';
    case 'sheets_read': return 'Reading spreadsheet';
    case 'sheets_create': return 'Creating spreadsheet';
    case 'sheets_update': return 'Preparing spreadsheet edit';
    case 'docs_write': return 'Preparing document edit';
    case 'sheets_append': return 'Preparing spreadsheet update';
    case 'drive_upload': return 'Preparing file upload';
    case 'review_overdue_tasks': return 'Checking overdue tasks';
    case 'save_email_to_doc': return 'Preparing email-to-doc';
    case 'archive_email_threads': return 'Preparing email archive';
    case 'trash_email_threads': return 'Preparing email delete';
    case 'restore_email_threads': return 'Preparing inbox restore';
    case 'mute_email_threads': return 'Preparing mute action';
    case 'mark_threads_read': return 'Preparing mark-as-read action';
    case 'apply_label_to_threads': return 'Preparing label update';
    case 'unsubscribe_from_sender': return 'Preparing unsubscribe check';
    case 'create_gmail_filter': return 'Preparing Gmail filter';
    case 'create_tool': return 'Creating new tool';
    default: {
      const dynamic = dynamicToolLabel(toolName);
      return dynamic ? `Running ${dynamic}` : `Running ${toolName}`;
    }
  }
}

/** Generate a verbose running label that includes argument context. */
export function verboseRunningLabel(toolName: string, args: Record<string, unknown>): string {
  switch (toolName) {
    case 'search_drive': return `Searching Drive for "${args.query}"`;
    case 'search_emails': return `Searching Gmail for "${args.query}"`;
    case 'read_email': return `Reading email ${String(args.message_id ?? '').slice(0, 12)}…`;
    case 'list_calendar_events': return `Checking calendar (next ${args.days ?? 7} days)`;
    case 'list_drive_files': return `Listing ${args.limit ?? 10} recent Drive files`;
    case 'list_tasks': return `Listing open tasks`;
    case 'standup_report': return 'Gathering calendar + tasks for standup';
    case 'meeting_prep': return 'Gathering agenda, attendees, and docs';
    case 'weekly_digest': return "Compiling this week's events and emails";
    case 'calendar_agenda': return `Loading today's agenda`;
    case 'gmail_triage': return `Triaging ${args.limit ?? 20} unread emails`;
    case 'sheets_read': return `Reading spreadsheet range ${args.range ?? ''}`;
    case 'sheets_create': return `Creating spreadsheet "${args.title ?? ''}"`;
    case 'sheets_update': return `Updating spreadsheet range ${args.range ?? ''}`;
    case 'send_email': return `Drafting email to ${args.to ?? 'recipient'}`;
    case 'compose_email': return `Composing draft to ${args.to ?? 'recipient'}`;
    case 'create_calendar_event': return `Creating event "${args.summary ?? ''}"`;
    case 'create_task': return `Creating task "${args.title ?? ''}"`;
    case 'docs_write': return `Writing to document`;
    case 'sheets_append': return `Appending rows to spreadsheet`;
    case 'drive_upload': return `Uploading ${args.file_path ?? 'file'}`;
    case 'review_overdue_tasks': return 'Scanning for overdue tasks';
    case 'save_email_to_doc': return 'Saving email thread as Doc';
    case 'archive_email_threads': {
      const count = Array.isArray(args.thread_ids) ? args.thread_ids.length : String(args.thread_ids ?? '').split(',').filter(Boolean).length;
      return `Archiving ${count || 1} email thread${count === 1 || count === 0 ? '' : 's'}`;
    }
    case 'trash_email_threads': {
      const count = Array.isArray(args.thread_ids) ? args.thread_ids.length : String(args.thread_ids ?? '').split(',').filter(Boolean).length;
      return `Trashing ${count || 1} email thread${count === 1 || count === 0 ? '' : 's'}`;
    }
    case 'restore_email_threads': return `Restoring ${String(args.thread_ids ?? '').split(',').filter(Boolean).length || 1} email threads to Inbox`;
    case 'mute_email_threads': return `Muting ${String(args.thread_ids ?? '').split(',').filter(Boolean).length || 1} email threads`;
    case 'mark_threads_read': return `Marking ${String(args.thread_ids ?? '').split(',').filter(Boolean).length || 1} email threads as read`;
    case 'apply_label_to_threads': return `Applying label "${args.label_name ?? ''}"`;
    case 'unsubscribe_from_sender': return 'Checking unsubscribe support';
    case 'create_gmail_filter': return `Creating Gmail filter`;
    default: return toolLabel(toolName);
  }
}

/** Generate a verbose completion summary from tool result. */
export function verboseCompletedDetail(toolName: string, result: string): string {
  try {
    const parsed = JSON.parse(result);
    switch (toolName) {
      case 'search_drive': {
        const count = parsed?.files?.length ?? 0;
        return count === 0 ? 'No files found' : `Found ${count} file${count !== 1 ? 's' : ''}`;
      }
      case 'search_emails': {
        const count = parsed?.messages?.length ?? 0;
        if (count === 0) return 'No emails found';
        const estimate = parsed?.resultSizeEstimate;
        if (parsed?.truncated && typeof estimate === 'number' && estimate > count) {
          return `Found ${count} of about ${estimate} email${estimate !== 1 ? 's' : ''}`;
        }
        return `Found ${count} email${count !== 1 ? 's' : ''}`;
      }
      case 'read_email': {
        const subj = parsed?.subject ?? '';
        return subj ? `Read: "${subj.slice(0, 60)}"` : 'Email read';
      }
      case 'list_calendar_events': {
        const count = parsed?.items?.length ?? 0;
        return `${count} upcoming event${count !== 1 ? 's' : ''}`;
      }
      case 'list_drive_files': {
        const count = parsed?.files?.length ?? 0;
        return `${count} recent file${count !== 1 ? 's' : ''}`;
      }
      case 'list_tasks': {
        const count = parsed?.items?.length ?? 0;
        return `${count} open task${count !== 1 ? 's' : ''}`;
      }
      case 'calendar_agenda': {
        const events = parsed?.events ?? parsed?.items ?? (Array.isArray(parsed) ? parsed : []);
        return `${events.length} event${events.length !== 1 ? 's' : ''} on agenda`;
      }
      case 'gmail_triage': {
        const t = parsed?.triage ?? parsed?.buckets ?? parsed;
        const total = (t?.action_required?.length ?? 0) + (t?.review?.length ?? 0) + (t?.low_priority?.length ?? 0);
        return `Triaged ${total} email${total !== 1 ? 's' : ''}`;
      }
      case 'sheets_read': {
        const rows = parsed?.values?.length ?? 0;
        return rows > 0 ? `Read ${rows} row${rows !== 1 ? 's' : ''}` : 'Spreadsheet read';
      }
      case 'sheets_create': {
        const title = parsed?.properties?.title;
        return title ? `Created "${title}"` : 'Spreadsheet created';
      }
      case 'sheets_update': {
        const cells = parsed?.updatedCells ?? 0;
        return cells > 0 ? `Updated ${cells} cell${cells !== 1 ? 's' : ''}` : 'Spreadsheet updated';
      }
      case 'compose_email': {
        const to = parsed?.to ?? '';
        return to ? `Draft ready for ${to}` : 'Draft ready';
      }
      case 'review_overdue_tasks': {
        const tasks = parsed?.tasks ?? parsed?.items ?? (Array.isArray(parsed) ? parsed : []);
        return `${tasks.length} overdue task${tasks.length !== 1 ? 's' : ''}`;
      }
      case 'archive_email_threads': {
        const count = parsed?.succeeded_count ?? parsed?.archived ?? 0;
        return `Archived ${count} email thread${count !== 1 ? 's' : ''}`;
      }
      case 'trash_email_threads':
        return `Trashed ${parsed?.succeeded_count ?? 0} email thread${(parsed?.succeeded_count ?? 0) !== 1 ? 's' : ''}`;
      case 'restore_email_threads':
        return `Restored ${parsed?.succeeded_count ?? 0} email thread${(parsed?.succeeded_count ?? 0) !== 1 ? 's' : ''}`;
      case 'mute_email_threads':
        return `Muted ${parsed?.succeeded_count ?? 0} email thread${(parsed?.succeeded_count ?? 0) !== 1 ? 's' : ''}`;
      case 'mark_threads_read':
        return `Marked ${parsed?.succeeded_count ?? 0} email thread${(parsed?.succeeded_count ?? 0) !== 1 ? 's' : ''} as read`;
      case 'apply_label_to_threads':
        return `Labeled ${parsed?.succeeded_count ?? 0} email thread${(parsed?.succeeded_count ?? 0) !== 1 ? 's' : ''}`;
      case 'unsubscribe_from_sender':
        return parsed?.message ?? 'Checked unsubscribe support';
      case 'create_gmail_filter':
        return parsed?.message ?? 'Created Gmail filter';
      default:
        return 'Done';
    }
  } catch {
    // Non-JSON result or tool returned plain text
    if (result.startsWith('Error:')) return result.slice(0, 80);
    if (result.includes('No messages found')) return 'No emails found';
    return 'Done';
  }
}

export function updateToolEvent(events: ToolEvent[], next: ToolEvent): ToolEvent[] {
  const existingIndex = events.findIndex((event) => event.id === next.id);
  if (existingIndex === -1) return [...events, next];
  const copy = [...events];
  copy[existingIndex] = next;
  return copy;
}

function approvalMessage(toolName: string): string {
  switch (toolName) {
    case 'send_email':
      return 'I drafted an email and stopped before sending it. Review the approval card and confirm if it looks right.';
    case 'create_calendar_event':
      return 'I prepared a calendar event draft. Review the details and approve it when you are ready.';
    case 'create_task':
      return 'I prepared a task for Google Tasks. Review the fields and approve it if you want me to create it.';
    case 'create_drive_folder':
      return 'I prepared a new Drive folder. Review the details and approve the action to create it.';
    case 'docs_write':
      return 'I prepared content for a Google Doc. Review the text and approve it to write.';
    case 'sheets_append':
      return 'I prepared rows to add to a spreadsheet. Review the data and approve to append.';
    case 'sheets_create':
      return 'I prepared a new spreadsheet. Review the title and initial data, then approve to create it.';
    case 'sheets_update':
      return 'I prepared changes to a spreadsheet. Review the data and approve to write the values.';
    case 'drive_upload':
      return 'I prepared a file upload to Drive. Review the details and approve to upload.';
    case 'save_email_to_doc':
      return 'I prepared to save an email thread as a Doc. Review and approve to proceed.';
    case 'archive_email_threads':
      return 'I prepared an inbox archive action. Review the thread IDs and approve it to remove those emails from Inbox.';
    case 'trash_email_threads':
      return 'I prepared a delete action. Review the thread IDs and approve it to move those emails to Gmail Trash.';
    case 'restore_email_threads':
      return 'I prepared an inbox restore action. Review the thread IDs and approve it to return those emails to Inbox.';
    case 'mute_email_threads':
      return 'I prepared a Gmail mute action. Review the thread IDs and approve it to mute future replies.';
    case 'mark_threads_read':
      return 'I prepared a mark-as-read action. Review the thread IDs and approve it to remove the unread state.';
    case 'apply_label_to_threads':
      return 'I prepared a Gmail label update. Review the selected threads and label name, then approve it to continue.';
    case 'unsubscribe_from_sender':
      return 'I prepared a safe unsubscribe check. Review it and approve to continue.';
    case 'create_gmail_filter':
      return 'I prepared a Gmail filter draft. Review the criteria and approve it to create the filter.';
    default:
      return 'I prepared a write action and stopped for approval. Review the details before continuing.';
  }
}

function getClient(): LLMClient {
  return createLLMClient();
}

function ensureNotAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw new DOMException('The request was aborted.', 'AbortError');
  }
}

function wantsRedDeadlineEmphasis(persona?: Persona): boolean {
  const ci = persona?.customInstructions?.toLowerCase() ?? '';
  if (!ci) return false;
  return ci.includes('deadline') && (ci.includes('red') || ci.includes('color'));
}

export function applyPersonaContentRules(content: string, persona?: Persona): string {
  if (!wantsRedDeadlineEmphasis(persona)) return content;
  if (content.includes('!!')) return content;

  let next = content;
  next = next.replace(
    /(\bdeadline\b\s*:\s*)([^\n]+)/gi,
    (_m, prefix: string, value: string) => `${prefix}!!${value.trim()}!!`,
  );

  const monthDate = /\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+\d{1,2}(?:,\s*\d{4})?\b/g;
  next = next.replace(monthDate, (m) => `!!${m}!!`);

  const numericDate = /\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/g;
  next = next.replace(numericDate, (m) => `!!${m}!!`);
  return next;
}

export function buildAutomaticSuggestions(payload: AssistantPayload): string[] {
  const suggestions: string[] = [];
  const emailBlock = payload.blocks.find((block) => block.type === 'email_list');
  if (emailBlock && /showing \d+ of about \d+/i.test(emailBlock.title)) {
    suggestions.push('Show more matching emails');
    suggestions.push('Expand search to 50 unread emails');
    suggestions.push('Narrow these results by sender or subject');
  }
  return suggestions;
}

function emitFinalPayload(onEvent: HandleChatOptions['onEvent'], payload: AssistantPayload, persona?: Persona) {
  const personaAdjustedContent = applyPersonaContentRules(payload.content, persona);
  // Parse [SUGGEST: ...] markers from content into structured suggestions
  const { cleanContent, suggestions } = parseSuggestions(personaAdjustedContent);
  const automaticSuggestions = buildAutomaticSuggestions(payload);
  const mergedSuggestions = [...new Set([...suggestions, ...automaticSuggestions])].slice(0, 4);
  const enriched: AssistantPayload = {
    ...payload,
    content: cleanContent,
    suggestions: mergedSuggestions.length > 0 ? mergedSuggestions : undefined,
  };

  for (const chunk of chunkText(enriched.content)) {
    emit(onEvent, { type: 'assistant_chunk', chunk });
  }
  emit(onEvent, { type: 'assistant_complete', payload: enriched });
}

export async function handleChat(
  messages: ChatMessageInput[],
  options: HandleChatOptions = {},
): Promise<AssistantPayload> {
  const client = getClient();
  const onEvent = options.onEvent;
  const signal = options.signal;
  let toolEvents: ToolEvent[] = [];
  const blocks: AssistantPayload['blocks'] = [];

  // Initialize memory for user
  const memoryInitialized = initMemoryForUser(options.userEmail);
  let retrievedMemories: MemoryEntry[] = [];
  let allExtractedMemories: ExtractedMemory[] = [];

  if (memoryInitialized) {
    try {
      loadMemories();
      const lastUserMessage = [...messages].reverse().find((m) => m.role === 'user');
      if (lastUserMessage) {
        const query = lastUserMessage.content;
        const results = retrieveMemories(query, [...getMemories()], { maxResults: 5 });
        retrievedMemories = results.map((r) => r.entry);
      }
    } catch (err) {
      console.error('Memory retrieval failed:', err);
    }
  }

  ensureNotAborted(signal);
  emit(onEvent, { type: 'assistant_begin' });

  const chatMessages: ChatMessage[] = [
    { role: 'system', content: buildSystemPrompt(options.userTz, options.persona, options.threadBrief, retrievedMemories) },
    ...messages.map((message) => ({
      role: message.role as 'user' | 'assistant',
      content: message.content,
    })),
  ];

  let response = await client.complete(chatMessages, { tools: getAllToolDefinitions(), signal });

  for (let round = 0; round < 5; round++) {
    ensureNotAborted(signal);
    const choice = response.choices[0];
    if (!choice) break;

    const toolCalls = choice.message.tool_calls;
    if (!toolCalls || toolCalls.length === 0 || choice.finish_reason !== 'tool_calls') {
      const payload: AssistantPayload = {
        content: choice.message.content || 'Done.',
        blocks,
        toolEvents,
      };
      emitFinalPayload(onEvent, payload, options.persona);
      return payload;
    }

    // Push the assistant message (with tool_calls) into the conversation
    chatMessages.push({
      role: 'assistant',
      content: choice.message.content,
      tool_calls: choice.message.tool_calls ? [...choice.message.tool_calls] : undefined,
    });

    for (const toolCall of toolCalls) {
      if (toolCall.type !== 'function') continue;

      const toolName = toolCall.function.name;
      let args: Record<string, unknown>;
      try {
        args = JSON.parse(toolCall.function.arguments);
      } catch {
        const errorResult = `Error: Failed to parse tool arguments for ${toolName}. The arguments were not valid JSON.`;
        chatMessages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: errorResult,
        });
        const errorEvent: ToolEvent = {
          id: toolCall.id,
          toolName,
          label: toolLabel(toolName),
          status: 'error',
          detail: 'Malformed tool arguments from model.',
        };
        toolEvents = updateToolEvent(toolEvents, errorEvent);
        emit(onEvent, { type: 'tool_event', event: errorEvent });
        continue;
      }

      const runningEvent: ToolEvent = {
        id: toolCall.id,
        toolName,
        label: verboseRunningLabel(toolName, args),
        status: 'running',
      };
      toolEvents = updateToolEvent(toolEvents, runningEvent);
      emit(onEvent, { type: 'tool_event', event: runningEvent });

      if (isWriteTool(toolName)) {
        const approval = buildApprovalRequest(toolName, args);
        if (options.runId) approval.runId = options.runId;
        if (options.sourceMessageId) approval.sourceMessageId = options.sourceMessageId;
        const approvalEvent: ToolEvent = {
          ...runningEvent,
          status: 'approval_required',
          detail: 'Waiting for explicit approval before executing.',
        };
        toolEvents = updateToolEvent(toolEvents, approvalEvent);
        emit(onEvent, { type: 'tool_event', event: approvalEvent });

        const payload: AssistantPayload = {
          content: approvalMessage(toolName),
          blocks,
          toolEvents,
          approval,
        };
        emitFinalPayload(onEvent, payload, options.persona);
        return payload;
      }

      try {
        const result = await executeTool(toolName, args, signal);

        // Navigation tools — emit navigate event to switch the UI view
        if (toolName === 'open_email_triage') {
          emit(onEvent, { type: 'navigate', view: 'gmail', tab: 'triage' });
        } else if (toolName === 'check_email_triage') {
          emit(onEvent, { type: 'navigate', view: 'gmail', tab: 'triage', refresh: true });
        }

        const newBlocks = buildBlocksFromToolResult(toolName, result);
        // Deduplicate: for list-type blocks, only keep the latest of each type
        // (e.g. multiple search_emails calls should show one EMAIL MATCHES, not three)
        for (const nb of newBlocks) {
          const listTypes = new Set(['email_list', 'file_list', 'event_list', 'task_list', 'agenda', 'triage', 'sheet_data']);
          const existingIdx = listTypes.has(nb.type)
            ? blocks.findIndex((b) => b.type === nb.type)
            : blocks.findIndex((b) => b.type === nb.type && b.title === nb.title);
          if (existingIdx !== -1) {
            blocks[existingIdx] = nb;
          } else {
            blocks.push(nb);
          }
        }
        // Extract memories from tool result (for read tools and non-approval write tools)
        if (!result.startsWith('Error:') && memoryInitialized) {
          try {
            const extracted = extractFromToolResult({ toolName, args, result });
            console.log('[memory] Extraction result for', toolName, ':', extracted.length, 'memories');
            for (const mem of extracted) {
              allExtractedMemories.push(mem);
              const entry = mergeMemory({
                category: mem.category,
                content: mem.content,
                tags: mem.tags,
                metadata: mem.metadata,
                resourceIds: mem.resourceIds,
                source: mem.source,
              });
              console.log('[memory] Saved memory:', entry.id, '-', entry.content);
            }
          } catch (err) {
            console.error('[memory] Memory extraction failed:', err);
          }
        } else if (result.startsWith('Error:')) {
          console.log('[memory] Skipping extraction for error result');
        } else if (!memoryInitialized) {
          console.log('[memory] Skipping extraction - memory not initialized');
        }

        chatMessages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: result,
        });

        const completedEvent: ToolEvent = {
          ...runningEvent,
          label: toolLabel(toolName),
          status: result.startsWith('Error:') ? 'error' : 'completed',
          detail: result.startsWith('Error:') ? result.slice(0, 180) : verboseCompletedDetail(toolName, result),
        };
        toolEvents = updateToolEvent(toolEvents, completedEvent);
        emit(onEvent, { type: 'tool_event', event: completedEvent });
      } catch (error: any) {
        const failedEvent: ToolEvent = {
          ...runningEvent,
          status: 'error',
          detail: error?.message || 'Tool execution failed.',
        };
        toolEvents = updateToolEvent(toolEvents, failedEvent);
        emit(onEvent, { type: 'tool_event', event: failedEvent });
        throw error;
      }
    }

    response = await client.complete(chatMessages, { tools: getAllToolDefinitions(), signal });
  }

  // If the last response was a tool-call (no text content), make one final call
  // without tools to force the model to produce a text summary of what it found.
  let finalContent = response.choices[0]?.message?.content;
  if (!finalContent) {
    ensureNotAborted(signal);
    const summaryResponse = await client.complete(
      [...chatMessages, { role: 'user' as const, content: 'Summarize what you found from the tool calls above. Do not call any more tools.' }],
      { signal },
    );
    finalContent = summaryResponse.choices[0]?.message?.content || 'I completed the requested actions.';
  }

  const payload: AssistantPayload = {
    content: finalContent,
    blocks,
    toolEvents,
    memoriesUsed: retrievedMemories.length > 0
      ? retrievedMemories.slice(0, 5).map((m) => ({ id: m.id, content: m.content, category: m.category }))
      : undefined,
    threadBriefSuggestion: generateThreadBriefSuggestion(allExtractedMemories),
  };
  emitFinalPayload(onEvent, payload, options.persona);
  return payload;
}

export async function executeApprovedAction(
  approval: ApprovalRequest,
  options: HandleChatOptions = {},
): Promise<AssistantPayload> {
  const onEvent = options.onEvent;
  const signal = options.signal;
  let toolEvents: ToolEvent[] = [];

  // Initialize memory for user
  const memoryInitialized = initMemoryForUser(options.userEmail);
  let extractedMemories: ExtractedMemory[] = [];

  ensureNotAborted(signal);
  emit(onEvent, { type: 'assistant_begin' });

  const args = approval.fields.reduce<Record<string, string>>((acc, field) => {
    if (field.value.trim()) acc[field.key] = field.value;
    return acc;
  }, {});

  const started: ToolEvent = {
    id: approval.id,
    toolName: approval.toolName,
    label: toolLabel(approval.toolName),
    status: 'running',
  };
  toolEvents = updateToolEvent(toolEvents, started);
  emit(onEvent, { type: 'tool_event', event: started });

  const result = await executeTool(approval.toolName, args, signal);
  const finalEvent: ToolEvent = {
    ...started,
    status: result.startsWith('Error:') ? 'error' : 'completed',
    detail: result.startsWith('Error:') ? result.slice(0, 180) : 'Approved action executed.',
  };
  toolEvents = updateToolEvent(toolEvents, finalEvent);
  emit(onEvent, { type: 'tool_event', event: finalEvent });

  // Extract memories from approved write tool result
  if (!result.startsWith('Error:') && memoryInitialized) {
    try {
      extractedMemories = extractFromToolResult({ toolName: approval.toolName, args, result });
      console.log('[memory] Extraction result for approved', approval.toolName, ':', extractedMemories.length, 'memories');
      for (const mem of extractedMemories) {
        const entry = mergeMemory({
          category: mem.category,
          content: mem.content,
          tags: mem.tags,
          metadata: mem.metadata,
          resourceIds: mem.resourceIds,
          source: mem.source,
        });
        console.log('[memory] Saved memory from approval:', entry.id, '-', entry.content);
      }
    } catch (err) {
      console.error('[memory] Memory extraction failed in executeApprovedAction:', err);
    }
  }

  // Build a richer success message for tools that produce referenceable output
  let successContent = 'Approved action completed successfully.';
  if (!result.startsWith('Error:')) {
    try {
      const parsed = JSON.parse(result);
      if (approval.toolName === 'sheets_create' && parsed?.spreadsheetId) {
        const title = parsed.properties?.title ?? 'Untitled';
        const url = parsed.spreadsheetUrl ?? '';
        successContent = `Created spreadsheet "${title}" (ID: ${parsed.spreadsheetId}).${url ? `\nOpen it here: ${url}` : ''}`;
      }
    } catch { /* non-JSON result, use default message */ }
  }

  const payload: AssistantPayload = {
    content: result.startsWith('Error:')
      ? `The approved action failed.\n\n${result}`
      : successContent,
    blocks: buildBlocksFromToolResult(approval.toolName, result),
    toolEvents,
    suggestions: result.startsWith('Error:')
      ? ['Retry this action', 'Show me the failed threads']
      : approval.toolName === 'archive_email_threads'
        ? ['Mute similar senders', 'Create a filter for these emails', 'Review action-required emails']
        : approval.toolName === 'mark_threads_read'
          ? ['Archive these emails too', 'Review action-required emails']
          : approval.toolName === 'create_gmail_filter'
            ? ['Apply this filter strategy to another sender', 'Review recent inbox actions']
            : undefined,
    threadBriefSuggestion: generateThreadBriefSuggestion(extractedMemories),
  };

  emitFinalPayload(onEvent, payload, options.persona);
  return payload;
}
