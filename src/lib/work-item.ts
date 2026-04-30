/**
 * WorkItem abstraction — a thin adapter so future non-email sources can reuse
 * the same workspace panes without depending on GmailThreadSummary directly.
 */

import type { GmailThreadSummary } from '../services/api.js';
import type { ThreadEnrichment, ThreadBrief } from '../shared/gmail-enrichment-types.js';
import type { ThreadType, PaneKind } from './gmail-work-registry.js';
import { lookupAction } from './gmail-work-registry.js';

export interface WorkItem {
  id: string;
  source: { kind: 'gmail'; threadId: string };
  /** Always set — resolved via lookupAction fallback to 'other' when unknown. */
  type: ThreadType;
  title: string;
  subtitle: string;
  whyItMatters?: string;
  primaryActionLabel: string;
  paneKind: PaneKind;
  enrichment?: ThreadEnrichment;
  /** Always undefined here — fetched separately by the workspace via useThreadBrief. */
  brief?: ThreadBrief;
}

/**
 * Extract the display name from an email "From" header.
 *
 * Handles:
 *   "Alice Lee" <alice@example.com>   → Alice Lee
 *   Alice Lee <alice@example.com>     → Alice Lee
 *   alice@example.com                 → alice  (local-part fallback)
 */
function extractSenderName(from: string): string {
  const displayMatch = from.match(/^"?([^"<]+?)"?\s*</);
  if (displayMatch) {
    return displayMatch[1].trim();
  }
  // Bare email — return the local part
  const atIdx = from.indexOf('@');
  if (atIdx > 0) {
    return from.slice(0, atIdx).trim();
  }
  return from.trim();
}

export function workItemFromGmailThread(
  thread: GmailThreadSummary,
  enrichment: ThreadEnrichment | undefined,
): WorkItem {
  const registryEntry = lookupAction(enrichment?.threadType);

  return {
    id: thread.id,
    source: { kind: 'gmail', threadId: thread.id },
    type: registryEntry.type,
    title: thread.subject || '(no subject)',
    subtitle: extractSenderName(thread.from),
    whyItMatters: enrichment?.whyItMatters,
    primaryActionLabel: registryEntry.primaryActionLabel,
    paneKind: registryEntry.paneKind,
    enrichment,
    brief: undefined,
  };
}
