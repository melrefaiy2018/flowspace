/**
 * WorkspaceHeader — type badge + subject + primary action + secondary chips.
 */
import { Loader2 } from 'lucide-react';
import type { WorkItem } from '../../../lib/work-item.js';
import type { SecondaryAction } from '../../../lib/gmail-work-registry.js';
import { ACTION_REGISTRY } from '../../../lib/gmail-work-registry.js';

// ── Type badge color map ─────────────────────────────────────────────
const TYPE_COLORS: Record<string, { text: string; bg: string; border: string }> = {
  personal_reply_needed: { text: '#7eb3f5', bg: 'rgba(126,179,245,0.12)', border: 'rgba(126,179,245,0.3)' },
  meeting_request:       { text: '#a78bfa', bg: 'rgba(167,139,250,0.12)', border: 'rgba(167,139,250,0.3)' },
  security_alert:        { text: '#f87171', bg: 'rgba(248,113,113,0.12)', border: 'rgba(248,113,113,0.3)' },
  promotional:           { text: '#fbbf24', bg: 'rgba(251,191,36,0.12)',  border: 'rgba(251,191,36,0.3)'  },
  receipt:               { text: '#34d399', bg: 'rgba(52,211,153,0.12)',  border: 'rgba(52,211,153,0.3)'  },
  newsletter:            { text: '#60a5fa', bg: 'rgba(96,165,250,0.12)',  border: 'rgba(96,165,250,0.3)'  },
  notification:          { text: '#94a3b8', bg: 'rgba(148,163,184,0.12)', border: 'rgba(148,163,184,0.3)' },
  other:                 { text: '#a3a3a3', bg: 'rgba(163,163,163,0.12)', border: 'rgba(163,163,163,0.3)' },
};

function typeColor(type: string) {
  return TYPE_COLORS[type] ?? TYPE_COLORS['other'];
}

// ── Secondary action label map ────────────────────────────────────────
const SECONDARY_LABELS: Record<SecondaryAction['kind'], string> = {
  discuss:     'Discuss',
  archive:     'Archive',
  unsubscribe: 'Unsubscribe',
  snooze:      'Snooze',
  decline:     'Decline',
  delegate:    'Delegate',
};

interface Props {
  item: WorkItem;
  onPrimaryAction: () => void;
  onSecondaryAction: (kind: SecondaryAction['kind']) => void;
  loading?: boolean;
}

export default function WorkspaceHeader({
  item,
  onPrimaryAction,
  onSecondaryAction,
  loading = false,
}: Props) {
  const colors = typeColor(item.type);
  const registryEntry = ACTION_REGISTRY[item.type] ?? ACTION_REGISTRY['other'];
  const typeLabelText = item.type.replace(/_/g, ' ');

  return (
    <div className="min-w-0 shrink-0 overflow-hidden px-5 pt-4 pb-3 border-b border-[var(--border)]">
      {/* Type badge + subject row */}
      <div className="flex min-w-0 items-start gap-3 mb-2">
        <span
          className="inline-flex items-center text-[10px] font-semibold tracking-wide uppercase rounded-full px-2.5 py-1 border font-mono shrink-0 mt-0.5"
          style={{ color: colors.text, background: colors.bg, borderColor: colors.border }}
        >
          {typeLabelText}
        </span>
        <div className="flex-1 min-w-0">
          <h2 className="text-[15px] font-semibold text-[var(--text)] leading-snug break-words [overflow-wrap:anywhere]">
            {item.title}
          </h2>
          <p className="text-[11px] text-[var(--text-faint)] truncate mt-0.5">{item.subtitle}</p>
        </div>
      </div>

      {/* Action row */}
      <div className="flex items-center gap-2 flex-wrap mt-3">
        {/* Primary action button */}
        <button
          onClick={onPrimaryAction}
          disabled={loading}
          className="flex items-center gap-1.5 bg-[var(--accent)] text-black rounded-[10px] px-3 py-1.5 text-[12px] font-medium hover:brightness-110 transition-all cursor-pointer disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
          aria-label={item.primaryActionLabel}
        >
          {loading ? <Loader2 size={12} className="animate-spin" /> : null}
          {item.primaryActionLabel}
        </button>

        {/* Secondary action chips */}
        {registryEntry.secondaryActions.map((action) => (
          <button
            key={action.kind}
            onClick={() => onSecondaryAction(action.kind)}
            className="border border-[var(--border)] bg-transparent text-[var(--text-dim)] rounded-[10px] px-3 py-1.5 text-[11px] hover:bg-[var(--surface2)] transition-all cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--border)]"
            aria-label={SECONDARY_LABELS[action.kind]}
          >
            {SECONDARY_LABELS[action.kind]}
          </button>
        ))}
      </div>
    </div>
  );
}
