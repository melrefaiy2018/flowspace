import { Check, X, KeyRound } from 'lucide-react';
import type { LLMProviderConfigResponse, CheckResult } from '../services/api';

interface Props {
  providerId: string;
  activeProvider: string | undefined;
  savedConfig: LLMProviderConfigResponse | null | undefined;
  liveCheckResult: CheckResult | null;
  testResult: CheckResult | null;
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

function statusLine(liveCheckResult: CheckResult | null, testResult: CheckResult | null, savedConfig: LLMProviderConfigResponse | null | undefined): { text: string; ok: boolean | null } {
  if (liveCheckResult?.configSource === 'saved') {
    if (liveCheckResult.success) return { text: 'Saved configuration is healthy', ok: true };
    return { text: `Last live check failed — ${liveCheckResult.error ?? 'unknown error'}`, ok: false };
  }
  if (testResult?.configSource === 'draft') {
    if (testResult.success && !liveCheckResult) return { text: 'Draft configuration passed validation', ok: true };
    if (!testResult.success) {
      const savedState = savedConfig ? 'Saved route not yet verified.' : 'No saved config.';
      return { text: `Draft configuration failed. ${savedState}`, ok: false };
    }
  }
  return { text: 'Not yet tested', ok: null };
}

export default function ProviderDiagnostics({ providerId, activeProvider, savedConfig, liveCheckResult, testResult }: Props) {
  const latest = liveCheckResult ?? testResult;
  const { text: statusText, ok } = statusLine(liveCheckResult, testResult, savedConfig);
  const routeStatus = activeProvider === providerId ? 'Live' : savedConfig ? 'Standby' : 'Inactive';

  return (
    <div className="rounded-[18px] border border-[var(--border)] bg-[var(--surface2)] p-3.5">
      <div className="mb-2.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--text-faint)]">Diagnostics</div>

      {/* Human-readable status line */}
      <div className={`mb-3 flex items-start gap-1.5 rounded-[10px] px-2.5 py-2 text-[11px] font-medium ${
        ok === true ? 'border border-[var(--green-border)] bg-[var(--green-dim)] text-[var(--green)]'
        : ok === false ? 'bg-red-500/10 text-red-300'
        : 'bg-[var(--surface)] text-[var(--text-faint)]'
      }`}>
        {ok === true && <Check className="mt-0.5 h-3 w-3 shrink-0" />}
        {ok === false && <X className="mt-0.5 h-3 w-3 shrink-0" />}
        <span>{statusText}</span>
      </div>

      <div className="space-y-2">
        {[
          { label: 'Last checked at', value: latest ? relativeTime(latest.testedAt) : '—' },
          {
            label: 'Result',
            value: latest ? (latest.success ? 'Passed' : 'Failed') : '—',
          },
          { label: 'Latency', value: latest?.latencyMs ? `${latest.latencyMs}ms` : '—' },
          { label: 'Config tested', value: latest?.configSource === 'saved' ? 'saved config' : latest?.configSource === 'draft' ? 'draft config' : '—' },
          { label: 'Credentials', value: savedConfig ? 'Saved locally' : 'Not saved' },
          { label: 'Route status', value: routeStatus },
        ].map((row) => (
          <div key={row.label} className="flex items-center justify-between gap-3">
            <span className="text-[11px] text-[var(--text-faint)]">{row.label}</span>
            <span className="text-[11px] font-medium text-[var(--text-dim)]">{row.value}</span>
          </div>
        ))}

        {/* Error detail */}
        {latest && !latest.success && latest.error && (
          <div className="rounded-[8px] bg-red-500/10 px-2 py-1.5 text-[10px] text-red-300 break-words">
            {latest.error}
          </div>
        )}
      </div>

      <div className="mt-3 border-t border-[var(--border)] pt-3">
        <div className="flex items-center gap-1.5 text-[11px]">
          <KeyRound className="h-3 w-3 shrink-0 text-[var(--accent)]" />
          <span className="text-[var(--text-faint)]">Stored in</span>
          <code className="truncate text-[10px] text-[var(--text-dim)]">~/Library/…/FlowSpace/.llm-settings.json</code>
        </div>
      </div>
    </div>
  );
}
