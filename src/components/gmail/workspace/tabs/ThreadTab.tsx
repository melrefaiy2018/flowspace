/**
 * ThreadTab — renders the full message chain using MessageCard.
 * Shows an empty state when there is only one message (no real thread history).
 */
import { MessageSquare } from 'lucide-react';
import type { GmailThreadDetail } from '../../../../services/api.js';
import { MessageCard } from '../../ThreadReader.js';

interface Props {
  threadDetail: GmailThreadDetail | null;
}

export default function ThreadTab({ threadDetail }: Props) {
  if (!threadDetail) {
    return (
      <div className="flex items-center justify-center py-12 text-[var(--text-faint)] text-[13px]">
        Loading email…
      </div>
    );
  }

  if (threadDetail.messages.length <= 1) {
    return (
      <div className="flex flex-col items-center justify-center flex-1 gap-3 py-16 px-8 text-center">
        <div className="w-10 h-10 rounded-full bg-[var(--surface2)] flex items-center justify-center">
          <MessageSquare size={16} className="text-[var(--text-faint)]" />
        </div>
        <p className="text-[13px] text-[var(--text-dim)]">No thread history for this item yet.</p>
        <p className="text-[11px] text-[var(--text-faint)]">This email has no prior conversation.</p>
      </div>
    );
  }

  return (
    <div data-testid="thread-tab" className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden">
      {threadDetail.messages.map((msg, i) => (
        <MessageCard
          key={msg.id}
          message={msg}
          isLast={i === threadDetail.messages.length - 1}
        />
      ))}
    </div>
  );
}
