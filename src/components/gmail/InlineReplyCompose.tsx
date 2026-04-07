import { useState, useRef, useEffect } from 'react';
import { Send, Trash2, Loader2, ChevronDown, ChevronUp } from 'lucide-react';
import { api, type OriginalMessage } from '../../services/api';

interface Props {
  threadId: string;
  subject: string;
  to: string;
  draft: string;
  originalMessages?: OriginalMessage[];
  onSent: () => void;
  onDiscard: () => void;
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

export default function InlineReplyCompose({ threadId, subject, to, draft, originalMessages, onSent, onDiscard }: Props) {
  const [body, setBody] = useState(draft);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [quotedExpanded, setQuotedExpanded] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    // Focus textarea and place cursor at end when compose opens
    textareaRef.current?.focus();
  }, []);

  // Update body when draft changes (new thread selected)
  useEffect(() => {
    setBody(draft);
  }, [draft]);

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
    <div className="border-t border-[var(--border)] bg-[var(--surface)]">
      {/* Header bar */}
      <div className="flex items-center gap-2 px-5 py-2 border-b border-[var(--border)]">
        <div className="flex-1 min-w-0">
          <span className="text-[11px] text-[var(--text-faint)]">
            Reply to <span className="text-[var(--text-dim)] font-medium">{to}</span>
          </span>
        </div>
      </div>

      {/* Compose area */}
      <div className="px-5 py-3">
        <textarea
          ref={textareaRef}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Write your reply..."
          className="w-full min-h-[100px] bg-[var(--bg)] border border-[var(--border)] rounded-[var(--radius-sm)] p-3 text-[13px] text-[var(--text)] leading-relaxed resize-none outline-none focus:border-[var(--accent)] transition-colors"
          style={{ fieldSizing: 'content' as any, maxHeight: '250px' }}
        />

        {error && (
          <div className="mt-1 text-[11px] text-[var(--error)]">{error}</div>
        )}

        {/* Quoted original */}
        {hasOriginal && (
          <div className="mt-2 border-l-2 border-[var(--border2)] pl-3">
            <button
              onClick={() => setQuotedExpanded(!quotedExpanded)}
              className="flex items-center gap-1.5 text-[11px] text-[var(--text-faint)] hover:text-[var(--text-dim)] cursor-pointer transition-colors py-0.5"
            >
              {quotedExpanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
              <span>
                {lastOriginal
                  ? `On ${formatQuoteDate(lastOriginal.date)}, ${extractName(lastOriginal.from)} wrote:`
                  : 'Show original'}
              </span>
            </button>

            {quotedExpanded && (
              <div className="mt-1.5">
                {originalMessages.map((msg, i) => (
                  <div key={i}>
                    {originalMessages.length > 1 && (
                      <div className="text-[10px] text-[var(--text-faint)] font-medium mt-2 first:mt-0">
                        {extractName(msg.from)} &middot; {formatQuoteDate(msg.date)}
                      </div>
                    )}
                    <pre className="text-[11px] text-[var(--text-faint)] whitespace-pre-wrap leading-relaxed font-sans max-h-[200px] overflow-y-auto">
                      {msg.body || '(no content)'}
                    </pre>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-2 mt-3">
          <button
            onClick={handleSend}
            disabled={sending || !body.trim()}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-[var(--radius-sm)] bg-[var(--accent)] text-black text-[11px] font-medium hover:brightness-110 transition-all cursor-pointer disabled:opacity-50"
          >
            {sending ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
            Send
          </button>
          <button
            onClick={onDiscard}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-[var(--radius-sm)] text-[var(--text-faint)] text-[11px] hover:text-[var(--error)] transition-colors cursor-pointer"
          >
            <Trash2 size={11} />
            Discard
          </button>
        </div>
      </div>
    </div>
  );
}
