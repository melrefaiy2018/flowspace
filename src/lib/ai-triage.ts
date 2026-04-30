import type { GmailThreadSummary } from '../services/api.js';
import type { ThreadEnrichment, Bucket, RecommendedAction, Priority, EffortBucket } from '../shared/gmail-enrichment-types.js';
import { isThreadType } from './gmail-work-registry.js';
import type { ThreadType } from './gmail-work-registry.js';

export interface AITriageCategory {
  label: string;
  threadIds: string[];
}

export interface AITriageResult {
  categories: AITriageCategory[];
}

export interface EnrichedTriageResult {
  enrichments: ThreadEnrichment[];
  failed: string[];
  categories?: AITriageCategory[];
}

const GENERIC_VERBS = /^(reply|follow up|draft a response|respond|read)$/i;

// Specificity check per FR-019a: whyItMatters must not be a bare generic phrase.
export const GENERIC_WHY_PHRASES = /^(reply|follow up|draft a response|respond|read)$/i;

const QUICK_WINS_ACTIONS: Set<string> = new Set([
  'archive_subscription', 'unsubscribe', 'create_filter', 'mark_done',
]);

export function parseAiTriageResponse(raw: string, validThreadIds: Set<string>): EnrichedTriageResult {
  let jsonStr: string | null = null;

  const codeBlockMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) jsonStr = codeBlockMatch[1].trim();
  if (!jsonStr) {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) jsonStr = jsonMatch[0];
  }
  if (!jsonStr) throw new Error('Could not find JSON in AI response');

  const parsed = JSON.parse(jsonStr);

  if (parsed.enrichments && Array.isArray(parsed.enrichments)) {
    return parseEnrichedResponse(parsed, validThreadIds);
  }

  if (parsed.categories && Array.isArray(parsed.categories)) {
    return parseLegacyResponse(parsed, validThreadIds);
  }

  throw new Error('Response missing "enrichments" or "categories" array');
}

function parseEnrichedResponse(parsed: any, validThreadIds: Set<string>): EnrichedTriageResult {
  const enrichments: ThreadEnrichment[] = [];
  const failed: string[] = [];

  for (const item of parsed.enrichments) {
    const threadId = String(item.threadId || '');
    if (!validThreadIds.has(threadId)) continue;

    const priority = validatePriority(item.priority);
    if (!priority) {
      failed.push(threadId);
      continue;
    }

    const effortMinutes = validateEffort(item.effortMinutes);

    let recommendedAction: ReturnType<typeof validateRecommendedAction> = undefined;
    if (priority !== 'none') {
      // Require a valid enum value — non-enum strings (including natural language
      // like "Reply to Alice Tuesday 2pm") are enrichment failures per Bug A fix.
      recommendedAction = validateRecommendedAction(item.recommendedAction);
      if (!recommendedAction) {
        failed.push(threadId);
        continue;
      }

      // Specificity rule (FR-019a): whyItMatters must name a concrete entity.
      // Generic bare verb phrases are rejected here (moved from recommendedAction).
      const why = String(item.whyItMatters || '');
      if (GENERIC_WHY_PHRASES.test(why.trim())) {
        failed.push(threadId);
        continue;
      }
    }

    let bucket = validateBucket(item.bucket);
    if (bucket && applyTieBreaker(bucket, String(item.recommendedAction || ''))) {
      bucket = 'reference_fyi';
    }

    enrichments.push({
      threadId,
      priority,
      recommendedAction,
      whyItMatters: priority !== 'none' ? truncateWhy(String(item.whyItMatters || '')) : undefined,
      effortMinutes,
      bucket: bucket || 'reference_fyi',
      threadType: validateThreadType(item.threadType),
    });
  }

  for (const id of validThreadIds) {
    if (!enrichments.find(e => e.threadId === id) && !failed.includes(id)) {
      failed.push(id);
    }
  }

  const categories = parsed.categories ? parseCategoriesArray(parsed.categories, validThreadIds) : undefined;

  return { enrichments, failed, categories };
}

function parseLegacyResponse(parsed: any, validThreadIds: Set<string>): EnrichedTriageResult {
  const categories = parseCategoriesArray(parsed.categories, validThreadIds);

  const threadToCategory = new Map<string, string>();
  for (const cat of categories) {
    for (const id of cat.threadIds) {
      threadToCategory.set(id, cat.label);
    }
  }

  const enrichments: ThreadEnrichment[] = [];
  const failed: string[] = [];

  for (const threadId of validThreadIds) {
    const catLabel = threadToCategory.get(threadId);
    if (!catLabel) {
      failed.push(threadId);
      continue;
    }
    enrichments.push({
      threadId,
      priority: 'medium',
      recommendedAction: 'snooze',
      whyItMatters: truncateWhy(catLabel),
      effortMinutes: '5',
      bucket: 'reference_fyi',
    });
  }

  return { enrichments, failed, categories };
}

function parseCategoriesArray(categories: any[], validThreadIds: Set<string>): AITriageCategory[] {
  return categories
    .filter((c: unknown): c is { label: string; threadIds: string[] } =>
      typeof c === 'object' && c !== null &&
      typeof (c as Record<string, unknown>).label === 'string' &&
      Array.isArray((c as Record<string, unknown>).threadIds),
    )
    .map((c: { label: string; threadIds: string[] }) => ({
      label: c.label,
      threadIds: c.threadIds.filter((id: string) => validThreadIds.has(id)),
    }))
    .filter((c: AITriageCategory) => c.threadIds.length > 0);
}

export { buildListEnrichmentPrompt, buildThreadBriefPrompt } from '../agent/prompts/gmail-enrichment.js';

export function validatePriority(v: unknown): Priority | null {
  if (v === 'high' || v === 'medium' || v === 'low' || v === 'none') return v;
  return null;
}

export function validateBucket(v: unknown): Bucket | null {
  if (v === 'needs_reply' || v === 'waiting' || v === 'quick_wins' || v === 'reference_fyi') return v;
  return null;
}

export function validateRecommendedAction(v: unknown): RecommendedAction | undefined {
  const actions: RecommendedAction[] = ['draft_reply', 'nudge', 'decline', 'delegate', 'archive', 'archive_subscription', 'unsubscribe', 'create_filter', 'create_task', 'save_to_drive', 'mark_done', 'snooze'];
  if (typeof v === 'string' && actions.includes(v as RecommendedAction)) return v as RecommendedAction;
  return undefined;
}

/** Returns the value if it's a known ThreadType, undefined otherwise. Does NOT fail threads. */
export function validateThreadType(v: unknown): ThreadType | undefined {
  return isThreadType(v) ? v : undefined;
}

export function validateEffort(v: unknown): EffortBucket {
  if (v === 'none' || v === '1' || v === '5' || v === '15+') return v;
  return 'none';
}

export function truncateWhy(s: string): string {
  if (s.length <= 120) return s;
  return s.slice(0, 117) + '...';
}

export function applyTieBreaker(bucket: Bucket, action: string): boolean {
  if (bucket !== 'quick_wins') return false;
  if (QUICK_WINS_ACTIONS.has(action)) return false;
  return true;
}

export { GENERIC_VERBS };

export function buildTriageSystemPrompt(): string {
  return `You are an email triage assistant. Your job is to categorize a user's email threads into meaningful topic groups.

Rules:
- Create 3-8 categories based on the actual content of the emails.
- Use short, descriptive labels (e.g., "Job Search", "Finance", "School", "Promotions", "Security Alerts").
- Every thread should appear in exactly one category.
- Return ONLY valid JSON in this exact format — no extra text:

{"categories": [{"label": "Category Name", "threadIds": ["id1", "id2"]}, ...]}

- Use the exact thread IDs provided.
- Group similar threads together. Prefer fewer, broader categories over many tiny ones.`;
}

export function buildTriageUserMessage(threads: readonly GmailThreadSummary[]): string {
  if (threads.length === 0) {
    return 'I have 0 threads in my inbox. Nothing to categorize.';
  }

  const lines = threads.map((t) =>
    `- ID: "${t.id}" | Subject: "${t.subject}" | From: ${t.from} | ${t.unread ? 'unread' : 'read'} | Snippet: "${t.snippet}"`,
  );

  return `Please categorize these ${threads.length} threads into topic groups:\n\n${lines.join('\n')}`;
}

export function parseTriageResponse(raw: string, validThreadIds: Set<string>): AITriageResult {
  const result = parseAiTriageResponse(raw, validThreadIds);
  return { categories: result.categories ?? [] };
}
