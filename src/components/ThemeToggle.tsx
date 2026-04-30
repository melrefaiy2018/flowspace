import { Sun, Moon } from 'lucide-react';
import { useTheme } from '../context/ThemeContext';

interface ThemeToggleProps {
  /** 'icon' = compact icon-only button for AppRail; 'row' = labeled row for SettingsPage */
  variant?: 'icon' | 'row';
  collapsed?: boolean;
}

export default function ThemeToggle({ variant = 'icon', collapsed = false }: ThemeToggleProps) {
  const { theme, toggle } = useTheme();
  const isDark = theme === 'dark';

  if (variant === 'row') {
    return (
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2.5">
          {isDark
            ? <Moon size={14} className="text-[var(--text-faint)]" strokeWidth={1.7} />
            : <Sun size={14} className="text-[var(--text-faint)]" strokeWidth={1.7} />
          }
          <span className="text-[13px] font-medium text-[var(--text)]">
            {isDark ? 'Dark mode' : 'Light mode'}
          </span>
        </div>
        <button
          onClick={toggle}
          role="switch"
          aria-checked={isDark}
          aria-label="Toggle theme"
          className={[
            'relative shrink-0 h-[22px] w-[40px] rounded-full transition-colors duration-200 cursor-pointer',
            isDark ? 'bg-[var(--accent)]' : 'bg-[var(--border2)]',
          ].join(' ')}
        >
          <span
            className={[
              'absolute top-[3px] h-[16px] w-[16px] rounded-full bg-white shadow transition-transform duration-200',
              isDark ? 'translate-x-[21px]' : 'translate-x-[3px]',
            ].join(' ')}
          />
        </button>
      </div>
    );
  }

  // icon variant: compact button matching NavItem proportions
  return (
    <button
      onClick={toggle}
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      className={[
        'group/item relative w-full flex items-center gap-2.5 rounded-md cursor-pointer transition-all duration-150',
        'text-[var(--text-faint)] hover:text-[var(--text-dim)]',
        collapsed ? 'px-0 py-2.5 justify-center' : 'px-2.5 py-2',
      ].join(' ')}
    >
      <span className="absolute inset-0 rounded-md opacity-0 group-hover/item:opacity-100 bg-white/[0.03] transition-opacity pointer-events-none" />
      <span className="relative shrink-0 flex items-center justify-center text-[var(--text-faint)] group-hover/item:text-[var(--text-dim)]">
        {isDark
          ? <Moon size={16} strokeWidth={1.7} />
          : <Sun size={16} strokeWidth={1.7} />
        }
      </span>
      {!collapsed && (
        <span className="text-[12.5px] whitespace-nowrap overflow-hidden tracking-[-0.01em] flex-1 text-left font-normal">
          {isDark ? 'Dark mode' : 'Light mode'}
        </span>
      )}
    </button>
  );
}
