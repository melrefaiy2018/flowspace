import { Paperclip } from 'lucide-react';
import type { GmailThreadSummary } from '../../services/api';
import type { ThreadEnrichment, RecommendedAction, Priority } from '../../shared/gmail-enrichment-types.js';

const ACTION_LABELS: Record<RecommendedAction, string> = {
  draft_reply: 'Draft reply',
  nudge: 'Nudge',
  decline: 'Decline',
  delegate: 'Delegate',
  archive: 'Archive',
  archive_subscription: 'Unsub & archive',
  unsubscribe: 'Unsubscribe',
  create_filter: 'Filter',
  create_task: 'Create task',
  save_to_drive: 'Save to Drive',
  mark_done: 'Mark done',
  snooze: 'Snooze',
};

const PRIORITY_COLORS: Record<Priority, string> = {
  high: '#ef4444',
  medium: '#f59e0b',
  low: '#3b82f6',
  none: 'transparent',
};

function extractName(from: string): string {
  const match = from.match(/^"?([^"<]+)"?\s*</);
  if (match) return match[1].trim();
  return from.split('@')[0];
}

function getInitial(from: string): string {
  const name = extractName(from);
  return name[0]?.toUpperCase() ?? '?';
}

function formatDate(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    if (diffDays === 0) return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return date.toLocaleDateString([], { weekday: 'short' });
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  } catch { return dateStr; }
}

function ActionChip({ action }: { action: RecommendedAction }) {
  return (
    <span className="inline-flex items-center text-[12px] px-1.5 py-0.5 rounded bg-[var(--surface3)] text-[var(--text-dim)] leading-4 shrink-0 max-w-[140px] truncate">
      {ACTION_LABELS[action]}
    </span>
  );
}

function QueuedChip() {
  return (
    <span
      className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-[var(--surface3)]/50 text-[var(--text-faint)] leading-4"
      aria-label="Analysis queued"
    >
      <span className="w-1 h-1 rounded-full bg-[var(--text-faint)] animate-pulse" aria-hidden="true" />
      Queued
    </span>
  );
}

interface Props {
  thread: GmailThreadSummary;
  enrichment?: ThreadEnrichment;
  selected: boolean;
  onSelect: (threadId: string) => void;
  onToggleSelect?: (threadId: string) => void;
  isSelected?: boolean;
  focused?: boolean;
  /**
   * True while this thread is waiting for its enrichment batch to run.
   * Shows a dim "Queued" pill where the action chip will go, signaling
   * that work is in progress rather than leaving the row blank.
   */
  isQueued?: boolean;
}

export default function EnrichedThreadRow({ thread, enrichment, selected, onSelect, onToggleSelect, isSelected, focused, isQueued }: Props) {
  const priorityColor = enrichment ? PRIORITY_COLORS[enrichment.priority] : 'transparent';
  const showEnrichment = !!enrichment && enrichment.priority !== 'none';

  const ariaLabel = [
    extractName(thread.from),
    thread.subject || '(no subject)',
    enrichment ? `${enrichment.priority} priority` : '',
    enrichment?.recommendedAction ? `recommended: ${ACTION_LABELS[enrichment.recommendedAction]}` : '',
    enrichment?.effortMinutes && enrichment.effortMinutes !== 'none' ? `effort: ${enrichment.effortMinutes} min` : '',
  ].filter(Boolean).join(', ');

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelect(thread.id)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(thread.id); } }}
      aria-label={ariaLabel}
      className={`group w-full flex items-start gap-0 px-0 py-0 border-b border-[var(--border)] text-left transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-white/20 focus-visible:outline-none ${
        selected ? 'bg-[linear-gradient(180deg,rgba(var(--accent-rgb),0.16),rgba(var(--accent-rgb),0.06))]' : thread.unread ? 'bg-[rgba(255,255,255,0.015)] hover:bg-[rgba(255,255,255,0.03)]' : 'hover:bg-[rgba(255,255,255,0.025)]'
      }`}
    >
      {priorityColor !== 'transparent' && (
        <div className="w-1 self-stretch shrink-0 rounded-l" style={{ backgroundColor: priorityColor }} />
      )}
      {priorityColor === 'transparent' && enrichment && (
        <div className="w-1 self-stretch shrink-0" />
      )}

      <div className="flex-1 min-w-0 flex items-start gap-3 px-4 py-3.5">
        {onToggleSelect && (
          <input
            type="checkbox"
            checked={!!isSelected}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
            onChange={() => onToggleSelect?.(thread.id)}
            className="mt-2 h-4 w-4 shrink-0 accent-[var(--accent)] cursor-pointer"
            aria-label={`Select ${thread.subject || '(no subject)'}`}
          />
        )}

        <div className="w-9 h-9 rounded-full bg-[var(--purple)] flex items-center justify-center text-[11px] font-bold text-white shrink-0 mt-0.5 shadow-[0_6px_16px_rgba(0,0,0,0.18)]">
          {getInitial(thread.from)}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5 min-w-0">
            <span className={`text-[12px] truncate ${thread.unread ? 'font-semibold text-[var(--text)]' : 'text-[var(--text-dim)]'}`}>
              {extractName(thread.from)}
            </span>
            {thread.messageCount > 1 && (
              <span className="text-[10px] text-[var(--text-faint)] font-mono shrink-0">{thread.messageCount}</span>
            )}
            <span className="ml-auto text-[10px] text-[var(--text-faint)] shrink-0">{formatDate(thread.date)}</span>
          </div>
          <div className={`text-[12px] truncate mb-0.5 ${thread.unread ? 'font-medium text-[var(--text)]' : 'text-[var(--text-dim)]'}`}>
            {thread.subject || '(no subject)'}
          </div>
          {showEnrichment && enrichment?.recommendedAction && enrichment?.whyItMatters ? (
            <div
              data-merged-row
              className="flex items-center gap-1.5 mb-0.5 text-[12px] min-w-0"
            >
              <ActionChip action={enrichment.recommendedAction} />
              <span className="text-[var(--text-faint)] shrink-0" aria-hidden="true">·</span>
              <span className="flex-1 min-w-0 truncate text-[var(--text-dim)]">
                {enrichment.whyItMatters.length > 120 ? enrichment.whyItMatters.slice(0, 117) + '...' : enrichment.whyItMatters}
              </span>
            </div>
          ) : showEnrichment && enrichment?.recommendedAction ? (
            <div
              data-merged-row
              className="flex items-center mb-0.5 text-[12px] min-w-0"
            >
              <ActionChip action={enrichment.recommendedAction} />
            </div>
          ) : !enrichment && isQueued ? (
            <div className="mb-0.5">
              <QueuedChip />
            </div>
          ) : null}
          <div className="flex items-center gap-1.5 min-w-0">
            <span className={`text-[11px] truncate leading-5 min-w-0 ${showEnrichment ? 'text-[var(--text-faint)]' : 'text-[var(--text-faint)]'}`}>{thread.snippet}</span>
            {thread.hasAttachments && <Paperclip size={10} className="text-[var(--text-faint)] shrink-0" />}
          </div>
        </div>

        <div className="flex flex-col items-end gap-1 shrink-0 mt-0.5">
          {showEnrichment && enrichment?.effortMinutes && enrichment.effortMinutes !== 'none' && (
            <span className="text-[10px] text-[var(--text-faint)]">{enrichment.effortMinutes}m</span>
          )}
          {thread.unread && <div className="w-2 h-2 rounded-full bg-[var(--accent)]" />}
        </div>
      </div>
    </div>
  );
}

export { ACTION_LABELS, PRIORITY_COLORS };
