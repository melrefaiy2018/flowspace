import { useState } from 'react';
import { Sparkles, ChevronRight } from 'lucide-react';

interface Props {
  title: string;
  count?: number;
  accentColor?: string;
  onAskAgent?: () => void;
  wide?: boolean;
  /** If true, auto-collapse when count === 0. Default: true */
  autoCollapse?: boolean;
  children: React.ReactNode;
}

export default function KanbanColumn({
  title,
  count,
  accentColor,
  onAskAgent,
  wide,
  autoCollapse = true,
  children,
}: Props) {
  const isEmpty = count === 0;
  const [collapsed, setCollapsed] = useState(autoCollapse && isEmpty);

  // Re-collapse when content becomes empty (e.g. user resolves all items)
  // but don't re-expand automatically when items arrive
  const shouldAutoCollapse = autoCollapse && isEmpty && !collapsed === false;
  void shouldAutoCollapse; // unused — manual toggle is primary

  return (
    <div
      className={[
        'kanban-column',
        collapsed ? 'kanban-column--collapsed' : '',
        wide && !collapsed ? 'kanban-column--wide' : '',
      ].filter(Boolean).join(' ')}
    >
      {/* Thin colored top accent line */}
      {accentColor && (
        <div
          className="shrink-0 h-[2px] w-full opacity-60"
          style={{ background: `linear-gradient(90deg, ${accentColor}, transparent 70%)` }}
        />
      )}

      {collapsed ? (
        /* ── Collapsed state: vertical label strip ── */
        <button
          onClick={() => setCollapsed(false)}
          className="flex-1 flex flex-col items-center justify-start gap-3 pt-4 pb-3 cursor-pointer group w-full"
          aria-label={`Expand ${title} column`}
          title={`Expand ${title}`}
        >
          <ChevronRight
            size={13}
            className="text-[var(--text-faint)] group-hover:text-[var(--text-dim)] transition-colors shrink-0"
          />
          <span
            className="kanban-column-title group-hover:text-[var(--text-dim)] transition-colors"
            style={{
              writingMode: 'vertical-rl',
              textOrientation: 'mixed',
              transform: 'rotate(180deg)',
              letterSpacing: '0.08em',
            }}
          >
            {title}
          </span>
          {count !== undefined && count > 0 && (
            <span
              className="text-[9px] font-mono font-bold w-5 h-5 rounded-full flex items-center justify-center shrink-0"
              style={{
                background: accentColor ? `color-mix(in srgb, ${accentColor} 15%, transparent)` : 'var(--surface2)',
                color: accentColor ?? 'var(--text-faint)',
              }}
            >
              {count}
            </span>
          )}
        </button>
      ) : (
        /* ── Expanded state ── */
        <>
          <div className="kanban-column-header">
            <div className="flex items-center gap-2 min-w-0">
              <button
                onClick={() => setCollapsed(true)}
                className="kanban-column-title truncate text-left cursor-pointer hover:text-[var(--text-dim)] transition-colors group flex items-center gap-1.5"
                aria-label={`Collapse ${title} column`}
                title={`Collapse ${title}`}
              >
                {title}
              </button>
              {count !== undefined && count > 0 && (
                <span
                  className="text-[10px] font-mono font-semibold px-[5px] py-[1px] rounded-[4px] shrink-0"
                  style={{
                    background: accentColor ? `color-mix(in srgb, ${accentColor} 12%, transparent)` : 'var(--surface2)',
                    color: accentColor ?? 'var(--text-faint)',
                  }}
                >
                  {count}
                </span>
              )}
              {count === 0 && (
                <span className="text-[10px] text-[var(--text-faint)] font-mono shrink-0">clear</span>
              )}
            </div>
            <div className="flex items-center gap-1 shrink-0">
              {onAskAgent && (
                <button
                  onClick={onAskAgent}
                  className="flex h-6 w-6 items-center justify-center rounded-md border border-[var(--border)] bg-[var(--surface)] text-[var(--text-faint)] transition-all hover:border-[var(--accent-border)] hover:text-[var(--accent)] hover:bg-[var(--accent-glow)] cursor-pointer"
                  title={`Ask AI about ${title}`}
                  aria-label={`Ask AI about ${title}`}
                >
                  <Sparkles size={11} />
                </button>
              )}
              <button
                onClick={() => setCollapsed(true)}
                className="flex h-6 w-6 items-center justify-center rounded-md border border-transparent text-[var(--text-faint)] transition-all hover:border-[var(--border)] hover:text-[var(--text-dim)] hover:bg-[var(--surface2)] cursor-pointer"
                title={`Collapse ${title}`}
                aria-label={`Collapse ${title}`}
              >
                <ChevronRight size={11} style={{ transform: 'rotate(180deg)' }} />
              </button>
            </div>
          </div>
          <div className="kanban-column-body">
            {children}
          </div>
        </>
      )}
    </div>
  );
}
