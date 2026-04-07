import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, Loader2, Plus, Puzzle } from 'lucide-react';
import { api, type DynamicToolItem } from '../services/api';
import SkillCard, { type SkillFormState } from '../components/SkillCard';

type LoadState = 'loading' | 'loaded' | 'error';

export default function SkillsPage() {
  const [tools, setTools] = useState<DynamicToolItem[]>([]);
  const [actions, setActions] = useState<string[]>([]);
  const [state, setState] = useState<LoadState>('loading');
  const [expandedTool, setExpandedTool] = useState<string | null>(null);
  const [editingTool, setEditingTool] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState('loading');
    try {
      const [toolsRes, actionsRes] = await Promise.all([
        api.getDynamicTools(),
        api.getDynamicToolActions(),
      ]);
      setTools(toolsRes.tools);
      setActions(actionsRes.actions);
      setState('loaded');
    } catch {
      setState('error');
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleDelete = async (name: string) => {
    const confirmed = window.confirm(`Delete skill "${name}"? This cannot be undone.`);
    if (!confirmed) return;
    try {
      await api.deleteDynamicTool(name);
      setTools((prev) => prev.filter((t) => t.name !== name));
      if (expandedTool === name) setExpandedTool(null);
      if (editingTool === name) setEditingTool(null);
    } catch {
      load();
    }
  };

  const handleSave = async (tool: DynamicToolItem) => {
    setSaving(true);
    setSaveError(null);
    try {
      const { name, description, label, isWriteTool, parameters, steps } = tool;
      const result = await api.updateDynamicTool(name, { description, label, isWriteTool, parameters, steps });
      setTools((prev) => prev.map((t) => (t.name === name ? result.tool : t)));
      setEditingTool(null);
    } catch (err: any) {
      setSaveError(err?.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleCreate = async (form: SkillFormState) => {
    setSaving(true);
    setSaveError(null);
    try {
      let params: Record<string, unknown> = {};
      try {
        params = JSON.parse(form.parameters);
      } catch {
        setSaveError('Invalid JSON in parameters');
        setSaving(false);
        return;
      }
      const result = await api.createDynamicTool({
        name: form.name,
        description: form.description,
        label: form.label || undefined,
        isWriteTool: form.isWriteTool,
        parameters: params,
        steps: form.steps.map((s) => ({
          action: s.action,
          args: s.args,
          ...(s.outputKey ? { outputKey: s.outputKey } : {}),
        })),
      });
      setTools((prev) => [...prev, result.tool]);
      setShowCreate(false);
    } catch (err: any) {
      setSaveError(err?.message || 'Failed to create skill');
    } finally {
      setSaving(false);
    }
  };

  const toggleExpand = (name: string) => {
    setExpandedTool((prev) => (prev === name ? null : name));
    if (editingTool === name) setEditingTool(null);
  };

  const startEdit = (name: string) => {
    setEditingTool(name);
    setExpandedTool(null);
    setSaveError(null);
  };

  if (state === 'loading') {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="flex items-center gap-2 text-[var(--text-faint)]">
          <Loader2 size={16} className="animate-spin" />
          <span className="text-[14px]">Loading skills...</span>
        </div>
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="flex items-center gap-2 text-[var(--error)]">
          <AlertCircle size={16} />
          <span className="text-[14px]">Failed to load skills</span>
        </div>
      </div>
    );
  }

  return (
    <div className="px-6 pt-10 pb-12 max-w-[900px] mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between mb-7">
        <div>
          <h2 className="text-[22px] font-semibold tracking-tight text-[var(--text)]">Custom Skills</h2>
          <p className="mt-1 text-[13px] text-[var(--text-dim)]">
            Tools created by the AI agent to handle complex workflows. View, edit, or create your own.
          </p>
        </div>
        {!showCreate && (
          <button
            onClick={() => { setShowCreate(true); setEditingTool(null); setSaveError(null); }}
            className="flex items-center gap-1.5 rounded-lg bg-[var(--accent)] px-3.5 py-2 text-[13px] font-medium text-black transition hover:brightness-110 shrink-0"
          >
            <Plus size={14} />
            Create Skill
          </button>
        )}
      </div>

      {/* Create form */}
      {showCreate && (
        <div className="mb-4">
          <SkillCard
            mode="create"
            actions={actions}
            onCreate={handleCreate}
            onCancelCreate={() => { setShowCreate(false); setSaveError(null); }}
            saving={saving}
            error={saveError}
          />
        </div>
      )}

      {/* Skills list */}
      {tools.length === 0 && !showCreate ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="h-12 w-12 rounded-full bg-[var(--surface2)] flex items-center justify-center mb-4">
            <Puzzle size={20} className="text-[var(--text-faint)]" />
          </div>
          <p className="text-[14px] text-[var(--text-dim)] mb-1">No custom skills yet</p>
          <p className="text-[12px] text-[var(--text-faint)] max-w-[340px] mb-4">
            Ask the agent to do something complex — like "create an expense tracker" — and it will build a reusable skill automatically.
          </p>
          <button
            onClick={() => { setShowCreate(true); setSaveError(null); }}
            className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3.5 py-2 text-[13px] text-[var(--text-dim)] transition hover:bg-white/[0.04] hover:text-white"
          >
            <Plus size={14} />
            Create your first skill
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3">
          {tools.map((tool) => (
            <SkillCard
              key={tool.name}
              tool={tool}
              actions={actions}
              expanded={expandedTool === tool.name}
              editing={editingTool === tool.name}
              onToggleExpand={() => toggleExpand(tool.name)}
              onStartEdit={() => startEdit(tool.name)}
              onCancelEdit={() => { setEditingTool(null); setSaveError(null); }}
              onSave={handleSave}
              onDelete={() => handleDelete(tool.name)}
              saving={saving && editingTool === tool.name}
              error={editingTool === tool.name ? saveError : null}
            />
          ))}
        </div>
      )}
    </div>
  );
}
