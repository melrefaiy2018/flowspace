import { useState, useCallback } from 'react';
import {
  ChevronDown,
  ChevronUp,
  PencilLine,
  Trash2,
  Wrench,
  Plus,
  X,
  Check,
  Loader2,
  ArrowUp,
  ArrowDown,
} from 'lucide-react';
import type { DynamicToolItem } from '../services/api';

interface ToolStepDraft {
  action: string;
  args: Record<string, string>;
  outputKey: string;
}

interface SkillFormState {
  name: string;
  description: string;
  label: string;
  isWriteTool: boolean;
  parameters: string; // JSON string
  steps: ToolStepDraft[];
}

function emptyStep(): ToolStepDraft {
  return { action: '', args: {}, outputKey: '' };
}

function toolToForm(tool: DynamicToolItem): SkillFormState {
  return {
    name: tool.name,
    description: tool.description,
    label: tool.label ?? '',
    isWriteTool: tool.isWriteTool,
    parameters: JSON.stringify(tool.parameters, null, 2),
    steps: tool.steps.map((s) => ({
      action: s.action,
      args: Object.fromEntries(Object.entries(s.args).map(([k, v]) => [k, String(v)])),
      outputKey: s.outputKey ?? '',
    })),
  };
}

function emptyForm(): SkillFormState {
  return {
    name: '',
    description: '',
    label: '',
    isWriteTool: false,
    parameters: '{}',
    steps: [emptyStep()],
  };
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return iso;
  }
}

function formatToolName(tool: DynamicToolItem): string {
  if (tool.label) return tool.label;
  return tool.name.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

// ── Step Editor ──────────────────────────────────────────────────────

function StepEditor({
  step,
  index,
  total,
  actions,
  onChange,
  onRemove,
  onMove,
}: {
  step: ToolStepDraft;
  index: number;
  total: number;
  actions: string[];
  onChange: (updated: ToolStepDraft) => void;
  onRemove: () => void;
  onMove: (dir: 'up' | 'down') => void;
}) {
  const [newArgKey, setNewArgKey] = useState('');

  const addArg = () => {
    const key = newArgKey.trim();
    if (!key || key in step.args) return;
    onChange({ ...step, args: { ...step.args, [key]: '' } });
    setNewArgKey('');
  };

  const removeArg = (key: string) => {
    const { [key]: _, ...rest } = step.args;
    onChange({ ...step, args: rest });
  };

  const updateArgValue = (key: string, value: string) => {
    onChange({ ...step, args: { ...step.args, [key]: value } });
  };

  return (
    <div className="rounded-[14px] border border-white/8 bg-black/20 p-3">
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="text-[11px] font-semibold text-[var(--text-faint)] uppercase tracking-wider">
          Step {index + 1}
        </span>
        <div className="flex items-center gap-1">
          {index > 0 && (
            <button onClick={() => onMove('up')} className="p-1 text-[var(--text-faint)] hover:text-white transition" title="Move up">
              <ArrowUp size={12} />
            </button>
          )}
          {index < total - 1 && (
            <button onClick={() => onMove('down')} className="p-1 text-[var(--text-faint)] hover:text-white transition" title="Move down">
              <ArrowDown size={12} />
            </button>
          )}
          <button onClick={onRemove} className="p-1 text-[var(--text-faint)] hover:text-[var(--error)] transition" title="Remove step">
            <X size={12} />
          </button>
        </div>
      </div>

      <select
        value={step.action}
        onChange={(e) => onChange({ ...step, action: e.target.value })}
        className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[13px] text-[var(--text)] outline-none focus:border-[var(--accent)] transition-colors mb-2"
      >
        <option value="">Select action...</option>
        {actions.map((a) => <option key={a} value={a}>{a}</option>)}
      </select>

      <div className="space-y-1.5 mb-2">
        {Object.entries(step.args).map(([key, value]) => (
          <div key={key} className="flex items-center gap-1.5">
            <code className="text-[11px] text-[var(--text-dim)] bg-[var(--surface2)] px-1.5 py-1 rounded min-w-[80px]">{key}</code>
            <input
              value={value}
              onChange={(e) => updateArgValue(key, e.target.value)}
              className="flex-1 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-[12px] text-[var(--text)] outline-none focus:border-[var(--accent)] font-mono"
              placeholder="value or {{template}}"
            />
            <button onClick={() => removeArg(key)} className="p-1 text-[var(--text-faint)] hover:text-[var(--error)] transition">
              <X size={11} />
            </button>
          </div>
        ))}
        <div className="flex items-center gap-1.5">
          <input
            value={newArgKey}
            onChange={(e) => setNewArgKey(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addArg()}
            placeholder="new arg name"
            className="rounded-md border border-dashed border-[var(--border)] bg-transparent px-2 py-1 text-[12px] text-[var(--text-dim)] outline-none focus:border-[var(--accent)] min-w-[80px] w-[120px]"
          />
          <button onClick={addArg} className="text-[var(--text-faint)] hover:text-[var(--accent)] transition p-1" title="Add argument">
            <Plus size={12} />
          </button>
        </div>
      </div>

      <input
        value={step.outputKey}
        onChange={(e) => onChange({ ...step, outputKey: e.target.value })}
        placeholder="outputKey (optional)"
        className="w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-[12px] text-[var(--text)] outline-none focus:border-[var(--accent)] font-mono"
      />
    </div>
  );
}

// ── Main SkillCard ───────────────────────────────────────────────────

interface SkillCardProps {
  tool?: DynamicToolItem;
  mode?: 'view' | 'create';
  expanded?: boolean;
  editing?: boolean;
  actions: string[];
  onToggleExpand?: () => void;
  onStartEdit?: () => void;
  onCancelEdit?: () => void;
  onSave?: (tool: DynamicToolItem) => void;
  onCreate?: (form: SkillFormState) => void;
  onDelete?: () => void;
  onCancelCreate?: () => void;
  saving?: boolean;
  error?: string | null;
}

export default function SkillCard({
  tool,
  mode = 'view',
  expanded = false,
  editing = false,
  actions,
  onToggleExpand,
  onStartEdit,
  onCancelEdit,
  onSave,
  onCreate,
  onDelete,
  onCancelCreate,
  saving = false,
  error,
}: SkillCardProps) {
  const isCreate = mode === 'create';
  const [form, setForm] = useState<SkillFormState>(
    isCreate ? emptyForm() : tool ? toolToForm(tool) : emptyForm(),
  );
  const [paramsError, setParamsError] = useState<string | null>(null);

  const resetForm = useCallback(() => {
    if (tool) setForm(toolToForm(tool));
  }, [tool]);

  const updateStep = (index: number, updated: ToolStepDraft) => {
    setForm((prev) => ({
      ...prev,
      steps: prev.steps.map((s, i) => (i === index ? updated : s)),
    }));
  };

  const removeStep = (index: number) => {
    setForm((prev) => ({ ...prev, steps: prev.steps.filter((_, i) => i !== index) }));
  };

  const moveStep = (index: number, dir: 'up' | 'down') => {
    setForm((prev) => {
      const steps = [...prev.steps];
      const target = dir === 'up' ? index - 1 : index + 1;
      [steps[index], steps[target]] = [steps[target], steps[index]];
      return { ...prev, steps };
    });
  };

  const addStep = () => {
    if (form.steps.length >= 10) return;
    setForm((prev) => ({ ...prev, steps: [...prev.steps, emptyStep()] }));
  };

  const validateParams = (json: string): boolean => {
    try {
      JSON.parse(json);
      setParamsError(null);
      return true;
    } catch {
      setParamsError('Invalid JSON');
      return false;
    }
  };

  const handleSave = () => {
    if (!validateParams(form.parameters)) return;
    if (isCreate && onCreate) {
      onCreate(form);
    } else if (tool && onSave) {
      onSave({
        ...tool,
        description: form.description,
        label: form.label || undefined,
        isWriteTool: form.isWriteTool,
        parameters: JSON.parse(form.parameters),
        steps: form.steps.map((s) => ({
          action: s.action,
          args: s.args,
          ...(s.outputKey ? { outputKey: s.outputKey } : {}),
        })),
      });
    }
  };

  const handleCancel = () => {
    if (isCreate) {
      onCancelCreate?.();
    } else {
      resetForm();
      onCancelEdit?.();
    }
  };

  // ── Create / Edit form ──────────────────────────────────────────────

  if (isCreate || editing) {
    return (
      <div className="rounded-[var(--radius-md)] border border-[var(--accent)]/30 bg-[var(--surface)] p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-[15px] font-semibold text-white">
            {isCreate ? 'Create New Skill' : `Editing: ${formatToolName(tool!)}`}
          </h3>
          <button onClick={handleCancel} className="text-[var(--text-faint)] hover:text-white transition p-1">
            <X size={16} />
          </button>
        </div>

        {isCreate && (
          <div>
            <div className="text-[11px] font-medium text-[var(--text-dim)] uppercase tracking-wider mb-1.5">Name</div>
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="my_skill_name (lowercase, underscores)"
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[13px] text-[var(--text)] outline-none focus:border-[var(--accent)] transition-colors font-mono"
            />
            {form.name && !/^[a-z][a-z0-9_]*$/.test(form.name) && (
              <p className="mt-1 text-[11px] text-[var(--error)]">Must start with a letter, only lowercase + underscores</p>
            )}
          </div>
        )}

        <div>
          <div className="text-[11px] font-medium text-[var(--text-dim)] uppercase tracking-wider mb-1.5">Label</div>
          <input
            value={form.label}
            onChange={(e) => setForm({ ...form, label: e.target.value })}
            placeholder="Human-readable display name"
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[13px] text-[var(--text)] outline-none focus:border-[var(--accent)] transition-colors"
          />
        </div>

        <div>
          <div className="text-[11px] font-medium text-[var(--text-dim)] uppercase tracking-wider mb-1.5">Description</div>
          <textarea
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            placeholder="What this skill does (shown to the AI agent)"
            rows={2}
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[13px] text-[var(--text)] outline-none focus:border-[var(--accent)] transition-colors resize-none"
          />
        </div>

        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={form.isWriteTool}
            onChange={(e) => setForm({ ...form, isWriteTool: e.target.checked })}
            className="accent-[var(--accent)] cursor-pointer"
            id="write-tool-toggle"
          />
          <label htmlFor="write-tool-toggle" className="text-[13px] text-[var(--text-dim)] cursor-pointer">
            Requires approval (write tool)
          </label>
        </div>

        <div>
          <div className="text-[11px] font-medium text-[var(--text-dim)] uppercase tracking-wider mb-1.5">
            Parameters <span className="normal-case tracking-normal font-normal">(JSON Schema)</span>
          </div>
          <textarea
            value={form.parameters}
            onChange={(e) => {
              setForm({ ...form, parameters: e.target.value });
              setParamsError(null);
            }}
            onBlur={() => validateParams(form.parameters)}
            rows={3}
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[12px] text-[var(--text)] outline-none focus:border-[var(--accent)] transition-colors resize-none font-mono"
            placeholder={'{\n  "type": "object",\n  "properties": { "query": { "type": "string" } }\n}'}
          />
          {paramsError && <p className="mt-1 text-[11px] text-[var(--error)]">{paramsError}</p>}
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <div className="text-[11px] font-medium text-[var(--text-dim)] uppercase tracking-wider">
              Steps ({form.steps.length}/10)
            </div>
            {form.steps.length < 10 && (
              <button onClick={addStep} className="flex items-center gap-1 text-[11px] text-[var(--accent)] hover:text-white transition">
                <Plus size={12} /> Add step
              </button>
            )}
          </div>
          <div className="space-y-2">
            {form.steps.map((step, i) => (
              <StepEditor
                key={i}
                step={step}
                index={i}
                total={form.steps.length}
                actions={actions}
                onChange={(updated) => updateStep(i, updated)}
                onRemove={() => removeStep(i)}
                onMove={(dir) => moveStep(i, dir)}
              />
            ))}
          </div>
        </div>

        {error && (
          <p className="text-[12px] text-[var(--error)] bg-[var(--error)]/10 border border-[var(--error)]/20 rounded-lg px-3 py-2">{error}</p>
        )}

        <div className="flex items-center gap-2 pt-1">
          <button
            onClick={handleSave}
            disabled={saving || (isCreate && (!form.name || !form.description || form.steps.length === 0))}
            className="flex items-center gap-1.5 rounded-lg bg-[var(--accent)] px-4 py-2 text-[13px] font-medium text-black transition hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            {isCreate ? 'Create' : 'Save'}
          </button>
          <button
            onClick={handleCancel}
            className="rounded-lg border border-[var(--border)] px-4 py-2 text-[13px] text-[var(--text-dim)] transition hover:bg-white/[0.04]"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  // ── Collapsed / Expanded view ─────────────────────────────────────

  if (!tool) return null;

  return (
    <div className="group rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] transition-colors hover:border-[var(--border2)]">
      {/* Header (always visible) */}
      <div
        className="flex items-start justify-between gap-3 p-4 cursor-pointer"
        onClick={onToggleExpand}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <Wrench size={14} className="text-[var(--text-dim)] shrink-0" />
            <span className="text-[15px] font-semibold text-[var(--text)] truncate">
              {formatToolName(tool)}
            </span>
            {tool.isWriteTool && (
              <span className="rounded-full border border-[var(--amber)]/40 bg-[var(--amber)]/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.06em] text-[var(--amber)]">
                Write
              </span>
            )}
          </div>
          <p className="text-[13px] text-[var(--text-dim)] line-clamp-2">{tool.description}</p>
          <div className="flex items-center gap-3 mt-2 text-[12px] text-[var(--text-faint)]">
            <span>{tool.steps.length} step{tool.steps.length !== 1 ? 's' : ''}</span>
            <span>·</span>
            <span>Created {formatDate(tool.createdAt)}</span>
            <span>·</span>
            <code className="text-[11px] bg-[var(--surface2)] px-1.5 py-0.5 rounded font-mono">{tool.name}</code>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={(e) => { e.stopPropagation(); onStartEdit?.(); }}
            className="h-7 w-7 rounded-md text-[var(--text-faint)] hover:text-[var(--accent)] hover:bg-[var(--accent)]/10 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-all flex items-center justify-center"
            title="Edit"
          >
            <PencilLine size={13} />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onDelete?.(); }}
            className="h-7 w-7 rounded-md text-[var(--text-faint)] hover:text-[var(--error)] hover:bg-[var(--error)]/10 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-all flex items-center justify-center"
            title="Delete"
          >
            <Trash2 size={13} />
          </button>
          {expanded ? <ChevronUp size={14} className="text-[var(--text-faint)]" /> : <ChevronDown size={14} className="text-[var(--text-faint)]" />}
        </div>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div className="border-t border-[var(--border)] px-4 py-4 space-y-4">
          {/* Parameters */}
          {tool.parameters && Object.keys(tool.parameters).length > 0 && (
            <div>
              <div className="text-[11px] font-medium text-[var(--text-dim)] uppercase tracking-wider mb-2">Parameters</div>
              <pre className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-[11px] text-[var(--text-dim)] font-mono overflow-x-auto">
                {JSON.stringify(tool.parameters, null, 2)}
              </pre>
            </div>
          )}

          {/* Steps timeline */}
          <div>
            <div className="text-[11px] font-medium text-[var(--text-dim)] uppercase tracking-wider mb-2">Workflow Steps</div>
            <div className="space-y-2">
              {tool.steps.map((step, i) => (
                <div key={i} className="flex gap-3">
                  <div className="flex flex-col items-center">
                    <div className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--accent)]/15 text-[10px] font-bold text-[var(--accent)]">
                      {i + 1}
                    </div>
                    {i < tool.steps.length - 1 && <div className="w-px flex-1 bg-[var(--border)] mt-1" />}
                  </div>
                  <div className="flex-1 pb-3">
                    <code className="text-[13px] font-semibold text-white font-mono">{step.action}</code>
                    {Object.keys(step.args).length > 0 && (
                      <div className="mt-1.5 space-y-1">
                        {Object.entries(step.args).map(([key, value]) => (
                          <div key={key} className="flex items-start gap-2 text-[11px]">
                            <code className="text-[var(--text-faint)] bg-[var(--surface2)] px-1 py-0.5 rounded shrink-0">{key}</code>
                            <code className="text-[var(--text-dim)] font-mono break-all">{value}</code>
                          </div>
                        ))}
                      </div>
                    )}
                    {step.outputKey && (
                      <div className="mt-1 text-[10px] text-[var(--text-faint)]">
                        → stores as <code className="text-[var(--blue)]">{step.outputKey}</code>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export type { SkillFormState };
