import type { GmailThreadDetail } from '../services/api.js';
import type { ContextChip } from '../shared/gmail-enrichment-types.js';

/**
 * Computes up to 4 deterministic context chips from thread metadata only.
 * No LLM involved. Used to seed fallback responses and merged into LLM chips.
 *
 * @param thread - The Gmail thread detail object.
 * @param nowMs  - Optional epoch ms for test determinism; defaults to Date.now().
 */
export function computeDeterministicChips(
  thread: GmailThreadDetail,
  nowMs?: number,
): ContextChip[] {
  const now = nowMs ?? Date.now();
  const chips: ContextChip[] = [];

  if (!thread.messages || thread.messages.length === 0) {
    return chips;
  }

  // ── last_message_age chip ──────────────────────────────────────────────────
  const lastMessage = thread.messages[thread.messages.length - 1];
  const lastMsgAgeChip = buildAgeChip(lastMessage.date, now, 'last_message_age', 'Last message');
  if (lastMsgAgeChip) chips.push(lastMsgAgeChip);

  // ── thread_age chip ────────────────────────────────────────────────────────
  const firstMessage = thread.messages[0];
  if (thread.messages.length > 1 || firstMessage !== lastMessage) {
    const threadAgeChip = buildThreadAgeChip(firstMessage.date, now);
    if (threadAgeChip) chips.push(threadAgeChip);
  } else {
    // Single message: show "New thread" if < 1 day old
    const firstTs = parseDate(firstMessage.date);
    if (firstTs !== null) {
      const ageMs = now - firstTs;
      if (ageMs < MS_PER_DAY) {
        chips.push({ label: 'New thread', kind: 'thread_age' });
      }
    }
  }

  // ── participants chip ──────────────────────────────────────────────────────
  const participantChip = buildParticipantsChip(thread);
  if (participantChip) chips.push(participantChip);

  return chips.slice(0, 4);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
const MS_PER_DAY = 24 * MS_PER_HOUR;

function parseDate(dateStr: string): number | null {
  if (!dateStr) return null;
  const ts = Date.parse(dateStr);
  return isNaN(ts) ? null : ts;
}

function formatAge(ageMs: number): string {
  if (ageMs < MS_PER_HOUR) {
    const mins = Math.floor(ageMs / MS_PER_MINUTE);
    return `${Math.max(mins, 0)}m ago`;
  }
  if (ageMs < MS_PER_DAY) {
    const hours = Math.floor(ageMs / MS_PER_HOUR);
    return `${hours}h ago`;
  }
  const days = Math.floor(ageMs / MS_PER_DAY);
  return `${days}d ago`;
}

function buildAgeChip(
  dateStr: string,
  now: number,
  kind: ContextChip['kind'],
  prefix: string,
): ContextChip | null {
  const ts = parseDate(dateStr);
  if (ts === null) return null;
  const ageMs = now - ts;
  if (ageMs < 0) return null;
  return { label: `${prefix} ${formatAge(ageMs)}`, kind };
}

function buildThreadAgeChip(firstDateStr: string, now: number): ContextChip | null {
  const ts = parseDate(firstDateStr);
  if (ts === null) return null;
  const ageMs = now - ts;
  if (ageMs < 0) return null;
  if (ageMs < MS_PER_DAY) {
    return { label: 'New thread', kind: 'thread_age' };
  }
  const days = Math.floor(ageMs / MS_PER_DAY);
  return { label: `Thread active ${days} days`, kind: 'thread_age' };
}

/** Extract all unique email addresses from To + Cc headers across all messages. */
function buildParticipantsChip(thread: GmailThreadDetail): ContextChip | null {
  // Collect sender email from first message
  const firstFrom = thread.messages[0]?.from ?? '';
  const firstFromEmail = extractEmail(firstFrom).toLowerCase();

  // Detect "internal-only" heuristic: only one distinct sender, no external recipients
  const externalEmails = new Set<string>();

  for (const msg of thread.messages) {
    // Parse To and Cc headers
    const toAddrs = parseAddressList(msg.to);
    const ccAddrs = parseAddressList(msg.cc);

    for (const addr of [...toAddrs, ...ccAddrs]) {
      if (addr && addr !== firstFromEmail) {
        externalEmails.add(addr);
      }
    }
  }

  // Skip if no external participants found or only one internal sender
  if (externalEmails.size === 0) return null;
  if (externalEmails.size === 1 && externalEmails.has(firstFromEmail)) return null;

  const count = externalEmails.size;
  return {
    label: `${count} external participant${count === 1 ? '' : 's'}`,
    kind: 'participants',
  };
}

function extractEmail(raw: string): string {
  const match = raw.match(/<([^>]+)>/);
  if (match) return match[1].toLowerCase();
  return raw.trim().toLowerCase();
}

function parseAddressList(raw: string): string[] {
  if (!raw) return [];
  // Split by comma, handling "Name <email>" format
  return raw
    .split(',')
    .map((s) => extractEmail(s.trim()))
    .filter(Boolean);
}
