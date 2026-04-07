import { useState } from 'react';
import { Clock, Check, X, ExternalLink, CalendarClock, ChevronDown, ChevronRight, Sparkles, Bookmark } from 'lucide-react';
import type { FollowupItem, SavedEmail } from '../services/api';
import { gmailThreadUrl } from '../lib/google-account-links';

interface Props {
  followups: FollowupItem[];
  accountEmail?: string | null;
  onComplete: (taskId: string) => void;
  onSnooze: (taskId: string, due: string) => void;
  onDelete: (taskId: string) => void;
  onOpenThread?: (threadId: string) => void;
  onAskAgent?: () => void;
  savedEmails?: SavedEmail[];
  onOpenSavedThread?: (threadId: string) => void;
  onUnsaveEmail?: (id: string) => void;
  kanbanMode?: boolean;
}

function dueLabel(due: string): string {
  if (!due) return '';
  const d = new Date(due);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function SnoozeMenu({ onSnooze }: { onSnooze: (due: string) => void }) {
  const [open, setOpen] = useState(false);

  const options = [
    { label: 'Tomorrow', days: 1 },
    { label: 'Next week', days: 7 },
    { label: 'Next month', days: 30 },
  ];

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 px-2 py-1 rounded bg-[var(--surface2)] text-[var(--text-dim)] text-[10px] hover:text-[var(--text)] transition-colors cursor-pointer"
        title="Snooze"
      >
        <CalendarClock size={10} />
        Snooze
      </button>
      {open && (
        <div className="absolute top-full right-0 mt-1 z-10 bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-sm)] shadow-lg py-1 min-w-[110px]">
          {options.map((opt) => (
            <button
              key={opt.label}
              onClick={() => {
                const date = new Date();
                date.setDate(date.getDate() + opt.days);
                onSnooze(date.toISOString());
                setOpen(false);
              }}
              className="w-full text-left px-3 py-1.5 text-[11px] text-[var(--text-dim)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)] transition-colors cursor-pointer"
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function FollowupCard({
  item,
  accountEmail,
  onComplete,
  onSnooze,
  onDelete,
  onOpenThread,
}: {
  item: FollowupItem;
  accountEmail?: string | null;
  onComplete: () => void;
  onSnooze: (due: string) => void;
  onDelete: () => void;
  onOpenThread?: (threadId: string) => void;
}) {
  const isOverdue = item.status === 'overdue';
  const isDueToday = item.status === 'due_today';

  return (
    <div
      className="group/item rounded-[22px] border border-white/6 bg-white/[0.03] p-4 transition-all hover:border-white/12 hover:-translate-y-px"
      style={{
        borderLeftWidth: isOverdue ? '4px' : isDueToday ? '3px' : '1px',
        borderLeftColor: isOverdue ? 'var(--error)' : isDueToday ? 'var(--warn)' : undefined,
      }}
    >
      <div className="flex items-start gap-3">
        <div
          className="w-2 h-2 rounded-full mt-1.5 shrink-0"
          style={{
            background: isOverdue ? 'var(--error)' : isDueToday ? 'var(--warn)' : 'var(--text-faint)',
          }}
        />
        <div className="flex-1 min-w-0">
          <div className="text-[14px] font-bold text-[var(--text)] tracking-tight">
            {item.commitment}
          </div>
          <div className="text-[12px] text-[var(--text-dim)] mt-1">
            to {item.recipient}
            {item.subject && <> &mdash; {item.subject}</>}
          </div>
          <div className="flex items-center gap-2 mt-2">
            <span
              className="text-[10px] font-bold px-2 py-0.5 rounded-full"
              style={{
                background: isOverdue ? 'var(--error-dim)' : isDueToday ? 'var(--warn-dim)' : 'var(--surface2)',
                color: isOverdue ? 'var(--error)' : isDueToday ? 'var(--warn)' : 'var(--text-faint)',
              }}
            >
              {isOverdue
                ? `${item.days_overdue}d overdue`
                : isDueToday
                  ? 'Due today'
                  : `Due ${dueLabel(item.due)}`}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-1.5 opacity-0 group-hover/item:opacity-100 transition-opacity shrink-0">
          <button
            onClick={onComplete}
            className="flex items-center gap-1 px-2 py-1 rounded bg-[var(--accent-dim)] text-[var(--accent)] text-[10px] font-bold hover:bg-[var(--accent)] hover:text-black active:translate-y-px transition-all cursor-pointer"
            title="Mark done"
          >
            <Check size={10} />
            Done
          </button>
          <SnoozeMenu onSnooze={onSnooze} />
          {item.thread_id && (
            <button
              onClick={() => onOpenThread?.(item.thread_id)}
              className="flex items-center gap-1 px-2 py-1 rounded bg-[var(--surface2)] text-[var(--text-dim)] text-[10px] hover:text-[var(--text)] transition-colors cursor-pointer"
              title="View in Gmail"
            >
              <ExternalLink size={10} />
            </button>
          )}
          <button
            onClick={onDelete}
            className="flex items-center px-1.5 py-1 rounded bg-[var(--surface2)] text-[var(--text-faint)] text-[10px] hover:text-[var(--error)] transition-colors cursor-pointer"
            title="Dismiss (false positive)"
          >
            <X size={10} />
          </button>
        </div>
      </div>
    </div>
  );
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export default function FollowupPanel({ followups, accountEmail, onComplete, onSnooze, onDelete, onOpenThread, onAskAgent, savedEmails, onOpenSavedThread, onUnsaveEmail, kanbanMode = false }: Props) {
  const active = followups.filter((f) => f.status !== 'completed');
  const overdue = active.filter((f) => f.status === 'overdue');
  const dueToday = active.filter((f) => f.status === 'due_today');
  const upcoming = active.filter((f) => f.status === 'upcoming');

  const [showUpcoming, setShowUpcoming] = useState(upcoming.length <= 3);

  return (
    <div className={kanbanMode ? 'flex flex-col' : 'home-panel home-panel-secondary overflow-hidden flex flex-col h-full'}>
      {!kanbanMode && (
        <div className="home-section-header" style={{ '--section-accent': 'var(--purple)' } as React.CSSProperties}>
          <div>
            <div className="home-section-kicker">Secondary workspace</div>
            <h3 className="home-section-title">Follow-ups</h3>
          </div>
          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 rounded-full bg-[var(--surface2)] text-[var(--text-faint)] text-[10px] font-mono font-bold uppercase tracking-wider">
              {active.length > 0 ? `${active.length} active` : 'All clear'}
            </span>
            {onAskAgent && (
              <button
                onClick={onAskAgent}
                className="flex h-7 w-7 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[var(--text-faint)] transition-all hover:border-[var(--accent-border)] hover:text-[var(--accent)] hover:bg-[var(--accent-glow)] cursor-pointer"
                title="Ask AI about follow-ups"
                aria-label="Ask AI about follow-ups"
              >
                <Sparkles size={13} />
              </button>
            )}
          </div>
        </div>
      )}

      {active.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center py-10 text-center">
          <div className="relative inline-flex items-center justify-center mb-3">
            <div className="absolute w-10 h-10 rounded-full bg-[var(--blue)] opacity-10 blur-md" />
            <div className="relative flex h-11 w-11 items-center justify-center rounded-full bg-[var(--blue-dim)] border border-[var(--blue-border)]">
              <Clock size={20} style={{ color: 'var(--blue)' }} />
            </div>
          </div>
          <span className="text-[13px] font-semibold text-[var(--text-dim)]">No open follow-ups</span>
          <span className="text-[12px] mt-1 text-[var(--text-faint)]">Commitments you make in sent emails will appear here</span>
        </div>
      ) : (
      <div className="px-4 py-4 flex flex-col gap-2.5">
        {overdue.map((item) => (
          <FollowupCard
            key={item.task_id}
            item={item}
            accountEmail={accountEmail}
            onComplete={() => onComplete(item.task_id)}
            onSnooze={(due) => onSnooze(item.task_id, due)}
            onDelete={() => onDelete(item.task_id)}
            onOpenThread={onOpenThread}
          />
        ))}
        {dueToday.map((item) => (
          <FollowupCard
            key={item.task_id}
            item={item}
            accountEmail={accountEmail}
            onComplete={() => onComplete(item.task_id)}
            onSnooze={(due) => onSnooze(item.task_id, due)}
            onDelete={() => onDelete(item.task_id)}
            onOpenThread={onOpenThread}
          />
        ))}
        {upcoming.length > 0 && (
          <>
            {!showUpcoming && upcoming.length > 3 && (
              <button
                onClick={() => setShowUpcoming(true)}
                className="flex items-center gap-1.5 px-4 py-2 text-[12px] text-[var(--text-dim)] hover:text-[var(--text)] transition-colors cursor-pointer"
              >
                <ChevronRight size={12} />
                {upcoming.length} upcoming
              </button>
            )}
            {(showUpcoming || upcoming.length <= 3) && upcoming.map((item) => (
              <FollowupCard
                key={item.task_id}
                item={item}
                accountEmail={accountEmail}
                onComplete={() => onComplete(item.task_id)}
                onSnooze={(due) => onSnooze(item.task_id, due)}
                onDelete={() => onDelete(item.task_id)}
                onOpenThread={onOpenThread}
              />
            ))}
            {showUpcoming && upcoming.length > 3 && (
              <button
                onClick={() => setShowUpcoming(false)}
                className="flex items-center gap-1.5 px-4 py-2 text-[12px] text-[var(--text-dim)] hover:text-[var(--text)] transition-colors cursor-pointer"
              >
                <ChevronDown size={12} />
                Show less
              </button>
            )}
          </>
        )}
      </div>
      )}

      {/* Saved emails section */}
      {savedEmails && savedEmails.length > 0 && (
        <div className="border-t border-[var(--border)] mt-1">
          <div className="px-4 pt-3 pb-1 flex items-center gap-2">
            <Bookmark size={12} style={{ color: 'var(--accent)' }} />
            <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-faint)]">
              Saved emails
            </span>
            <span className="ml-auto text-[10px] font-mono text-[var(--text-faint)]">{savedEmails.length}</span>
          </div>
          <div className="px-4 pb-3 flex flex-col gap-2">
            {savedEmails.map((email) => (
              <div
                key={email.id}
                className="group/saved flex items-start gap-2.5 rounded-[14px] border border-white/6 bg-white/[0.02] px-3 py-2.5 hover:border-white/10 hover:bg-white/[0.04] transition-all"
              >
                <div className="w-6 h-6 rounded-full bg-[var(--accent-dim)] border border-[var(--accent-border)] flex items-center justify-center text-[10px] font-bold text-[var(--accent)] shrink-0 mt-0.5">
                  {(email.sender[0] ?? '?').toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[12px] font-medium text-[var(--text)] truncate">{email.subject}</div>
                  <div className="text-[11px] text-[var(--text-faint)] truncate">
                    {email.sender} &middot; {timeAgo(email.saved_at)}
                  </div>
                </div>
                <div className="flex items-center gap-1 opacity-0 group-hover/saved:opacity-100 transition-opacity shrink-0">
                  {onOpenSavedThread && (
                    <button
                      title="Open in Gmail"
                      onClick={() => onOpenSavedThread(email.thread_id)}
                      className="flex items-center gap-1 px-2 py-1 rounded bg-[var(--surface2)] text-[var(--text-dim)] text-[10px] hover:text-[var(--text)] transition-colors cursor-pointer"
                    >
                      <ExternalLink size={10} />
                    </button>
                  )}
                  {onUnsaveEmail && (
                    <button
                      title="Unsave"
                      onClick={() => onUnsaveEmail(email.id)}
                      className="flex items-center px-1.5 py-1 rounded bg-[var(--surface2)] text-[var(--text-faint)] text-[10px] hover:text-[var(--error)] transition-colors cursor-pointer"
                    >
                      <X size={10} />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
