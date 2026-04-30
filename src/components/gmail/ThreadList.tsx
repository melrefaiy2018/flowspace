import { Mail } from 'lucide-react';
import type { GmailThreadSummary } from '../../services/api';
import type { ThreadEnrichment } from '../../shared/gmail-enrichment-types.js';
import EnrichedThreadRow from './EnrichedThreadRow';
import EmptyState from '../EmptyState';

interface Props {
  threads: GmailThreadSummary[];
  selectedId: string | null;
  selectedThreadIds?: string[];
  loading: boolean;
  hasMore: boolean;
  onSelect: (threadId: string) => void;
  onLoadMore: () => void;
  onToggleSelect?: (threadId: string) => void;
  enrichmentMap?: Map<string, ThreadEnrichment>;
  fallbackReason?: string | null;
  /** Set of thread ids still waiting for their enrichment batch. */
  enrichmentQueue?: Set<string>;
}

export default function ThreadList({ threads, selectedId, selectedThreadIds = [], loading, hasMore, onSelect, onLoadMore, onToggleSelect, enrichmentMap, fallbackReason, enrichmentQueue }: Props) {
  if (loading) {
    return (
      <div className="flex flex-col gap-0">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="flex items-start gap-3 px-4 py-3 border-b border-[var(--border)]">
            <div className="w-8 h-8 rounded-full bg-[var(--surface3)] animate-pulse shrink-0" />
            <div className="flex-1 flex flex-col gap-1.5">
              <div className="h-3.5 w-32 bg-[var(--surface3)] animate-pulse rounded" />
              <div className="h-3 w-full bg-[var(--surface2)] animate-pulse rounded" />
              <div className="h-3 w-3/4 bg-[var(--surface2)] animate-pulse rounded" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (threads.length === 0) {
    return <EmptyState icon={Mail} title="No emails found" size="sm" />;
  }

  return (
    <div className="flex min-w-0 w-full flex-col">
      {threads.map((thread) => (
        <EnrichedThreadRow
          key={thread.id}
          thread={thread}
          enrichment={enrichmentMap?.get(thread.id)}
          isQueued={enrichmentQueue?.has(thread.id) ?? false}
          selected={selectedId === thread.id}
          onSelect={onSelect}
          onToggleSelect={onToggleSelect}
          isSelected={selectedThreadIds.includes(thread.id)}
        />
      ))}

      {hasMore && (
        <button
          onClick={onLoadMore}
          className="w-full py-3 text-[12px] text-[var(--accent)] hover:bg-[var(--surface2)] transition-colors cursor-pointer font-medium"
        >
          Load more
        </button>
      )}
    </div>
  );
}
