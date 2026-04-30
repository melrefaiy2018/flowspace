/**
 * EnrichmentProgressBanner
 *
 * Shown above the thread list while enrichment is in progress. Displays
 * a live progress count (e.g. "6 of 25 analyzed") when a progress object
 * is provided, or generic first-run copy otherwise.
 *
 * Hides automatically as soon as the enrichmentStatus transitions to
 * 'ready' or 'failed' (the fallback banner takes over on failure).
 */
import { Loader2 } from 'lucide-react';

interface Props {
  visible: boolean;
  progress?: { completed: number; total: number } | null;
}

export default function EnrichmentProgressBanner({ visible, progress }: Props) {
  if (!visible) return null;

  const hasProgress = progress && progress.total > 0;
  const message = hasProgress
    ? `Analyzing your inbox — ${progress.completed} of ${progress.total} threads done. First run is slow, subsequent visits will be instant.`
    : 'Analyzing your inbox for the first time — this takes a minute. Subsequent visits will be instant.';

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center gap-2 px-4 py-2 bg-[var(--surface2)] border-b border-[var(--border)] text-[var(--text-dim)] text-[12px]"
    >
      <Loader2 size={12} className="shrink-0 animate-spin" aria-hidden="true" />
      <span className="flex-1">{message}</span>
    </div>
  );
}
