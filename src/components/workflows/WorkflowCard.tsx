import { Play, Pencil, Trash2, Shield, Eye } from 'lucide-react';
import type { DynamicToolItem } from '../../services/api';

interface Props {
  workflow: DynamicToolItem;
  onRun: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

function formatRelativeTime(iso: string): string {
  const date = new Date(iso);
  if (isNaN(date.getTime())) return 'Never run yet';
  const diff = Date.now() - date.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatLabel(workflow: DynamicToolItem): string {
  if (workflow.label) return workflow.label;
  return workflow.name.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

export default function WorkflowCard({ workflow, onRun, onEdit, onDelete }: Props) {
  const label = formatLabel(workflow);

  return (
    <div className="group relative rounded-[22px] border border-white/6 bg-[var(--surface)] p-4 transition-all hover:border-white/12 hover:shadow-lg hover:-translate-y-[1px]">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="text-[15px] font-semibold text-[var(--text)] truncate">{label}</span>
            {workflow.isWriteTool ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-400 uppercase tracking-wider shrink-0">
                <Shield size={9} />
                Asks before sending
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full border border-blue-500/30 bg-blue-500/10 px-2 py-0.5 text-[10px] font-medium text-blue-400 uppercase tracking-wider shrink-0">
                <Eye size={9} />
                Read-only
              </span>
            )}
          </div>
          <p className="text-[13px] text-[var(--text-dim)] line-clamp-2 leading-relaxed">{workflow.description}</p>
          <p className="mt-2 text-[11px] text-[var(--text-faint)]">
            {workflow.steps.length} step{workflow.steps.length !== 1 ? 's' : ''} · Never run yet
          </p>
        </div>
      </div>

      {/* Actions row — appears on hover */}
      <div className="mt-3 flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={onRun}
          className="flex items-center gap-1.5 rounded-lg bg-[var(--accent)] px-3 py-1.5 text-[12px] font-medium text-black transition hover:brightness-110"
        >
          <Play size={11} />
          Run now
        </button>
        <button
          onClick={onEdit}
          className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-1.5 text-[12px] text-[var(--text-dim)] transition hover:bg-white/[0.04] hover:text-white"
        >
          <Pencil size={11} />
          Edit
        </button>
        <button
          onClick={onDelete}
          className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-1.5 text-[12px] text-[var(--text-dim)] transition hover:border-red-500/40 hover:text-red-400"
        >
          <Trash2 size={11} />
          Delete
        </button>
      </div>
    </div>
  );
}
