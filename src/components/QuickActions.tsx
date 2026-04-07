import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, PencilLine, Plus, Trash2, X } from 'lucide-react';
import { api } from '../services/api';
import type { WorkspaceStats, CalendarEvent } from '../services/api';

interface QuickAction {
  label: string;
  prompt: string;
}

interface Props {
  stats: WorkspaceStats | null;
  events: CalendarEvent[];
  onAction: (prompt: string) => void;
}

// ── Default actions (used for new users or when no saved config) ─────

function buildDefaultActions(stats: WorkspaceStats | null, events: CalendarEvent[]): QuickAction[] {
  const items: QuickAction[] = [];

  if (stats && stats.unreadEmails > 0) {
    items.push({
      label: 'Summarize unread emails',
      prompt: 'Summarize my unread emails',
    });
  }

  const soon = events.find((ev) => {
    const start = new Date(ev.start).getTime();
    const now = Date.now();
    return start > now && start - now < 2 * 60 * 60 * 1000;
  });
  if (soon) {
    items.push({
      label: `Prep for ${soon.summary}`,
      prompt: `Prepare for my meeting: ${soon.summary}`,
    });
  }

  items.push({ label: 'Standup report', prompt: 'Give me a standup report' });
  items.push({ label: 'Weekly digest', prompt: 'Give me a weekly digest' });

  if (stats && stats.openTasks > 0) {
    items.push({
      label: 'Review open tasks',
      prompt: 'List my open tasks',
    });
  }

  return items.slice(0, 5);
}

// ── Suggested actions catalog (for the add menu) ─────────────────────

const SUGGESTED_ACTIONS: QuickAction[] = [
  { label: 'Standup report', prompt: 'Give me a standup report' },
  { label: 'Weekly digest', prompt: 'Give me a weekly digest' },
  { label: 'Summarize unread emails', prompt: 'Summarize my unread emails' },
  { label: 'Review open tasks', prompt: 'List my open tasks' },
  { label: 'Today\'s agenda', prompt: 'What\'s on my calendar today?' },
  { label: 'Draft a reply', prompt: 'Help me draft a reply to my latest email' },
  { label: 'Meeting prep', prompt: 'Prepare for my next meeting' },
  { label: 'Search Drive', prompt: 'Search my Drive for recent documents' },
  { label: 'Create a task', prompt: 'Create a new task for me' },
  { label: 'Triage inbox', prompt: 'Triage my inbox and categorize emails' },
];

// ── Component ────────────────────────────────────────────────────────

export default function QuickActions({ stats, events, onAction }: Props) {
  const [savedActions, setSavedActions] = useState<QuickAction[] | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<QuickAction[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [customLabel, setCustomLabel] = useState('');
  const [customPrompt, setCustomPrompt] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.getQuickActions()
      .then(({ actions }) => {
        setSavedActions(actions);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

  const defaultActions = useMemo(
    () => buildDefaultActions(stats, events),
    [stats, events],
  );

  const displayActions = loaded && savedActions ? savedActions : defaultActions;

  const startEdit = useCallback(() => {
    setDraft([...displayActions]);
    setEditing(true);
    setShowSuggestions(false);
    setCustomLabel('');
    setCustomPrompt('');
  }, [displayActions]);

  const cancelEdit = () => {
    setEditing(false);
    setShowSuggestions(false);
  };

  const saveEdit = async () => {
    setSaving(true);
    try {
      await api.saveQuickActions(draft);
      setSavedActions(draft);
      setEditing(false);
    } catch {
      // silently fail
    } finally {
      setSaving(false);
    }
  };

  const addSuggested = (action: QuickAction) => {
    if (draft.length >= 6) return;
    if (draft.some((d) => d.prompt === action.prompt)) return;
    setDraft((prev) => [...prev, action]);
    setShowSuggestions(false);
  };

  const addCustom = () => {
    const label = customLabel.trim();
    const prompt = customPrompt.trim();
    if (!label || !prompt || draft.length >= 6) return;
    setDraft((prev) => [...prev, { label, prompt }]);
    setCustomLabel('');
    setCustomPrompt('');
    setShowSuggestions(false);
  };

  const removeDraft = (index: number) => {
    setDraft((prev) => prev.filter((_, i) => i !== index));
  };

  const resetToDefaults = async () => {
    setSaving(true);
    try {
      // Save empty array means "use defaults" — but we actually save the defaults
      // so they become the user's explicit config. Alternatively, delete the file.
      // For simplicity, send the defaults.
      const defaults = buildDefaultActions(stats, events);
      await api.saveQuickActions(defaults);
      setSavedActions(defaults);
      setDraft([...defaults]);
    } catch {
      // silently fail
    } finally {
      setSaving(false);
    }
  };

  // Available suggestions (exclude already-added ones)
  const availableSuggestions = SUGGESTED_ACTIONS.filter(
    (s) => !draft.some((d) => d.prompt === s.prompt),
  );

  // ── Edit mode ──────────────────────────────────────────────────────

  if (editing) {
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-[12px] font-medium text-[var(--text-dim)] uppercase tracking-wider">Edit quick actions</span>
          <div className="flex items-center gap-1.5">
            <button
              onClick={resetToDefaults}
              disabled={saving}
              className="px-2.5 py-1 rounded-md text-[11px] text-[var(--text-faint)] hover:text-[var(--text)] hover:bg-white/[0.04] transition"
            >
              Reset defaults
            </button>
            <button
              onClick={cancelEdit}
              className="p-1.5 rounded-md text-[var(--text-faint)] hover:text-white hover:bg-white/[0.04] transition"
            >
              <X size={14} />
            </button>
            <button
              onClick={saveEdit}
              disabled={saving || draft.length === 0}
              className="flex items-center gap-1 px-3 py-1 rounded-md bg-[var(--accent)] text-black text-[12px] font-medium hover:brightness-110 transition disabled:opacity-40"
            >
              <Check size={12} />
              Save
            </button>
          </div>
        </div>

        {/* Current draft actions */}
        <div className="flex flex-wrap gap-2">
          {draft.map((action, i) => (
            <div
              key={i}
              className="flex items-center gap-1.5 pl-3 pr-1.5 py-1.5 rounded-full text-[13px] bg-[var(--surface2)] border border-[var(--border2)] text-[var(--text-dim)]"
            >
              <span>{action.label}</span>
              <button
                onClick={() => removeDraft(i)}
                className="p-0.5 rounded-full text-[var(--text-faint)] hover:text-[var(--error)] hover:bg-[var(--error)]/10 transition"
              >
                <X size={12} />
              </button>
            </div>
          ))}
          {draft.length < 6 && (
            <button
              onClick={() => setShowSuggestions(!showSuggestions)}
              className="flex items-center gap-1 px-3 py-1.5 rounded-full text-[13px] border border-dashed border-[var(--border2)] text-[var(--text-faint)] hover:border-[var(--accent)] hover:text-[var(--accent)] transition"
            >
              <Plus size={12} />
              Add
            </button>
          )}
        </div>

        {/* Suggestions dropdown */}
        {showSuggestions && (
          <div className="rounded-[14px] border border-[var(--border)] bg-[var(--surface)] p-3 space-y-3">
            {/* Preset suggestions */}
            {availableSuggestions.length > 0 && (
              <div>
                <div className="text-[11px] text-[var(--text-faint)] uppercase tracking-wider mb-2">Suggestions</div>
                <div className="flex flex-wrap gap-1.5">
                  {availableSuggestions.map((s) => (
                    <button
                      key={s.prompt}
                      onClick={() => addSuggested(s)}
                      className="px-3 py-1.5 rounded-full text-[12px] border border-[var(--border)] text-[var(--text-dim)] hover:border-[var(--accent)] hover:text-[var(--accent)] transition"
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Custom action */}
            <div>
              <div className="text-[11px] text-[var(--text-faint)] uppercase tracking-wider mb-2">Custom action</div>
              <div className="flex gap-2">
                <input
                  value={customLabel}
                  onChange={(e) => setCustomLabel(e.target.value)}
                  placeholder="Button label"
                  className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2.5 py-1.5 text-[12px] text-[var(--text)] outline-none focus:border-[var(--accent)] transition"
                />
                <input
                  value={customPrompt}
                  onChange={(e) => setCustomPrompt(e.target.value)}
                  placeholder="Prompt to send"
                  onKeyDown={(e) => e.key === 'Enter' && addCustom()}
                  className="flex-[2] rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2.5 py-1.5 text-[12px] text-[var(--text)] outline-none focus:border-[var(--accent)] transition"
                />
                <button
                  onClick={addCustom}
                  disabled={!customLabel.trim() || !customPrompt.trim()}
                  className="px-3 py-1.5 rounded-lg bg-[var(--accent)] text-black text-[12px] font-medium hover:brightness-110 transition disabled:opacity-40"
                >
                  Add
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── Display mode ───────────────────────────────────────────────────

  return (
    <div className="flex flex-wrap gap-2 overflow-x-auto flex-1 scrollbar-none items-center">
      {displayActions.map((a) => (
        <button
          key={a.prompt}
          onClick={() => onAction(a.prompt)}
          className="whitespace-nowrap px-3.5 py-1.5 rounded-full text-[13px] bg-[var(--surface2)] border border-[var(--border2)] text-[var(--text-dim)] cursor-pointer hover:border-[var(--accent-border)] hover:text-[var(--text)] hover:-translate-y-px active:translate-y-px transition-all duration-100"
        >
          {a.label}
        </button>
      ))}
      <button
        onClick={startEdit}
        className="shrink-0 p-2 rounded-full text-[var(--text-faint)] hover:text-[var(--text)] hover:bg-white/[0.04] transition"
        aria-label="Customize quick actions"
      >
        <PencilLine size={14} aria-hidden="true" />
      </button>
    </div>
  );
}
