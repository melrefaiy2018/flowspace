import type { ThreadType } from '../lib/gmail-work-registry.js';

export type { ThreadType };

export type Priority = 'high' | 'medium' | 'low' | 'none';

export type RecommendedAction =
  | 'draft_reply'
  | 'nudge'
  | 'decline'
  | 'delegate'
  | 'archive'
  | 'archive_subscription'
  | 'unsubscribe'
  | 'create_filter'
  | 'create_task'
  | 'save_to_drive'
  | 'mark_done'
  | 'snooze';

export type EffortBucket = 'none' | '1' | '5' | '15+';

export type Bucket = 'needs_reply' | 'waiting' | 'quick_wins' | 'reference_fyi';

export interface ThreadEnrichment {
  threadId: string;
  priority: Priority;
  recommendedAction?: RecommendedAction;
  whyItMatters?: string;
  effortMinutes: EffortBucket;
  bucket: Bucket;
  specificityTokens?: string[];
  /** Advisory classification; absent on old cached entries. Falls back to 'other' via lookupAction. */
  threadType?: ThreadType;
}

export interface ContextChip {
  label: string;
  kind: 'reply_state' | 'last_message_age' | 'thread_age' | 'participants' | 'other';
}

export type FirstClassAction =
  | { kind: 'draft_reply' }
  | { kind: 'pick_times' }
  | { kind: 'decline' }
  | { kind: 'delegate' }
  | { kind: 'save_to_drive' }
  | { kind: 'nudge' };

export interface ThreadBrief {
  threadId: string;
  summary: string;
  recommendedAction: string;
  contextChips: ContextChip[];
  firstClassActions: FirstClassAction[];
  isFallback: boolean;
  cachedAt: string;
}

export interface FreeSlot {
  startIso: string;
  endIso: string;
  durationMinutes: number;
  label: string;
  dayOfWeek: 'Mon' | 'Tue' | 'Wed' | 'Thu' | 'Fri' | 'Sat' | 'Sun';
}

export interface EnrichedThreadsResponse {
  enrichments: ThreadEnrichment[];
  failed: string[];
  cacheStats: {
    hits: number;
    misses: number;
    totalRequested: number;
  };
  bucketCounts: Record<Bucket, number>;
  durationMs: number;
  categories?: { label: string; threadIds: string[] }[];
}

export interface ThreadBriefResponse {
  brief: ThreadBrief;
  cacheHit: boolean;
  durationMs: number;
}
