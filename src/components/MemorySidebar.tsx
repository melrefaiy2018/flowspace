import { useState, useEffect } from 'react';
import { Brain, Trash2, Edit2, X, Check, AlertTriangle, RefreshCw, FolderOpen, Workflow, Heart, Lightbulb } from 'lucide-react';

const MEMORY_SIDEBAR_KEY = 'flowspace.memory.collapsed';

interface MemoryEntry {
  id: string;
  category: 'resource' | 'workflow' | 'preference' | 'fact';
  content: string;
  tags: string[];
  metadata: Record<string, unknown>;
  resourceIds?: string[];
  source: { type: string; conversationId?: string; toolName?: string; messageId?: string };
  stale?: boolean;
  createdAt: string;
  updatedAt: string;
  lastAccessedAt: string;
  accessCount: number;
}

interface MemoriesResponse {
  memories: MemoryEntry[];
}

const CATEGORY_CONFIG: Record<string, { icon: typeof Brain; label: string; color: string }> = {
  resource: { icon: FolderOpen, label: 'Resources', color: 'text-blue-500' },
  workflow: { icon: Workflow, label: 'Workflows', color: 'text-purple-500' },
  preference: { icon: Heart, label: 'Preferences', color: 'text-pink-500' },
  fact: { icon: Lightbulb, label: 'Facts', color: 'text-amber-500' },
};

function formatRelativeTime(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`;
  return `${Math.floor(diffDays / 365)} years ago`;
}

function MemoryItem({
  memory,
  onDelete,
  onUpdate,
}: {
  memory: MemoryEntry;
  onDelete: (id: string) => void;
  onUpdate: (id: string, updates: Partial<MemoryEntry>) => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState(memory.content);
  const config = CATEGORY_CONFIG[memory.category] ?? CATEGORY_CONFIG.fact;
  const Icon = config.icon;

  const handleSave = () => {
    if (editContent.trim() !== memory.content) {
      onUpdate(memory.id, { content: editContent.trim() });
    }
    setIsEditing(false);
  };

  return (
    <div className={`group relative py-2 px-3 hover:bg-[var(--surface)] rounded-lg transition-colors ${memory.stale ? 'opacity-60' : ''}`}>
      <div className="flex items-start gap-2">
        <Icon size={14} className={`mt-0.5 shrink-0 ${config.color}`} />
        <div className="min-w-0 flex-1">
          {isEditing ? (
            <div className="flex gap-1">
              <input
                type="text"
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                className="flex-1 text-[11px] bg-[var(--surface)] border border-[var(--border)] rounded px-1.5 py-0.5 text-[var(--text)] outline-none focus:border-[var(--accent)]"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSave();
                  if (e.key === 'Escape') {
                    setEditContent(memory.content);
                    setIsEditing(false);
                  }
                }}
              />
              <button
                onClick={handleSave}
                className="w-6 h-6 rounded flex items-center justify-center text-green-500 hover:bg-green-500/10"
              >
                <Check size={12} />
              </button>
            </div>
          ) : (
            <div className="text-[11px] text-[var(--text)] leading-relaxed">{memory.content}</div>
          )}

          {memory.tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1">
              {memory.tags.slice(0, 4).map((tag) => (
                <span
                  key={tag}
                  className="text-[9px] px-1.5 py-0.5 rounded bg-[var(--surface)] text-[var(--text-dim)]"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}

          <div className="flex items-center gap-2 mt-1.5 text-[9px] text-[var(--text-faint)]">
            <span>{formatRelativeTime(memory.lastAccessedAt)}</span>
            {memory.accessCount > 0 && <span>&middot; {memory.accessCount} uses</span>}
          </div>
        </div>

        {memory.stale && (
          <div className="shrink-0" title="This resource may have been deleted">
            <AlertTriangle size={12} className="text-amber-500" />
          </div>
        )}

        <div className="shrink-0 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 flex items-center gap-1 transition-opacity">
          <button
            onClick={() => setIsEditing(true)}
            className="w-6 h-6 rounded flex items-center justify-center text-[var(--text-faint)] hover:text-[var(--text)] hover:bg-[var(--surface)]"
            title="Edit"
          >
            <Edit2 size={11} />
          </button>
          <button
            onClick={() => onDelete(memory.id)}
            className="w-6 h-6 rounded flex items-center justify-center text-[var(--text-faint)] hover:text-red-500 hover:bg-red-500/10"
            title="Delete"
          >
            <Trash2 size={11} />
          </button>
        </div>
      </div>
    </div>
  );
}

export function MemorySidebar() {
  const [isCollapsed, setIsCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem(MEMORY_SIDEBAR_KEY) === 'true';
  });
  const [memories, setMemories] = useState<MemoryEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchMemories = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/memory');
      if (!res.ok) throw new Error('Failed to load memories');
      const data: MemoriesResponse = await res.json();
      setMemories(data.memories || []);
    } catch (err: any) {
      setError(err.message || 'Failed to load memories');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchMemories();
  }, []);

  const handleDelete = async (id: string) => {
    try {
      const res = await fetch(`/api/memory/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete memory');
      setMemories((prev) => prev.filter((m) => m.id !== id));
    } catch (err) {
      console.error('Failed to delete memory:', err);
    }
  };

  const handleUpdate = async (id: string, updates: Partial<MemoryEntry>) => {
    try {
      const res = await fetch(`/api/memory/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      if (!res.ok) throw new Error('Failed to update memory');
      setMemories((prev) =>
        prev.map((m) => (m.id === id ? { ...m, ...updates, updatedAt: new Date().toISOString() } : m))
      );
    } catch (err) {
      console.error('Failed to update memory:', err);
    }
  };

  const groupedMemories: Record<string, MemoryEntry[]> = {
    resource: memories.filter((m) => m.category === 'resource'),
    workflow: memories.filter((m) => m.category === 'workflow'),
    preference: memories.filter((m) => m.category === 'preference'),
    fact: memories.filter((m) => m.category === 'fact'),
  };

  const totalMemories = memories.length;

  if (isCollapsed) {
    return (
      <button
        onClick={() => setIsCollapsed(false)}
        className="flex items-center gap-1.5 px-2 py-1.5 text-[10px] font-medium text-[var(--text-dim)] hover:text-[var(--text)] hover:bg-[var(--surface)] rounded-md transition-colors"
        title="Show memories"
      >
        <Brain size={12} />
        <span>Memory</span>
        {totalMemories > 0 && (
          <span className="text-[9px] bg-[var(--accent-dim)] text-[var(--accent)] px-1 rounded">
            {totalMemories}
          </span>
        )}
      </button>
    );
  }

  return (
    <div className="flex flex-col h-full border-l border-[var(--border)] bg-[var(--bg)] w-56">
      <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border)]">
        <div className="flex items-center gap-1.5">
          <Brain size={14} className="text-[var(--accent)]" />
          <span className="text-[11px] font-medium text-[var(--text)]">Memory</span>
          {totalMemories > 0 && (
            <span className="text-[9px] bg-[var(--accent-dim)] text-[var(--accent)] px-1.5 rounded">
              {totalMemories}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={fetchMemories}
            disabled={isLoading}
            className="w-6 h-6 rounded flex items-center justify-center text-[var(--text-faint)] hover:text-[var(--text)] hover:bg-[var(--surface)] disabled:opacity-50"
            title="Refresh"
          >
            <RefreshCw size={11} className={isLoading ? 'animate-spin' : ''} />
          </button>
          <button
            onClick={() => setIsCollapsed(true)}
            className="w-6 h-6 rounded flex items-center justify-center text-[var(--text-faint)] hover:text-[var(--text)] hover:bg-[var(--surface)]"
            title="Hide sidebar"
          >
            <X size={11} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {error && (
          <div className="px-3 py-2 text-[10px] text-red-500">{error}</div>
        )}

        {isLoading ? (
          <div className="flex items-center justify-center h-20">
            <RefreshCw size={16} className="animate-spin text-[var(--text-faint)]" />
          </div>
        ) : totalMemories === 0 ? (
          <div className="px-3 py-4 text-center">
            <Brain size={24} className="mx-auto mb-2 text-[var(--text-faint)]" />
            <div className="text-[10px] text-[var(--text-dim)]">No memories yet</div>
            <div className="text-[9px] text-[var(--text-faint)] mt-1">
              Memories are saved when you tell me to remember something or when I create resources for you.
            </div>
          </div>
        ) : (
          <div className="py-2">
            {(['resource', 'workflow', 'preference', 'fact'] as const).map((category) => {
              const items = groupedMemories[category];
              if (items.length === 0) return null;
              const config = CATEGORY_CONFIG[category];
              const Icon = config.icon;

              return (
                <div key={category} className="mb-3">
                  <div className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-medium text-[var(--text-dim)]">
                    <Icon size={11} className={config.color} />
                    <span>{config.label}</span>
                    <span className="text-[9px] text-[var(--text-faint)]">({items.length})</span>
                  </div>
                  {items.map((memory) => (
                    <MemoryItem
                      key={memory.id}
                      memory={memory}
                      onDelete={handleDelete}
                      onUpdate={handleUpdate}
                    />
                  ))}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}