import type { MemoryEntry, RetrievedMemory, MemoryCategory } from './memory-types';
import { incrementAccess } from './memory-store';
import { supportsEmbeddings, computeEmbedding, cosineSimilarity, saveEmbedding } from './memory-embeddings.js';
import { getConversationTitle } from '../conversation-index.js';

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

/**
 * Calculate relevance score for a memory entry against a query.
 *
 * Dual-path scoring:
 * - When both queryEmbedding and entryEmbedding exist: embedding-weighted
 * - Otherwise: keyword-only (original behavior preserved)
 */
function calculateRelevanceScore(
  entry: MemoryEntry,
  queryKeywords: Set<string>,
  queryEmbedding?: number[] | null,
  entryEmbedding?: number[],
): number {
  const tagMatches = entry.tags.filter((t) => queryKeywords.has(t.toLowerCase()));
  const contentLower = entry.content.toLowerCase();
  const contentKeywords = new Set(extractKeywords(entry.content));

  const keywordMatchCount = queryKeywords.size > 0
    ? [...queryKeywords].filter((k) => contentLower.includes(k) || contentKeywords.has(k)).length
    : 0;

  const lastAccessed = new Date(entry.lastAccessedAt).getTime();
  const now = Date.now();
  const daysSinceAccess = (now - lastAccessed) / (1000 * 60 * 60 * 24);

  // Dual-path: embedding-weighted scoring when both embeddings are present
  if (queryEmbedding && queryEmbedding.length > 0 && entryEmbedding && entryEmbedding.length > 0) {
    const embeddingScore = cosineSimilarity(queryEmbedding, entryEmbedding) * 0.50;
    const tagScore = tagMatches.length * 0.10;
    const keywordScore = queryKeywords.size > 0
      ? (keywordMatchCount / queryKeywords.size) * 0.15
      : 0;
    const categoryScore = (5 - CATEGORY_PRIORITY[entry.category]) * 0.05;
    const recencyScore = Math.max(0, 0.10 - daysSinceAccess * 0.003);
    const accessScore = Math.min(entry.accessCount * 0.010, 0.10);

    let score = embeddingScore + tagScore + keywordScore + categoryScore + recencyScore + accessScore;

    if (entry.stale) {
      score *= 0.5;
    }

    return Math.min(Math.max(score, 0), 1);
  }

  // Keyword-only path (original behavior — unchanged)
  if (tagMatches.length === 0 && keywordMatchCount === 0) {
    return 0;
  }

  const tagScore = tagMatches.length * 0.25;
  const keywordScore = (keywordMatchCount / Math.max(queryKeywords.size, 1)) * 0.35;
  const categoryScore = (5 - CATEGORY_PRIORITY[entry.category]) * 0.05;

  const recencyScore = Math.max(0, 0.15 - daysSinceAccess * 0.005);

  const accessScore = Math.min(entry.accessCount * 0.015, 0.1);

  let score = tagScore + keywordScore + categoryScore + recencyScore + accessScore;

  if (entry.stale) {
    score *= 0.5;
  }

  return Math.min(Math.max(score, 0), 1);
}

export async function retrieveMemories(
  query: string,
  memories: MemoryEntry[],
  options: RetrievalOptions = {},
  embeddings?: Record<string, number[]>,
): Promise<RetrievedMemory[]> {
  const maxResults = options.maxResults ?? 5;
  const maxTokens = options.maxTokens ?? 800;

  const queryKeywords = new Set(extractKeywords(query));

  // Compute query embedding once if provider supports it
  let queryEmbedding: number[] | null = null;
  if (supportsEmbeddings()) {
    try {
      queryEmbedding = await computeEmbedding(query);
    } catch {
      // Fall back to keyword-only scoring
      queryEmbedding = null;
    }
  }

  const scored = memories
    .map((entry): RetrievedMemory => {
      const entryEmbedding = embeddings?.[entry.id];
      return {
        entry,
        relevanceScore: calculateRelevanceScore(
          entry,
          queryKeywords,
          queryEmbedding,
          entryEmbedding,
        ),
      };
    })
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

  for (const r of selected) {
    incrementAccess(r.entry.id);
  }

  // Lazy migration: compute and save embeddings for selected entries that lack them.
  // Caps at 5 lazy computations per retrieval to bound latency.
  if (supportsEmbeddings() && queryEmbedding) {
    let lazyCount = 0;
    for (const r of selected) {
      if (lazyCount >= 5) break;
      if (embeddings && r.entry.id in embeddings) continue; // already has embedding

      try {
        const text = r.entry.content + ' ' + r.entry.tags.join(' ');
        const embedding = await computeEmbedding(text);
        if (embedding) {
          saveEmbedding(r.entry.id, embedding);
          lazyCount++;
        }
      } catch {
        // Non-fatal — continue without embedding
      }
    }
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

export function formatMemoriesForPrompt(memories: MemoryEntry[], userHash?: string): string {
  if (memories.length === 0) return '';

  const sorted = [...memories].sort(
    (a, b) => CATEGORY_PRIORITY[a.category] - CATEGORY_PRIORITY[b.category],
  );

  const lines: string[] = ['Your memories about this user:', ''];

  for (const entry of sorted) {
    const category = entry.category.toUpperCase();
    const stale = entry.stale ? ' [STALE]' : '';
    let content = entry.content;

    // If this memory was extracted in a known conversation, append context
    if (userHash && entry.source?.conversationId) {
      try {
        const convTitle = getConversationTitle(userHash, entry.source.conversationId);
        if (convTitle) {
          content = `${content} (from conversation: ${convTitle})`;
        }
      } catch {
        // non-fatal — proceed without title enrichment
      }
    }

    const lines_for_entry: string[] = [`[${category}${stale}] ${content}`];

    const metadataStr = formatMetadata(entry.metadata);
    if (metadataStr) lines_for_entry.push(metadataStr);

    const relativeTime = formatRelativeTime(entry.lastAccessedAt);
    if (relativeTime) lines_for_entry.push(`Last used: ${relativeTime}`);

    lines.push(lines_for_entry.join('\n'));
    lines.push('');
  }

  return lines.join('\n').trim();
}
