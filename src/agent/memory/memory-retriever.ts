import type { MemoryEntry, RetrievedMemory, MemoryCategory } from './memory-types';

const CATEGORY_PRIORITY: Record<MemoryCategory, number> = {
  resource: 1,
  workflow: 2,
  preference: 3,
  fact: 4,
};

export interface RetrievalOptions {
  maxResults?: number;
  maxTokens?: number;
}

function extractKeywords(text: string): string[] {
  const stopWords = new Set([
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by',
    'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did',
    'will', 'would', 'could', 'should', 'may', 'might', 'must', 'shall', 'can', 'need',
    'this', 'that', 'these', 'those', 'what', 'which', 'who', 'whom', 'when', 'where', 'why', 'how',
    'i', 'me', 'my', 'we', 'us', 'our', 'you', 'your', 'he', 'him', 'his', 'she', 'her', 'it', 'its',
    'they', 'them', 'their', 'am', 'pm', 'get', 'got', 'make', 'made', 'take', 'took',
  ]);

  const words = text.toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !stopWords.has(w));

  return [...new Set(words)];
}

function calculateRelevanceScore(
  entry: MemoryEntry,
  queryKeywords: Set<string>,
): number {
  const tagMatches = entry.tags.filter((t) => queryKeywords.has(t.toLowerCase()));
  const contentLower = entry.content.toLowerCase();
  const contentKeywords = new Set(extractKeywords(entry.content));

  const keywordMatches = queryKeywords.size > 0
    ? [...queryKeywords].filter((k) => contentLower.includes(k) || contentKeywords.has(k)).length
    : 0;
  
  if (tagMatches.length === 0 && keywordMatches === 0) {
    return 0;
  }

  const tagScore = tagMatches.length * 0.25;
  const keywordScore = (keywordMatches / Math.max(queryKeywords.size, 1)) * 0.35;
  const categoryScore = (5 - CATEGORY_PRIORITY[entry.category]) * 0.05;

  const recencyScore = (() => {
    const lastAccessed = new Date(entry.lastAccessedAt).getTime();
    const now = Date.now();
    const daysSinceAccess = (now - lastAccessed) / (1000 * 60 * 60 * 24);
    return Math.max(0, 0.15 - daysSinceAccess * 0.005);
  })();

  const accessScore = Math.min(entry.accessCount * 0.015, 0.1);

  let score = tagScore + keywordScore + categoryScore + recencyScore + accessScore;

  if (entry.stale) {
    score *= 0.5;
  }

  return Math.min(Math.max(score, 0), 1);
}

export function retrieveMemories(
  query: string,
  memories: MemoryEntry[],
  options: RetrievalOptions = {},
): RetrievedMemory[] {
  const maxResults = options.maxResults ?? 5;
  const maxTokens = options.maxTokens ?? 800;

  const queryKeywords = new Set(extractKeywords(query));

  const scored = memories
    .map((entry): RetrievedMemory => ({
      entry,
      relevanceScore: calculateRelevanceScore(entry, queryKeywords),
    }))
    .filter((r) => r.relevanceScore > 0)
    .sort((a, b) => {
      if (b.relevanceScore !== a.relevanceScore) {
        return b.relevanceScore - a.relevanceScore;
      }
      return CATEGORY_PRIORITY[a.entry.category] - CATEGORY_PRIORITY[b.entry.category];
    });

  const selected: RetrievedMemory[] = [];
  let tokenCount = 0;

  for (const r of scored) {
    if (selected.length >= maxResults) break;

    const combinedText = r.entry.content + ' ' + r.entry.tags.join(' ');
    const entryTokens = Math.ceil(combinedText.length / 4);
    if (tokenCount + entryTokens > maxTokens && selected.length > 0) break;

    selected.push(r);
    tokenCount += entryTokens;
  }

  return selected;
}

function formatRelativeTime(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'today';
  if (diffDays === 1) return 'yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`;
  return `${Math.floor(diffDays / 365)} years ago`;
}

function formatMetadata(metadata: Record<string, unknown>): string {
  const parts: string[] = [];

  // Prefer URLs (user-friendly) over raw IDs (internal-only)
  if (metadata.url) {
    parts.push(`URL: ${metadata.url}`);
  } else if (metadata.webViewLink) {
    parts.push(`URL: ${metadata.webViewLink}`);
  } else if (metadata.htmlLink) {
    parts.push(`URL: ${metadata.htmlLink}`);
  }

  // Include title if available
  if (metadata.title) parts.push(`Title: ${metadata.title}`);
  if (metadata.name && metadata.name !== metadata.title) parts.push(`Name: ${metadata.name}`);

  // Only include IDs as internal refs (prefixed so the LLM uses them in tool calls, not in prose)
  const id = metadata.spreadsheetId || metadata.docId || metadata.folderId || metadata.fileId || metadata.eventId || metadata.taskId;
  if (id) parts.push(`[internal_id: ${id}]`);

  return parts.join(' | ');
}

export function formatMemoriesForPrompt(memories: MemoryEntry[]): string {
  if (memories.length === 0) return '';

  const sorted = [...memories].sort(
    (a, b) => CATEGORY_PRIORITY[a.category] - CATEGORY_PRIORITY[b.category],
  );

  const lines: string[] = ['Your memories about this user:', ''];

  for (const entry of sorted) {
    const category = entry.category.toUpperCase();
    const stale = entry.stale ? ' [STALE]' : '';
    const lines_for_entry: string[] = [`[${category}${stale}] ${entry.content}`];

    const metadataStr = formatMetadata(entry.metadata);
    if (metadataStr) lines_for_entry.push(metadataStr);

    const relativeTime = formatRelativeTime(entry.lastAccessedAt);
    if (relativeTime) lines_for_entry.push(`Last used: ${relativeTime}`);

    lines.push(lines_for_entry.join('\n'));
    lines.push('');
  }

  return lines.join('\n').trim();
}