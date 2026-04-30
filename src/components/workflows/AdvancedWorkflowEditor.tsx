import { useState } from 'react';
import { ChevronDown, ChevronRight, Plus, X, ArrowUp, ArrowDown } from 'lucide-react';
import type { DynamicToolItem } from '../../services/api';

interface ToolStepDraft {
  action: string;
  args: Record<string, string>;
  outputKey: string;
}

interface Props {
  name: string;
  parameters: string; // JSON string
  steps: ToolStepDraft[];
  isWriteTool: boolean;
  actions: string[];
  onChangeName: (v: string) => void;
  onChangeParameters: (v: string) => void;
  onChangeSteps: (steps: ToolStepDraft[]) => void;
  onChangeIsWriteTool: (v: boolean) => void;
}

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

export default function AdvancedWorkflowEditor({
  name,
  parameters,
  steps,
  isWriteTool,
  actions,
  onChangeName,
  onChangeParameters,
  onChangeSteps,
  onChangeIsWriteTool,
}: Props) {
  const [open, setOpen] = useState(false);
  const [paramsError, setParamsError] = useState<string | null>(null);

  const updateStep = (index: number, updated: ToolStepDraft) => {
    onChangeSteps(steps.map((s, i) => (i === index ? updated : s)));
  };

  const removeStep = (index: number) => {
    onChangeSteps(steps.filter((_, i) => i !== index));
  };

  const moveStep = (index: number, dir: 'up' | 'down') => {
    const next = [...steps];
    const target = dir === 'up' ? index - 1 : index + 1;
    [next[index], next[target]] = [next[target], next[index]];
    onChangeSteps(next);
  };

  const addStep = () => {
    if (steps.length >= 10) return;
    onChangeSteps([...steps, { action: '', args: {}, outputKey: '' }]);
  };

  const validateParams = (json: string) => {
    try {
      JSON.parse(json);
      setParamsError(null);
    } catch {
      setParamsError('Invalid JSON');
    }
  };

  return (
    <div className="border-t border-[var(--border)] pt-4">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-[12px] text-[var(--text-faint)] hover:text-[var(--text-dim)] transition"
      >
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        Advanced
      </button>

      {open && (
        <div className="mt-4 space-y-4">
          {/* Internal name */}
          <div>
            <div className="text-[11px] font-medium text-[var(--text-dim)] uppercase tracking-wider mb-1.5">Internal name</div>
            <input
              value={name}
              onChange={(e) => onChangeName(e.target.value)}
              placeholder="my_workflow_name (lowercase, underscores)"
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[13px] text-[var(--text)] outline-none focus:border-[var(--accent)] transition-colors font-mono"
            />
            {name && !/^[a-z][a-z0-9_]*$/.test(name) && (
              <p className="mt-1 text-[11px] text-[var(--error)]">Must start with a letter, only lowercase + underscores</p>
            )}
          </div>

          {/* Parameters JSON */}
          <div>
            <div className="text-[11px] font-medium text-[var(--text-dim)] uppercase tracking-wider mb-1.5">
              Parameters <span className="normal-case tracking-normal font-normal">(JSON Schema)</span>
            </div>
            <textarea
              value={parameters}
              onChange={(e) => {
                onChangeParameters(e.target.value);
                setParamsError(null);
              }}
              onBlur={() => validateParams(parameters)}
              rows={3}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[12px] text-[var(--text)] outline-none focus:border-[var(--accent)] transition-colors resize-none font-mono"
              placeholder={'{\n  "type": "object",\n  "properties": { "query": { "type": "string" } }\n}'}
            />
            {paramsError && <p className="mt-1 text-[11px] text-[var(--error)]">{paramsError}</p>}
          </div>

          {/* Ask before each run override */}
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={isWriteTool}
              onChange={(e) => onChangeIsWriteTool(e.target.checked)}
              className="accent-[var(--accent)] cursor-pointer"
              id="adv-write-tool-toggle"
            />
            <label htmlFor="adv-write-tool-toggle" className="text-[13px] text-[var(--text-dim)] cursor-pointer">
              Ask me before each run
            </label>
          </div>

          {/* Step editor */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="text-[11px] font-medium text-[var(--text-dim)] uppercase tracking-wider">
                Steps ({steps.length}/10)
              </div>
              {steps.length < 10 && (
                <button onClick={addStep} className="flex items-center gap-1 text-[11px] text-[var(--accent)] hover:text-white transition">
                  <Plus size={12} /> Add step
                </button>
              )}
            </div>
            <div className="space-y-2">
              {steps.map((step, i) => (
                <StepEditor
                  key={i}
                  step={step}
                  index={i}
                  total={steps.length}
                  actions={actions}
                  onChange={(updated) => updateStep(i, updated)}
                  onRemove={() => removeStep(i)}
                  onMove={(dir) => moveStep(i, dir)}
                />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export type { ToolStepDraft };
