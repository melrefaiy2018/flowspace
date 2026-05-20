import { Activity, Check, X } from 'lucide-react';
import type { LLMProviderConfigResponse, CheckResult } from '../services/api';

interface Props {
  providerId: string;
  activeProvider: string | undefined;
  savedConfig: LLMProviderConfigResponse | null | undefined;
  liveCheckResult: CheckResult | null;
  showBaseURL: boolean;
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default function SavedConnectionStatus({ providerId, activeProvider, savedConfig, liveCheckResult, showBaseURL }: Props) {
  const routeStatus = activeProvider === providerId ? 'Live' : savedConfig ? 'Standby' : 'Inactive';

  const rows = [
    { label: 'Route status', value: routeStatus },
    {
      label: 'Last live check',
      value: liveCheckResult ? relativeTime(liveCheckResult.testedAt) : 'Never',
    },
    { label: 'Credentials', value: savedConfig ? 'Saved locally' : 'Not saved' },
    { label: 'Model', value: savedConfig?.model ?? '—' },
    ...(showBaseURL ? [{ label: 'Base URL', value: savedConfig?.baseURL ?? 'default' }] : []),
  ];

  return (
    <div className="rounded-[14px] border border-[var(--border)] bg-[var(--surface2)] p-3">
      <div className="mb-2 flex items-center gap-1.5">
        <Activity className="h-3 w-3 text-[var(--text-faint)]" />
        <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--text-faint)]">Saved connection</span>
        {liveCheckResult && (
          <span className={`ml-auto flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
            liveCheckResult.success
              ? 'border border-[var(--green-border)] bg-[var(--green-dim)] text-[var(--green)]'
              : 'bg-red-500/15 text-red-300'
          }`}>
            {liveCheckResult.success
              ? <><Check className="h-2.5 w-2.5" />Passed</>
              : <><X className="h-2.5 w-2.5" />Failed</>}
          </span>
        )}
        {!liveCheckResult && (
          <span className="ml-auto text-[10px] text-[var(--text-faint)] opacity-60">Not yet tested</span>
        )}
      </div>
      <div className="space-y-1.5">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center justify-between gap-3">
            <span className="text-[11px] text-[var(--text-faint)]">{row.label}</span>
            <span className={`text-[11px] font-medium truncate max-w-[160px] ${
              row.label === 'Route status' && routeStatus === 'Live'
                ? 'text-[var(--green)]'
                : 'text-[var(--text-dim)]'
            }`}>{row.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
