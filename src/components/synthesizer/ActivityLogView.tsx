import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Loader2, RefreshCw, Trash2, Zap, MessageCircle } from 'lucide-react';
import { api } from '../../services/api';
import type { ToolInvocation } from '../../services/api';

interface Props {
  onBack: () => void;
}

function formatTimestamp(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  return new Date(t).toLocaleString();
}

export default function ActivityLogView({ onBack }: Props) {
  const [entries, setEntries] = useState<ToolInvocation[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await api.getInvocationLog(500);
      setEntries(r.entries);
      setTotal(r.totalEntries);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load activity log');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleClear = useCallback(async () => {
    try {
      await api.clearInvocationLog();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to clear log');
    }
  }, [load]);

  const empty = useMemo(() => entries.length === 0, [entries]);

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-2 rounded-[10px] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[12px] font-medium text-[var(--text-dim)] transition hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
        >
          <ArrowLeft size={14} />
          Back
        </button>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={load}
            className="inline-flex items-center gap-2 rounded-[10px] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[12px] font-medium text-[var(--text)] transition hover:bg-[var(--surface-hover)]"
          >
            <RefreshCw size={13} />
            Refresh
          </button>
          <button
            type="button"
            onClick={handleClear}
            className="inline-flex items-center gap-2 rounded-[10px] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[12px] font-medium text-[var(--text-dim)] transition hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
          >
            <Trash2 size={13} />
            Clear
          </button>
        </div>
      </header>

      <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--text-faint)]">
        Activity log · {total} entries
      </div>

      {error && (
        <div className="rounded-[10px] border border-red-500/30 bg-red-500/10 px-3 py-2 text-[12px] text-red-200">
          {error}
        </div>
      )}

      {loading && entries.length === 0 ? (
        <div className="flex items-center gap-2 text-[var(--text-dim)]">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>Loading…</span>
        </div>
      ) : empty ? (
        <div className="rounded-[12px] border border-dashed border-[var(--border)] bg-[var(--surface)] px-4 py-8 text-center text-[12px] text-[var(--text-faint)]">
          No activity recorded yet. Enable suggestions in Settings and use the agent to populate
          the log.
        </div>
      ) : (
        <ul className="space-y-1.5">
          {entries.map((entry) => (
            <li
              key={entry.id}
              className="flex items-center gap-3 rounded-[10px] border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
            >
              <span
                className={`flex h-6 w-6 items-center justify-center rounded-[8px] border ${
                  entry.source === 'scheduler'
                    ? 'border-[var(--accent)]/40 bg-[var(--accent)]/10 text-[var(--accent)]'
                    : 'border-[var(--border2)] bg-[var(--surface2)] text-[var(--text-dim)]'
                }`}
                title={entry.source}
              >
                {entry.source === 'scheduler' ? <Zap size={12} /> : <MessageCircle size={12} />}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="truncate text-[13px] font-medium text-[var(--text)]">
                    {entry.name}
                  </span>
                  <span
                    className={`text-[10px] font-semibold uppercase tracking-[0.12em] ${
                      entry.success ? 'text-emerald-400' : 'text-red-400'
                    }`}
                  >
                    {entry.success ? 'ok' : 'fail'}
                  </span>
                  <span className="text-[10px] uppercase tracking-[0.12em] text-[var(--text-faint)]">
                    {entry.approval}
                  </span>
                </div>
                <div className="mt-0.5 flex gap-3 text-[10px] text-[var(--text-faint)]">
                  <span className="font-mono">{entry.argsHash}</span>
                  <span>{formatTimestamp(entry.timestamp)}</span>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
