/**
 * RawNotesSection — subtle disclosure block, deliberately de-emphasised.
 * Lighter border, dimmer background, smaller toggle target.
 * Reads as "source material" not primary content.
 */

import { ChevronDown, ChevronRight } from 'lucide-react';
import { useState } from 'react';

export function RawNotesSection({ notes }: { notes: string | null | undefined }) {
  const [open, setOpen] = useState(false);
  const text = notes?.trim();
  if (!text) return null;

  const Chevron = open ? ChevronDown : ChevronRight;

  return (
    <div className="rounded-[16px] border border-[var(--border)]/60 bg-[var(--surface)]/40">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-5 py-3 text-left cursor-pointer"
        aria-expanded={open}
        aria-label={open ? 'Collapse notes' : 'View original task notes'}
      >
        <span className="text-[10px] font-medium uppercase tracking-[0.1em] text-[var(--text-faint)]/70">
          {open ? 'Notes' : 'View original task notes'}
        </span>
        <Chevron size={12} className="text-[var(--text-faint)]/60" aria-hidden />
      </button>

      {open && (
        <div className="border-t border-[var(--border)]/60 px-5 py-3.5">
          <pre className="whitespace-pre-wrap break-words font-sans text-[12px] leading-relaxed text-[var(--text-faint)]">
            {text}
          </pre>
        </div>
      )}
    </div>
  );
}
