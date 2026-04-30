import { useCallback, useEffect, useState } from 'react';
import { Lightbulb, Trash2, AlertCircle, Loader2 } from 'lucide-react';
import { api } from '../../services/api';
import type { SynthesisSettings } from '../../services/api';

interface Props {
  onOpenActivityLog: () => void;
}

export default function SynthesisSettingsPanel({ onOpenActivityLog }: Props) {
  const [settings, setSettings] = useState<SynthesisSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clearedNotice, setClearedNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const s = await api.getSynthesisSettings();
      setSettings(s);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load settings');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const update = useCallback(
    async (patch: Partial<SynthesisSettings>) => {
      setSaving(true);
      setError(null);
      try {
        const next = await api.updateSynthesisSettings(patch);
        setSettings(next);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to update settings');
      } finally {
        setSaving(false);
      }
    },
    [],
  );

  const handleClearLog = useCallback(async () => {
    setClearedNotice(null);
    try {
      const r = await api.clearInvocationLog();
      setClearedNotice(`Cleared ${r.deletedCount} entries.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to clear log');
    }
  }, []);

  if (loading || !settings) {
    return (
      <div className="flex items-center gap-2 text-[var(--text-dim)]">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span>Loading…</span>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <header className="flex items-start gap-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-[10px] border border-[var(--border)] bg-[var(--surface2)]">
          <Lightbulb className="h-4 w-4 text-[var(--accent)]" aria-hidden />
        </span>
        <div>
          <h2 className="text-[15px] font-semibold tracking-[-0.02em] text-[var(--text)]">
            Workflow suggestions
          </h2>
          <p className="mt-0.5 max-w-prose text-[12px] leading-5 text-[var(--text-faint)]">
            Opt-in: when enabled, FlowSpace records the tools the agent runs (names and a hash of
            argument shapes — no message bodies, no recipient addresses) so it can suggest saved
            workflows when you do the same thing repeatedly. Default: off.
          </p>
        </div>
      </header>

      {error && (
        <div className="flex items-start gap-2 rounded-[10px] border border-red-500/30 bg-red-500/10 px-3 py-2 text-[12px] text-red-200">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <label className="flex items-center justify-between gap-4 rounded-[12px] border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
        <div>
          <div className="text-[13px] font-medium text-[var(--text)]">
            Suggest workflows from my activity
          </div>
          <div className="mt-0.5 text-[11px] text-[var(--text-faint)]">
            Records tool dispatches locally to detect repeated sequences.
          </div>
        </div>
        <input
          type="checkbox"
          checked={settings.enabled}
          disabled={saving}
          onChange={(e) => update({ enabled: e.target.checked })}
          className="h-5 w-5 cursor-pointer accent-[var(--accent)]"
        />
      </label>

      <fieldset className="space-y-3 rounded-[12px] border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
        <legend className="px-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--text-faint)]">
          Detection
        </legend>
        <NumberRow
          label="Minimum occurrences before suggesting"
          value={settings.minOccurrences}
          min={2}
          max={10}
          disabled={!settings.enabled || saving}
          onCommit={(v) => update({ minOccurrences: v })}
        />
        <NumberRow
          label="Look-back window (days)"
          value={settings.lookBackDays}
          min={1}
          max={90}
          disabled={!settings.enabled || saving}
          onCommit={(v) => update({ lookBackDays: v })}
        />
        <NumberRow
          label="Maximum sequence length"
          value={settings.maxSequenceLength}
          min={2}
          max={10}
          disabled={!settings.enabled || saving}
          onCommit={(v) => update({ maxSequenceLength: v })}
        />
      </fieldset>

      <fieldset className="space-y-3 rounded-[12px] border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
        <legend className="px-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--text-faint)]">
          Storage
        </legend>
        <NumberRow
          label="Retain log entries (count)"
          value={settings.logCapEntries}
          min={100}
          max={10000}
          disabled={!settings.enabled || saving}
          onCommit={(v) => update({ logCapEntries: v })}
        />
        <NumberRow
          label="Retain log entries (days)"
          value={settings.logRetentionDays}
          min={1}
          max={365}
          disabled={!settings.enabled || saving}
          onCommit={(v) => update({ logRetentionDays: v })}
        />
      </fieldset>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onOpenActivityLog}
          className="inline-flex items-center gap-2 rounded-[10px] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[12px] font-medium text-[var(--text)] transition hover:bg-[var(--surface-hover)]"
        >
          View activity log
        </button>
        <button
          type="button"
          onClick={handleClearLog}
          className="inline-flex items-center gap-2 rounded-[10px] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[12px] font-medium text-[var(--text-dim)] transition hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
        >
          <Trash2 className="h-3.5 w-3.5" />
          Clear activity log
        </button>
        {clearedNotice && (
          <span className="inline-flex items-center text-[12px] text-[var(--text-faint)]">
            {clearedNotice}
          </span>
        )}
      </div>
    </div>
  );
}

function NumberRow({
  label,
  value,
  min,
  max,
  disabled,
  onCommit,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  disabled?: boolean;
  onCommit: (v: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[12px] text-[var(--text-dim)]">{label}</span>
      <input
        type="number"
        value={draft}
        min={min}
        max={max}
        disabled={disabled}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          const n = Number(draft);
          if (!Number.isFinite(n) || n < min || n > max) {
            setDraft(String(value));
            return;
          }
          if (n !== value) onCommit(n);
        }}
        className="w-24 rounded-[8px] border border-[var(--border)] bg-[var(--surface2)] px-2 py-1 text-right text-[12px] text-[var(--text)] disabled:opacity-50"
      />
    </div>
  );
}
