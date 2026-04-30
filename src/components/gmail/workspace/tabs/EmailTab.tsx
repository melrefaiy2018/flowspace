/**
 * EmailTab — renders the thread's last message (the email the user is acting on).
 *
 * Imports MessageCard as a named export from ThreadReader.
 */
import type { GmailThreadDetail } from '../../../../services/api.js';
import { MessageCard } from '../../ThreadReader.js';

interface Props {
  threadDetail: GmailThreadDetail | null;
}

export default function EmailTab({ threadDetail }: Props) {
  if (!threadDetail) {
    return (
      <div className="flex items-center justify-center py-12 text-[var(--text-faint)] text-[13px]">
        Loading email…
      </div>
    );
  }

  const lastMessage = threadDetail.messages[threadDetail.messages.length - 1];
  if (!lastMessage) {
    return (
      <div className="flex items-center justify-center py-12 text-[var(--text-faint)] text-[13px]">
        No message content.
      </div>
    );
  }

  return (
    <div data-testid="email-tab" className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden">
      <MessageCard message={lastMessage} isLast={true} />
    </div>
  );
}
