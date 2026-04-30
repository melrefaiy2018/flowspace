import type { ThreadEnrichment } from '../shared/gmail-enrichment-types.js';

export interface EnrichmentCacheEntry {
  enrichment: ThreadEnrichment;
  cachedAt: string;
  expiresAt: string;
  invalidatedAt?: string;
}

export interface EnrichmentCacheFile {
  version: 2;
  updatedAt: string;
  entries: Record<string, EnrichmentCacheEntry>;
}
