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

  return (
    <div className="flex flex-wrap items-center gap-1">
      {systemLabels.map((label) => (
        <button
          key={label.id}
          onClick={() => onSelect(label.id)}
          className={`flex items-center gap-1.5 rounded-[10px] border px-2.5 py-1 text-[11px] font-medium transition-colors cursor-pointer whitespace-nowrap ${
            activeLabel === label.id
              ? 'border-[var(--accent)]/30 bg-[var(--accent)]/12 text-[var(--accent)]'
              : 'border-transparent bg-[var(--surface2)] text-[var(--text-dim)] hover:border-white/8 hover:bg-[var(--surface3)] hover:text-[var(--text)]'
          }`}
        >
          {label.name}
          {label.unread > 0 && (
            <span className={`min-w-[16px] rounded-[999px] px-[4px] py-px text-center font-mono text-[9px] ${
              activeLabel === label.id
                ? 'bg-[var(--accent)]/18 text-[var(--accent)]'
                : 'bg-black/20 text-[var(--text-faint)]'
            }`}>
              {label.unread > 99 ? '99+' : label.unread}
            </span>
          )}
        </button>
      ))}
      {userLabels.length > 0 && (
        <>
          <div className="mx-1 h-4 w-px bg-[var(--border)] self-center" />
          {userLabels.map((label) => (
            <button
              key={label.id}
              onClick={() => onSelect(label.id)}
              className={`flex items-center gap-1.5 rounded-[10px] border px-2.5 py-1 text-[11px] font-medium transition-colors cursor-pointer whitespace-nowrap ${
                activeLabel === label.id
                  ? 'border-[var(--accent)]/30 bg-[var(--accent)]/12 text-[var(--accent)]'
                  : 'border-transparent bg-[var(--surface2)] text-[var(--text-dim)] hover:border-white/8 hover:bg-[var(--surface3)] hover:text-[var(--text)]'
              }`}
            >
              {label.name}
              {label.messagesUnread > 0 && (
                <span className={`min-w-[16px] rounded-[999px] px-[4px] py-px text-center font-mono text-[9px] ${
                  activeLabel === label.id
                    ? 'bg-[var(--accent)]/18 text-[var(--accent)]'
                    : 'bg-black/20 text-[var(--text-faint)]'
                }`}>
                  {label.messagesUnread > 99 ? '99+' : label.messagesUnread}
                </span>
              )}
            </button>
          ))}
        </>
      )}
    </div>
  );
}
