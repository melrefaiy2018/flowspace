import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowLeft, Check, ChevronRight, Loader2, MessageSquare, Play,
  RefreshCw, Save, Send, Shield, Sparkles, X,
} from 'lucide-react';
import { api, type DynamicToolItem } from '../services/api';
import { SUGGESTED_TEMPLATES } from '../components/workflows/SuggestedTemplates';
import { deriveSummaryText, deriveTrustInfo } from '../components/workflows/TrustSummary';
import AdvancedWorkflowEditor, { type ToolStepDraft } from '../components/workflows/AdvancedWorkflowEditor';
import { useChatContext } from '../context/ChatContext';
import { AutomatePanel } from '../components/AutomatePanel';

// ── Constants ──────────────────────────────────────────────────────────────

const LEFT_W_KEY = 'flowspace.studio.leftW';
const RIGHT_W_KEY = 'flowspace.studio.rightW';
const LEFT_DEFAULT = 288;
const RIGHT_DEFAULT = 288;
const MIN_SIDE = 200;
const MAX_SIDE = 440;

const WRITE_ACTIONS = new Set([
  'create_drive_folder', 'send_email', 'create_calendar_event', 'create_task',
  'email_to_task', 'sheets_create', 'sheets_update', 'sheets_append', 'docs_write',
  'drive_upload', 'save_email_to_doc', 'archive_email_threads', 'trash_email_threads',
  'restore_email_threads', 'mute_email_threads', 'mark_threads_read',
  'apply_label_to_threads', 'unsubscribe_from_sender', 'create_gmail_filter',
]);

const ACTION_LABELS: Record<string, string> = {
  search_drive: 'Search your Google Drive files',
  list_drive_files: 'List files in Google Drive',
  create_drive_folder: 'Create a folder in Google Drive',
  send_email: 'Send an email',
  search_emails: 'Search your emails',
  read_email: 'Read an email thread',
  create_calendar_event: 'Create a calendar event',
  list_calendar_events: 'Check your calendar events',
  create_task: 'Create a task',
  list_tasks: 'List your tasks',
  standup_report: 'Compile a standup report',
  meeting_prep: 'Prep for your next meeting',
  email_to_task: 'Turn an email into a task',
  weekly_digest: 'Compile your weekly digest',
  calendar_agenda: 'Check your calendar agenda',
  gmail_triage: 'Triage your inbox',
  sheets_read: 'Read a Google Sheets spreadsheet',
  sheets_create: 'Create a new spreadsheet',
  sheets_update: 'Update a spreadsheet',
  sheets_append: 'Add rows to a spreadsheet',
  docs_read: 'Read a Google Doc',
  docs_write: 'Write to a Google Doc',
  drive_upload: 'Upload a file to Drive',
  review_overdue_tasks: 'Review your overdue tasks',
  save_email_to_doc: 'Save an email to a Google Doc',
  archive_email_threads: 'Archive email threads',
  trash_email_threads: 'Move emails to trash',
  restore_email_threads: 'Restore emails from trash',
  mute_email_threads: 'Mute email threads',
  mark_threads_read: 'Mark emails as read',
  apply_label_to_threads: 'Apply labels to emails',
  unsubscribe_from_sender: 'Unsubscribe from a sender',
  create_gmail_filter: 'Create a Gmail filter',
};


function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40) || 'my_workflow';
}

function toTitleCase(s: string): string {
  return s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

// ── ResizeHandle ───────────────────────────────────────────────────────────

function ResizeHandle({ onDrag }: { onDrag: (delta: number) => void }) {
  const dragging = useRef(false);
  const lastX = useRef(0);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    dragging.current = true;
    lastX.current = e.clientX;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging.current) return;
    const delta = e.clientX - lastX.current;
    lastX.current = e.clientX;
    onDrag(delta);
  }, [onDrag]);

  const onPointerUp = useCallback(() => { dragging.current = false; }, []);

  return (
    <div
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      className="shrink-0 w-[5px] cursor-col-resize flex items-center justify-center group transition-colors relative z-10"
    >
      <div className="w-px h-8 bg-[var(--border)] group-hover:bg-[var(--accent)] group-active:bg-[var(--accent)] transition-colors rounded-full" />
    </div>
  );
}

// ── Activity feed helpers ─────────────────────────────────────────────────

interface StreamInfo {
  label: string | null;       // "label": "..."
  description: string | null; // "description": "..."
  actions: string[];          // each "action": "..." found
}

/** Parse useful fields from partial streamed JSON. */
function parseStreamInfo(text: string): StreamInfo {
  const labelMatch = text.match(/"label"\s*:\s*"([^"]+)"/);
  const descMatch = text.match(/"description"\s*:\s*"([^"]+)"/);
  const actionMatches = [...text.matchAll(/"action"\s*:\s*"([^"]+)"/g)];
  return {
    label: labelMatch?.[1] ?? null,
    description: descMatch?.[1] ?? null,
    actions: actionMatches.map((m) => m[1].replace(/_/g, ' ')),
  };
}

function ActivityLine({
  done,
  text,
  sub,
  indent = false,
}: {
  done: boolean;
  text: string;
  sub?: string;
  indent?: boolean;
}) {
  return (
    <div className={`flex items-start gap-2.5 ${indent ? 'ml-6' : ''}`}>
      <div className="mt-[3px] shrink-0 h-3.5 w-3.5 flex items-center justify-center">
        {done
          ? <Check size={10} strokeWidth={2.5} className="text-[var(--accent)]" />
          : <div className="h-1.5 w-1.5 rounded-full bg-[var(--accent)]/60 animate-pulse" />
        }
      </div>
      <div>
        <span className={`text-[11.5px] font-mono leading-snug transition-colors ${done ? 'text-[var(--text-dim)]' : 'text-[var(--text-faint)]'}`}>
          {text}
        </span>
        {sub && (
          <span className="ml-2 text-[10.5px] font-mono text-[var(--accent)]/70">{sub}</span>
        )}
      </div>
    </div>
  );
}

// ── Step row ──────────────────────────────────────────────────────────────

function StepRow({
  step,
  index,
  total,
  isLast,
}: {
  step: { action: string; args: Record<string, string | number | boolean>; outputKey?: string };
  index: number;
  total: number;
  isLast: boolean;
}) {
  const isWrite = WRITE_ACTIONS.has(step.action);
  const label = ACTION_LABELS[step.action]
    || step.action.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center">
        <div className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--accent)]/12 text-[10px] font-bold text-[var(--accent)] shrink-0">
          {index + 1}
        </div>
        {!isLast && <div className="w-px flex-1 bg-[var(--border)] mt-1 mb-1 min-h-[20px]" />}
      </div>
      <div className="flex-1 pb-4 pt-0.5 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[13px] text-[var(--text)] leading-relaxed">{label}</span>
          {isWrite && (
            <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/25 bg-amber-500/8 px-1.5 py-0.5 text-[9px] font-medium text-amber-400 uppercase tracking-wider shrink-0">
              <Shield size={8} /> Asks
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Progress milestone ─────────────────────────────────────────────────────

function Milestone({ done, active, label }: { done: boolean; active: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <div className={`h-5 w-5 rounded-full flex items-center justify-center shrink-0 transition-all ${
        done
          ? 'bg-[var(--accent)] text-black'
          : active
          ? 'border-2 border-[var(--accent)] bg-transparent'
          : 'border border-[var(--border2)] bg-transparent'
      }`}>
        {done
          ? <Check size={11} strokeWidth={2.5} />
          : active
          ? <div className="h-1.5 w-1.5 rounded-full bg-[var(--accent)] animate-pulse" />
          : null
        }
      </div>
      <span className={`text-[12px] transition-colors ${
        done ? 'text-[var(--text)]' : active ? 'text-[var(--text-dim)]' : 'text-[var(--text-faint)]'
      }`}>{label}</span>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

interface Props {
  initialDescription?: string;
  editingDraft?: DynamicToolItem;
  onBack: () => void;
  onSaved: (tool: DynamicToolItem) => void;
}

type GenState = 'idle' | 'generating' | 'done' | 'error';
type SaveState = 'idle' | 'saving' | 'saved' | 'error';
type ChatMsg = { role: 'agent' | 'user'; content: string };
type RefineState = 'idle' | 'loading' | 'error';

export default function WorkflowStudioPage({ initialDescription = '', editingDraft, onBack, onSaved }: Props) {
  const { triggerAction, openChatPanel } = useChatContext();

  // Column widths
  const [leftW, setLeftW] = useState(() => {
    const saved = window.localStorage.getItem(LEFT_W_KEY);
    return saved ? Math.max(MIN_SIDE, Math.min(MAX_SIDE, Number(saved))) : LEFT_DEFAULT;
  });
  const [rightW, setRightW] = useState(() => {
    const saved = window.localStorage.getItem(RIGHT_W_KEY);
    return saved ? Math.max(MIN_SIDE, Math.min(MAX_SIDE, Number(saved))) : RIGHT_DEFAULT;
  });

  useEffect(() => { window.localStorage.setItem(LEFT_W_KEY, String(leftW)); }, [leftW]);
  useEffect(() => { window.localStorage.setItem(RIGHT_W_KEY, String(rightW)); }, [rightW]);

  const dragLeft = useCallback((delta: number) => {
    setLeftW((w) => Math.max(MIN_SIDE, Math.min(MAX_SIDE, w + delta)));
  }, []);
  const dragRight = useCallback((delta: number) => {
    setRightW((w) => Math.max(MIN_SIDE, Math.min(MAX_SIDE, w - delta)));
  }, []);

  // Intent (left column)
  const [description, setDescription] = useState(initialDescription);
  const [pendingRegenerate, setPendingRegenerate] = useState(false);

  // Generation
  const [genState, setGenState] = useState<GenState>(editingDraft ? 'done' : 'idle');
  const [genError, setGenError] = useState<string | null>(null);
  const [partialSteps, setPartialSteps] = useState<number>(0); // how many skeleton steps to show while generating
  const [streamingText, setStreamingText] = useState<string>(''); // raw LLM output for live display
  const abortRef = useRef<AbortController | null>(null);
  const streamEndRef = useRef<HTMLDivElement | null>(null);

  // Plan (center column)
  const [draft, setDraft] = useState<DynamicToolItem | null>(editingDraft ?? null);
  const [advSteps, setAdvSteps] = useState<ToolStepDraft[]>(
    editingDraft?.steps.map((s) => ({
      action: s.action,
      args: Object.fromEntries(Object.entries(s.args).map(([k, v]) => [k, String(v)])),
      outputKey: s.outputKey ?? '',
    })) ?? []
  );
  const [actions, setActions] = useState<string[]>([]);

  // Save / test state (right column)
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [testLaunched, setTestLaunched] = useState(false);

  // Studio chat state
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMsg[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [refineState, setRefineState] = useState<RefineState>('idle');
  const [refineHistory, setRefineHistory] = useState<{ role: 'user' | 'assistant'; content: string }[]>([]);
  const refineAbortRef = useRef<AbortController | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  // Load available actions once
  useEffect(() => {
    api.getDynamicToolActions().then((r) => setActions(r.actions)).catch(() => {});
  }, []);

  // Auto-scroll streaming output to bottom as new tokens arrive
  useEffect(() => {
    if (genState === 'generating') {
      streamEndRef.current?.scrollIntoView({ behavior: 'instant' });
    }
  }, [streamingText, genState]);

  // Seed initial agent message when chat panel opens on a ready draft
  useEffect(() => {
    if (chatOpen && chatMessages.length === 0 && draft) {
      setChatMessages([{
        role: 'agent',
        content: `I've planned ${draft.steps.length} step${draft.steps.length !== 1 ? 's' : ''} for "${draft.label || draft.name}". What would you like to change?`,
      }]);
    }
  }, [chatOpen, chatMessages.length, draft]);

  // Auto-scroll chat to bottom on new messages
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  // Cancel in-flight refine when chat panel is closed or component unmounts
  useEffect(() => {
    if (!chatOpen) refineAbortRef.current?.abort();
  }, [chatOpen]);
  useEffect(() => () => { refineAbortRef.current?.abort(); }, []);

  // ── Generation ────────────────────────────────────────────────────────

  const generate = useCallback(async (desc: string) => {
    if (desc.trim().length < 10) return;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    setGenState('generating');
    setGenError(null);
    setDraft(null);
    setPartialSteps(0);
    setStreamingText('');
    setPendingRegenerate(false);
    setChatMessages([]);
    setRefineHistory([]);
    setRefineState('idle');
    refineAbortRef.current?.abort();

    let accumulated = '';

    const parsePartialStepCount = (text: string): number => {
      // Count how many complete step objects we can see in the partial JSON
      const matches = text.match(/\{[^{}]*"action"\s*:/g);
      return matches ? matches.length : 0;
    };

    try {
      console.log('[WorkflowStudio] Calling streamWorkflowPlan, actions count:', actions.length);
      await api.streamWorkflowPlan(
        desc,
        actions,
        (chunk) => {
          if (ctrl.signal.aborted) return;
          accumulated += chunk;
          setStreamingText(accumulated);
          setPartialSteps(parsePartialStepCount(accumulated));
        },
        ctrl.signal,
      );

      if (ctrl.signal.aborted) return;

      const jsonMatch = accumulated.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No plan in response');

      const plan = JSON.parse(jsonMatch[0]);
      const steps: DynamicToolItem['steps'] = Array.isArray(plan.steps) ? plan.steps : [];
      const name = slugify(plan.name || desc);
      const label = plan.label || toTitleCase(name);

      const generated: DynamicToolItem = {
        name,
        label,
        description: plan.description || desc,
        parameters: {},
        steps,
        isWriteTool: steps.some((s) => WRITE_ACTIONS.has(s.action)),
        createdAt: editingDraft?.createdAt ?? new Date().toISOString(),
      };

      setDraft(generated);
      setAdvSteps(steps.map((s) => ({
        action: s.action,
        args: Object.fromEntries(Object.entries(s.args).map(([k, v]) => [k, String(v)])),
        outputKey: s.outputKey ?? '',
      })));
      setGenState('done');
    } catch (err: any) {
      if (err?.name === 'AbortError' || ctrl.signal.aborted) return;
      console.error('[WorkflowStudio] Plan generation failed:', err);
      setGenError(`I couldn't turn that into a plan. ${err?.message ? `(${err.message})` : 'Try adding more detail about when and what.'}`);
      setGenState('error');
    }
  }, [actions, editingDraft]);

  // Auto-generate on mount if description is pre-filled and we're not editing
  const hasAutoGenerated = useRef(false);
  useEffect(() => {
    if (!hasAutoGenerated.current && !editingDraft && initialDescription.trim().length >= 10 && actions.length > 0) {
      hasAutoGenerated.current = true;
      void generate(initialDescription);
    }
  }, [actions, editingDraft, generate, initialDescription]);

  const syncAdvToSteps = (steps: ToolStepDraft[]) => {
    setAdvSteps(steps);
    setDraft((prev) => prev ? {
      ...prev,
      steps: steps.map((s) => ({ action: s.action, args: s.args, ...(s.outputKey ? { outputKey: s.outputKey } : {}) })),
      isWriteTool: steps.some((s) => WRITE_ACTIONS.has(s.action)),
    } : prev);
  };

  // ── Save ──────────────────────────────────────────────────────────────

  const handleSave = useCallback(async () => {
    if (!draft) return;
    setSaveState('saving');
    setSaveError(null);
    try {
      let saved: DynamicToolItem;
      if (editingDraft) {
        const r = await api.updateDynamicTool(editingDraft.name, {
          description: draft.description,
          label: draft.label,
          isWriteTool: draft.isWriteTool,
          parameters: draft.parameters,
          steps: draft.steps,
        });
        saved = r.tool;
      } else {
        const r = await api.createDynamicTool({
          name: draft.name,
          description: draft.description,
          label: draft.label,
          isWriteTool: draft.isWriteTool ?? false,
          parameters: draft.parameters,
          steps: draft.steps,
        });
        saved = r.tool;
      }
      setSaveState('saved');
      onSaved(saved);
    } catch (err: any) {
      setSaveError(err?.message || 'Failed to save');
      setSaveState('error');
    }
  }, [draft, editingDraft, onSaved]);

  const handleTryInChat = useCallback(async () => {
    if (!draft) return;

    // Auto-save if not yet saved, so the tool is registered and callable by the agent
    let toolName = draft.name;
    if (saveState !== 'saved') {
      setSaveState('saving');
      setSaveError(null);
      try {
        let saved: DynamicToolItem;
        if (editingDraft) {
          const r = await api.updateDynamicTool(editingDraft.name, {
            description: draft.description,
            label: draft.label,
            isWriteTool: draft.isWriteTool,
            parameters: draft.parameters,
            steps: draft.steps,
          });
          saved = r.tool;
        } else {
          const r = await api.createDynamicTool({
            name: draft.name,
            description: draft.description,
            label: draft.label,
            isWriteTool: draft.isWriteTool ?? false,
            parameters: draft.parameters,
            steps: draft.steps,
          });
          saved = r.tool;
        }
        toolName = saved.name;
        setSaveState('saved');
      } catch (err: any) {
        setSaveError(err?.message || 'Failed to save');
        setSaveState('error');
        return;
      }
    }

    // Open chat panel and invoke the tool by its internal name
    openChatPanel();
    triggerAction(`Use the ${toolName} tool`, true);
    setTestLaunched(true);
  }, [draft, editingDraft, saveState, triggerAction, openChatPanel]);

  const handleRefine = useCallback(async () => {
    const text = chatInput.trim();
    if (!text || !draft || refineState === 'loading') return;

    setChatInput('');
    setChatMessages((prev) => [
      ...prev,
      { role: 'user', content: text },
      { role: 'agent', content: '__loading__' },
    ]);
    setRefineState('loading');

    refineAbortRef.current?.abort();
    const ctrl = new AbortController();
    refineAbortRef.current = ctrl;

    let accumulated = '';
    try {
      await api.streamWorkflowRefine(
        draft,
        text,
        refineHistory,
        actions,
        (chunk) => { accumulated += chunk; },
        ctrl.signal,
      );

      if (ctrl.signal.aborted) return;

      const jsonMatch = accumulated.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No plan JSON in response');
      const plan = JSON.parse(jsonMatch[0]);
      const steps: DynamicToolItem['steps'] = Array.isArray(plan.steps) ? plan.steps : [];

      setDraft((prev) => prev ? {
        ...prev,
        label: plan.label || prev.label,
        description: plan.description || prev.description,
        steps,
        isWriteTool: steps.some((s) => WRITE_ACTIONS.has(s.action)),
      } : prev);

      syncAdvToSteps(steps.map((s) => ({
        action: s.action,
        args: Object.fromEntries(Object.entries(s.args ?? {}).map(([k, v]) => [k, String(v)])),
        outputKey: s.outputKey ?? '',
      })));

      const ack = `Done — updated to ${steps.length} step${steps.length !== 1 ? 's' : ''}.`;
      setRefineHistory((prev) => [
        ...prev,
        { role: 'user', content: text },
        { role: 'assistant', content: ack },
      ]);
      setChatMessages((prev) => [...prev.slice(0, -1), { role: 'agent', content: ack }]);
      setRefineState('idle');
      setSaveState('idle');
    } catch (err: any) {
      if (err?.name === 'AbortError' || ctrl.signal.aborted) {
        setChatMessages((prev) =>
          prev[prev.length - 1]?.content === '__loading__' ? prev.slice(0, -1) : prev
        );
        return;
      }
      const msg = `Sorry, I couldn't apply that change. ${err?.message ? `(${err.message})` : 'Try rephrasing.'}`;
      setChatMessages((prev) => [...prev.slice(0, -1), { role: 'agent', content: msg }]);
      setRefineState('error');
    }
  }, [chatInput, draft, refineHistory, actions, refineState]);

  // ── Derived state ─────────────────────────────────────────────────────

  const hasDescription = description.trim().length >= 10;
  const isGenerating = genState === 'generating';
  const planReady = genState === 'done' && draft !== null;
  const isSaved = saveState === 'saved';

  const descriptionWritten = hasDescription;
  const planGenerated = planReady;
  const savedToLibrary = isSaved;

  const trustText = draft ? deriveSummaryText(draft.steps) : null;
  const { writeVerbs } = draft ? deriveTrustInfo(draft.steps) : { writeVerbs: [] };
  const hasWrites = writeVerbs.length > 0;

  // ── Render ────────────────────────────────────────────────────────────

  return (
    <div className="flex h-full min-h-0 overflow-hidden">

      {/* ── LEFT COLUMN: Intent ── */}
      <div
        className="shrink-0 flex flex-col h-full border-r border-[var(--border)] overflow-hidden"
        style={{ width: leftW }}
      >
        {/* Back link */}
        <div className="px-5 pt-5 pb-4 shrink-0 border-b border-[var(--border)]">
          <button
            onClick={onBack}
            className="flex items-center gap-1.5 text-[12px] text-[var(--text-faint)] hover:text-[var(--text-dim)] transition mb-4"
          >
            <ArrowLeft size={13} /> Back to library
          </button>
          <p className="text-[10px] font-mono text-[var(--text-faint)] uppercase tracking-widest mb-0.5">Studio</p>
          <h2 className="text-[14px] font-semibold text-[var(--text)]">
            {editingDraft ? `Editing: ${draft?.label || editingDraft.name}` : 'Teach a workflow'}
          </h2>
        </div>

        {/* Description textarea — always stays here */}
        <div className="flex-1 overflow-y-auto px-5 py-5 min-h-0 flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <label className="text-[11px] font-medium text-[var(--text-faint)] uppercase tracking-wider">
              What recurring job should I learn?
            </label>
            <textarea
              value={description}
              onChange={(e) => {
                setDescription(e.target.value);
                if (genState === 'done') setPendingRegenerate(true);
              }}
              rows={6}
              disabled={isGenerating}
              placeholder="Every Friday at 4pm, summarize what I shipped this week from my calendar, recent docs, and sent emails — then draft a note to my manager."
              className="w-full rounded-[12px] border border-[var(--border)] bg-[var(--surface)] px-3.5 py-3 text-[13px] text-[var(--text)] outline-none focus:border-[var(--accent)]/50 transition-colors resize-none placeholder:text-[var(--text-faint)] leading-relaxed disabled:opacity-60"
            />
            <p className="text-[11px] text-[var(--text-faint)]">
              Mention when it should run, what to look at, and what to produce.
            </p>
          </div>

          {/* Generate / Regenerate button */}
          <button
            onClick={() => generate(description)}
            disabled={!hasDescription || isGenerating}
            className={`flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-[13px] font-medium transition disabled:opacity-40 disabled:cursor-not-allowed ${
              pendingRegenerate
                ? 'border border-[var(--accent)]/40 text-[var(--accent)] bg-[var(--accent)]/8 hover:bg-[var(--accent)]/12'
                : 'bg-[var(--accent)] text-black hover:brightness-110'
            }`}
          >
            {isGenerating ? (
              <><Sparkles size={13} className="animate-pulse" /> Generating…</>
            ) : pendingRegenerate ? (
              <><RefreshCw size={13} /> Regenerate with changes</>
            ) : genState === 'done' ? (
              <><RefreshCw size={13} /> Regenerate</>
            ) : (
              <><Sparkles size={13} /> Generate plan</>
            )}
          </button>

          {/* Templates */}
          <div className="pt-1">
            <p className="text-[10px] font-medium text-[var(--text-faint)] uppercase tracking-wider mb-2">
              Or start from a template
            </p>
            <div className="flex flex-col gap-0.5">
              {SUGGESTED_TEMPLATES.map((t) => (
                <button
                  key={t.id}
                  onClick={() => {
                    setDescription(t.description);
                    if (genState === 'done') setPendingRegenerate(true);
                  }}
                  className="text-left px-2.5 py-1.5 rounded-lg text-[12px] text-[var(--text-faint)] hover:text-[var(--text-dim)] hover:bg-[var(--surface-hover)] transition truncate"
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <ResizeHandle onDrag={dragLeft} />

      {/* ── CENTER COLUMN: Plan ── */}
      <div className="flex-1 min-w-0 flex flex-col h-full overflow-hidden">
        {/* Column header */}
        <div className="px-6 pt-5 pb-4 border-b border-[var(--border)] shrink-0 flex items-center gap-3">
          {isGenerating ? (
            <>
              <Loader2 size={13} className="animate-spin text-[var(--accent)]" />
              <span className="text-[13px] text-[var(--text-dim)]">Generating plan…</span>
            </>
          ) : genState === 'done' && draft ? (
            <>
              <span className="text-[13px] font-medium text-[var(--text)]">Plan</span>
              <span className="text-[11px] text-[var(--text-faint)] bg-[var(--surface2)] rounded-full px-2 py-0.5">
                {draft.steps.length} step{draft.steps.length !== 1 ? 's' : ''}
              </span>
            </>
          ) : genState === 'error' ? (
            <>
              <X size={13} className="text-red-400" />
              <span className="text-[13px] text-red-400">Generation failed</span>
            </>
          ) : (
            <span className="text-[13px] text-[var(--text-faint)]">Plan will appear here</span>
          )}

          {planReady && (
            <button
              onClick={() => setChatOpen((o) => !o)}
              className={`ml-auto flex items-center gap-2 rounded-xl px-3.5 py-1.5 text-[12px] font-medium transition ${
                chatOpen
                  ? 'bg-[var(--accent)]/15 text-[var(--accent)] border border-[var(--accent)]/40'
                  : 'bg-[var(--accent)] text-black hover:brightness-110'
              }`}
            >
              <MessageSquare size={13} />
              {chatOpen ? 'Close chat' : 'Chat with agent'}
            </button>
          )}

          {!planReady && testLaunched && !isSaved && (
            <div className="ml-auto flex items-center gap-1.5 text-[11px] text-[var(--text-faint)] bg-[var(--surface2)] rounded-full px-3 py-1">
              <div className="h-1.5 w-1.5 rounded-full bg-[var(--accent)] animate-pulse" />
              Running in chat — review the chat panel
            </div>
          )}
        </div>

        {/* Plan content */}
        <div className="flex-1 overflow-y-auto px-6 py-5 min-h-0">

          {/* Idle — prompt to start */}
          {genState === 'idle' && (
            <div className="flex flex-col items-center justify-center h-full text-center py-16">
              <div className="h-12 w-12 rounded-xl bg-[var(--surface2)] border border-[var(--border)] flex items-center justify-center mb-4">
                <Sparkles size={20} className="text-[var(--text-faint)]" />
              </div>
              <p className="text-[14px] text-[var(--text-dim)] mb-1">Your plan will appear here</p>
              <p className="text-[12px] text-[var(--text-faint)]">
                Describe the workflow on the left, then click Generate plan.
              </p>
            </div>
          )}

          {/* Generating — live activity feed */}
          {isGenerating && (() => {
            const info = parseStreamInfo(streamingText);
            const hasStructure = !!info.label || !!info.description;
            const hasSteps = info.actions.length > 0;
            return (
              <div className="rounded-[14px] border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
                {/* Terminal title bar */}
                <div className="flex items-center gap-2 px-4 py-2.5 border-b border-[var(--border)] bg-[var(--surface2)]">
                  <div className="flex gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-[var(--border2)]" />
                    <span className="h-2 w-2 rounded-full bg-[var(--border2)]" />
                    <span className="h-2 w-2 rounded-full bg-[var(--border2)]" />
                  </div>
                  <span className="font-mono text-[10px] text-[var(--text-faint)] ml-1 tracking-wide">generating plan…</span>
                  <Loader2 size={10} className="animate-spin text-[var(--accent)] ml-auto" />
                </div>

                {/* Activity lines */}
                <div className="px-4 py-4 space-y-2.5 min-h-[140px] overflow-y-auto max-h-[420px]">

                  {/* Phase 1: reading the description */}
                  <ActivityLine
                    done={hasStructure || hasSteps}
                    text="Reading your description…"
                  />

                  {/* Phase 2: naming + describing the workflow */}
                  {(hasStructure || hasSteps) && (
                    <ActivityLine
                      done={hasSteps}
                      text="Designing the workflow structure…"
                    />
                  )}
                  {info.label && (
                    <ActivityLine indent done={hasSteps} text="Name" sub={`"${info.label}"`} />
                  )}
                  {info.description && (
                    <ActivityLine indent done={hasSteps} text="Goal" sub={`"${info.description}"`} />
                  )}

                  {/* Phase 3: steps */}
                  {hasSteps && (
                    <ActivityLine
                      done={false}
                      text={`Sequencing ${info.actions.length} step${info.actions.length !== 1 ? 's' : ''}…`}
                    />
                  )}
                  {info.actions.map((action, i) => (
                    <ActivityLine
                      key={i}
                      indent
                      done={i < info.actions.length - 1}
                      text={`Step ${i + 1}`}
                      sub={action}
                    />
                  ))}

                  <div ref={streamEndRef} />
                </div>
              </div>
            );
          })()}

          {/* Error */}
          {genState === 'error' && (
            <div className="rounded-[14px] border border-red-500/20 bg-red-500/5 px-4 py-4">
              <p className="text-[13px] text-red-400 mb-1">{genError}</p>
              <button
                onClick={() => generate(description)}
                className="text-[12px] text-red-400/70 hover:text-red-400 transition underline underline-offset-2"
              >
                Try again
              </button>
            </div>
          )}

          {/* Plan ready */}
          {genState === 'done' && draft && (
            <div className="space-y-5">
              {/* Editable name + description */}
              <div className="space-y-2.5">
                <input
                  value={draft.label || draft.name}
                  onChange={(e) => setDraft({ ...draft, label: e.target.value })}
                  className="w-full rounded-xl border border-[var(--border)] bg-transparent px-3 py-2 text-[17px] font-semibold text-[var(--text)] outline-none focus:border-[var(--accent)]/50 transition-colors"
                  placeholder="Workflow name"
                />
                <input
                  value={draft.description}
                  onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                  className="w-full rounded-xl border border-[var(--border)] bg-transparent px-3 py-2 text-[13px] text-[var(--text-dim)] outline-none focus:border-[var(--accent)]/50 transition-colors"
                  placeholder="What this workflow does…"
                />
              </div>

              {/* Steps */}
              <div>
                {draft.steps.map((step, i) => (
                  <StepRow
                    key={i}
                    step={step}
                    index={i}
                    total={draft.steps.length}
                    isLast={i === draft.steps.length - 1}
                  />
                ))}
              </div>

              {/* Advanced editor */}
              <AdvancedWorkflowEditor
                name={draft.name}
                parameters={JSON.stringify(draft.parameters ?? {}, null, 2)}
                steps={advSteps}
                isWriteTool={draft.isWriteTool ?? false}
                actions={actions}
                onChangeName={(v) => setDraft({ ...draft, name: v })}
                onChangeParameters={(v) => {
                  try { setDraft({ ...draft, parameters: JSON.parse(v) }); } catch { /* ignore mid-edit */ }
                }}
                onChangeSteps={syncAdvToSteps}
                onChangeIsWriteTool={(v) => setDraft({ ...draft, isWriteTool: v })}
              />
            </div>
          )}
        </div>

        {/* ── Studio Chat Panel ── */}
        {chatOpen && planReady && (
          <div className="h-72 shrink-0 flex flex-col border-t border-[var(--border)]">
            <div
              className="flex-1 overflow-y-auto px-4 py-3 space-y-2"
              role="log"
              aria-live="polite"
            >
              {chatMessages.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  {msg.content === '__loading__' ? (
                    <div className="flex items-center gap-1.5 rounded-[10px] rounded-tl-sm bg-[var(--surface2)] px-3 py-2">
                      <Loader2 size={11} className="animate-spin text-[var(--accent)]" />
                      <span className="text-[12px] text-[var(--text-faint)]">Updating workflow…</span>
                    </div>
                  ) : (
                    <div className={`max-w-[85%] rounded-[10px] px-3 py-2 text-[12px] text-[var(--text)] ${
                      msg.role === 'user'
                        ? 'rounded-tr-sm bg-[var(--accent)]/12'
                        : 'rounded-tl-sm bg-[var(--surface2)]'
                    }`}>
                      {msg.content}
                    </div>
                  )}
                </div>
              ))}
              <div ref={chatEndRef} />
            </div>
            <div className="shrink-0 border-t border-[var(--border)] px-3 py-2 flex gap-2 items-end">
              <textarea
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void handleRefine();
                  }
                }}
                disabled={refineState === 'loading'}
                rows={1}
                placeholder="What to change?"
                className="flex-1 resize-none rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[12px] text-[var(--text)] outline-none focus:border-[var(--accent)]/50 transition-colors placeholder:text-[var(--text-faint)] disabled:opacity-60 max-h-20"
              />
              <button
                onClick={() => void handleRefine()}
                disabled={!chatInput.trim() || refineState === 'loading'}
                aria-label="Send"
                className="shrink-0 flex items-center justify-center h-8 w-8 rounded-xl bg-[var(--accent)] text-black transition hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Send size={13} />
              </button>
            </div>
          </div>
        )}

        <AutomatePanel workflowName={draft?.name ?? ''} workflowSaved={saveState === 'saved' && !!draft?.name} />
      </div>

      <ResizeHandle onDrag={dragRight} />

      {/* ── RIGHT COLUMN: Status + Actions ── */}
      <div
        className="shrink-0 flex flex-col h-full border-l border-[var(--border)] overflow-hidden"
        style={{ width: rightW }}
      >
        <div className="px-5 pt-5 pb-4 border-b border-[var(--border)] shrink-0">
          <p className="text-[10px] font-mono text-[var(--text-faint)] uppercase tracking-widest mb-0.5">Status</p>
          <h3 className="text-[14px] font-semibold text-[var(--text)]">
            {isSaved ? 'Saved to library' : planReady ? 'Ready to save' : isGenerating ? 'Generating…' : 'Waiting'}
          </h3>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-5 min-h-0 flex flex-col gap-6">

          {/* Progress milestones */}
          <div className="space-y-3">
            <Milestone done={descriptionWritten} active={!descriptionWritten} label="Description written" />
            <div className="ml-2.5 w-px h-3 bg-[var(--border)]" />
            <Milestone done={planGenerated} active={isGenerating} label="Plan generated" />
            <div className="ml-2.5 w-px h-3 bg-[var(--border)]" />
            <Milestone done={savedToLibrary} active={planReady && !savedToLibrary} label="Saved to library" />
          </div>

          {/* Trust summary */}
          {draft && draft.steps.length > 0 && (
            <div>
              <p className="text-[10px] font-medium text-[var(--text-faint)] uppercase tracking-wider mb-2">Trust</p>
              <div className={`flex items-start gap-2.5 rounded-[12px] border px-3.5 py-3 ${
                hasWrites ? 'border-amber-500/20 bg-amber-500/5' : 'border-blue-500/20 bg-blue-500/5'
              }`}>
                <Shield size={13} className={`mt-0.5 shrink-0 ${hasWrites ? 'text-amber-400' : 'text-blue-400'}`} />
                <p className={`text-[12px] leading-relaxed ${hasWrites ? 'text-[var(--amber)]' : 'text-[var(--blue)]'}`}>
                  {trustText}
                </p>
              </div>
            </div>
          )}

          {/* Save error */}
          {saveState === 'error' && saveError && (
            <div className="rounded-[10px] border border-red-500/20 bg-red-500/5 px-3 py-2.5">
              <p className="text-[12px] text-red-400">{saveError}</p>
            </div>
          )}

          {/* Action buttons */}
          <div className="flex flex-col gap-2 mt-auto">
            {isSaved ? (
              <button
                onClick={onBack}
                className="flex items-center justify-center gap-2 rounded-xl border border-[var(--accent)]/30 px-4 py-2.5 text-[13px] text-[var(--accent)] transition hover:bg-[var(--accent)]/8"
              >
                <ChevronRight size={14} /> View in library
              </button>
            ) : (
              <>
                <button
                  onClick={handleSave}
                  disabled={!planReady || saveState === 'saving'}
                  className="flex items-center justify-center gap-2 rounded-xl bg-[var(--accent)] px-4 py-2.5 text-[13px] font-medium text-black transition hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {saveState === 'saving'
                    ? <><Loader2 size={13} className="animate-spin" /> Saving…</>
                    : <><Save size={13} /> Save workflow</>
                  }
                </button>
                <button
                  onClick={handleTryInChat}
                  disabled={!planReady}
                  className="flex items-center justify-center gap-2 rounded-xl border border-[var(--border)] px-4 py-2.5 text-[13px] text-[var(--text-dim)] transition hover:bg-[var(--surface-hover)] hover:text-[var(--text)] disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Play size={13} /> Try it in chat
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
