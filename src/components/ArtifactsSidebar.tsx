import { useState } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, ExternalLink, FileText, Mail, Calendar, CheckSquare, Table } from 'lucide-react';
import type { AssistantBlock, ResultListItem, AgendaEvent, TriageItem } from '../shared/chat';
import type { Message } from '../context/ChatContext';
import { safeMarkdown } from './ChatThread';

const ARTIFACTS_COLLAPSED_KEY = 'flowspace.artifacts.collapsed';

interface ArtifactGroup {
  type: string;
  icon: typeof Mail;
  label: string;
  blocks: AssistantBlock[];
}

function groupArtifacts(messages: Message[]): ArtifactGroup[] {
  // Collect all blocks from assistant messages, newest first
  const allBlocks: AssistantBlock[] = [];
  for (const msg of messages) {
    if (msg.role !== 'assistant' || !msg.blocks) continue;
    for (const block of msg.blocks) {
      // Skip status blocks — they're inline summaries, not artifacts
      if (block.type === 'status') continue;
      allBlocks.push(block);
    }
  }

  // Group by category
  const emailBlocks = allBlocks.filter((b) => b.type === 'email_list' || b.type === 'fact_list' && b.title.toLowerCase().includes('email'));
  const fileBlocks = allBlocks.filter((b) => b.type === 'file_list');
  const eventBlocks = allBlocks.filter((b) => b.type === 'event_list' || b.type === 'agenda');
  const taskBlocks = allBlocks.filter((b) => b.type === 'task_list');
  const triageBlocks = allBlocks.filter((b) => b.type === 'triage');
  const inboxActionBlocks = allBlocks.filter((b) => b.type === 'bulk_action_preview');
  const sheetBlocks = allBlocks.filter((b) => b.type === 'sheet_data');
  const factBlocks = allBlocks.filter((b) => b.type === 'fact_list' && !b.title.toLowerCase().includes('email'));

  const groups: ArtifactGroup[] = [];
  if (emailBlocks.length > 0) groups.push({ type: 'emails', icon: Mail, label: 'Emails', blocks: emailBlocks });
  if (fileBlocks.length > 0) groups.push({ type: 'files', icon: FileText, label: 'Files', blocks: fileBlocks });
  if (eventBlocks.length > 0) groups.push({ type: 'events', icon: Calendar, label: 'Events', blocks: eventBlocks });
  if (taskBlocks.length > 0) groups.push({ type: 'tasks', icon: CheckSquare, label: 'Tasks', blocks: taskBlocks });
  if (triageBlocks.length > 0) groups.push({ type: 'triage', icon: Mail, label: 'Inbox Triage', blocks: triageBlocks });
  if (inboxActionBlocks.length > 0) groups.push({ type: 'inbox-actions', icon: Mail, label: 'Inbox Actions', blocks: inboxActionBlocks });
  if (sheetBlocks.length > 0) groups.push({ type: 'sheets', icon: Table, label: 'Spreadsheet', blocks: sheetBlocks });
  if (factBlocks.length > 0) groups.push({ type: 'details', icon: FileText, label: 'Details', blocks: factBlocks });

  return groups;
}

function ResultItem({ item }: { item: ResultListItem }) {
  return (
    <div className="flex items-start gap-2 py-2 px-3 hover:bg-[var(--surface)] rounded-lg transition-colors group">
      <div className="min-w-0 flex-1">
        <div className="text-[12px] font-medium text-[var(--text)] leading-snug truncate">{item.title}</div>
        {item.subtitle && (
          <div className="text-[11px] text-[var(--text-dim)] truncate mt-0.5">{item.subtitle}</div>
        )}
        {item.meta && (
          <div className="text-[10px] font-mono text-[var(--text-faint)] mt-0.5 truncate">{item.meta}</div>
        )}
      </div>
      {item.url && (
        <button
          onClick={() => window.open(item.url, '_blank')}
          className="shrink-0 w-6 h-6 rounded-md flex items-center justify-center text-[var(--text-faint)] opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 hover:text-[var(--accent)] hover:bg-[var(--accent-dim)] transition-all cursor-pointer"
          title="Open"
        >
          <ExternalLink size={11} />
        </button>
      )}
    </div>
  );
}

function AgendaItem({ event }: { event: AgendaEvent }) {
  return (
    <div className="flex items-start gap-2 py-2 px-3 hover:bg-[var(--surface)] rounded-lg transition-colors group">
      <div className="w-10 shrink-0 text-[10px] font-mono text-[var(--accent)] font-medium mt-0.5">{event.time}</div>
      <div className="min-w-0 flex-1">
        <div className="text-[12px] font-medium text-[var(--text)] leading-snug">{event.title}</div>
        {event.attendees && event.attendees.length > 0 && (
          <div className="text-[10px] text-[var(--text-faint)] mt-0.5 truncate">{event.attendees.join(', ')}</div>
        )}
        {event.linked_docs && event.linked_docs.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1">
            {event.linked_docs.map((doc, i) => (
              <button
                key={i}
                onClick={() => window.open(doc.url, '_blank')}
                className="flex items-center gap-1 text-[10px] text-[var(--accent)] hover:underline cursor-pointer"
              >
                <FileText size={9} />
                {doc.name}
              </button>
            ))}
          </div>
        )}
      </div>
      {event.url && (
        <button
          onClick={() => window.open(event.url, '_blank')}
          className="shrink-0 w-6 h-6 rounded-md flex items-center justify-center text-[var(--text-faint)] opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 hover:text-[var(--accent)] hover:bg-[var(--accent-dim)] transition-all cursor-pointer"
        >
          <ExternalLink size={11} />
        </button>
      )}
    </div>
  );
}

function TriageSection({ items, label, color }: { items: TriageItem[]; label: string; color: string }) {
  if (items.length === 0) return null;
  return (
    <div className="mt-1">
      <div className={`px-3 py-1 text-[10px] font-mono uppercase tracking-wider ${color}`}>
        {label} ({items.length})
      </div>
      {items.map((item, i) => (
        <div key={`${item.subject}-${i}`} className="px-3 py-1.5">
          <div className="text-[11px] font-medium text-[var(--text)] truncate">{item.subject}</div>
          <div className="text-[10px] text-[var(--text-faint)] truncate">{item.sender}</div>
        </div>
      ))}
    </div>
  );
}

function ArtifactBlockRenderer({ block }: { block: AssistantBlock }) {
  if (block.type === 'email_list' || block.type === 'file_list' || block.type === 'event_list' || block.type === 'task_list') {
    return (
      <div className="divide-y divide-[var(--border)]">
        {block.items.map((item, i) => (
          <ResultItem key={`${item.title}-${i}`} item={item} />
        ))}
      </div>
    );
  }

  if (block.type === 'agenda') {
    return (
      <div className="divide-y divide-[var(--border)]">
        {block.items.map((event, i) => (
          <AgendaItem key={`${event.title}-${i}`} event={event} />
        ))}
      </div>
    );
  }

  if (block.type === 'triage') {
    return (
      <>
        <TriageSection items={block.data.action_required} label="Action Required" color="text-[var(--error)]" />
        <TriageSection items={block.data.review} label="Review" color="text-[var(--amber)]" />
        <TriageSection items={block.data.low_priority} label="Low Priority" color="text-[var(--text-faint)]" />
      </>
    );
  }

  if (block.type === 'bulk_action_preview') {
    return (
      <div className="divide-y divide-[var(--border)]">
        <div className="px-3 py-2 text-[11px] text-[var(--text-dim)]">{block.effect}</div>
        {block.items.map((item) => (
          <div key={item.thread_id} className="px-3 py-2">
            <div className="text-[11px] font-medium text-[var(--text)]">{item.subject}</div>
            <div className="mt-0.5 text-[10px] text-[var(--text-faint)]">{item.sender}</div>
            {item.reason && <div className="mt-1 text-[10px] text-[var(--text-dim)]">{item.reason}</div>}
          </div>
        ))}
      </div>
    );
  }

  if (block.type === 'sheet_data') {
    return (
      <div className="overflow-x-auto">
        <table className="w-full text-[11px]">
          <thead>
            <tr className="border-b border-[var(--border)]">
              {block.data.headers.map((h, i) => (
                <th key={i} className="text-left px-2 py-1.5 text-[10px] font-semibold text-[var(--text)] uppercase tracking-wider whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.data.rows.map((row, i) => (
              <tr key={i} className="border-b border-[var(--border)] last:border-0">
                {row.map((cell, j) => (
                  <td key={j} className="px-2 py-1.5 text-[var(--text-dim)]">{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  if (block.type === 'fact_list') {
    return (
      <div className="divide-y divide-[var(--border)]">
        {block.items.map((item) => (
          <div key={item.label} className="flex items-start gap-2 px-3 py-2">
            <div className="w-16 shrink-0 text-[10px] font-mono uppercase tracking-wider text-[var(--text-faint)]">{item.label}</div>
            <div className="text-[11px] text-[var(--text)] break-words min-w-0" dangerouslySetInnerHTML={{ __html: safeMarkdown(item.value) }} />
          </div>
        ))}
      </div>
    );
  }

  return null;
}

function ArtifactGroupCard({ group }: { group: ArtifactGroup }) {
  const [expanded, setExpanded] = useState(true);
  const Icon = group.icon;

  return (
    <div className="border border-[var(--border)] rounded-xl overflow-hidden bg-[var(--bg)]">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2.5 hover:bg-[var(--surface)] transition-colors cursor-pointer"
      >
        <Icon size={13} className="text-[var(--text-dim)] shrink-0" />
        <span className="text-[12px] font-semibold text-[var(--text)] flex-1 text-left">{group.label}</span>
        <ChevronDown size={12} className={`text-[var(--text-faint)] transition-transform ${expanded ? '' : '-rotate-90'}`} />
      </button>
      {expanded && (
        <div className="border-t border-[var(--border)]">
          {group.blocks.map((block, i) => (
            <ArtifactBlockRenderer key={`${block.type}-${i}`} block={block} />
          ))}
        </div>
      )}
    </div>
  );
}

interface Props {
  messages: Message[];
}

export default function ArtifactsSidebar({ messages }: Props) {
  const [collapsed, setCollapsed] = useState(() => window.localStorage.getItem(ARTIFACTS_COLLAPSED_KEY) === 'true');
  const groups = groupArtifacts(messages);

  if (groups.length === 0) return null;

  const setCollapsedState = (value: boolean) => {
    setCollapsed(value);
    window.localStorage.setItem(ARTIFACTS_COLLAPSED_KEY, String(value));
  };

  if (collapsed) {
    return (
      <div className="w-[56px] shrink-0 border-l border-[var(--border)] bg-[var(--bg-elevated)] flex flex-col h-full overflow-hidden">
        <div className="flex flex-col items-center gap-1 px-2 py-2 border-b border-[var(--border)] shrink-0">
          <button
            onClick={() => setCollapsedState(false)}
            className="w-8 h-8 rounded-md flex items-center justify-center text-[var(--text-faint)] hover:text-[var(--text-dim)] hover:bg-[var(--surface)] transition-colors cursor-pointer"
            title="Expand artifacts"
          >
            <ChevronLeft size={14} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-2 py-2 flex flex-col items-center gap-2">
          {groups.map((group) => {
            const Icon = group.icon;
            return (
              <button
                key={group.type}
                onClick={() => setCollapsedState(false)}
                className="w-8 h-8 rounded-md border border-[var(--border)] bg-[var(--surface)] flex items-center justify-center text-[var(--text-dim)] hover:text-[var(--text)] hover:border-[var(--border2)] transition-colors cursor-pointer"
                title={group.label}
              >
                <Icon size={13} />
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="w-[320px] shrink-0 border-l border-[var(--border)] bg-[var(--bg-elevated)] flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)] shrink-0">
        <span className="text-[12px] font-semibold text-[var(--text)]">Artifacts</span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setCollapsedState(true)}
            className="w-6 h-6 rounded-md flex items-center justify-center text-[var(--text-faint)] hover:text-[var(--text-dim)] hover:bg-[var(--surface)] transition-colors cursor-pointer"
            title="Collapse artifacts"
          >
            <ChevronRight size={13} />
          </button>
        </div>
      </div>

      {/* Artifact groups */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
        {groups.map((group) => (
          <ArtifactGroupCard key={group.type} group={group} />
        ))}
      </div>
    </div>
  );
}
