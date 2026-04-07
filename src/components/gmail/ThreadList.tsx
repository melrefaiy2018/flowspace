import { Paperclip } from 'lucide-react';
import type { GmailThreadSummary } from '../../services/api';

interface Props {
  threads: GmailThreadSummary[];
  selectedId: string | null;
  selectedThreadIds?: string[];
  loading: boolean;
  hasMore: boolean;
  onSelect: (threadId: string) => void;
  onLoadMore: () => void;
  onToggleSelect?: (threadId: string) => void;
}

function formatDate(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) {
      return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    }
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return date.toLocaleDateString([], { weekday: 'short' });
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  } catch {
    return dateStr;
  }
}

function extractName(from: string): string {
  // "Alice Smith <alice@example.com>" → "Alice Smith"
  const match = from.match(/^"?([^"<]+)"?\s*</);
  if (match) return match[1].trim();
  // "alice@example.com" → "alice"
  return from.split('@')[0];
}

function getInitial(from: string): string {
  const name = extractName(from);
  return name[0]?.toUpperCase() ?? '?';
}

export default function ThreadList({ threads, selectedId, selectedThreadIds = [], loading, hasMore, onSelect, onLoadMore, onToggleSelect }: Props) {
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
    return (
      <div className="flex flex-col items-center justify-center py-16 text-[var(--text-faint)]">
        <p className="text-[13px]">No emails found</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      {threads.map((thread) => (
        <div
          key={thread.id}
          role="button"
          tabIndex={0}
          onClick={() => onSelect(thread.id)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              onSelect(thread.id);
            }
          }}
          className={`w-full flex items-start gap-3 px-4 py-3.5 border-b border-[var(--border)] text-left transition-colors cursor-pointer ${
            selectedId === thread.id
              ? 'bg-[linear-gradient(180deg,rgba(var(--accent-rgb),0.16),rgba(var(--accent-rgb),0.06))]'
              : thread.unread
                ? 'bg-[rgba(255,255,255,0.015)] hover:bg-[rgba(255,255,255,0.03)]'
                : 'hover:bg-[rgba(255,255,255,0.025)]'
          }`}
        >
          {onToggleSelect && (
            <input
              type="checkbox"
              checked={selectedThreadIds.includes(thread.id)}
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => event.stopPropagation()}
              onChange={() => onToggleSelect(thread.id)}
              className="mt-2 h-4 w-4 shrink-0 accent-[var(--accent)] cursor-pointer"
              aria-label={`Select ${thread.subject || '(no subject)'}`}
            />
          )}
          {/* Avatar */}
          <div className="w-9 h-9 rounded-full bg-[var(--purple)] flex items-center justify-center text-[11px] font-bold text-white shrink-0 mt-0.5 shadow-[0_6px_16px_rgba(0,0,0,0.18)]">
            {getInitial(thread.from)}
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              <span className={`text-[12px] truncate ${thread.unread ? 'font-semibold text-[var(--text)]' : 'text-[var(--text-dim)]'}`}>
                {extractName(thread.from)}
              </span>
              {thread.messageCount > 1 && (
                <span className="text-[10px] text-[var(--text-faint)] font-mono shrink-0">
                  {thread.messageCount}
                </span>
              )}
              <span className="ml-auto text-[10px] text-[var(--text-faint)] shrink-0">
                {formatDate(thread.date)}
              </span>
            </div>
            <div className={`text-[12px] truncate mb-0.5 ${thread.unread ? 'font-medium text-[var(--text)]' : 'text-[var(--text-dim)]'}`}>
              {thread.subject || '(no subject)'}
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] text-[var(--text-faint)] truncate leading-5">
                {thread.snippet}
              </span>
              {thread.hasAttachments && (
                <Paperclip size={10} className="text-[var(--text-faint)] shrink-0" />
              )}
            </div>
          </div>

          {/* Unread dot */}
          {thread.unread && (
            <div className="w-2 h-2 rounded-full bg-[var(--accent)] shrink-0 mt-2" />
          )}
        </div>
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
