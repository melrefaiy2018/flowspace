import type { LucideIcon } from 'lucide-react';

export interface EmptyStateAction {
  label: string;
  onClick: () => void;
}

export interface EmptyStateProps {
  /** Lucide icon component to display */
  icon: LucideIcon;
  title: string;
  description?: string;
  primaryAction?: EmptyStateAction;
  secondaryAction?: EmptyStateAction;
  /** Controls overall size — defaults to 'md' */
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const sizeConfig = {
  sm: { icon: 20, wrapper: 'py-6 gap-2', title: 'text-sm', desc: 'text-xs' },
  md: { icon: 28, wrapper: 'py-10 gap-3', title: 'text-base', desc: 'text-sm' },
  lg: { icon: 36, wrapper: 'py-16 gap-4', title: 'text-lg', desc: 'text-sm' },
} as const;

export default function EmptyState({
  icon: Icon,
  title,
  description,
  primaryAction,
  secondaryAction,
  size = 'md',
  className = '',
}: EmptyStateProps) {
  const cfg = sizeConfig[size];

  return (
    <div
      className={`flex flex-col items-center justify-center text-center ${cfg.wrapper} ${className}`}
    >
      <div className="rounded-full bg-[var(--surface2)] p-3 text-[var(--text-faint)]">
        <Icon size={cfg.icon} strokeWidth={1.5} />
      </div>

      <p className={`font-medium text-[var(--text)] ${cfg.title}`}>{title}</p>

      {description && (
        <p className={`max-w-xs text-[var(--text-dim)] ${cfg.desc}`}>{description}</p>
      )}

      {(primaryAction || secondaryAction) && (
        <div className="flex items-center gap-2 mt-1">
          {primaryAction && (
            <button
              onClick={primaryAction.onClick}
              className="rounded-full bg-[var(--accent)] px-4 py-1.5 text-sm font-medium text-white hover:brightness-110 transition-all cursor-pointer"
            >
              {primaryAction.label}
            </button>
          )}
          {secondaryAction && (
            <button
              onClick={secondaryAction.onClick}
              className="rounded-full border border-[var(--border)] px-4 py-1.5 text-sm text-[var(--text-dim)] hover:border-[var(--accent)] transition-all cursor-pointer"
            >
              {secondaryAction.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
