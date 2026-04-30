import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, ChevronDown, Loader2, Zap } from 'lucide-react';
import { api } from '../services/api';

interface TriggerStatus {
  enabled: boolean;
  filter: string | null;
  intervalMinutes: number | null;
  lastPollAt: number | null;
  processedCount: number;
  nextPollIn: number | null;
  failures: Array<{ messageId: string; failedAt: number; error: string }>;
}

interface AutomatePanelProps {
  workflowName: string;
  workflowSaved: boolean;
}

function relativeTime(ts: number | null): string {
  if (!ts) return 'never';
  const diff = Date.now() - ts;
  if (diff < 60_000) return 'just now';
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)} min ago`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h ago`;
  return `${Math.floor(diff / 86400_000)}d ago`;
}

export function AutomatePanel({ workflowName, workflowSaved }: AutomatePanelProps) {
  const [expanded, setExpanded] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [filter, setFilter] = useState('');
  const [intervalMinutes, setIntervalMinutes] = useState(2);
  const [status, setStatus] = useState<TriggerStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const [retriggering, setRetriggering] = useState(false);

  const refreshStatus = useCallback(() => {
    if (!workflowName) return;
    api.getWorkflowTriggerStatus(workflowName).then((s) => {
      setStatus(s);
      setEnabled(s.enabled);
      if (s.filter) setFilter(s.filter);
      if (s.intervalMinutes) setIntervalMinutes(s.intervalMinutes);
    }).catch(() => {});
  }, [workflowName]);

  useEffect(() => {
    if (!workflowSaved || !workflowName) return;
    refreshStatus();
  }, [workflowSaved, workflowName, refreshStatus]);

  useEffect(() => {
    if (!expanded || !workflowSaved || !workflowName) return;
    const id = setInterval(refreshStatus, 30_000);
    return () => clearInterval(id);
  }, [expanded, workflowSaved, workflowName, refreshStatus]);

  if (!workflowSaved) return null;

  const handleSave = async () => {
    setLoading(true);
    setSaveError(null);
    setSaved(false);
    try {
      await api.updateWorkflowTrigger(workflowName, {
        enabled,
        filter,
        intervalMinutes,
      });
      setSaved(true);
      refreshStatus();
      setTimeout(() => setSaved(false), 2000);
    } catch (err: any) {
      setSaveError(err.message || 'Failed to save');
    } finally {
      setLoading(false);
    }
  };

  const handleDismissFailures = async () => {
    try {
      await api.dismissTriggerFailures(workflowName);
      refreshStatus();
    } catch {}
  };

  const handleRetrigger = async (messageId: string) => {
    setRetriggering(true);
    try {
      await api.retriggerWorkflow(workflowName, messageId);
      refreshStatus();
    } catch {} finally {
      setRetriggering(false);
    }
  };

  const latestFailure = status?.failures?.length ? status.failures[status.failures.length - 1] : null;

  return (
    <div className="border-t border-[var(--border)] mt-2">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-5 py-3 text-[13px] text-[var(--text-dim)] hover:text-[var(--text)] hover:bg-[var(--surface-hover)] transition"
      >
        <Zap size={14} className="text-[var(--accent)]" />
        <span className="font-medium">Automate</span>
        {status?.failures?.length ? (
          <span className="ml-auto flex items-center gap-1 text-[11px] text-amber-400">
            <AlertCircle size={10} />
            {status.failures.length} failure{status.failures.length > 1 ? 's' : ''}
          </span>
        ) : null}
        <ChevronDown
          size={14}
          className={`ml-auto transition-transform ${expanded ? 'rotate-180' : ''}`}
        />
      </button>

      {expanded && (
        <div className="px-5 pb-4 space-y-3">
          <label className="flex items-center gap-2.5 text-[12px] text-[var(--text-dim)]">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="accent-[var(--accent)] rounded"
            />
            Run automatically when new emails arrive
          </label>

          {enabled && (
            <>
              <div>
                <label className="block text-[10px] font-medium text-[var(--text-faint)] uppercase tracking-wider mb-1">
                  Gmail filter
                </label>
                <input
                  type="text"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder="e.g. subject:credit card"
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-[12px] text-[var(--text)] outline-none focus:border-[var(--accent)]/50 transition placeholder:text-[var(--text-faint)]"
                />
              </div>

              <div>
                <label className="block text-[10px] font-medium text-[var(--text-faint)] uppercase tracking-wider mb-1">
                  Check every
                </label>
                <select
                  value={intervalMinutes}
                  onChange={(e) => setIntervalMinutes(Number(e.target.value))}
                  className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-[12px] text-[var(--text)] outline-none"
                >
                  <option value={1}>1 min</option>
                  <option value={2}>2 min</option>
                  <option value={5}>5 min</option>
                  <option value={10}>10 min</option>
                </select>
              </div>
            </>
          )}

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleSave}
              disabled={loading || (enabled && !filter.trim())}
              className="flex items-center justify-center gap-1.5 rounded-xl bg-[var(--accent)] px-3.5 py-1.5 text-[12px] font-medium text-black transition hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {loading ? <Loader2 size={12} className="animate-spin" /> : null}
              Save automation
            </button>
            {saved && <span className="text-[11px] text-green-400">Saved</span>}
            {saveError && <span className="text-[11px] text-red-400">{saveError}</span>}
          </div>

          {status && (
            <p className="text-[11px] text-[var(--text-faint)]">
              Last run: {relativeTime(status.lastPollAt)}
              {status.processedCount > 0 && <> · {status.processedCount} processed</>}
            </p>
          )}

          {latestFailure && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/8 px-3 py-2">
              <AlertCircle size={13} className="text-amber-400 shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-[11px] text-amber-300 truncate">{latestFailure.error}</p>
              </div>
              <button
                type="button"
                onClick={() => handleRetrigger(latestFailure.messageId)}
                disabled={retriggering}
                className="text-[10px] text-amber-400/70 hover:text-amber-300 transition underline underline-offset-2 shrink-0"
              >
                {retriggering ? 'Running…' : 'Re-trigger'}
              </button>
              <button
                type="button"
                onClick={handleDismissFailures}
                className="text-[10px] text-amber-400/70 hover:text-amber-300 transition underline underline-offset-2 shrink-0"
              >
                Dismiss
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
