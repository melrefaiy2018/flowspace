export type ImportanceFeedbackScope = 'attention_item' | 'triage_item';
export type PreferenceLabel = 'important' | 'not_important';
export type PreferenceSenderClass = 'human' | 'newsletter' | 'automated' | 'unknown';
export type PreferenceIntentClass =
  | 'general'
  | 'newsletter'
  | 'billing'
  | 'security'
  | 'deadline'
  | 'approval'
  | 'meeting'
  | 'direct_reply';

export interface ImportanceFeedbackTarget {
  scope: ImportanceFeedbackScope;
  item_type: string;
  entity_id?: string;
  sender?: string;
  sender_email?: string;
  sender_domain?: string;
  sender_name?: string;
  subject?: string;
  title?: string;
  summary?: string;
  label_ids?: string[];
  urgency?: 'urgent_action' | 'needs_input' | 'review' | 'fyi';
  bucket?: 'needs_reply' | 'needs_input' | 'fyi_only' | 'can_ignore';
}

export interface PreferenceFeatures {
  entity_id?: string;
  sender_email?: string;
  sender_domain?: string;
  sender_name?: string;
  normalized_subject?: string;
  normalized_title?: string;
  normalized_summary?: string;
  subject_tokens: string[];
  label_ids: string[];
  urgency?: 'urgent_action' | 'needs_input' | 'review' | 'fyi';
  bucket?: 'needs_reply' | 'needs_input' | 'fyi_only' | 'can_ignore';
  sender_class: PreferenceSenderClass;
  intent_class: PreferenceIntentClass;
  risk_flags: string[];
}

export interface PreferenceExample {
  id: string;
  created_at: number;
  label: PreferenceLabel;
  scope: ImportanceFeedbackScope;
  item_type: string;
  target: ImportanceFeedbackTarget;
  features: PreferenceFeatures;
}

// Backward-compatible alias for existing callers until the rest of the repo is updated.
export type ImportancePreference = PreferenceExample;

export interface PreferenceScoreResult {
  score: number;
  strongest_label?: PreferenceLabel;
  reasons: string[];
}

export interface ScoredPreferenceMatch {
  example: PreferenceExample;
  similarity: number;
  signedScore: number;
  reasons: string[];
}

type AttentionLike = {
  type: string;
  title: string;
  action_context?: string;
  description?: string;
  feedback_target?: ImportanceFeedbackTarget;
  priority?: 'high' | 'medium';
};

type TriageLike = {
  subject: string;
  sender: string;
  thread_id?: string;
  summary?: string;
  label_ids?: string[];
  urgency?: 'urgent_action' | 'needs_input' | 'review' | 'fyi';
  actions?: unknown[];
  feedback_target?: ImportanceFeedbackTarget;
};

type TriageBuckets<TItem> = {
  needs_reply: TItem[];
  needs_input: TItem[];
  fyi_only: TItem[];
  can_ignore: TItem[];
};

const AUTO_SENDER_PATTERNS = /noreply@|no-reply@|notifications@|mailer-daemon@|donotreply@|newsletter@/i;
const NEWSLETTER_PATTERNS = /substack|digest|newsletter|briefing|roundup|weekly|daily/i;
const DIRECT_REPLY_PATTERNS = /\bre:|\bfwd:|following up|reply requested|can you|could you|please review/i;
const BILLING_PATTERNS = /\binvoice|payment|receipt|card|billing|subscription|charge|renewal/i;
const SECURITY_PATTERNS = /\bsecurity|password|verify|verification|login|account alert|suspicious|2fa|mfa/i;
const DEADLINE_PATTERNS = /\bdue|deadline|eod|by friday|by monday|due today|overdue|expires/i;
const APPROVAL_PATTERNS = /\bapprove|approval|sign off|sign-off|review and approve/i;
const MEETING_PATTERNS = /\bmeeting|invite|calendar|rsvp|schedule|time slot|zoom|call\b/i;
const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'be', 'by', 'for', 'from', 'has', 'have', 'in', 'is', 'it', 'of', 'on', 'or', 're',
  'that', 'the', 'this', 'to', 'with', 'your', 'you',
]);

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function normalizeImportanceText(value: string | undefined): string {
  if (!value) return '';
  return collapseWhitespace(
    value
      .toLowerCase()
      .replace(/^((re|fw|fwd):\s*)+/, '')
      .replace(/[^a-z0-9\s]/g, ' ')
  );
}

function tokenize(value: string | undefined): string[] {
  const normalized = normalizeImportanceText(value);
  if (!normalized) return [];
  return [...new Set(
    normalized
      .split(' ')
      .map((token) => token.trim())
      .filter((token) => token.length > 2 && !STOP_WORDS.has(token))
  )];
}

function overlapScore(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const setA = new Set(a);
  const setB = new Set(b);
  let overlap = 0;
  for (const token of setA) {
    if (setB.has(token)) overlap += 1;
  }
  return overlap / Math.max(setA.size, setB.size);
}

export function extractSenderEmail(sender?: string): string {
  if (!sender) return '';
  const bracketMatch = sender.match(/<([^>]+)>/);
  if (bracketMatch) return bracketMatch[1].trim().toLowerCase();
  const plainMatch = sender.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return plainMatch ? plainMatch[0].trim().toLowerCase() : '';
}

export function extractSenderName(sender?: string): string {
  if (!sender) return '';
  const match = sender.match(/^([^<]+)/);
  return match ? collapseWhitespace(match[1]).toLowerCase() : '';
}

export function extractSenderDomain(sender?: string): string {
  const email = extractSenderEmail(sender);
  const domain = email.split('@')[1];
  return domain ? domain.toLowerCase() : '';
}

function normalizedTarget(target: ImportanceFeedbackTarget): ImportanceFeedbackTarget {
  const sender_email = target.sender_email || extractSenderEmail(target.sender);
  const sender_domain = target.sender_domain || extractSenderDomain(target.sender || sender_email);
  const sender_name = target.sender_name || extractSenderName(target.sender);
  return {
    ...target,
    item_type: collapseWhitespace(target.item_type),
    entity_id: target.entity_id?.trim(),
    sender_email,
    sender_domain,
    sender_name,
    subject: collapseWhitespace(target.subject || ''),
    title: collapseWhitespace(target.title || ''),
    summary: collapseWhitespace(target.summary || ''),
    label_ids: [...new Set((target.label_ids ?? []).map((value) => value.trim()).filter(Boolean))],
  };
}

export function getImportanceFeedbackKey(target: ImportanceFeedbackTarget | undefined): string {
  if (!target) return '';
  const normalized = normalizedTarget(target);
  return [
    normalized.scope,
    normalized.item_type,
    normalized.entity_id || '',
    normalized.sender_email || '',
    normalized.sender_domain || '',
    normalizeImportanceText(normalized.subject),
    normalizeImportanceText(normalized.title),
    normalized.bucket || '',
  ].join('::');
}

function inferSenderClass(target: ImportanceFeedbackTarget): PreferenceSenderClass {
  const sender = `${target.sender || ''} ${target.sender_email || ''} ${target.sender_domain || ''}`.toLowerCase();
  const labels = (target.label_ids ?? []).join(' ').toLowerCase();
  if (AUTO_SENDER_PATTERNS.test(sender)) return 'automated';
  if (NEWSLETTER_PATTERNS.test(sender) || labels.includes('category_promotions') || labels.includes('category_updates')) {
    return 'newsletter';
  }
  if (sender) return 'human';
  return 'unknown';
}

function inferIntentClass(target: ImportanceFeedbackTarget, senderClass: PreferenceSenderClass): PreferenceIntentClass {
  const haystack = `${target.subject || ''} ${target.summary || ''} ${target.title || ''}`.toLowerCase();
  if (SECURITY_PATTERNS.test(haystack)) return 'security';
  if (BILLING_PATTERNS.test(haystack)) return 'billing';
  if (APPROVAL_PATTERNS.test(haystack)) return 'approval';
  if (DEADLINE_PATTERNS.test(haystack) || target.urgency === 'urgent_action') return 'deadline';
  if (MEETING_PATTERNS.test(haystack)) return 'meeting';
  if (DIRECT_REPLY_PATTERNS.test(haystack) || target.bucket === 'needs_reply' || target.bucket === 'needs_input') return 'direct_reply';
  if (senderClass === 'newsletter') return 'newsletter';
  return 'general';
}

function inferRiskFlags(target: ImportanceFeedbackTarget, intentClass: PreferenceIntentClass): string[] {
  const flags = new Set<string>();
  if (target.urgency === 'urgent_action' || target.urgency === 'needs_input') flags.add('urgent');
  if (intentClass === 'billing') flags.add('billing');
  if (intentClass === 'security') flags.add('security');
  if (intentClass === 'deadline') flags.add('deadline');
  if (intentClass === 'approval') flags.add('approval');
  if (intentClass === 'direct_reply') flags.add('direct_reply');
  return [...flags];
}

export function extractPreferenceFeatures(target: ImportanceFeedbackTarget): PreferenceFeatures {
  const normalized = normalizedTarget(target);
  const sender_class = inferSenderClass(normalized);
  const intent_class = inferIntentClass(normalized, sender_class);
  const normalized_subject = normalizeImportanceText(normalized.subject);
  const normalized_title = normalizeImportanceText(normalized.title);
  const normalized_summary = normalizeImportanceText(normalized.summary);
  return {
    entity_id: normalized.entity_id,
    sender_email: normalized.sender_email || undefined,
    sender_domain: normalized.sender_domain || undefined,
    sender_name: normalized.sender_name || undefined,
    normalized_subject: normalized_subject || undefined,
    normalized_title: normalized_title || undefined,
    normalized_summary: normalized_summary || undefined,
    subject_tokens: [
      ...new Set([
        ...tokenize(normalized.subject),
        ...tokenize(normalized.title),
        ...tokenize(normalized.summary),
      ]),
    ],
    label_ids: normalized.label_ids ?? [],
    urgency: normalized.urgency,
    bucket: normalized.bucket,
    sender_class,
    intent_class,
    risk_flags: inferRiskFlags(normalized, intent_class),
  };
}

export function buildAttentionFeedbackTarget(item: AttentionLike): ImportanceFeedbackTarget {
  return item.feedback_target ?? {
    scope: 'attention_item',
    item_type: item.type,
    entity_id: item.action_context || undefined,
    title: item.title,
    summary: item.description,
  };
}

export function buildTriageFeedbackTarget(
  item: TriageLike,
  bucket: 'needs_reply' | 'needs_input' | 'fyi_only' | 'can_ignore',
): ImportanceFeedbackTarget {
  return item.feedback_target ?? {
    scope: 'triage_item',
    item_type: 'email',
    entity_id: item.thread_id || undefined,
    sender: item.sender,
    sender_email: extractSenderEmail(item.sender),
    sender_domain: extractSenderDomain(item.sender),
    sender_name: extractSenderName(item.sender),
    subject: item.subject,
    summary: item.summary,
    label_ids: item.label_ids,
    urgency: item.urgency,
    bucket,
  };
}

export function createPreferenceExample(
  target: ImportanceFeedbackTarget,
  label: PreferenceLabel,
  createId: () => string = () => `${Date.now()}`,
): PreferenceExample | null {
  const normalized = normalizedTarget(target);
  if (!normalized.item_type) return null;
  return {
    id: createId(),
    created_at: Date.now(),
    label,
    scope: normalized.scope,
    item_type: normalized.item_type,
    target: normalized,
    features: extractPreferenceFeatures(normalized),
  };
}

function scoreExampleSimilarity(target: ImportanceFeedbackTarget, example: PreferenceExample): ScoredPreferenceMatch {
  const normalizedTargetValue = normalizedTarget(target);
  const targetFeatures = extractPreferenceFeatures(normalizedTargetValue);
  const reasons: string[] = [];
  let similarity = 0;

  if (normalizedTargetValue.item_type !== example.item_type) {
    return { example, similarity: 0, signedScore: 0, reasons: [] };
  }

  if (targetFeatures.entity_id && example.features.entity_id && targetFeatures.entity_id === example.features.entity_id) {
    similarity += 0.7;
    reasons.push('same item');
  }
  if (targetFeatures.sender_email && example.features.sender_email && targetFeatures.sender_email === example.features.sender_email) {
    similarity += 0.4;
    reasons.push('same sender');
  } else if (
    targetFeatures.sender_domain && example.features.sender_domain
    && targetFeatures.sender_domain === example.features.sender_domain
  ) {
    similarity += 0.18;
    reasons.push('same sender domain');
  }
  if (targetFeatures.sender_class === example.features.sender_class && targetFeatures.sender_class !== 'unknown') {
    similarity += 0.1;
    reasons.push(`same sender type: ${targetFeatures.sender_class}`);
  }
  if (targetFeatures.intent_class === example.features.intent_class) {
    similarity += 0.18;
    reasons.push(`same intent: ${targetFeatures.intent_class}`);
  }
  if (targetFeatures.bucket && example.features.bucket && targetFeatures.bucket === example.features.bucket) {
    similarity += 0.05;
    reasons.push(`same bucket: ${targetFeatures.bucket}`);
  }
  if (targetFeatures.urgency && example.features.urgency && targetFeatures.urgency === example.features.urgency) {
    similarity += 0.08;
    reasons.push(`same urgency: ${targetFeatures.urgency}`);
  }

  const tokenOverlap = overlapScore(targetFeatures.subject_tokens, example.features.subject_tokens);
  if (tokenOverlap > 0) {
    similarity += 0.24 * tokenOverlap;
    reasons.push(`topic overlap ${Math.round(tokenOverlap * 100)}%`);
  }

  similarity = Math.min(1, similarity);
  let signedScore = similarity * (example.label === 'important' ? 1 : -1);

  if (example.label === 'not_important' && targetFeatures.risk_flags.length > 0) {
    signedScore = Math.max(signedScore * 0.35, -0.24);
    reasons.push(`negative preference capped for ${targetFeatures.risk_flags.join(', ')}`);
  }

  return { example, similarity, signedScore, reasons };
}

export function scorePreferenceTarget(
  target: ImportanceFeedbackTarget | undefined,
  examples: PreferenceExample[] = [],
): PreferenceScoreResult {
  if (!target || examples.length === 0) return { score: 0, reasons: [] };

  const scored = examples
    .map((example) => scoreExampleSimilarity(target, example))
    .filter((result) => result.similarity > 0);

  if (scored.length === 0) return { score: 0, reasons: [] };

  const total = scored.reduce((sum, result) => sum + result.signedScore, 0);
  const strongest = [...scored].sort((a, b) => Math.abs(b.signedScore) - Math.abs(a.signedScore))[0];
  return {
    score: Math.max(-1, Math.min(1, total)),
    strongest_label: strongest?.example.label,
    reasons: scored
      .sort((a, b) => Math.abs(b.signedScore) - Math.abs(a.signedScore))
      .slice(0, 4)
      .map((result) => `${result.example.label}: ${result.reasons.join(', ')}`),
  };
}

export function attachPreferenceTargetsToTriage<TItem extends TriageLike>(
  triage: TriageBuckets<TItem>,
): TriageBuckets<TItem & { feedback_target: ImportanceFeedbackTarget }> {
  return {
    needs_reply: triage.needs_reply.map((item) => ({ ...item, feedback_target: buildTriageFeedbackTarget(item, 'needs_reply') })),
    needs_input: triage.needs_input.map((item) => ({ ...item, feedback_target: buildTriageFeedbackTarget(item, 'needs_input') })),
    fyi_only: triage.fyi_only.map((item) => ({ ...item, feedback_target: buildTriageFeedbackTarget(item, 'fyi_only') })),
    can_ignore: triage.can_ignore.map((item) => ({ ...item, feedback_target: buildTriageFeedbackTarget(item, 'can_ignore') })),
  };
}

function moveTriageItem<TItem extends TriageLike & {
  feedback_target: ImportanceFeedbackTarget;
  preference_score?: number;
  preference_reasons?: string[];
}>(
  item: TItem,
  currentBucket: 'needs_reply' | 'needs_input' | 'fyi_only' | 'can_ignore',
): 'needs_reply' | 'needs_input' | 'fyi_only' | 'can_ignore' {
  const score = item.preference_score ?? 0;
  const riskFlags = extractPreferenceFeatures(item.feedback_target).risk_flags;

  if (score <= -0.55) {
    return riskFlags.length > 0 ? 'fyi_only' : 'can_ignore';
  }
  if (score <= -0.22) {
    return currentBucket === 'needs_reply' || currentBucket === 'needs_input' ? 'fyi_only' : currentBucket;
  }
  if (score >= 0.45 && currentBucket === 'can_ignore') {
    return 'fyi_only';
  }
  return currentBucket;
}

export function applyPreferenceExamplesToTriage<TItem extends TriageLike>(
  triage: TriageBuckets<TItem>,
  examples: PreferenceExample[] = [],
): TriageBuckets<TItem & {
  feedback_target: ImportanceFeedbackTarget;
  preference_score?: number;
  preference_reasons?: string[];
}> {
  const withTargets = attachPreferenceTargetsToTriage(triage);
  const result = {
    needs_reply: [] as Array<TItem & { feedback_target: ImportanceFeedbackTarget; preference_score?: number; preference_reasons?: string[] }>,
    needs_input: [] as Array<TItem & { feedback_target: ImportanceFeedbackTarget; preference_score?: number; preference_reasons?: string[] }>,
    fyi_only: [] as Array<TItem & { feedback_target: ImportanceFeedbackTarget; preference_score?: number; preference_reasons?: string[] }>,
    can_ignore: [] as Array<TItem & { feedback_target: ImportanceFeedbackTarget; preference_score?: number; preference_reasons?: string[] }>,
  };

  ([
    ['needs_reply', withTargets.needs_reply],
    ['needs_input', withTargets.needs_input],
    ['fyi_only', withTargets.fyi_only],
    ['can_ignore', withTargets.can_ignore],
  ] as const).forEach(([bucket, items]) => {
    for (const item of items) {
      const score = scorePreferenceTarget(item.feedback_target, examples);
      const enriched = {
        ...item,
        preference_score: score.score,
        preference_reasons: score.reasons,
      };
      const destination = moveTriageItem(enriched, bucket);
      enriched.feedback_target = { ...enriched.feedback_target, bucket: destination };
      result[destination].push(enriched);
    }
  });

  return result;
}

export function applyPreferenceExamplesToBriefing<
  TAttention extends AttentionLike,
  TTriage extends TriageLike,
  TBriefing extends {
    attention_items?: TAttention[];
    inbox_triage?: TriageBuckets<TTriage>;
  },
>(
  briefing: TBriefing,
  examples: PreferenceExample[] = [],
): TBriefing & {
  attention_items: Array<TAttention & {
    feedback_target: ImportanceFeedbackTarget;
    preference_score?: number;
    preference_reasons?: string[];
  }>;
  inbox_triage: TriageBuckets<TTriage & {
    feedback_target: ImportanceFeedbackTarget;
    preference_score?: number;
    preference_reasons?: string[];
  }>;
} {
  const attention_items = (briefing.attention_items ?? []).map((item) => {
    const feedback_target = buildAttentionFeedbackTarget(item);
    const score = scorePreferenceTarget(feedback_target, examples);
    const originalPriority = item.priority ?? 'medium';
    const nextPriority = score.score >= 0.45
      ? 'high'
      : score.score <= -0.35 && originalPriority === 'high'
        ? 'medium'
        : originalPriority;
    return {
      ...item,
      priority: nextPriority,
      feedback_target,
      preference_score: score.score,
      preference_reasons: score.reasons,
    };
  }).sort((a, b) => {
    const aValue = (a.priority === 'high' ? 1 : 0) + (a.preference_score ?? 0);
    const bValue = (b.priority === 'high' ? 1 : 0) + (b.preference_score ?? 0);
    return bValue - aValue;
  });

  const triage = applyPreferenceExamplesToTriage(briefing.inbox_triage ?? {
    needs_reply: [],
    needs_input: [],
    fyi_only: [],
    can_ignore: [],
  }, examples);

  return {
    ...briefing,
    attention_items,
    inbox_triage: triage,
  };
}

function preferenceSignature(example: PreferenceExample): string {
  return JSON.stringify({
    label: example.label,
    scope: example.scope,
    item_type: example.item_type,
    sender_email: example.features.sender_email,
    sender_domain: example.features.sender_domain,
    normalized_subject: example.features.normalized_subject,
    normalized_title: example.features.normalized_title,
    intent_class: example.features.intent_class,
    sender_class: example.features.sender_class,
  });
}

export function hasSamePreferenceExample(a: PreferenceExample, b: PreferenceExample): boolean {
  return preferenceSignature(a) === preferenceSignature(b);
}

export function coerceStoredPreferenceExample(value: unknown): PreferenceExample | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;

  if (typeof record.label === 'string' && record.features && record.target) {
    return record as unknown as PreferenceExample;
  }

  // Legacy v1 payload: { id, created_at, target, match }
  if (record.target && typeof record.target === 'object') {
    const legacyTarget = record.target as ImportanceFeedbackTarget;
    const example = createPreferenceExample(legacyTarget, 'not_important', () =>
      typeof record.id === 'string' ? record.id : `${Date.now()}`
    );
    if (!example) return null;
    example.created_at = typeof record.created_at === 'number' ? record.created_at : Date.now();
    return example;
  }

  return null;
}
