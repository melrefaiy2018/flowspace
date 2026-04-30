/**
 * BucketSection — collapsible section for work-state thread buckets.
 * Props: { id, label, count, defaultExpanded, children }
 */
import { useState, type ReactNode, type KeyboardEvent } from 'react';
import { ChevronRight } from 'lucide-react';

interface Props {
  id: string;
  label: string;
  count: number;
  defaultExpanded: boolean;
  children: ReactNode;
}

export default function BucketSection({ id, label, count, defaultExpanded, children }: Props) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  const toggle = () => setExpanded((prev) => !prev);

  const handleKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggle();
    }
  };

  const contentId = `bucket-section-${id}`;

  return (
    <div className="border-b border-[var(--border)] last:border-b-0">
      <button
        type="button"
        onClick={toggle}
        onKeyDown={handleKeyDown}
        aria-expanded={expanded}
        aria-controls={contentId}
        className={
          'flex w-full cursor-pointer select-none items-center gap-2 px-4 py-[10px] ' +
          'transition-colors hover:bg-white/[0.03] ' +
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-1'
        }
      >
        <ChevronRight
          size={10}
          className={`shrink-0 text-[var(--text-faint)] transition-transform duration-150 ${expanded ? 'rotate-90' : ''}`}
          aria-hidden="true"
        />
        <span className="flex-1 text-left text-[12px] font-semibold text-[var(--text-dim)]">
          {label}
        </span>
        <span className="rounded-[10px] bg-white/[0.06] px-[7px] py-px font-mono text-[10px] text-[var(--text-faint)]">
          {count}
        </span>
      </button>

      {expanded && (
        <div id={contentId} className="min-w-0 w-full">
          {children}
        </div>
      )}
    </div>
  );
}
