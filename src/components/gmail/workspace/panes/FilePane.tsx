/**
 * FilePane — destination picker for promotional, receipt, and notification threads.
 *
 * Actions:
 * - Archive (direct, requires onDirectAction prop)
 * - Save to Drive (routes through chat approval flow)
 * - Unsubscribe (only for promotional / newsletter types)
 *
 * If onDirectAction is undefined, the Archive button is disabled to indicate
 * it has not been wired up by the parent.
 */
import { Archive, HardDrive, MailMinus } from 'lucide-react';
import type { PaneProps } from './types.js';

/** Thread types that show the Unsubscribe option. */
const UNSUBSCRIBE_TYPES = new Set(['promotional', 'newsletter']);

// ── Action button ────────────────────────────────────────────────────────────

interface ActionButtonProps {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  variant?: 'primary' | 'secondary' | 'danger';
  'aria-label'?: string;
}

function ActionButton({
  label,
  icon,
  onClick,
  disabled = false,
  title,
  variant = 'secondary',
  'aria-label': ariaLabel,
}: ActionButtonProps) {
  const baseClass =
    'flex items-center gap-2 w-full px-4 py-3 rounded-[10px] border text-[13px] font-medium transition-all cursor-pointer text-left disabled:opacity-50 disabled:cursor-not-allowed';

  const variantClass = {
    primary: 'bg-[var(--accent)] text-black border-transparent hover:brightness-110',
    secondary:
      'bg-[var(--surface)] text-[var(--text)] border-[var(--border)] hover:bg-[var(--surface2)]',
    danger:
      'bg-transparent text-[var(--error,#e74c3c)] border-[var(--border)] hover:bg-[var(--error,#e74c3c)]/10',
  }[variant];

  return (
    <button
      type="button"
      aria-label={ariaLabel ?? label}
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={`${baseClass} ${variantClass}`}
    >
      {icon}
      {label}
    </button>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

export default function FilePane({ item, onAgentAction, onDirectAction, onComplete }: PaneProps) {
  const threadId = item.source.threadId;
  const showUnsubscribe = UNSUBSCRIBE_TYPES.has(item.type);

  const handleArchive = () => {
    onDirectAction?.('archive', threadId);
    onComplete?.(`Archived "${item.title}"`);
  };

  const handleSaveToDrive = () => {
    onAgentAction('save_to_drive');
  };

  const handleUnsubscribe = () => {
    if (onDirectAction) {
      onDirectAction('unsubscribe', threadId);
    } else {
      onAgentAction('ask_agent', 'Unsubscribe me from this sender');
    }
  };

  return (
    <div className="flex flex-col gap-4 p-5">
      {/* Sender confirmation */}
      <div className="text-[12px] text-[var(--text-faint)]">
        From: <span className="text-[var(--text-dim)] font-medium">{item.subtitle}</span>
      </div>

      {/* Info card */}
      <div className="rounded-[10px] bg-[var(--surface)] border border-[var(--border)] px-4 py-3">
        <p className="text-[13px] text-[var(--text-dim)] leading-relaxed">
          Choose where this thread belongs.
        </p>
      </div>

      {/* Action buttons column */}
      <div className="flex flex-col gap-2">
        <ActionButton
          label="Archive"
          aria-label="Archive"
          icon={<Archive size={15} />}
          onClick={handleArchive}
          disabled={onDirectAction === undefined}
          title={onDirectAction === undefined ? 'Archive handler not wired yet' : undefined}
          variant="primary"
        />

        <ActionButton
          label="Save to Drive"
          aria-label="Save to Drive"
          icon={<HardDrive size={15} />}
          onClick={handleSaveToDrive}
          variant="secondary"
        />

        {showUnsubscribe && (
          <ActionButton
            label="Unsubscribe"
            aria-label="Unsubscribe"
            icon={<MailMinus size={15} />}
            onClick={handleUnsubscribe}
            variant="danger"
          />
        )}
      </div>

      {/* Secondary info */}
      <p className="text-[11px] text-[var(--text-faint)] leading-relaxed">
        Archive keeps the thread in your Google account but hides it from inbox. Save to Drive
        creates a Google Doc copy.
      </p>
    </div>
  );
}
