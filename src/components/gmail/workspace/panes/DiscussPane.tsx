/**
 * DiscussPane — chat-bridge pane for 'discuss' pane kind and as the fallback.
 *
 * Navigates to the Chat tab (inline, item-scoped) instead of opening the side panel.
 * Quick-prompt buttons pre-seed the chat input and switch to the Chat tab.
 */
import { MessageCircle } from 'lucide-react';
import { useChatContext } from '../../../../context/ChatContext.js';
import type { PaneProps } from './types.js';

const QUICK_PROMPTS = [
  'Summarize this thread',
  'What should I do with this?',
  'Draft a reply',
] as const;

export default function DiscussPane({ briefLoading, onSwitchTab }: PaneProps) {
  const { setInput } = useChatContext();

  function goToChat(prompt?: string) {
    if (prompt) setInput(prompt);
    onSwitchTab?.('chat');
  }

  return (
    <div className="flex flex-col gap-4 p-5">
      {/* Loading banner */}
      {briefLoading && (
        <div
          data-testid="discuss-pane-loading-banner"
          className="flex items-center gap-2 px-4 py-2.5 rounded-[8px] bg-[var(--surface2)] border border-[var(--border)] text-[12px] text-[var(--text-dim)]"
        >
          <div className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] animate-pulse" />
          FlowSpace is still analyzing this thread — you can start discussing while it works.
        </div>
      )}

      {/* Main card */}
      <div className="rounded-[12px] bg-[var(--surface)] border border-[var(--border)] px-5 py-6 flex flex-col items-center text-center gap-4">
        <div className="w-10 h-10 rounded-full bg-[var(--surface2)] flex items-center justify-center">
          <MessageCircle size={18} className="text-[var(--text-faint)]" />
        </div>

        <p className="text-[14px] text-[var(--text-dim)] max-w-xs leading-relaxed">
          Talk to the agent about this email. Chat happens right here in the workspace.
        </p>

        {/* Primary chat button */}
        <button
          type="button"
          aria-label="Open chat"
          onClick={() => goToChat()}
          className="px-4 py-2 rounded-[8px] bg-[var(--accent)] text-black text-[13px] font-medium hover:brightness-110 transition-all cursor-pointer"
        >
          Open chat
        </button>
      </div>

      {/* Quick prompts */}
      <div className="flex flex-col gap-2">
        <p className="text-[11px] text-[var(--text-faint)] uppercase tracking-wide px-1">
          Quick prompts
        </p>
        <div className="flex flex-wrap gap-2">
          {QUICK_PROMPTS.map((prompt) => (
            <button
              key={prompt}
              type="button"
              aria-label={prompt}
              onClick={() => goToChat(prompt)}
              className="px-3 py-1.5 rounded-[8px] border border-[var(--border)] text-[12px] text-[var(--text-dim)] hover:bg-[var(--surface2)] transition-colors cursor-pointer"
            >
              {prompt}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
