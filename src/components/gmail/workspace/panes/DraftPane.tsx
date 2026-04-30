/**
 * DraftPane — wraps InlineReplyCompose with a workspace header and a Regenerate button.
 *
 * Fetches a draft on mount via api.draftReply when briefand threadDetail are present.
 * A Regenerate button refetches a fresh draft from the LLM.
 */
import { useState, useEffect } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { api } from '../../../../services/api.js';
import type { OriginalMessage } from '../../../../services/api.js';
import InlineReplyCompose from '../../InlineReplyCompose.js';
import type { PaneProps } from './types.js';

function extractRecipient(messages: NonNullable<import('../../../../services/api.js').GmailThreadDetail>['messages']): string {
  if (messages.length === 0) return '';
  const lastMsg = messages[messages.length - 1];
  // Reply to whoever sent the last message
  const fromHeader = lastMsg.from;
  const emailMatch = fromHeader.match(/<([^>]+)>/);
  if (emailMatch) return emailMatch[1];
  return fromHeader.trim();
}

// ── Skeleton ────────────────────────────────────────────────────────────────

function DraftPaneSkeleton() {
  return (
    <div data-testid="draft-pane-skeleton" className="flex flex-col gap-4 p-5">
      <div className="h-14 w-full bg-[var(--surface3)] animate-pulse rounded-[10px]" />
      <div className="h-32 w-full bg-[var(--surface3)] animate-pulse rounded-[10px]" />
      <div className="h-8 w-24 bg-[var(--surface3)] animate-pulse rounded-[8px]" />
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

export default function DraftPane({ item, threadDetail, brief, briefLoading: _briefLoading, onAgentAction: _onAgentAction, onComplete }: PaneProps) {
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [originalMessages, setOriginalMessages] = useState<OriginalMessage[]>([]);
  const [to, setTo] = useState('');
  const [fetched, setFetched] = useState(false);

  const threadId = item.source.threadId;

  // Fetch initial draft when threadDetail and brief are available
  useEffect(() => {
    if (!threadDetail || !brief || fetched) return;

    let cancelled = false;
    setLoading(true);
    setError(null);

    api.draftReply(threadId)
      .then((resp) => {
        if (cancelled) return;
        setDraft(resp.draft);
        setTo(resp.to);
        setOriginalMessages(resp.original_messages ?? []);
        setFetched(true);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load draft');
        setLoading(false);
      });

    return () => { cancelled = true; };
  }, [threadId, threadDetail, brief, fetched]);

  const handleRegenerate = async () => {
    setRegenerating(true);
    setError(null);
    try {
      const resp = await api.draftReply(threadId);
      setDraft(resp.draft);
      setTo(resp.to);
      setOriginalMessages(resp.original_messages ?? []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to regenerate draft');
    } finally {
      setRegenerating(false);
    }
  };

  const handleSent = () => {
    const recipient = to || (threadDetail ? extractRecipient(threadDetail.messages) : 'recipient');
    onComplete?.(`Replied to ${recipient}`);
  };

  const handleDiscard = () => {
    setDraft('');
    setFetched(false);
  };

  if (!threadDetail) {
    return <DraftPaneSkeleton />;
  }

  const subject = threadDetail.subject ?? item.title;
  const recipient = to || extractRecipient(threadDetail.messages);

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {/* Header info card */}
      <div className="mx-5 mt-5 mb-3 px-4 py-3 rounded-[10px] bg-[var(--surface)] border border-[var(--border)]">
        <p className="text-[13px] text-[var(--text-dim)] leading-relaxed">
          Agent has drafted a reply based on this thread. Review and send, or regenerate.
        </p>
        <div className="flex items-center gap-2 mt-2">
          <button
            type="button"
            aria-label="Regenerate draft"
            onClick={handleRegenerate}
            disabled={regenerating || loading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] border border-[var(--border)] text-[11px] text-[var(--text-dim)] hover:bg-[var(--surface2)] transition-colors cursor-pointer disabled:opacity-50"
          >
            {regenerating
              ? <Loader2 data-testid="regenerate-spinner" size={12} className="animate-spin" />
              : <RefreshCw size={12} />}
            Regenerate
          </button>
        </div>
      </div>

      {/* Error state */}
      {error && (
        <div className="mx-5 mb-3 px-4 py-2 rounded-[8px] bg-[var(--error)]/10 text-[12px] text-[var(--error)]">
          {error}
        </div>
      )}

      {/* Loading overlay for initial fetch */}
      {loading && (
        <div className="mx-5 mb-3 flex items-center gap-2 text-[12px] text-[var(--text-faint)]">
          <Loader2 size={12} className="animate-spin" />
          Loading draft…
        </div>
      )}

      {/* Compose area */}
      {!loading && (
        <InlineReplyCompose
          threadId={threadId}
          subject={subject}
          to={recipient}
          draft={draft}
          originalMessages={originalMessages}
          onSent={handleSent}
          onDiscard={handleDiscard}
        />
      )}
    </div>
  );
}
