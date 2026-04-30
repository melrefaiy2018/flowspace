/**
 * Utilities for binding a GmailWorkspace item to a dedicated chat conversation.
 * Each WorkItem maps to a stable conversation id derived from its thread ID so
 * switching items switches conversations, and revisiting an item restores history.
 */
import type { WorkItem } from './work-item.js';

export const GMAIL_CONVO_PREFIX = 'gmail-thread:';
export const GMAIL_CONVO_GROUP = 'group_gmail_items';

/** Deterministic conversation id for a WorkItem. */
export function conversationIdForItem(item: WorkItem): string {
  return `${GMAIL_CONVO_PREFIX}${item.source.threadId}`;
}

/** Human-readable title for the item's conversation. */
export function titleForItem(item: WorkItem): string {
  return item.title || '(no subject)';
}

/** Compose a short thread brief from WorkItem metadata for agent context. */
export function briefForItem(item: WorkItem): string {
  const parts: string[] = [];
  if (item.title) parts.push(`Subject: ${item.title}`);
  if (item.subtitle) parts.push(`From: ${item.subtitle}`);
  if (item.type) parts.push(`Type: ${item.type}`);
  if (item.paneKind) parts.push(`Action: ${item.paneKind}`);
  if (item.enrichment?.whyItMatters) parts.push(`Why it matters: ${item.enrichment.whyItMatters}`);
  return parts.join('\n');
}
