import type { GmailThreadSummary, GmailThreadDetail } from '../../services/api.js';

const RECOMMENDED_ACTIONS = [
  'draft_reply', 'nudge', 'decline', 'delegate', 'archive',
  'archive_subscription', 'unsubscribe', 'create_filter',
  'create_task', 'save_to_drive', 'mark_done', 'snooze',
] as const;

const THREAD_TYPE_DESCRIPTIONS = `- personal_reply_needed: Someone is waiting for a reply from you.
- meeting_request: An invitation or scheduling request that needs a response.
- security_alert: A security notice or account alert that warrants a quick review.
- promotional: A marketing or promotional email with no personal content.
- receipt: An order confirmation, invoice, or payment receipt.
- newsletter: A newsletter or digest you subscribed to but rarely act on.
- notification: An automated system notification with no required action.
- other: Unclassified — use when none of the above clearly fits.`;

export function buildListEnrichmentPrompt(threads: readonly GmailThreadSummary[]): { system: string; user: string } {
  const system = `You are FlowSpace's email enrichment engine. Given a list of Gmail thread metadata, return a per-thread enrichment with priority, recommended action, context, effort estimate, bucket assignment, and thread type.

Rules:
- Return ONLY valid JSON in this exact format — no extra text:
{"enrichments":[{"threadId":"...","priority":"high|medium|low|none","recommendedAction":"...","whyItMatters":"...","effortMinutes":"none|1|5|15+","bucket":"needs_reply|waiting|quick_wins|reference_fyi","threadType":"personal_reply_needed|meeting_request|security_alert|promotional|receipt|newsletter|notification|other"}]}

- "priority" must be one of: high, medium, low, none
- "recommendedAction" must be EXACTLY one of: ${RECOMMENDED_ACTIONS.join(', ')} — no other values are accepted
- "whyItMatters" must be one specific sentence, max 120 characters, naming at least one concrete entity from the thread (a date, time, person, document, number, or decision). Generic phrases like "Reply", "Follow up", "Read this", or "Respond to this" are FORBIDDEN — instead write something like "Alice asked about the Tuesday 2pm slot" or "Invoice #1042 due Apr 30"
- "effortMinutes" must be one of: none, 1, 5, 15+
- "bucket" must be one of: needs_reply, waiting, quick_wins, reference_fyi
- Threads that are receipts, confirmations, or automated notifications should get priority "none" and bucket "reference_fyi"
- When in doubt between "quick_wins" and "reference_fyi", prefer "reference_fyi" unless the recommended action is archive_subscription, unsubscribe, create_filter, or mark_done
- Every thread in the input must appear in the output enrichments array
- "threadType" must be exactly one of the following values:
${THREAD_TYPE_DESCRIPTIONS}
- If you cannot confidently assign a thread to one of the listed types, use 'other' — it is a valid and expected fallback, not a failure
- Do NOT include message body content — use only metadata (subject, sender, snippet, date, labels)`;

  if (threads.length === 0) {
    return { system, user: 'I have 0 threads to enrich.' };
  }

  const lines = threads.map((t) =>
    `- ID: "${t.id}" | Subject: "${t.subject}" | From: ${t.from} | Date: ${t.date} | ${t.unread ? 'unread' : 'read'} | Labels: ${t.labelIds.join(',')} | Snippet: "${t.snippet}"`,
  );

  const user = `Enrich these ${threads.length} threads:\n\n${lines.join('\n')}`;

  return { system, user };
}

export function buildThreadBriefPrompt(thread: GmailThreadDetail): { system: string; user: string } {
  const system = `You are FlowSpace's decision helper. Given a Gmail thread, return a one-sentence summary (max 140 chars), a recommended next action sentence that names at least one concrete entity from the thread or the user's context (a date, time, person, document, number, or decision), and up to 4 context chips. Generic phrases alone ("Reply", "Follow up", "Draft a response") are FORBIDDEN — the action must be specific, e.g. "Reply to Alice about the Tuesday 2pm slot" or "Decline — conflicts with sprint review on Apr 15".

Response MUST be valid JSON in this exact shape:
{"summary":"...","recommendedAction":"...","contextChips":[{"label":"...","kind":"reply_state|last_message_age|thread_age|participants|other"}],"firstClassActions":[{"kind":"draft_reply|pick_times|decline|delegate|save_to_drive|nudge"}]}`;

  const maxMessages = 5;
  const maxCharsPerBody = 2000;
  const messages = thread.messages.slice(0, maxMessages);

  const parts = messages.map((m) => {
    const body = m.body.length > maxCharsPerBody ? m.body.slice(0, maxCharsPerBody) + '...' : m.body;
    return `From: ${m.from} | Date: ${m.date}\n${body}`;
  });

  const user = `Subject: ${thread.subject}\n\n${parts.join('\n\n---\n\n')}`;

  return { system, user };
}

export { RECOMMENDED_ACTIONS };
