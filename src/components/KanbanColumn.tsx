import { Sparkles } from 'lucide-react';

interface Props {
  title: string;
  count?: number;
  accentColor?: string;
  onAskAgent?: () => void;
  wide?: boolean;
  children: React.ReactNode;
}

export default function KanbanColumn({ title, count, accentColor, onAskAgent, wide, children }: Props) {
  return (
    <div className={`kanban-column${wide ? ' kanban-column--wide' : ''}`}>
      <div className="kanban-column-header">
        <div className="flex items-center gap-2 min-w-0">
          <span className="kanban-column-title truncate">{title}</span>
          {count !== undefined && count > 0 && (
            <span
              className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded-full shrink-0"
              style={{
                background: accentColor ? `color-mix(in srgb, ${accentColor} 15%, transparent)` : 'var(--surface2)',
                color: accentColor ?? 'var(--text-faint)',
              }}
            >
              {count}
            </span>
          )}
        </div>
        {onAskAgent && (
          <button
            onClick={onAskAgent}
            className="flex h-7 w-7 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[var(--text-faint)] transition-all hover:border-[var(--accent-border)] hover:text-[var(--accent)] hover:bg-[var(--accent-glow)] cursor-pointer shrink-0"
            title={`Ask AI about ${title}`}
            aria-label={`Ask AI about ${title}`}
          >
            <Sparkles size={13} />
          </button>
        )}
      </div>
      <div className="kanban-column-body">
        {children}
      </div>
    </div>
  );
}
