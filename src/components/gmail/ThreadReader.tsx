import { useRef, useEffect, useState, useCallback } from 'react';
import { ArrowLeft, Archive, Trash2, Reply, Paperclip, Download, Loader2 } from 'lucide-react';
import { api, type GmailThreadDetail, type GmailThreadMessage, type DraftReplyResponse } from '../../services/api';
import type { GmailAgentAction } from '../../lib/gmail-agent';
import { openExternalUrl } from '../../lib/open-external';
import InlineReplyCompose from './InlineReplyCompose';

interface Props {
  thread: GmailThreadDetail;
  onBack: () => void;
  onArchive: (threadId: string) => Promise<void>;
  onTrash: (threadId: string) => Promise<void>;
  onAgentAction: (thread: GmailThreadDetail, action: GmailAgentAction, question?: string) => void;
}

function formatFullDate(dateStr: string): string {
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

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function MessageBody({ message }: { message: GmailThreadMessage }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    if (message.bodyType === 'html' && iframeRef.current) {
      const doc = iframeRef.current.contentDocument;
      if (doc) {
        doc.open();
        doc.write(`
          <html>
            <head>
              <style>
                html, body {
                  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                  font-size: 13px;
                  line-height: 1.5;
                  margin: 0;
                  padding: 0;
                  word-break: break-word;
                  overflow-wrap: break-word;
                  background: #1a1a1a !important;
                  color: #e0e0e0 !important;
                  color-scheme: dark;
                }
                img { max-width: 100%; height: auto; }
                a { color: #7eb3f5; }
                blockquote {
                  border-left: 2px solid #555;
                  margin: 8px 0;
                  padding-left: 12px;
                  color: #999;
                }
                pre, code { white-space: pre-wrap; }
                table, td, th { background-color: transparent !important; }
                [style*="background:#fff"], [style*="background: #fff"],
                [style*="background:#ffffff"], [style*="background: #ffffff"],
                [style*="background-color:#fff"], [style*="background-color: #fff"],
                [style*="background-color:#ffffff"], [style*="background-color: #ffffff"],
                [style*="background-color: white"], [style*="background-color:white"] {
                  background-color: #1a1a1a !important;
                }
                [style*="color:#000"], [style*="color: #000"],
                [style*="color:#333"], [style*="color: #333"],
                [style*="color:#222"], [style*="color: #222"],
                [style*="color: black"], [style*="color:black"] {
                  color: #e0e0e0 !important;
                }
              </style>
              <script>
                document.addEventListener('click', function(e) {
                  var a = e.target.closest('a');
                  if (a && a.href) {
                    e.preventDefault();
                    window.parent.postMessage({ type: 'open-url', url: a.href }, '*');
                  }
                });
              </script>
            </head>
            <body>${message.body}</body>
          </html>
        `);
        doc.close();

        // Listen for open-url messages posted by the injected iframe script
        const handleMessage = (e: MessageEvent) => {
          if (e.data?.type === 'open-url' && typeof e.data.url === 'string') {
            openExternalUrl(e.data.url);
          }
        };
        window.addEventListener('message', handleMessage);

        // Auto-resize iframe to fit content
        const resize = () => {
          if (iframeRef.current && doc.body) {
            iframeRef.current.style.height = `${doc.body.scrollHeight + 16}px`;
          }
        };
        resize();
        // Re-check after images load
        const observer = new MutationObserver(resize);
        observer.observe(doc.body, { childList: true, subtree: true });
        doc.addEventListener('load', resize, true);
        return () => {
          observer.disconnect();
          window.removeEventListener('message', handleMessage);
        };
      }
    }
  }, [message.body, message.bodyType]);

  if (message.bodyType === 'html') {
    return (
      <iframe
        ref={iframeRef}
        sandbox="allow-same-origin allow-scripts"
        title="Email content"
        className="w-full max-w-full border-0 min-h-[100px]"
        style={{ background: 'transparent' }}
      />
    );
  }

  return (
    <pre className="text-[13px] text-[var(--text-dim)] whitespace-pre-wrap leading-relaxed font-sans">
      {message.body || '(no content)'}
    </pre>
  );
}

function MessageCard({ message, isLast }: { message: GmailThreadMessage; isLast: boolean }) {
  return (
    <div className={`px-5 py-4 ${!isLast ? 'border-b border-[var(--border)]' : ''}`}>
      {/* Header */}
      <div className="flex items-start gap-3 mb-3">
        <div className="w-8 h-8 rounded-full bg-[var(--purple)] flex items-center justify-center text-[11px] font-bold text-white shrink-0">
          {extractName(message.from)[0]?.toUpperCase() ?? '?'}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2">
            <span className="text-[13px] font-medium">{extractName(message.from)}</span>
            <span className="text-[10px] text-[var(--text-faint)]">{formatFullDate(message.date)}</span>
          </div>
          <div className="text-[11px] text-[var(--text-faint)] truncate">
            To: {message.to}
            {message.cc && <> &middot; Cc: {message.cc}</>}
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="pl-11">
        <MessageBody message={message} />

        {/* Attachments */}
        {message.attachments.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {message.attachments.map((att) => (
              <div
                key={att.attachmentId}
                className="flex items-center gap-2 px-3 py-2 bg-[var(--surface2)] border border-[var(--border)] rounded-lg text-[11px]"
              >
                <Paperclip size={12} className="text-[var(--text-faint)] shrink-0" />
                <span className="truncate max-w-[160px]">{att.filename}</span>
                <span className="text-[var(--text-faint)]">{formatSize(att.size)}</span>
                <Download size={12} className="text-[var(--accent)] shrink-0 cursor-pointer hover:scale-110 transition-transform" />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function ThreadReader({ thread, onBack, onArchive, onTrash, onAgentAction }: Props) {
  const [replyState, setReplyState] = useState<DraftReplyResponse | null>(null);
  const [draftLoading, setDraftLoading] = useState(false);
  const [askInput, setAskInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  // Reset reply state when switching threads
  useEffect(() => {
    setReplyState(null);
    setAskInput('');
  }, [thread.id]);

  const handleReply = useCallback(async () => {
    setDraftLoading(true);
    try {
      const result = await api.draftReply(thread.id);
      setReplyState(result);
      // Scroll to bottom to show compose area
      requestAnimationFrame(() => {
        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
      });
    } catch (err: any) {
      console.error('Draft reply failed:', err.message);
    } finally {
      setDraftLoading(false);
    }
  }, [thread.id]);

  const handleReplySent = useCallback(() => {
    setReplyState(null);
  }, []);

  const handleAskAgent = useCallback(() => {
    const trimmed = askInput.trim();
    if (!trimmed) return;
    onAgentAction(thread, 'ask_agent', trimmed);
    setAskInput('');
  }, [askInput, onAgentAction, thread]);

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-[var(--border)] bg-[var(--surface)] shrink-0">
        <button
          onClick={onBack}
          className="p-1.5 rounded-[var(--radius-sm)] text-[var(--text-dim)] hover:bg-[var(--surface2)] hover:text-[var(--text)] transition-all cursor-pointer"
          title="Back to list"
        >
          <ArrowLeft size={16} />
        </button>
        <div className="flex-1" />
        <button
          onClick={handleReply}
          disabled={draftLoading || replyState !== null}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-sm)] text-[11px] font-medium bg-[var(--accent)] text-black hover:brightness-110 transition-all cursor-pointer disabled:opacity-50"
        >
          {draftLoading ? <Loader2 size={12} className="animate-spin" /> : <Reply size={12} />}
          Reply
        </button>
        <button
          onClick={() => onArchive(thread.id)}
          className="p-1.5 rounded-[var(--radius-sm)] text-[var(--text-dim)] hover:bg-[var(--surface2)] hover:text-[var(--text)] transition-all cursor-pointer"
          title="Archive"
        >
          <Archive size={14} />
        </button>
        <button
          onClick={() => onTrash(thread.id)}
          className="p-1.5 rounded-[var(--radius-sm)] text-[var(--text-dim)] hover:bg-[var(--error-dim)] hover:text-[var(--error)] transition-all cursor-pointer"
          title="Trash"
        >
          <Trash2 size={14} />
        </button>
      </div>

      {/* Subject */}
      <div className="px-5 py-3 border-b border-[var(--border)]">
        <h2 className="text-[16px] font-semibold tracking-[-0.3px]">{thread.subject || '(no subject)'}</h2>
        <span className="text-[11px] text-[var(--text-faint)]">
          {thread.messages.length} message{thread.messages.length !== 1 ? 's' : ''}
        </span>
        <div className="mt-3 rounded-[12px] border border-[var(--border)] bg-[var(--surface)]/60 p-3">
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--text-faint)]">
                Agent actions
              </span>
              <button
                onClick={() => onAgentAction(thread, 'add_to_calendar')}
                className="rounded-full border border-[var(--border)] px-3 py-1.5 text-[11px] font-medium text-[var(--text-dim)] hover:border-[var(--accent)]/40 hover:text-[var(--text)] hover:bg-[var(--surface2)] transition-colors cursor-pointer"
              >
                Add to calendar
              </button>
              <button
                onClick={() => onAgentAction(thread, 'draft_follow_up')}
                className="rounded-full border border-[var(--border)] px-3 py-1.5 text-[11px] font-medium text-[var(--text-dim)] hover:border-[var(--accent)]/40 hover:text-[var(--text)] hover:bg-[var(--surface2)] transition-colors cursor-pointer"
              >
                Draft follow-up
              </button>
              <button
                onClick={() => onAgentAction(thread, 'create_task')}
                className="rounded-full border border-[var(--border)] px-3 py-1.5 text-[11px] font-medium text-[var(--text-dim)] hover:border-[var(--accent)]/40 hover:text-[var(--text)] hover:bg-[var(--surface2)] transition-colors cursor-pointer"
              >
                Create task
              </button>
            </div>
            <div className="flex flex-col gap-2 md:flex-row">
              <input
                value={askInput}
                onChange={(e) => setAskInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAskAgent();
                  }
                }}
                placeholder="Ask the agent about this email..."
                className="flex-1 rounded-[10px] border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-[12px] text-[var(--text)] placeholder:text-[var(--text-faint)] outline-none focus:border-[var(--accent)]"
              />
              <button
                onClick={handleAskAgent}
                disabled={!askInput.trim()}
                className="rounded-[10px] bg-[var(--surface2)] px-3 py-2 text-[12px] font-medium text-[var(--text)] hover:bg-[var(--surface3)] transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
              >
                Ask agent
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Messages + inline reply */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto overflow-x-hidden">
        {thread.messages.map((msg, i) => (
          <MessageCard
            key={msg.id}
            message={msg}
            isLast={i === thread.messages.length - 1 && !replyState}
          />
        ))}

        {/* Inline reply compose (appears at bottom of thread, like Gmail) */}
        {replyState && (
          <InlineReplyCompose
            threadId={replyState.thread_id}
            subject={replyState.subject}
            to={replyState.to}
            draft={replyState.draft}
            originalMessages={replyState.original_messages}
            onSent={handleReplySent}
            onDiscard={() => setReplyState(null)}
          />
        )}
      </div>
    </div>
  );
}
