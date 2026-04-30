import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, Eye, Loader2, Play, Plus, Shield, Sparkles } from 'lucide-react';
import { api, type DynamicToolItem } from '../services/api';
import { SUGGESTED_TEMPLATES } from '../components/workflows/SuggestedTemplates';
import { deriveSummaryText } from '../components/workflows/TrustSummary';
import { useChatContext } from '../context/ChatContext';

type LoadState = 'loading' | 'loaded' | 'error';

function formatLabel(w: DynamicToolItem): string {
  if (w.label) return w.label;
  return w.name.split('_').map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');
}

/* ── Workflow row in the left list ────────────────────────────── */

function WorkflowRow({
  workflow,
  selected,
  onClick,
}: {
  workflow: DynamicToolItem;
  selected: boolean;
  onClick: () => void;
}) {
  const label = formatLabel(workflow);
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-3 py-2.5 rounded-xl transition-all group ${
        selected
          ? 'bg-[var(--accent)]/10 border border-[var(--accent)]/25'
          : 'border border-transparent hover:bg-[var(--surface-hover)]'
      }`}
    >
      <div className="flex items-center gap-2 min-w-0">
        <div className={`h-1.5 w-1.5 rounded-full shrink-0 ${selected ? 'bg-[var(--accent)]' : 'bg-[var(--text-faint)]'}`} />
        <span className={`text-[13px] font-medium truncate ${selected ? 'text-[var(--text)]' : 'text-[var(--text-dim)] group-hover:text-[var(--text)]'}`}>
          {label}
        </span>
        {workflow.isWriteTool ? (
          <Shield size={10} className="shrink-0 text-amber-400/60" />
        ) : (
          <Eye size={10} className="shrink-0 text-blue-400/40" />
        )}
      </div>
      <p className="text-[11px] text-[var(--text-faint)] truncate ml-3.5 mt-0.5">
        {workflow.steps.length} step{workflow.steps.length !== 1 ? 's' : ''}
      </p>
    </button>
  );
}

/* ── Right panel: workflow preview ────────────────────────────── */

const ACTION_LABELS: Record<string, string> = {
  search_drive: 'Search Google Drive', list_drive_files: 'List Drive files',
  create_drive_folder: 'Create Drive folder', send_email: 'Send an email',
  search_emails: 'Search emails', read_email: 'Read email thread',
  create_calendar_event: 'Create calendar event', list_calendar_events: 'Check calendar',
  create_task: 'Create task', list_tasks: 'List tasks',
  standup_report: 'Standup report', meeting_prep: 'Prep for meeting',
  email_to_task: 'Turn email into task', weekly_digest: 'Weekly digest',
  calendar_agenda: 'Calendar agenda', gmail_triage: 'Triage inbox',
  sheets_read: 'Read spreadsheet', sheets_create: 'Create spreadsheet',
  sheets_update: 'Update spreadsheet', sheets_append: 'Append to spreadsheet',
  docs_read: 'Read document', docs_write: 'Write document',
  drive_upload: 'Upload to Drive', review_overdue_tasks: 'Review overdue tasks',
  save_email_to_doc: 'Save email to doc', archive_email_threads: 'Archive emails',
  trash_email_threads: 'Move emails to trash',
};

const WRITE_ACTIONS = new Set([
  'create_drive_folder','send_email','create_calendar_event','create_task',
  'email_to_task','sheets_create','sheets_update','sheets_append','docs_write',
  'drive_upload','save_email_to_doc','archive_email_threads','trash_email_threads',
  'restore_email_threads','mute_email_threads','mark_threads_read',
  'apply_label_to_threads','unsubscribe_from_sender','create_gmail_filter',
]);

function WorkflowPreview({
  workflow,
  onRun,
  onEdit,
  onDelete,
}: {
  workflow: DynamicToolItem;
  onRun: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const label = formatLabel(workflow);
  const trustText = deriveSummaryText(workflow.steps);
  const hasWrites = workflow.isWriteTool || workflow.steps.some((s) => WRITE_ACTIONS.has(s.action));

  return (
    <div className="flex flex-col h-full px-8 py-8 overflow-y-auto">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-2 flex-wrap">
          <h2 className="text-[20px] font-semibold text-[var(--text)]">{label}</h2>
          {hasWrites ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-400 uppercase tracking-wider">
              <Shield size={9} /> Asks before sending
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full border border-blue-500/30 bg-blue-500/10 px-2 py-0.5 text-[10px] font-medium text-blue-400 uppercase tracking-wider">
              <Eye size={9} /> Read-only
            </span>
          )}
        </div>
        <p className="text-[14px] text-[var(--text-dim)] leading-relaxed">{workflow.description}</p>
      </div>

      {/* Steps timeline */}
      <div className="mb-6">
        <p className="text-[11px] font-medium text-[var(--text-faint)] uppercase tracking-wider mb-3">Steps</p>
        <div className="space-y-0">
          {workflow.steps.map((step, i) => (
            <div key={i} className="flex gap-3">
              <div className="flex flex-col items-center">
                <div className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--accent)]/12 text-[10px] font-bold text-[var(--accent)] shrink-0">
                  {i + 1}
                </div>
                {i < workflow.steps.length - 1 && (
                  <div className="w-px flex-1 bg-[var(--border)] mt-1 mb-1 min-h-[14px]" />
                )}
              </div>
              <div className="flex-1 pb-3 pt-0.5 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[13px] text-[var(--text)]">
                    {ACTION_LABELS[step.action] || step.action.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}
                  </span>
                  {WRITE_ACTIONS.has(step.action) && (
                    <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/25 bg-amber-500/8 px-1.5 py-0.5 text-[9px] font-medium text-amber-400 uppercase tracking-wider shrink-0">
                      <Shield size={8} /> Asks
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Trust summary */}
      <div className={`flex items-start gap-2.5 rounded-[12px] border px-3.5 py-3 mb-8 ${
        hasWrites ? 'border-amber-500/20 bg-amber-500/5' : 'border-blue-500/20 bg-blue-500/5'
      }`}>
        {hasWrites ? <Shield size={14} className="text-amber-400 mt-0.5 shrink-0" /> : <Eye size={14} className="text-blue-400 mt-0.5 shrink-0" />}
        <p className={`text-[12px] leading-relaxed ${hasWrites ? 'text-[var(--amber)]' : 'text-[var(--blue)]'}`}>{trustText}</p>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 mt-auto">
        <button
          onClick={onRun}
          className="flex items-center gap-1.5 rounded-xl bg-[var(--accent)] px-4 py-2 text-[13px] font-medium text-black transition hover:brightness-110"
        >
          <Play size={13} /> Run now
        </button>
        <button
          onClick={onEdit}
          className="flex items-center gap-1.5 rounded-xl border border-[var(--border)] px-4 py-2 text-[13px] text-[var(--text-dim)] transition hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
        >
          Edit workflow
        </button>
        <button
          onClick={onDelete}
          className="ml-auto text-[12px] text-[var(--text-faint)] hover:text-red-400 transition"
        >
          Delete
        </button>
      </div>
    </div>
  );
}

/* ── Empty right panel ────────────────────────────────────────── */

function EmptyPreview({ onTeach }: { onTeach: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center h-full px-8 text-center">
      <div className="h-14 w-14 rounded-2xl bg-[var(--accent)]/8 border border-[var(--accent)]/15 flex items-center justify-center mb-5">
        <Sparkles size={22} className="text-[var(--accent)]" />
      </div>
      <h3 className="text-[16px] font-semibold text-[var(--text)] mb-2">Teach FlowSpace a recurring job</h3>
      <p className="text-[13px] text-[var(--text-dim)] max-w-[340px] leading-relaxed mb-6">
        Describe something you do regularly. FlowSpace will plan the steps, you review them, then save it for one-click use.
      </p>
      <button
        onClick={onTeach}
        className="inline-flex items-center gap-2 rounded-xl bg-[var(--accent)] px-5 py-2.5 text-[13px] font-medium text-black transition hover:brightness-110"
      >
        <Plus size={13} /> Teach your first workflow
      </button>
    </div>
  );
}

/* ── Main page ────────────────────────────────────────────────── */

interface Props {
  onTeach: (initialDescription?: string) => void;
  onEdit: (workflow: DynamicToolItem) => void;
}

export default function WorkflowLibraryPage({ onTeach, onEdit }: Props) {
  const { triggerAction, openChatPanel } = useChatContext();
  const [tools, setTools] = useState<DynamicToolItem[]>([]);
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [selected, setSelected] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadState('loading');
    try {
      const res = await api.getDynamicTools();
      setTools(res.tools);
      setLoadState('loaded');
    } catch {
      setLoadState('error');
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleDelete = async (name: string) => {
    if (!window.confirm('Delete this workflow? This cannot be undone.')) return;
    try {
      await api.deleteDynamicTool(name);
      setTools((prev) => prev.filter((t) => t.name !== name));
      if (selected === name) setSelected(null);
    } catch {
      load();
    }
  };

  const selectedWorkflow = tools.find((t) => t.name === selected) ?? null;

  if (loadState === 'loading') {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 size={16} className="animate-spin text-[var(--text-faint)]" />
      </div>
    );
  }

  if (loadState === 'error') {
    return (
      <div className="flex items-center justify-center h-full gap-2 text-[var(--error)]">
        <AlertCircle size={15} />
        <span className="text-[13px]">Failed to load workflows</span>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0">
      {/* ── Left column: list ── */}
      <div className="w-[260px] shrink-0 flex flex-col border-r border-[var(--border)] h-full overflow-hidden">
        {/* Column header */}
        <div className="px-4 pt-4 pb-2 shrink-0 flex items-center justify-between border-b border-[var(--border)]">
          <span className="text-[11px] font-mono text-[var(--text-faint)] uppercase tracking-[0.1em] opacity-60">Library</span>
          <button
            onClick={() => onTeach()}
            className="flex items-center gap-1 rounded-md bg-[var(--accent)] px-2.5 py-1 text-[11px] font-medium text-black transition hover:brightness-110 cursor-pointer"
            title="Teach a new workflow"
          >
            <Plus size={10} /> New
          </button>
        </div>

        {/* Workflow list */}
        <div className="flex-1 overflow-y-auto px-2 py-3 pb-4 min-h-0">
          {tools.length > 0 && (
            <div className="mb-3">
              <p className="text-[9px] font-mono text-[var(--text-faint)] uppercase tracking-[0.12em] opacity-50 px-2 mb-1.5">Your workflows</p>
              <div className="space-y-0.5">
                {tools.map((t) => (
                  <WorkflowRow
                    key={t.name}
                    workflow={t}
                    selected={selected === t.name}
                    onClick={() => setSelected(t.name)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Templates */}
          <div>
            <p className="text-[9px] font-mono text-[var(--text-faint)] uppercase tracking-[0.12em] opacity-50 px-2 mb-1.5">
              {tools.length > 0 ? 'Suggested' : 'Templates'}
            </p>
            <div className="space-y-0.5">
              {SUGGESTED_TEMPLATES.map((t) => (
                <button
                  key={t.id}
                  onClick={() => onTeach(t.description)}
                  className="w-full text-left px-3 py-2.5 rounded-xl border border-transparent hover:bg-[var(--surface-hover)] transition group"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="h-1.5 w-1.5 rounded-full shrink-0 bg-[var(--border2)] group-hover:bg-[var(--accent)]/50 transition" />
                    <span className="text-[12px] text-[var(--text-faint)] group-hover:text-[var(--text-dim)] truncate transition">
                      {t.label}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── Right column: preview or empty ── */}
      <div className="flex-1 min-w-0 h-full overflow-hidden bg-[var(--bg)]">
        {selectedWorkflow ? (
          <WorkflowPreview
            workflow={selectedWorkflow}
            onRun={() => {
              openChatPanel();
              triggerAction(`Use the ${selectedWorkflow.name} tool`, true);
            }}
            onEdit={() => onEdit(selectedWorkflow)}
            onDelete={() => handleDelete(selectedWorkflow.name)}
          />
        ) : (
          <EmptyPreview onTeach={() => onTeach()} />
        )}
      </div>
    </div>
  );
}
