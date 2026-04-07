import { useState, useCallback } from 'react';
import { AlertTriangle, Bell, ChevronDown, ChevronRight, Eye, Inbox, Paperclip, VolumeX, Archive, Sparkles, ArrowRight, Plus, Tag, X } from 'lucide-react';
import type { GmailThreadSummary } from '../../services/api';
import type { ThreadTriageResult } from '../../lib/triage';

export interface CustomCategory {
  id: string;
  label: string;
  threadIds: string[];
}

interface Props {
  triage: ThreadTriageResult;
  onSelectThread: (threadId: string) => void;
  selectedThreadId?: string | null;
  customCategories?: CustomCategory[];
  onAddCategory?: (label: string) => void;
  onMoveThread?: (threadId: string, categoryId: string) => void;
  onArchiveThread?: (threadId: string) => void;
  onAskAgent?: (threadId: string) => void;
}

function formatDate(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    if (diffDays === 0) return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return date.toLocaleDateString([], { weekday: 'short' });
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  } catch {
    return dateStr;
  }
}

function extractName(from: string): string {
  const match = from.match(/^"?([^"<]+)"?\s*</);
  if (match) return match[1].trim();
  return from.split('@')[0];
}

function getInitial(from: string): string {
  const name = extractName(from);
  return name[0]?.toUpperCase() ?? '?';
}

interface CategoryConfig {
  key: string;
  label: string;
  icon: typeof AlertTriangle;
  accentClass: string;
  badgeClass: string;
}

const DEFAULT_CATEGORIES: CategoryConfig[] = [
  {
    key: 'urgent',
    label: 'Urgent',
    icon: AlertTriangle,
    accentClass: 'text-[var(--amber)]',
    badgeClass: 'bg-[var(--amber)]/15 text-[var(--amber)] border-[var(--amber)]/30',
  },
  {
    key: 'needs_attention',
    label: 'Needs attention',
    icon: Bell,
    accentClass: 'text-[var(--blue)]',
    badgeClass: 'bg-[var(--blue)]/15 text-[var(--blue)] border-[var(--blue)]/30',
  },
  {
    key: 'informational',
    label: 'Informational',
    icon: Eye,
    accentClass: 'text-[var(--text-dim)]',
    badgeClass: 'bg-white/[0.06] text-[var(--text-dim)] border-white/10',
  },
  {
    key: 'low_priority',
    label: 'Low priority',
    icon: VolumeX,
    accentClass: 'text-[var(--text-faint)]',
    badgeClass: 'bg-white/[0.04] text-[var(--text-faint)] border-white/8',
  },
];

function MoveMenu({
  threadId,
  currentCategoryKey,
  customCategories,
  onMove,
  onClose,
}: {
  threadId: string;
  currentCategoryKey: string;
  customCategories: CustomCategory[];
  onMove: (threadId: string, categoryId: string) => void;
  onClose: () => void;
}) {
  const targets = [
    ...DEFAULT_CATEGORIES.filter((c) => c.key !== currentCategoryKey).map((c) => ({ id: c.key, label: c.label })),
    ...customCategories.map((c) => ({ id: c.id, label: c.label })),
  ];

  return (
    <div className="absolute right-0 top-full z-20 mt-1 min-w-[160px] rounded-[10px] border border-[var(--border)] bg-[var(--surface)] py-1 shadow-lg">
      {targets.map((target) => (
        <button
          key={target.id}
          type="button"
          role="button"
          onClick={(e) => {
            e.stopPropagation();
            onMove(threadId, target.id);
            onClose();
          }}
          className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] text-[var(--text-dim)] hover:bg-white/[0.05] hover:text-[var(--text)] transition-colors cursor-pointer"
        >
          {target.label}
        </button>
      ))}
    </div>
  );
}

function ThreadItem({
  thread,
  categoryKey,
  onSelect,
  isSelected,
  customCategories,
  onArchive,
  onAskAgent,
  onMove,
}: {
  thread: GmailThreadSummary;
  categoryKey: string;
  onSelect: () => void;
  isSelected: boolean;
  customCategories: CustomCategory[];
  onArchive?: (threadId: string) => void;
  onAskAgent?: (threadId: string) => void;
  onMove?: (threadId: string, categoryId: string) => void;
}) {
  const [moveMenuOpen, setMoveMenuOpen] = useState(false);
  const initial = getInitial(thread.from);
  const name = extractName(thread.from);

  return (
    <div
      data-thread-id={thread.id}
      className={`relative flex items-start gap-3 w-full text-left px-4 py-3 border-b border-[var(--border)] transition-colors cursor-pointer group ${
        isSelected
          ? 'bg-[var(--accent)]/8'
          : 'hover:bg-white/[0.03]'
      }`}
      onMouseLeave={() => setMoveMenuOpen(false)}
      onClick={onSelect}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter') onSelect(); }}
    >
      <div className={`flex h-8 w-8 items-center justify-center rounded-full text-[12px] font-semibold shrink-0 ${
        thread.unread ? 'bg-[var(--accent)]/20 text-[var(--accent)]' : 'bg-[var(--surface3)] text-[var(--text-faint)]'
      }`}>
        {initial}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className={`text-[13px] truncate ${thread.unread ? 'font-semibold text-[var(--text)]' : 'text-[var(--text-dim)]'}`}>
            {name}
          </span>
          <div className="flex items-center gap-1 shrink-0">
            <span className="text-[11px] text-[var(--text-faint)]">{formatDate(thread.date)}</span>
            {/* Thread action buttons — always visible */}
            {(onArchive || onAskAgent || onMove) && (
              <div className="flex items-center gap-0.5 ml-1">
                {onArchive && (
                  <button
                    type="button"
                    title="Archive"
                    onClick={(e) => { e.stopPropagation(); onArchive(thread.id); }}
                    className="rounded-md p-1 text-[var(--text-faint)] hover:bg-[var(--surface2)] hover:text-[var(--text)] transition-colors"
                  >
                    <Archive size={12} />
                  </button>
                )}
                {onAskAgent && (
                  <button
                    type="button"
                    title="Ask agent"
                    onClick={(e) => { e.stopPropagation(); onAskAgent(thread.id); }}
                    className="rounded-md p-1 text-[var(--text-faint)] hover:bg-[var(--surface2)] hover:text-[var(--accent)] transition-colors"
                  >
                    <Sparkles size={12} />
                  </button>
                )}
                {onMove && (
                  <div className="relative">
                    <button
                      type="button"
                      title="Move to category"
                      onClick={(e) => { e.stopPropagation(); setMoveMenuOpen((v) => !v); }}
                      className="rounded-md p-1 text-[var(--text-faint)] hover:bg-[var(--surface2)] hover:text-[var(--text)] transition-colors"
                    >
                      <ArrowRight size={12} />
                    </button>
                    {moveMenuOpen && (
                      <MoveMenu
                        threadId={thread.id}
                        currentCategoryKey={categoryKey}
                        customCategories={customCategories}
                        onMove={onMove}
                        onClose={() => setMoveMenuOpen(false)}
                      />
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
        <div className={`text-[13px] truncate ${thread.unread ? 'font-medium text-[var(--text)]' : 'text-[var(--text-dim)]'}`}>
          {thread.subject}
          {thread.messageCount > 1 && (
            <span className="ml-1 text-[11px] text-[var(--text-faint)]">({thread.messageCount})</span>
          )}
        </div>
        <div className="flex items-center gap-1.5 mt-0.5">
          <span className="text-[12px] text-[var(--text-faint)] truncate">{thread.snippet}</span>
          {thread.hasAttachments && <Paperclip size={11} className="text-[var(--text-faint)] shrink-0" />}
        </div>
      </div>
    </div>
  );
}

function CategorySection({
  config,
  threads,
  onSelectThread,
  selectedThreadId,
  defaultOpen,
  customCategories,
  isCustom,
  onArchive,
  onAskAgent,
  onMove,
}: {
  config: CategoryConfig;
  threads: GmailThreadSummary[];
  onSelectThread: (id: string) => void;
  selectedThreadId?: string | null;
  defaultOpen: boolean;
  customCategories: CustomCategory[];
  isCustom?: boolean;
  onArchive?: (threadId: string) => void;
  onAskAgent?: (threadId: string) => void;
  onMove?: (threadId: string, categoryId: string) => void;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const Icon = config.icon;

  if (threads.length === 0 && !isCustom) return null;

  return (
    <div data-category={config.key} className="border-b border-[var(--border)]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2.5 px-4 py-3 text-left hover:bg-white/[0.02] transition cursor-pointer"
      >
        {open ? <ChevronDown size={14} className="text-[var(--text-faint)]" /> : <ChevronRight size={14} className="text-[var(--text-faint)]" />}
        <Icon size={15} className={config.accentClass} />
        <span className={`text-[13px] font-semibold ${config.accentClass}`}>{config.label}</span>
        <span className={`ml-auto rounded-full border px-2 py-0.5 text-[11px] font-medium ${config.badgeClass}`}>
          {threads.length}
        </span>
      </button>
      {open && (
        <div>
          {threads.length === 0 && isCustom && (
            <div className="px-4 py-3 text-[12px] text-[var(--text-faint)]">
              Move threads here using the <ArrowRight size={11} className="inline" /> action on any email.
            </div>
          )}
          {threads.map((thread) => (
            <ThreadItem
              key={thread.id}
              thread={thread}
              categoryKey={config.key}
              onSelect={() => onSelectThread(thread.id)}
              isSelected={selectedThreadId === thread.id}
              customCategories={customCategories}
              onArchive={onArchive}
              onAskAgent={onAskAgent}
              onMove={onMove}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function AddCategoryForm({ onAdd }: { onAdd: (label: string) => void }) {
  const [isAdding, setIsAdding] = useState(false);
  const [value, setValue] = useState('');

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) return;
    onAdd(trimmed);
    setValue('');
    setIsAdding(false);
  }, [value, onAdd]);

  if (!isAdding) {
    return (
      <button
        type="button"
        onClick={() => setIsAdding(true)}
        className="flex w-full items-center gap-2 px-4 py-3 text-[12px] text-[var(--text-faint)] hover:text-[var(--text-dim)] hover:bg-white/[0.02] transition-colors cursor-pointer"
      >
        <Plus size={14} />
        Add category
      </button>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex items-center gap-2 px-4 py-2.5 border-b border-[var(--border)]">
      <Tag size={14} className="text-[var(--accent)] shrink-0" />
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Category name..."
        autoFocus
        className="flex-1 bg-transparent text-[12px] text-[var(--text)] placeholder:text-[var(--text-faint)] outline-none"
      />
      <button
        type="submit"
        disabled={!value.trim()}
        className="text-[11px] font-medium text-[var(--accent)] disabled:opacity-40 cursor-pointer"
      >
        Add
      </button>
      <button
        type="button"
        onClick={() => { setIsAdding(false); setValue(''); }}
        className="text-[var(--text-faint)] hover:text-[var(--text)] cursor-pointer"
      >
        <X size={14} />
      </button>
    </form>
  );
}

export default function GmailTriageView({
  triage,
  onSelectThread,
  selectedThreadId,
  customCategories = [],
  onAddCategory,
  onMoveThread,
  onArchiveThread,
  onAskAgent,
}: Props) {
  // Collect thread IDs that have been moved to custom categories
  const movedThreadIds = new Set(customCategories.flatMap((c) => c.threadIds));

  // Filter moved threads out of default categories
  const filteredTriage: ThreadTriageResult = {
    urgent: triage.urgent.filter((t) => !movedThreadIds.has(t.id)),
    needs_attention: triage.needs_attention.filter((t) => !movedThreadIds.has(t.id)),
    informational: triage.informational.filter((t) => !movedThreadIds.has(t.id)),
    low_priority: triage.low_priority.filter((t) => !movedThreadIds.has(t.id)),
  };

  // Build a lookup of all threads by ID for custom category rendering
  const allThreads = [...triage.urgent, ...triage.needs_attention, ...triage.informational, ...triage.low_priority];
  const threadById = new Map(allThreads.map((t) => [t.id, t]));

  const totalCount = allThreads.length;

  if (totalCount === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <Inbox size={24} className="text-[var(--text-faint)] mb-3" />
        <p className="text-[14px] text-[var(--text-dim)]">No emails to categorize</p>
        <p className="text-[12px] text-[var(--text-faint)] mt-1">Emails will appear here once your inbox loads</p>
      </div>
    );
  }

  return (
    <div>
      <div className="px-4 py-2.5 border-b border-[var(--border)] bg-[var(--surface)]">
        <span className="text-[11px] font-mono uppercase tracking-[0.06em] text-[var(--text-faint)]">
          {totalCount} threads categorized
        </span>
      </div>

      {/* Default categories */}
      {DEFAULT_CATEGORIES.map((config) => (
        <CategorySection
          key={config.key}
          config={config}
          threads={filteredTriage[config.key as keyof ThreadTriageResult]}
          onSelectThread={onSelectThread}
          selectedThreadId={selectedThreadId}
          defaultOpen={config.key === 'urgent' || config.key === 'needs_attention'}
          customCategories={customCategories}
          onArchive={onArchiveThread}
          onAskAgent={onAskAgent}
          onMove={onMoveThread}
        />
      ))}

      {/* Custom categories */}
      {customCategories.map((cat) => {
        const catThreads = cat.threadIds
          .map((id) => threadById.get(id))
          .filter((t): t is GmailThreadSummary => t !== undefined);

        const config: CategoryConfig = {
          key: cat.id,
          label: cat.label,
          icon: Tag,
          accentClass: 'text-[var(--accent)]',
          badgeClass: 'bg-[var(--accent)]/15 text-[var(--accent)] border-[var(--accent)]/30',
        };

        return (
          <CategorySection
            key={cat.id}
            config={config}
            threads={catThreads}
            onSelectThread={onSelectThread}
            selectedThreadId={selectedThreadId}
            defaultOpen={true}
            customCategories={customCategories}
            isCustom={true}
            onArchive={onArchiveThread}
            onAskAgent={onAskAgent}
            onMove={onMoveThread}
          />
        );
      })}

      {/* Add category */}
      {onAddCategory && <AddCategoryForm onAdd={onAddCategory} />}
    </div>
  );
}
