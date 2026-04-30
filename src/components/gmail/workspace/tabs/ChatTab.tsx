/**
 * ChatTab — renders an item-scoped chat conversation inside the workspace canvas.
 *
 * Each WorkItem gets a deterministic conversation id derived from its threadId.
 * On mount the tab binds (or creates) that conversation in the global ChatContext,
 * so the history persists when the user switches items and returns.
 *
 * Approval flow, streaming, and tool events all continue to work unchanged —
 * they operate on the global ChatContext's currentConversationId.
 */
import { useEffect } from 'react';
import ChatThread from '../../../ChatThread.js';
import CommandInput from '../../../CommandInput.js';
import { useChatContext } from '../../../../context/ChatContext.js';
import { conversationIdForItem, titleForItem, briefForItem } from '../../../../lib/gmail-item-conversation.js';
import type { WorkItem } from '../../../../lib/work-item.js';

interface Props {
  item: WorkItem;
}

export default function ChatTab({ item }: Props) {
  const { getOrCreateConversation, currentConversationId } = useChatContext();
  const targetId = conversationIdForItem(item);
  const seedTitle = titleForItem(item);
  const seedBrief = briefForItem(item);

  useEffect(() => {
    getOrCreateConversation(targetId, { title: seedTitle, threadBrief: seedBrief });
    // Re-run when the seed brief changes (e.g. enrichment lands) so the
    // existing conversation's threadBrief gets refreshed via
    // getOrCreateConversation's update path.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetId, seedBrief]);

  // Wait until the context has switched to the target conversation to avoid
  // rendering another item's message history for a brief moment.
  if (currentConversationId !== targetId) {
    return (
      <div className="flex flex-1 items-center justify-center text-[var(--text-faint)] text-[12px]">
        Loading chat…
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col min-h-0 min-w-0" data-testid="chat-tab">
      <ChatThread title={item.title} showCloseButton={false} />
      <CommandInput variant="reply" />
    </div>
  );
}
