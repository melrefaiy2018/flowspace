import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, Loader2, Zap } from 'lucide-react';
import { api } from '../services/api';
import { useChatContext } from '../context/ChatContext';

interface TriggerEntry {
  workflowName: string;
  workflowLabel: string;
  trigger: { type: 'email_received'; enabled: boolean; filter: string; intervalMinutes?: number };
  status: {
    enabled: boolean;
    lastPollAt: number | null;
    processedCount: number;
    nextPollIn: number | null;
    failures: Array<{ messageId: string; failedAt: number; error: string }>;
  };
}

function relativeTime(ts: number | null): string {
  if (!ts) return 'never';
  const diff = Date.now() - ts;
  if (diff < 60_000) return 'just now';
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)} min ago`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h ago`;
  return `${Math.floor(diff / 86400_000)}d ago`;
}

export default function AutomationsPage() {
  const [automations, setAutomations] = useState<TriggerEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [retriggering, setRetriggering] = useState<string | null>(null);
  const { setActiveView, setPendingWorkflowEdit } = useChatContext();

  const fetchAutomations = useCallback(async () => {
    try {
      const data = await api.getAllTriggers();
      setAutomations(data);
    } catch {} finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAutomations();
    const id = setInterval(fetchAutomations, 30_000);
    return () => clearInterval(id);
  }, [fetchAutomations]);

  const handleRetrigger = async (name: string, messageId: string) => {
    setRetriggering(messageId);
    try {
      await api.retriggerWorkflow(name, messageId);
      fetchAutomations();
    } catch {} finally {
      setRetriggering(null);
    }
  };

  const handleEdit = (name: string) => {
    setPendingWorkflowEdit(name);
    setActiveView('workflows');
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 size={20} className="animate-spin text-[var(--text-faint)]" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-6 py-8">
      <div className="flex items-center gap-2 mb-6">
        <Zap size={18} className="text-[var(--accent)]" />
        <h1 className="text-[18px] font-semibold text-[var(--text)]">Automations</h1>
      </div>

      {automations.length === 0 ? (
        <div className="text-center py-16">
          <div className="h-12 w-12 rounded-xl bg-[var(--surface2)] border border-[var(--border)] flex items-center justify-center mx-auto mb-4">
            <Zap size={20} className="text-[var(--text-faint)]" />
          </div>
          <p className="text-[14px] text-[var(--text-dim)] mb-1">No automations configured.</p>
          <p className="text-[12px] text-[var(--text-faint)]">
            Open a workflow in Studio to add one.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {automations.map((entry) => {
            const latestFailure = entry.status.failures.length > 0
              ? entry.status.failures[entry.status.failures.length - 1]
              : null;

            return (
              <div
                key={entry.workflowName}
                className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4"
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <div className={`h-2 w-2 rounded-full ${entry.trigger.enabled ? 'bg-[var(--accent)]' : 'bg-[var(--text-faint)]'}`} />
                    <span className="text-[14px] font-medium text-[var(--text)]">{entry.workflowLabel}</span>
                    <span className={`text-[10px] font-medium uppercase tracking-wider ${entry.trigger.enabled ? 'text-[var(--accent)]' : 'text-[var(--text-faint)]'}`}>
                      {entry.trigger.enabled ? 'Active' : 'Paused'}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleEdit(entry.workflowName)}
                    className="text-[11px] text-[var(--accent)] hover:underline underline-offset-2"
                  >
                    Edit
                  </button>
                </div>

                <p className="text-[11px] text-[var(--text-faint)] mb-1">
                  Filter: {entry.trigger.filter} · every {entry.trigger.intervalMinutes ?? 2} min
                </p>

                <p className="text-[11px] text-[var(--text-faint)]">
                  Last run: {relativeTime(entry.status.lastPollAt)}
                  {entry.status.processedCount > 0 && <> · {entry.status.processedCount} processed</>}
                  {entry.status.failures.length > 0 && (
                    <span className="text-amber-400"> · {entry.status.failures.length} failure{entry.status.failures.length > 1 ? 's' : ''}</span>
                  )}
                </p>

                {latestFailure && (
                  <div className="flex items-start gap-2 mt-2 rounded-lg border border-amber-500/20 bg-amber-500/8 px-3 py-2">
                    <AlertCircle size={12} className="text-amber-400 shrink-0 mt-0.5" />
                    <p className="text-[11px] text-amber-300 flex-1 truncate">{latestFailure.error}</p>
                    <button
                      type="button"
                      onClick={() => handleRetrigger(entry.workflowName, latestFailure.messageId)}
                      disabled={retriggering === latestFailure.messageId}
                      className="text-[10px] text-amber-400/70 hover:text-amber-300 transition underline underline-offset-2 shrink-0"
                    >
                      {retriggering === latestFailure.messageId ? 'Running…' : 'Re-trigger'}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
