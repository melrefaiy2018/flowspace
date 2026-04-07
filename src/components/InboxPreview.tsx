import { Mail, Reply, CheckSquare, Sparkles } from 'lucide-react';
import type { GmailMessage } from '../services/api';

interface Props {
  messages: GmailMessage[];
  onAction: (prompt: string, autoSend: boolean) => void;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  return `${days}d`;
}

function senderName(from: string): string {
  const match = from.match(/^([^<]+)/);
  return match ? match[1].trim() : from;
}

export default function InboxPreview({ messages, onAction }: Props) {
  const unreadCount = messages.filter((m) => m.unread).length;
  // Sort: unread first, then by date
  const sorted = [...messages].sort((a, b) => {
    if (a.unread !== b.unread) return a.unread ? -1 : 1;
    return new Date(b.date).getTime() - new Date(a.date).getTime();
  });

  return (
    <div className="rounded-[var(--radius-md)] bg-[var(--surface)] border border-[var(--border)] overflow-hidden flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)]">
        <div className="flex items-center gap-2">
          <Mail size={14} className="text-[var(--accent)]" />
          <span className="text-[12px] font-medium">Inbox</span>
          {unreadCount > 0 && (
            <span className="px-1.5 py-0.5 rounded-full bg-[var(--accent-dim)] text-[var(--accent)] text-[9px] font-mono font-bold">
              {unreadCount} new
            </span>
          )}
        </div>
      </div>

      {/* Email rows */}
      <div className="flex-1 overflow-y-auto px-2 py-2 flex flex-col gap-0.5">
        {sorted.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-[var(--text-faint)]">
            <Mail size={24} className="mb-2 opacity-40" />
            <span className="text-[12px]">Inbox zero</span>
          </div>
        ) : (
          sorted.slice(0, 4).map((msg) => (
            <div
              key={msg.id}
              className="group px-3 py-2.5 rounded-[var(--radius-sm)] transition-colors hover:bg-[var(--surface-hover)]"
            >
              {/* Row 1: sender + time + actions */}
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  {msg.unread && (
                    <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] shrink-0" />
                  )}
                  <span className={`text-[12px] truncate ${msg.unread ? 'font-medium text-[var(--text)]' : 'text-[var(--text-dim)]'}`}>
                    {senderName(msg.from)}
                  </span>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
                    <button
                      onClick={() => onAction(`Give me a brief, human-readable summary of this email.\n\nFrom: ${senderName(msg.from)}\nSubject: ${msg.subject}\nPreview: ${msg.snippet || '(no preview available)'}\n\nSummarize the key points in 2-3 sentences. Do not output JSON or raw data.`, true)}
                      className="w-6 h-6 rounded-[var(--radius-sm)] bg-[var(--purple-dim)] flex items-center justify-center text-[var(--purple)] hover:bg-[var(--purple)] hover:text-black transition-colors cursor-pointer"
                      title="Summarize with AI"
                    >
                      <Sparkles size={11} />
                    </button>
                    <button
                      onClick={() => onAction(`Draft a reply to ${senderName(msg.from)} about "${msg.subject}"`, false)}
                      className="w-6 h-6 rounded-[var(--radius-sm)] bg-[var(--accent-dim)] flex items-center justify-center text-[var(--accent)] hover:bg-[var(--accent)] hover:text-black transition-colors cursor-pointer"
                      title="Reply with AI"
                    >
                      <Reply size={11} />
                    </button>
                    <button
                      onClick={() => onAction(`Create a task from this email: "${msg.subject}" from ${senderName(msg.from)}`, true)}
                      className="w-6 h-6 rounded-[var(--radius-sm)] bg-[var(--warn-dim)] flex items-center justify-center text-[var(--warn)] hover:bg-[var(--warn)] hover:text-black transition-colors cursor-pointer"
                      title="Create task"
                    >
                      <CheckSquare size={11} />
                    </button>
                  </div>
                  <span className="text-[10px] font-mono text-[var(--text-faint)]">{timeAgo(msg.date)}</span>
                </div>
              </div>
              {/* Row 2: subject */}
              <div className={`text-[12px] truncate mt-1 ${msg.unread ? 'text-[var(--text)]' : 'text-[var(--text-dim)]'}`}>
                {msg.subject || '(No subject)'}
              </div>
              {/* Row 3: snippet preview */}
              {msg.snippet && (
                <div className="text-[11px] text-[var(--text-faint)] mt-0.5 line-clamp-2 leading-relaxed">
                  {msg.snippet}
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* Footer */}
      {unreadCount > 0 && (
        <div className="border-t border-[var(--border)] px-4 py-2.5">
          <button
            onClick={() => onAction('Summarize my unread emails', true)}
            className="text-[11px] text-[var(--accent)] hover:underline cursor-pointer"
          >
            Summarize all unread
          </button>
        </div>
      )}
    </div>
  );
}
