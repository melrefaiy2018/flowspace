import { useState, useCallback } from 'react';
import { Sparkles, Send, Loader2, Wand2 } from 'lucide-react';
import type { GmailThreadSummary } from '../../services/api';
import type { ThreadTriageResult } from '../../lib/triage';

export interface TriageAgentBarProps {
  triage: ThreadTriageResult;
  threads: readonly GmailThreadSummary[];
  onSendToAgent: (prompt: string, displayContent: string) => void;
  onAISort?: () => Promise<void>;
  aiSortLoading?: boolean;
}

export const TRIAGE_SUGGESTIONS = [
  { label: 'Categorize by project', prompt: 'categorize_by_project' },
  { label: 'Find action items', prompt: 'find_action_items' },
  { label: 'Summarize inbox', prompt: 'summarize_inbox' },
] as const;

export type TriageSuggestionPrompt = typeof TRIAGE_SUGGESTIONS[number]['prompt'];

function buildThreadListSummary(threads: readonly GmailThreadSummary[]): string {
  return threads
    .slice(0, 30)
    .map((t, i) => `${i + 1}. "${t.subject}" from ${t.from} (${t.unread ? 'unread' : 'read'}, ${t.date})`)
    .join('\n');
}

function buildTriageContext(threads: readonly GmailThreadSummary[], triage: ThreadTriageResult): string {
  return [
    `I have ${threads.length} threads in my inbox.`,
    `Current triage: ${triage.urgent.length} urgent, ${triage.needs_attention.length} needs attention, ${triage.informational.length} informational, ${triage.low_priority.length} low priority.`,
    `\nThread list:\n${buildThreadListSummary(threads)}`,
  ].join('\n');
}

export function buildTriageAgentPrompt(
  prompt: TriageSuggestionPrompt | string,
  threads: readonly GmailThreadSummary[],
  triage: ThreadTriageResult,
): string {
  const context = buildTriageContext(threads, triage);

  switch (prompt) {
    case 'categorize_by_project':
      return `${context}\n\nPlease categorize these email threads by project or topic. Group related threads together and give each group a descriptive label. List which threads belong to each category.`;
    case 'find_action_items':
      return `${context}\n\nPlease scan these email threads and identify any action items, deadlines, or tasks that need my attention. For each action item, note which thread it comes from and its urgency.`;
    case 'summarize_inbox':
      return `${context}\n\nPlease summarize my current inbox state. Highlight the most important threads, any patterns you notice, and suggest what I should focus on first.`;
    default:
      return `${context}\n\nUser request: ${prompt}`;
  }
}

export default function TriageAgentBar({ triage, threads, onSendToAgent, onAISort, aiSortLoading }: TriageAgentBarProps) {
  const [input, setInput] = useState('');

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed) return;
    const prompt = buildTriageAgentPrompt(trimmed, threads, triage);
    onSendToAgent(prompt, trimmed);
    setInput('');
  }, [input, threads, triage, onSendToAgent]);

  const handleSuggestion = useCallback((suggestion: typeof TRIAGE_SUGGESTIONS[number]) => {
    const prompt = buildTriageAgentPrompt(suggestion.prompt, threads, triage);
    onSendToAgent(prompt, suggestion.label);
  }, [threads, triage, onSendToAgent]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const trimmed = input.trim();
      if (!trimmed) return;
      const prompt = buildTriageAgentPrompt(trimmed, threads, triage);
      onSendToAgent(prompt, trimmed);
      setInput('');
    }
  }, [input, threads, triage, onSendToAgent]);

  return (
    <div className="border-b border-[var(--border)] bg-[var(--surface)]/60 px-4 py-3">
      <div className="flex items-center gap-2 mb-2">
        <Sparkles size={13} className="text-[var(--accent)] shrink-0" />
        <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--text-faint)]">
          Ask agent about your inbox
        </span>
      </div>
      <div className="flex flex-wrap gap-1.5 mb-2.5">
        {onAISort && (
          <button
            type="button"
            onClick={onAISort}
            disabled={aiSortLoading}
            className="flex items-center gap-1.5 rounded-full border border-[var(--accent)]/30 bg-[var(--accent)]/10 px-3 py-1.5 text-[11px] font-medium text-[var(--accent)] hover:bg-[var(--accent)]/20 transition-colors cursor-pointer disabled:opacity-50"
          >
            {aiSortLoading ? <Loader2 size={12} className="animate-spin" /> : <Wand2 size={12} />}
            {aiSortLoading ? 'Sorting...' : 'AI Sort'}
          </button>
        )}
        {TRIAGE_SUGGESTIONS.map((suggestion) => (
          <button
            key={suggestion.prompt}
            type="button"
            onClick={() => handleSuggestion(suggestion)}
            className="rounded-full border border-[var(--border)] px-3 py-1.5 text-[11px] font-medium text-[var(--text-dim)] hover:border-[var(--accent)]/40 hover:text-[var(--text)] hover:bg-[var(--surface2)] transition-colors cursor-pointer"
          >
            {suggestion.label}
          </button>
        ))}
      </div>
      <form onSubmit={handleSubmit} className="flex items-center gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask the agent about your inbox..."
          className="flex-1 rounded-[10px] border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-[12px] text-[var(--text)] placeholder:text-[var(--text-faint)] outline-none focus:border-[var(--accent)]"
        />
        <button
          type="submit"
          disabled={!input.trim()}
          className="rounded-[10px] bg-[var(--accent)] p-2 text-black transition-colors hover:brightness-110 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Send size={14} />
        </button>
      </form>
    </div>
  );
}
