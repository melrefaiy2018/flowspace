/**
 * Single source of truth for thread type → (primary action, pane kind,
 * secondary actions) mapping. Pure data + pure functions — no runtime deps.
 */

export type ThreadType =
  | 'personal_reply_needed'
  | 'meeting_request'
  | 'security_alert'
  | 'promotional'
  | 'receipt'
  | 'newsletter'
  | 'notification'
  | 'other';

export type PaneKind =
  | 'draft'
  | 'schedule'
  | 'file'
  | 'review'
  | 'tasks'
  | 'summary'
  | 'discuss';

export type SecondaryAction =
  | { kind: 'discuss' }
  | { kind: 'archive' }
  | { kind: 'unsubscribe' }
  | { kind: 'snooze' }
  | { kind: 'decline' }
  | { kind: 'delegate' };

export interface WorkRegistryEntry {
  type: ThreadType;
  primaryActionLabel: string;
  paneKind: PaneKind;
  secondaryActions: SecondaryAction[];
  description: string;
}

export const ACTION_REGISTRY: Record<ThreadType, WorkRegistryEntry> = {
  personal_reply_needed: {
    type: 'personal_reply_needed',
    primaryActionLabel: 'Draft reply',
    paneKind: 'draft',
    secondaryActions: [{ kind: 'discuss' }, { kind: 'snooze' }],
    description: 'Someone is waiting for a reply from you.',
  },
  meeting_request: {
    type: 'meeting_request',
    primaryActionLabel: 'Pick times',
    paneKind: 'schedule',
    secondaryActions: [{ kind: 'decline' }, { kind: 'delegate' }, { kind: 'discuss' }],
    description: 'An invitation or scheduling request that needs a response.',
  },
  security_alert: {
    type: 'security_alert',
    primaryActionLabel: 'Review activity',
    paneKind: 'review',
    secondaryActions: [{ kind: 'archive' }, { kind: 'discuss' }],
    description: 'A security notice or account alert that warrants a quick review.',
  },
  promotional: {
    type: 'promotional',
    primaryActionLabel: 'Unsubscribe & archive',
    paneKind: 'file',
    secondaryActions: [{ kind: 'archive' }, { kind: 'discuss' }],
    description: 'A marketing or promotional email with no personal content.',
  },
  receipt: {
    type: 'receipt',
    primaryActionLabel: 'File to Drive',
    paneKind: 'file',
    secondaryActions: [{ kind: 'archive' }, { kind: 'discuss' }],
    description: 'An order confirmation, invoice, or payment receipt.',
  },
  newsletter: {
    type: 'newsletter',
    primaryActionLabel: 'Summarize & file',
    paneKind: 'summary',
    secondaryActions: [{ kind: 'archive' }, { kind: 'unsubscribe' }, { kind: 'discuss' }],
    description: 'A newsletter or digest you subscribed to but rarely act on.',
  },
  notification: {
    type: 'notification',
    primaryActionLabel: 'Archive',
    paneKind: 'file',
    secondaryActions: [{ kind: 'discuss' }],
    description: 'An automated system notification with no required action.',
  },
  other: {
    type: 'other',
    primaryActionLabel: 'Discuss',
    paneKind: 'discuss',
    secondaryActions: [{ kind: 'archive' }],
    description: 'Unclassified thread — open a conversation with the agent to decide next steps.',
  },
};

/** All valid thread types as a readonly tuple, useful for iteration and validation. */
export const THREAD_TYPES: readonly ThreadType[] = [
  'personal_reply_needed',
  'meeting_request',
  'security_alert',
  'promotional',
  'receipt',
  'newsletter',
  'notification',
  'other',
] as const;

/** Type predicate for runtime validation. */
export function isThreadType(v: unknown): v is ThreadType {
  return typeof v === 'string' && (THREAD_TYPES as readonly string[]).includes(v);
}

/**
 * Look up the registry entry for a thread type.
 * Falls back to the 'other' entry when `type` is undefined, null,
 * an empty string, or not a recognised ThreadType.
 */
export function lookupAction(type: ThreadType | string | undefined | null): WorkRegistryEntry {
  if (isThreadType(type)) {
    return ACTION_REGISTRY[type];
  }
  return ACTION_REGISTRY['other'];
}
