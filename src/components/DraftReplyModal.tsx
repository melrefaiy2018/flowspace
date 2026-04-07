import { useState, useRef } from 'react';
import { X, Send, Edit3, Trash2, Loader2, ChevronDown, ChevronUp } from 'lucide-react';
import { api, type OriginalMessage } from '../services/api';

interface Props {
  draft: string;
  subject: string;
  to: string;
  threadId: string;
  originalMessages?: OriginalMessage[];
  onClose: () => void;
  onSent: () => void;
}

function formatQuoteDate(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    return date.toLocaleString([], {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return dateStr;
  }
}

function extractName(from: string): string {
  const match = from.match(/^"?([^"<]+)"?\s*</);
  if (match) return match[1].trim();
  return from.split('@')[0];
}

export default function DraftReplyModal({ draft, subject, to, threadId, originalMessages, onClose, onSent }: Props) {
  const [body, setBody] = useState(draft);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [quotedExpanded, setQuotedExpanded] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = async () => {
    setSending(true);
    setError(null);
    try {
      await api.sendReply({ thread_id: threadId, to, subject, body });
      onSent();
    } catch (err: any) {
      setError(err.message || 'Failed to send');
    } finally {
      setSending(false);
    }
  };

  const hasOriginal = originalMessages && originalMessages.length > 0;
  const lastOriginal = hasOriginal ? originalMessages[originalMessages.length - 1] : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-[640px] mx-4 bg-[var(--bg-elevated)] border border-[var(--border)] rounded-[var(--radius-md)] shadow-[var(--shadow-elevated)] flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)]">
          <div className="flex-1 min-w-0">
            <div className="text-[12px] font-medium text-[var(--text)] truncate">{subject}</div>
            <div className="text-[10px] text-[var(--text-faint)] mt-0.5">To: {to}</div>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-[var(--radius-sm)] flex items-center justify-center text-[var(--text-faint)] hover:text-[var(--text)] hover:bg-[var(--surface)] transition-colors cursor-pointer ml-3"
          >
            <X size={14} />
          </button>
        </div>

        {/* Compose area + quoted original */}
        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
          {/* Draft textarea */}
          <textarea
            ref={textareaRef}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            className="w-full min-h-[140px] bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-sm)] p-3 text-[13px] text-[var(--text)] leading-relaxed resize-none outline-none focus:border-[var(--accent)] transition-colors"
            style={{ fieldSizing: 'content' as any, maxHeight: '300px' }}
          />

          {error && (
            <div className="text-[11px] text-[var(--error)]">{error}</div>
          )}

          {/* Original message (quoted reply, like Gmail) */}
          {hasOriginal && (
            <div className="border-l-2 border-[var(--border2)] pl-3">
              <button
                onClick={() => setQuotedExpanded(!quotedExpanded)}
                className="flex items-center gap-1.5 text-[11px] text-[var(--text-faint)] hover:text-[var(--text-dim)] cursor-pointer transition-colors py-1"
              >
                {quotedExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                <span className="font-medium">
                  {lastOriginal
                    ? `On ${formatQuoteDate(lastOriginal.date)}, ${extractName(lastOriginal.from)} wrote:`
                    : 'Show original message'
                  }
                </span>
              </button>

              {quotedExpanded && (
                <div className="mt-2 flex flex-col gap-4">
                  {originalMessages.map((msg, i) => (
                    <div key={i} className="flex flex-col gap-1">
                      {/* Show header for each message in the thread */}
                      {originalMessages.length > 1 && (
                        <div className="text-[10px] text-[var(--text-faint)] font-medium">
                          {extractName(msg.from)} &middot; {formatQuoteDate(msg.date)}
                        </div>
                      )}
                      <pre className="text-[12px] text-[var(--text-faint)] whitespace-pre-wrap leading-relaxed font-sans max-h-[300px] overflow-y-auto">
                        {msg.body || '(no content)'}
                      </pre>
                      {i < originalMessages.length - 1 && (
                        <hr className="border-[var(--border)] my-1" />
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 px-4 py-3 border-t border-[var(--border)]">
          <button
            onClick={handleSend}
            disabled={sending || !body.trim()}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-[var(--radius-sm)] bg-[var(--accent)] text-black text-[11px] font-medium hover:brightness-110 transition-all cursor-pointer disabled:opacity-50"
          >
            {sending ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
            Send
          </button>
          <button
            onClick={() => {
              textareaRef.current?.focus();
              textareaRef.current?.setSelectionRange(0, 0);
            }}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-[var(--radius-sm)] bg-[var(--surface)] border border-[var(--border)] text-[var(--text-dim)] text-[11px] font-medium hover:text-[var(--text)] hover:border-[var(--border2)] transition-all cursor-pointer"
          >
            <Edit3 size={12} />
            Edit & Send
          </button>
          <div className="flex-1" />
          <button
            onClick={onClose}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-[var(--radius-sm)] text-[var(--text-faint)] text-[11px] hover:text-[var(--error)] transition-colors cursor-pointer"
          >
            <Trash2 size={12} />
            Discard
          </button>
        </div>
      </div>
    </div>
  );
}
