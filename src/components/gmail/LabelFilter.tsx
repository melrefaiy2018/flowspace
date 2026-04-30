import type { GmailLabel } from '../../services/api';

// System labels to show (in order), with display-friendly names
const SYSTEM_LABELS: Array<{ id: string; name: string }> = [
  { id: 'INBOX', name: 'Inbox' },
  { id: 'STARRED', name: 'Starred' },
  { id: 'SENT', name: 'Sent' },
  { id: 'DRAFT', name: 'Drafts' },
  { id: 'SPAM', name: 'Spam' },
  { id: 'TRASH', name: 'Trash' },
];

interface Props {
  labels: GmailLabel[];
  activeLabel: string;
  onSelect: (labelId: string) => void;
}

export default function LabelFilter({ labels, activeLabel, onSelect }: Props) {
  const systemLabels = SYSTEM_LABELS.map((sl) => {
    const match = labels.find((l) => l.id === sl.id);
    return { ...sl, unread: match?.messagesUnread ?? 0 };
  });

  const userLabels = labels
    .filter((l) => l.type === 'user')
    .sort((a, b) => a.name.localeCompare(b.name));

  const TabItem = ({
    id,
    name,
    unread,
  }: {
    id: string;
    name: string;
    unread?: number;
  }) => {
    const isActive = activeLabel === id;
    return (
      <button
        key={id}
        onClick={() => onSelect(id)}
        className={[
          'relative flex items-center gap-1.5 px-1 pb-3 text-[12px] font-medium transition-colors duration-100 cursor-pointer whitespace-nowrap shrink-0',
          isActive
            ? 'text-[var(--text)]'
            : 'text-[var(--text-faint)] hover:text-[var(--text-dim)]',
        ].join(' ')}
      >
        {name}
        {unread !== undefined && unread > 0 && (
          <span
            className={`font-mono text-[9px] rounded-full px-[5px] py-px min-w-[16px] text-center leading-[15px] ${
              isActive
                ? 'bg-[var(--accent)]/15 text-[var(--accent)]'
                : 'bg-white/[0.06] text-[var(--text-faint)]'
            }`}
          >
            {unread > 99 ? '99+' : unread}
          </span>
        )}
        {/* Active underline */}
        {isActive && (
          <span className="absolute bottom-0 left-0 right-0 h-[1.5px] bg-[var(--accent)] rounded-full" />
        )}
      </button>
    );
  };

  return (
    <div className="flex items-end gap-4 h-full">
      {systemLabels.map((label) => (
        <TabItem key={label.id} id={label.id} name={label.name} unread={label.unread} />
      ))}
      {userLabels.length > 0 && (
        <>
          <div className="self-center h-3.5 w-px bg-[var(--border)] shrink-0" />
          {userLabels.map((label) => (
            <TabItem
              key={label.id}
              id={label.id}
              name={label.name}
              unread={label.messagesUnread}
            />
          ))}
        </>
      )}
    </div>
  );
}
