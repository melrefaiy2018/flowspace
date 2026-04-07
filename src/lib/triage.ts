/**
 * Pure email triage logic — extracted for testability.
 */

import type { GmailMessage, GmailThreadSummary, InboxTriageItem } from '../services/api';
import type { PreferenceExample } from './importance-feedback';
import { applyPreferenceExamplesToTriage } from './importance-feedback';

const AUTO_SENDER_PATTERNS = /noreply@|no-reply@|notifications@|mailer-daemon@|donotreply@|newsletter@/i;

export function triageEmailsHeuristic(emails: GmailMessage[], preferences: PreferenceExample[] = []): {
  needs_reply: InboxTriageItem[];
  needs_input: InboxTriageItem[];
  fyi_only: InboxTriageItem[];
  can_ignore: InboxTriageItem[];
} {
  const needs_reply: InboxTriageItem[] = [];
  const fyi_only: InboxTriageItem[] = [];
  const can_ignore: InboxTriageItem[] = [];

  for (const email of emails) {
    const item: InboxTriageItem = {
      subject: email.subject,
      sender: email.from,
      thread_id: email.threadId,
      actions: [],
    };

    // Decide bucket first, then assign actions only for actionable buckets
    if (AUTO_SENDER_PATTERNS.test(email.from)) {
      can_ignore.push(item);
    } else if (email.labelIds?.includes('CATEGORY_PROMOTIONS') || email.labelIds?.includes('CATEGORY_UPDATES')) {
      can_ignore.push(item);
    } else if (email.unread) {
      item.actions = [{ type: 'draft_reply', label: 'Draft reply', context: { thread_id: email.threadId } }];
      needs_reply.push(item);
    } else {
      fyi_only.push(item);
    }
  }
  return applyPreferenceExamplesToTriage(
    { needs_reply: needs_reply.slice(0, 5), needs_input: [], fyi_only, can_ignore },
    preferences,
  );
}

// ── Thread-level triage (for Gmail page AI Triage tab) ───────────────

export interface ThreadTriageResult {
  urgent: GmailThreadSummary[];
  needs_attention: GmailThreadSummary[];
  informational: GmailThreadSummary[];
  low_priority: GmailThreadSummary[];
}

/**
 * Categorize Gmail threads by importance using heuristics.
 * Operates on the thread summaries already loaded by useGmailPage.
 */
export function triageThreads(threads: readonly GmailThreadSummary[]): ThreadTriageResult {
  const urgent: GmailThreadSummary[] = [];
  const needs_attention: GmailThreadSummary[] = [];
  const informational: GmailThreadSummary[] = [];
  const low_priority: GmailThreadSummary[] = [];

  for (const thread of threads) {
    const isAutoSender = AUTO_SENDER_PATTERNS.test(thread.from);
    const isPromotion = thread.labelIds.includes('CATEGORY_PROMOTIONS');
    const isUpdate = thread.labelIds.includes('CATEGORY_UPDATES');
    const isSocial = thread.labelIds.includes('CATEGORY_SOCIAL');
    const isImportant = thread.labelIds.includes('IMPORTANT');

    if (isAutoSender || isPromotion || isUpdate || isSocial) {
      low_priority.push(thread);
    } else if (thread.unread && (thread.messageCount > 1 || isImportant)) {
      urgent.push(thread);
    } else if (thread.unread) {
      needs_attention.push(thread);
    } else {
      informational.push(thread);
    }
  }

  return { urgent, needs_attention, informational, low_priority };
}
