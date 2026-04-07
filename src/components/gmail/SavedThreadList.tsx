import { Bookmark, Star, EyeOff, X } from 'lucide-react';
import type { SavedEmail } from '../../services/api';

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

interface Props {
  savedEmails: SavedEmail[];
  selectedThreadId?: string;
  onSelectThread: (threadId: string) => void;
  onUnsave: (id: string) => void;
}

const CATEGORIES: { label: 'important' | 'not_important'; title: string; icon: React.ReactNode; color: string }[] = [
  {
    label: 'important',
    title: 'Important',
    icon: <Star size={12} />,
    color: 'var(--warn)',
  },
  {
    label: 'not_important',
    title: 'Not important',
    icon: <EyeOff size={12} />,
    color: 'var(--text-faint)',
  },
];

function EmailCard({
  email,
  isSelected,
  onSelect,
  onUnsave,
}: {
  email: SavedEmail;
  isSelected: boolean;
  onSelect: () => void;
  onUnsave: () => void;
}) {
  const initial = (email.sender[0] ?? '?').toUpperCase();

  return (
    <div
      data-testid="saved-email-card"
      data-selected={String(isSelected)}
      onClick={onSelect}
      className={`group flex items-start gap-3 px-4 py-3 cursor-pointer transition-colors hover:bg-white/[0.04] ${
        isSelected ? 'bg-[var(--accent)]/8 border-l-2 border-l-[var(--accent)]' : ''
      }`}
    >
      <div className="w-8 h-8 rounded-full bg-[var(--accent-dim)] border border-[var(--accent-border)] flex items-center justify-center text-[11px] font-bold text-[var(--accent)] shrink-0 mt-0.5">
        {initial}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="text-[13px] font-medium text-[var(--text)] truncate">{email.sender}</span>
          <span className="text-[10px] text-[var(--text-faint)] shrink-0">{timeAgo(email.saved_at)}</span>
        </div>
        <div className="text-[12px] text-[var(--text-dim)] truncate mt-0.5">{email.subject}</div>
      </div>
      <button
        title="Remove"
        onClick={(e) => { e.stopPropagation(); onUnsave(); }}
        className="opacity-0 group-hover:opacity-100 p-1 rounded text-[var(--text-faint)] hover:text-[var(--error)] hover:bg-[var(--error-dim)] transition-all cursor-pointer shrink-0"
      >
        <X size={12} />
      </button>
    </div>
  );
}

export default function SavedThreadList({ savedEmails, selectedThreadId, onSelectThread, onUnsave }: Props) {
  if (savedEmails.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
        <div className="relative inline-flex items-center justify-center mb-3">
          <div className="absolute w-10 h-10 rounded-full bg-[var(--accent)] opacity-10 blur-md" />
          <div className="relative flex h-11 w-11 items-center justify-center rounded-full bg-[var(--accent-dim)] border border-[var(--accent-border)]">
            <Bookmark size={20} style={{ color: 'var(--accent)' }} />
          </div>
        </div>
        <span className="text-[13px] font-semibold text-[var(--text-dim)]">No labeled emails yet</span>
        <span className="text-[12px] mt-1 text-[var(--text-faint)] max-w-[220px]">
          Mark emails <strong>Important</strong> or <strong>Not important</strong> in AI Triage to see them here
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      {CATEGORIES.map((cat) => {
        const items = savedEmails.filter((e) => e.label === cat.label);
        if (items.length === 0) return null;

        return (
          <div key={cat.label}>
            {/* Category header */}
            <div className="flex items-center gap-2 px-4 py-2.5 border-b border-[var(--border)] bg-white/[0.01] sticky top-0">
              <span style={{ color: cat.color }} className="flex items-center">
                {cat.icon}
              </span>
              <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-faint)]">
                {cat.title}
              </span>
              <span className="ml-auto text-[10px] font-mono text-[var(--text-faint)]">{items.length}</span>
            </div>

            {/* Cards */}
            <div className="divide-y divide-[var(--border)]">
              {items.map((email) => (
                <EmailCard
                  key={email.id}
                  email={email}
                  isSelected={email.thread_id === selectedThreadId}
                  onSelect={() => onSelectThread(email.thread_id)}
                  onUnsave={() => onUnsave(email.id)}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
