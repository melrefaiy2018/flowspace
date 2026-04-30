import { AGENT_NAME } from '../lib/branding.js';
import { buildPersonaPrompt, DEFAULT_PERSONA, type Persona } from '../lib/persona.js';
import { formatMemoriesForPrompt } from './memory/memory-retriever.js';
import type { MemoryEntry } from './memory/memory-types.js';
import { parseThreadBrief } from '../shared/chat.js';

export interface AssembleContextOptions {
  userTz?: string;
  persona?: Persona;
  threadBrief?: string;
  memories?: MemoryEntry[];
  userHash?: string;
  conversationSummary?: string;
  /** Unix timestamp (ms) when the conversation summary was last generated. */
  conversationSummaryUpdatedAt?: number;
}

/**
 * Format a timestamp as a human-readable relative or absolute string.
 * E.g. "2 hours ago" or "today at 3:15 PM".
 */
function formatSummaryTimestamp(updatedAt: number): string {
  const now = Date.now();
  const diffMs = now - updatedAt;
  const diffMins = Math.floor(diffMs / 60_000);
  const diffHours = Math.floor(diffMs / 3_600_000);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins} minute${diffMins === 1 ? '' : 's'} ago`;
  if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;

  const date = new Date(updatedAt);
  const timeStr = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  return `today at ${timeStr}`;
}

export function buildSystemPrompt(
  userTz?: string,
  persona?: Persona,
  threadBrief?: string,
  memories?: MemoryEntry[],
  userHash?: string,
  conversationSummary?: string,
  conversationSummaryUpdatedAt?: number,
): string {
  const tz = userTz || Intl.DateTimeFormat().resolvedOptions().timeZone;
  const now = new Date().toLocaleString('en-US', {
    timeZone: tz,
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

  const structured = parseThreadBrief(threadBrief);
  const threadContext = structured
    ? `\nOptional thread brief:\n${structured.type === 'meeting_prep' ? '[Meeting Prep] ' : ''}${structured.summary.trim()}\n\nUse this as persistent context for this thread only. Treat it as background guidance, not as a replacement for the user's latest request.\n`
    : '';

  const memoryContext =
    memories && memories.length > 0
      ? `\n${formatMemoriesForPrompt(memories, userHash)}\n\nMemory usage rules:
- When you use a memory to take action, be transparent: tell the user which resource you found and include its URL as a clickable link so they can verify. Example: "I found your **Job Applications** spreadsheet ([open](URL)) — I'll add this entry there."
- NEVER show raw resource IDs, spreadsheet IDs, doc IDs, or folder IDs in your messages. Use titles/names and URLs instead.
- Always show the user WHERE data will go before proposing a write action — include the resource name and link.\n`
      : '';

  const summaryTimestamp = conversationSummary ? formatSummaryTimestamp(conversationSummaryUpdatedAt ?? Date.now()) : '';
  const summaryContext = conversationSummary
    ? `\n--- Conversation summary (last updated: ${summaryTimestamp}) ---\n${conversationSummary}\n--- End of conversation summary ---\n`
    : '';

  return `You are ${AGENT_NAME}, an AI agent that helps users manage their Google Workspace.
You have access to tools that can read and write to Google Drive, Gmail, Calendar, and Tasks.

Current date and time: ${now} (${tz})
${threadContext}${memoryContext}${summaryContext}
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

/** Thin wrapper around buildSystemPrompt that accepts an options object. */
export function assembleContext(options: AssembleContextOptions): string {
  return buildSystemPrompt(
    options.userTz,
    options.persona,
    options.threadBrief,
    options.memories,
    options.userHash,
    options.conversationSummary,
    options.conversationSummaryUpdatedAt,
  );
}

/** Safe default context window budget (100K tokens). Protects against long-conversation overflow. */
export const MAX_CONTEXT_TOKENS = 100_000;

/** Estimate the number of tokens in a string (approximation: 4 chars per token). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Drop oldest non-system messages when the total estimated token count exceeds
 * the budget. Always preserves the first message and the most recent user message.
 *
 * Accepts any message array with `role` and `content` fields (ChatMessage or
 * ChatMessageInput) and returns the same shape.
 */
export function truncateMessages<T extends { role: string; content: string }>(
  messages: readonly T[],
  maxTokens: number,
): T[] {
  const totalTokens = messages.reduce((sum, m) => sum + estimateTokens(m.content), 0);
  if (totalTokens <= maxTokens) {
    return [...messages];
  }

  // Identify anchors: first message and last user message
  const firstMsg = messages[0];
  const lastUserIdx = [...messages].reduceRight(
    (found, m, i) => (found === -1 && m.role === 'user' ? i : found),
    -1,
  );
  const lastUserMsg = lastUserIdx !== -1 ? messages[lastUserIdx] : null;

  const anchors: T[] = [firstMsg, ...(lastUserMsg ? [lastUserMsg] : [])];
  const anchorTokens = anchors.reduce((s, m) => s + estimateTokens(m.content), 0);

  if (anchorTokens >= maxTokens) {
    return anchors;
  }

  let budget = maxTokens - anchorTokens;
  const kept: T[] = [];

  // Add middle messages from most-recent to oldest until budget exhausted
  const middleFromMostRecent = messages
    .slice(1)
    .filter((_, i) => i + 1 !== lastUserIdx)
    .reverse();

  for (const msg of middleFromMostRecent) {
    const cost = estimateTokens(msg.content);
    if (budget >= cost) {
      kept.unshift(msg);
      budget -= cost;
    }
  }

  return [firstMsg, ...kept, ...(lastUserMsg ? [lastUserMsg] : [])];
}
