export type MemoryCategory = 'resource' | 'workflow' | 'preference' | 'fact';

export interface MemorySource {
  type: 'auto_extraction' | 'llm_extraction' | 'explicit_user';
  conversationId?: string;
  toolName?: string;
  messageId?: string;
}

export interface MemoryEntry {
  id: string;
  category: MemoryCategory;
  content: string;
  tags: string[];
  metadata: Record<string, unknown>;
  resourceIds?: string[];
  source: MemorySource;
  stale?: boolean;
  embedding?: number[];
  createdAt: string;
  updatedAt: string;
  lastAccessedAt: string;
  accessCount: number;
}

export interface MemoryFile {
  version: 1;
  entries: MemoryEntry[];
}

export interface RetrievedMemory {
  entry: MemoryEntry;
  relevanceScore: number;
}

export const MAX_MEMORY_ENTRIES = 500;