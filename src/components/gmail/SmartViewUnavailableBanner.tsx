/**
 * SmartViewUnavailableBanner — T024
 *
 * Small pill-shaped banner shown when enrichment fails and the Gmail tab
 * falls back to plain chronological rows.
 *
 * Dismissible: hides until the next page reload (state is React-local).
 */
import { useState } from 'react';
import { X } from 'lucide-react';

interface Props {
  fallbackReason: string | null;
}

export default function SmartViewUnavailableBanner({ fallbackReason }: Props) {
  const [dismissed, setDismissed] = useState(false);

  if (!fallbackReason || dismissed) return null;

  return (
    <div className="flex items-center gap-2 px-4 py-2 bg-[var(--surface2)] border-b border-[var(--border)] text-[var(--text-dim)] text-[12px]">
      <span className="flex-1">
        Smart view unavailable — showing standard inbox.
      </span>
      <button
        onClick={() => setDismissed(true)}
        aria-label="Dismiss smart view unavailable banner"
        className="shrink-0 p-0.5 rounded hover:bg-[var(--surface3)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
      >
        <X size={12} />
      </button>
    </div>
  );
}
