import { AlertTriangle, Users, FileText, Focus, Zap } from 'lucide-react';
import type { InsightFilter } from '../../hooks/useCalendarPage';
import type { WeekInsights } from './calendarUtils';
import { formatMeetingHours } from './calendarUtils';

interface Props {
  insights: WeekInsights;
  activeFilter: InsightFilter;
  onFilter: (f: InsightFilter) => void;
}

interface MetricChipProps {
  id: InsightFilter;
  label: string;
  value: string | number;
  icon: React.ReactNode;
  tone: 'neutral' | 'warning' | 'error' | 'calm';
  isActive: boolean;
  isPrimary?: boolean;
  onClick: () => void;
}

function MetricChip({ label, value, icon, tone, isActive, isPrimary, onClick }: MetricChipProps) {
  const valueCls =
    tone === 'error' ? 'text-[var(--error)]' :
    tone === 'warning' ? 'text-[var(--warn)]' :
    tone === 'calm' ? 'text-[var(--accent)]' :
    'text-[var(--text-dim)]';

  const iconCls =
    tone === 'error' ? 'text-[var(--error)]' :
    tone === 'warning' ? 'text-[var(--warn)]' :
    tone === 'calm' ? 'text-[var(--accent)]' :
    'text-[var(--text-faint)]';

  const baseCls = isActive
    ? 'bg-[var(--surface3)] border-[var(--border)] shadow-sm'
    : isPrimary && tone !== 'neutral'
      ? 'bg-[var(--surface2)] border-[var(--border2)] hover:bg-[var(--surface3)]'
      : 'bg-transparent border-transparent hover:bg-[var(--surface2)] hover:border-[var(--border2)]';

  return (
    <button
      onClick={onClick}
      aria-pressed={isActive}
      className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border transition-all duration-150 cursor-pointer shrink-0 ${baseCls}`}
    >
      <span className={iconCls}>{icon}</span>
      <span className={`text-[13px] font-semibold tabular-nums ${valueCls}`}>{value}</span>
      <span className="text-[11px] text-[var(--text-faint)]">{label}</span>
      {isActive && (
        <span className="text-[9px] text-[var(--text-faint)] ml-0.5">×</span>
      )}
    </button>
  );
}

export default function InsightRail({ insights, activeFilter, onFilter }: Props) {
  function toggle(f: InsightFilter) {
    onFilter(activeFilter === f ? null : f);
  }

  const b2bTone = insights.backToBackCount >= 4 ? 'error' : insights.backToBackCount >= 2 ? 'warning' : 'neutral';
  const prepTone = insights.needsPrepCount >= 3 ? 'warning' : insights.needsPrepCount > 0 ? 'warning' : 'neutral';

  return (
    <div className="flex items-center gap-0.5 px-4 py-1.5 border-b border-[var(--border)] overflow-x-auto bg-[var(--surface1)]/30 shrink-0">
      {/* Needs prep — always first, most actionable */}
      {insights.needsPrepCount > 0 && (
        <MetricChip
          id="needs-prep"
          label={insights.needsPrepCount === 1 ? 'needs prep' : 'need prep'}
          value={insights.needsPrepCount}
          icon={<FileText size={12} />}
          tone={prepTone}
          isPrimary
          isActive={activeFilter === 'needs-prep'}
          onClick={() => toggle('needs-prep')}
        />
      )}

      {/* Back to back — second if significant */}
      {insights.backToBackCount > 0 && (
        <MetricChip
          id="back-to-back"
          label="back to back"
          value={insights.backToBackCount}
          icon={<Zap size={12} />}
          tone={b2bTone}
          isPrimary={insights.backToBackCount >= 2}
          isActive={activeFilter === 'back-to-back'}
          onClick={() => toggle('back-to-back')}
        />
      )}

      {/* External */}
      {insights.externalCount > 0 && (
        <MetricChip
          id="external"
          label={insights.externalCount === 1 ? 'external' : 'external'}
          value={insights.externalCount}
          icon={<Users size={12} />}
          tone="neutral"
          isActive={activeFilter === 'external'}
          onClick={() => toggle('external')}
        />
      )}

      {/* Focus time */}
      <MetricChip
        id="focus-protected"
        label="focus available"
        value={formatMeetingHours(insights.focusMinutes)}
        icon={<Focus size={12} />}
        tone="calm"
        isActive={activeFilter === 'focus-protected'}
        onClick={() => toggle('focus-protected')}
      />

      {/* Conflicts — only when real */}
      {insights.conflictCount > 0 && (
        <>
          <div className="w-px h-4 bg-[var(--border)] mx-1 shrink-0" />
          <MetricChip
            id="conflicts"
            label={insights.conflictCount === 1 ? 'conflict' : 'conflicts'}
            value={insights.conflictCount}
            icon={<AlertTriangle size={12} />}
            tone="error"
            isPrimary
            isActive={activeFilter === 'conflicts'}
            onClick={() => toggle('conflicts')}
          />
        </>
      )}

      {/* Clear filter */}
      {activeFilter && (
        <>
          <div className="flex-1" />
          <button
            onClick={() => onFilter(null)}
            className="shrink-0 text-[10px] text-[var(--text-faint)] hover:text-[var(--text-dim)] px-2 py-1 rounded transition-colors cursor-pointer"
          >
            Clear filter
          </button>
        </>
      )}
    </div>
  );
}
