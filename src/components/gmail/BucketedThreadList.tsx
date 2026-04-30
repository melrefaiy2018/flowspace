/**
 * BucketedThreadList — groups threads into 4 work-state buckets using
 * `assignBucketsFromEnrichment`. Supports raw-inbox toggle and fallback to flat list.
 */
import { Loader2 } from 'lucide-react';
import { assignBucketsFromEnrichment } from '../../lib/triage';
import type { GmailThreadSummary } from '../../services/api';
import type { ThreadEnrichment } from '../../shared/gmail-enrichment-types.js';
import ThreadList from './ThreadList';
import BucketSection from './BucketSection';
import EnrichedThreadRow from './EnrichedThreadRow';

interface Props {
  threads: GmailThreadSummary[];
  enrichmentMap: Map<string, ThreadEnrichment>;
  enrichmentQueue: Set<string>;
  fallbackReason: string | null;
  showRawInbox: boolean;
  selectedId: string | null;
  selectedThreadIds?: string[];
  loading: boolean;
  hasMore: boolean;
  onSelect: (threadId: string) => void;
  onLoadMore: () => void;
  onToggleSelect?: (threadId: string) => void;
}

const BUCKET_ORDER = [
  { key: 'needs_reply' as const, label: 'Needs reply', defaultExpanded: true },
  { key: 'waiting' as const, label: 'Waiting', defaultExpanded: true },
  { key: 'quick_wins' as const, label: 'Quick wins', defaultExpanded: true },
  { key: 'reference_fyi' as const, label: 'Reference / FYI', defaultExpanded: false },
];

// ── Loading skeleton ─────────────────────────────────────────────────────────

function QueueLoadingSkeleton() {
  return (
    <div className="flex flex-col w-full">
      {/* Bucket skeletons */}
      {[
        { label: 'Needs reply', count: 3 },
        { label: 'Waiting', count: 2 },
        { label: 'Quick wins', count: 4 },
      ].map(({ label, count }) => (
        <div key={label} className="border-b border-[var(--border)]">
          {/* Bucket header */}
          <div className="flex items-center gap-2 px-4 py-[10px]">
            <div className="h-2.5 w-2 rounded-sm bg-white/[0.06]" />
            <div className="h-3 rounded bg-white/[0.06] animate-pulse" style={{ width: `${label.length * 7 + 8}px` }} />
            <div className="ml-auto h-4 w-5 rounded-[6px] bg-white/[0.04] animate-pulse" />
          </div>
          {/* Row skeletons */}
          {Array.from({ length: count }).map((_, i) => (
            <div
              key={i}
              className="flex items-start gap-3 px-4 py-3 border-t border-[var(--border)]/60"
              style={{ opacity: 1 - i * 0.15 }}
            >
              {/* Avatar */}
              <div
                className="w-7 h-7 rounded-full bg-white/[0.07] animate-pulse shrink-0 mt-0.5"
                style={{ animationDelay: `${i * 80}ms` }}
              />
              <div className="flex-1 flex flex-col gap-1.5 min-w-0">
                {/* Sender + time */}
                <div className="flex items-center justify-between gap-2">
                  <div
                    className="h-2.5 rounded bg-white/[0.08] animate-pulse"
                    style={{ width: `${60 + (i % 3) * 20}px`, animationDelay: `${i * 80 + 30}ms` }}
                  />
                  <div
                    className="h-2 w-8 rounded bg-white/[0.04] animate-pulse shrink-0"
                    style={{ animationDelay: `${i * 80 + 60}ms` }}
                  />
                </div>
                {/* Subject */}
                <div
                  className="h-2.5 rounded bg-white/[0.06] animate-pulse"
                  style={{ width: `${75 + (i % 4) * 10}%`, animationDelay: `${i * 80 + 20}ms` }}
                />
                {/* Snippet */}
                <div
                  className="h-2 rounded bg-white/[0.04] animate-pulse"
                  style={{ width: `${50 + (i % 3) * 15}%`, animationDelay: `${i * 80 + 40}ms` }}
                />
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function BucketedThreadList({
  threads,
  enrichmentMap,
  enrichmentQueue,
  fallbackReason,
  showRawInbox,
  selectedId,
  selectedThreadIds = [],
  loading,
  hasMore,
  onSelect,
  onLoadMore,
  onToggleSelect,
}: Props) {
  // Loading skeleton — shown while the initial thread fetch is in progress
  if (loading && threads.length === 0) {
    return <QueueLoadingSkeleton />;
  }

  // Flat list for raw-inbox toggle or fallback
  if (showRawInbox || fallbackReason !== null) {
    return (
      <ThreadList
        threads={threads}
        selectedId={selectedId}
        selectedThreadIds={selectedThreadIds}
        loading={loading}
        hasMore={hasMore}
        onSelect={onSelect}
        onLoadMore={onLoadMore}
        onToggleSelect={onToggleSelect}
        enrichmentMap={enrichmentMap}
        enrichmentQueue={enrichmentQueue}
        fallbackReason={fallbackReason}
      />
    );
  }

  // Determine which threads are queued (in queue but not yet in map)
  const queuedThreads = threads.filter(
    (t) => enrichmentQueue.has(t.id) && !enrichmentMap.has(t.id),
  );

  // Bucket the enriched threads
  const buckets = assignBucketsFromEnrichment(threads, enrichmentMap);

  return (
    <div className="flex min-w-0 w-full flex-col">
      {/* Analyzing pseudo-bucket — shown while enrichment is in progress */}
      {queuedThreads.length > 0 && (
        <div className="border-b border-[var(--border)] bg-[var(--surface-soft)] min-w-0 w-full">
          <div className="flex items-center gap-2 px-4 py-[10px]">
            <Loader2
              size={12}
              className="shrink-0 animate-spin text-[var(--text-faint)]"
              aria-hidden="true"
            />
            <span className="flex-1 text-[12px] font-semibold text-[var(--text-dim)]">
              Analyzing…
            </span>
            <span className="rounded-[10px] bg-white/[0.06] px-[7px] py-px font-mono text-[10px] text-[var(--text-faint)]">
              {queuedThreads.length}
            </span>
          </div>
          <div className="pb-1">
            {queuedThreads.map((thread) => (
              <EnrichedThreadRow
                key={thread.id}
                thread={thread}
                selected={thread.id === selectedId}
                isSelected={selectedThreadIds.includes(thread.id)}
                onSelect={onSelect}
                onToggleSelect={onToggleSelect}
                enrichment={undefined}
                isQueued={true}
              />
            ))}
          </div>
        </div>
      )}

      {/* Four work-state buckets */}
      {BUCKET_ORDER.map(({ key, label, defaultExpanded }) => {
        const bucketThreads = buckets[key];
        return (
          <BucketSection
            key={key}
            id={key.replace('_', '-')}
            label={label}
            count={bucketThreads.length}
            defaultExpanded={defaultExpanded}
          >
            {bucketThreads.map((thread) => (
              <EnrichedThreadRow
                key={thread.id}
                thread={thread}
                selected={thread.id === selectedId}
                isSelected={selectedThreadIds.includes(thread.id)}
                onSelect={onSelect}
                onToggleSelect={onToggleSelect}
                enrichment={enrichmentMap.get(thread.id)}
                isQueued={false}
              />
            ))}
          </BucketSection>
        );
      })}

      {/* Load more trigger */}
      {hasMore && (
        <div className="flex justify-center py-3">
          <button
            type="button"
            onClick={onLoadMore}
            className="rounded-[10px] border border-[var(--border)] bg-black/10 px-3 py-1.5 text-[12px] text-[var(--text-dim)] transition-colors hover:text-[var(--text)] cursor-pointer"
          >
            Load more
          </button>
        </div>
      )}
    </div>
  );
}
