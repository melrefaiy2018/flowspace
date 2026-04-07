import { useEffect, useMemo, useRef, useState } from 'react';
import { Archive, Bot, Briefcase, Calendar, Check, CheckCircle2, ChevronRight, CircleDashed, ExternalLink, FileText, Mail, PencilLine, RefreshCw, RotateCcw, Sparkles, User, VolumeX, X } from 'lucide-react';
import { useChatContext, type Message } from '../context/ChatContext';
import type { AgendaEvent, ApprovalRequest, AssistantBlock, BulkActionPreviewItem, EmailDraftData, InboxActionType, ResultListItem, ToolEvent, TriageItem } from '../shared/chat';
import EmailDraftCard from './EmailDraftCard';
import { AGENT_NAME } from '../lib/branding';

const WORKFLOW_CARDS = [
  { icon: Briefcase, label: 'Delegate Standup', desc: "Build today's standup report", prompt: 'Give me a standup report' },
  { icon: Mail, label: 'Delegate Inbox', desc: 'Triage and summarize unread email', prompt: 'Summarize my unread emails' },
  { icon: Calendar, label: 'Delegate Meeting Prep', desc: 'Assemble agenda, attendees, and docs', prompt: 'Prepare for my next meeting' },
  { icon: FileText, label: 'Delegate Weekly Digest', desc: 'Compile this week at a glance', prompt: 'Give me a weekly digest' },
];

export function renderMarkdown(text: string): string {
  let html = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, (_m, _lang, code) =>
    `<pre class="md-pre"><code>${code.trim()}</code></pre>`
  );

  html = html.replace(
    /((?:^.*\|.*$\n?){2,})/gm,
    (block) => {
      const rows = block.trim().split('\n');
      const dataRows = rows.filter((row) => !/^\|[\s\-:|]+\|$/.test(row) && !/^[\s\-:|]+$/.test(row));
      if (dataRows.length === 0) return block;

      const parseRow = (row: string) => row.split('|').map((cell) => cell.trim()).filter(Boolean);
      const headerCells = parseRow(dataRows[0]);
      const bodyRows = dataRows.slice(1);

      let table = '<table class="md-table">';
      table += '<thead><tr>' + headerCells.map((cell) => `<th>${inlineFormat(cell)}</th>`).join('') + '</tr></thead>';
      if (bodyRows.length > 0) {
        table += '<tbody>';
        for (const row of bodyRows) {
          const cells = parseRow(row);
          table += '<tr>' + cells.map((cell) => `<td>${inlineFormat(cell)}</td>`).join('') + '</tr>';
        }
        table += '</tbody>';
      }
      table += '</table>';
      return table;
    }
  );

  const lines = html.split('\n');
  const out: string[] = [];
  let inList = false;
  let listType: 'ul' | 'ol' = 'ul';

  for (const line of lines) {
    if (line.startsWith('<pre') || line.startsWith('<table')) {
      if (inList) { out.push(`</${listType}>`); inList = false; }
      out.push(line);
      continue;
    }

    if (/^---+$/.test(line.trim()) || /^\*\*\*+$/.test(line.trim())) {
      if (inList) { out.push(`</${listType}>`); inList = false; }
      out.push('<hr class="md-hr"/>');
      continue;
    }

    const headingMatch = line.match(/^(#{1,4})\s+(.+)$/);
    if (headingMatch) {
      if (inList) { out.push(`</${listType}>`); inList = false; }
      const level = headingMatch[1].length;
      const cls = level === 1 ? 'md-h1' : level === 2 ? 'md-h2' : 'md-h3';
      out.push(`<div class="${cls}">${inlineFormat(headingMatch[2])}</div>`);
      continue;
    }

    const ulMatch = line.match(/^[\s]*[-*]\s+(.+)$/);
    if (ulMatch) {
      if (!inList || listType !== 'ul') {
        if (inList) out.push(`</${listType}>`);
        out.push('<ul class="md-ul">');
        inList = true;
        listType = 'ul';
      }
      out.push(`<li>${inlineFormat(ulMatch[1])}</li>`);
      continue;
    }

    const olMatch = line.match(/^[\s]*\d+[.)]\s+(.+)$/);
    if (olMatch) {
      if (!inList || listType !== 'ol') {
        if (inList) out.push(`</${listType}>`);
        out.push('<ol class="md-ol">');
        inList = true;
        listType = 'ol';
      }
      out.push(`<li>${inlineFormat(olMatch[1])}</li>`);
      continue;
    }

    if (inList) { out.push(`</${listType}>`); inList = false; }

    if (line.trim() === '') {
      out.push('<div class="h-2"></div>');
      continue;
    }

    out.push(`<p class="md-p">${inlineFormat(line)}</p>`);
  }

  if (inList) out.push(`</${listType}>`);
  return out.join('');
}

function inlineFormat(text: string): string {
  return text
    .replace(/!!(.+?)!!/g, '<span class="md-deadline">$1</span>')
    .replace(/`([^`]+)`/g, '<code class="md-code">$1</code>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    // Markdown links: [text](url)
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer" class="md-link">$1</a>')
    // Bare URLs (not already inside an href)
    .replace(/(?<!href="|">)(https?:\/\/[^\s<)"]+)/g, '<a href="$1" target="_blank" rel="noreferrer" class="md-link">$1</a>');
}

function friendlyToolError(detail?: string): string {
  const text = detail || 'Tool execution failed';
  const lowered = text.toLowerCase();
  if (lowered.includes('auth') || lowered.includes('unauthorized') || lowered.includes('token')) return 'Authentication expired. Reconnect your account and retry.';
  if (lowered.includes('429') || lowered.includes('rate')) return 'Rate limited by provider. Please retry shortly.';
  if (lowered.includes('timeout') || lowered.includes('timed out')) return 'Tool timed out. Try a narrower request.';
  if (lowered.includes('invalid') || lowered.includes('required') || lowered.includes('validation')) return 'Invalid tool input. Adjust the request and retry.';
  return text;
}

function ToolActivityLine({ event }: { event: ToolEvent }) {
  const isRunning = event.status === 'running';
  const isError = event.status === 'error';
  const isApproval = event.status === 'approval_required';
  const isCompleted = event.status === 'completed';

  return (
    <div className="flex items-start gap-2 py-0.5 font-mono text-[12px] leading-relaxed">
      {/* Status icon */}
      {isRunning && (
        <RefreshCw size={12} className="text-[var(--accent)] animate-spin mt-[3px] shrink-0" />
      )}
      {isCompleted && (
        <CheckCircle2 size={12} className="text-[var(--text-faint)] mt-[3px] shrink-0" />
      )}
      {isError && (
        <X size={12} className="text-[var(--error)] mt-[3px] shrink-0" />
      )}
      {isApproval && (
        <CircleDashed size={12} className="text-[var(--amber)] mt-[3px] shrink-0" />
      )}
      {event.status === 'pending' && (
        <CircleDashed size={12} className="text-[var(--text-faint)] mt-[3px] shrink-0" />
      )}

      <div className="min-w-0 flex-1">
        {/* Running: show verbose label */}
        {isRunning && (
          <span className="text-[var(--accent)]">{event.label}</span>
        )}
        {/* Completed: label + detail summary */}
        {isCompleted && (
          <span className="text-[var(--text-faint)]">
            {event.label}
            {event.detail && event.detail !== 'Done' && (
              <span className="text-[var(--text-dim)] ml-1.5">— {event.detail}</span>
            )}
          </span>
        )}
        {/* Error: red inline */}
        {isError && (
          <span className="text-[var(--error)]">
            {event.label} failed
            {event.detail && (
              <span className="text-[var(--error)]/70 ml-1">— {friendlyToolError(event.detail)}</span>
            )}
          </span>
        )}
        {/* Approval */}
        {isApproval && (
          <span className="text-[var(--amber)]">{event.label} — awaiting approval</span>
        )}
        {/* Pending */}
        {event.status === 'pending' && (
          <span className="text-[var(--text-faint)]">{event.label}</span>
        )}
      </div>
    </div>
  );
}

function ToolActivityLog({ events, expanded }: { events: ToolEvent[] | undefined; expanded: boolean }) {
  if (!events || events.length === 0) return null;

  if (!expanded) return null;

  return (
    <div className="pl-1 border-l-2 border-[var(--border)] ml-0.5 space-y-0">
      {events.map((event) => (
        <ToolActivityLine key={event.id} event={event} />
      ))}
    </div>
  );
}

function buildInboxActionPrompt(actionType: InboxActionType, items: TriageItem[] | BulkActionPreviewItem[]): string {
  const validItems = items.filter((item) => item.thread_id);
  const serialized = JSON.stringify(validItems.map((item) => ({
    thread_id: item.thread_id,
    sender: item.sender,
    subject: item.subject || '(no subject)',
    reason: 'reason' in item ? item.reason : undefined,
  })));
  switch (actionType) {
    case 'archive_threads':
      return `Archive these Gmail threads by exact ID only. Include the preview_items JSON in the approval request.\n${serialized}`;
    case 'mute_threads':
      return `Mute these Gmail threads by exact ID only.\n${serialized}`;
    case 'mark_read':
      return `Mark these Gmail threads as read by exact ID only.\n${serialized}`;
    case 'create_filter': {
      const first = validItems[0];
      return `Create a Gmail filter for emails similar to these items. Use the sender "${first?.sender ?? ''}" if possible and skip Inbox for future matches.\n${serialized}`;
    }
    case 'restore_threads':
      return `Restore these Gmail threads back to Inbox by exact ID only.\n${serialized}`;
    case 'untrash_threads':
      return `Remove these Gmail threads from Trash by exact ID only.\n${serialized}`;
    case 'mark_unread':
      return `Mark these Gmail threads as unread by exact ID only.\n${serialized}`;
    case 'unmute_threads':
      return `Unmute these Gmail threads by exact ID only.\n${serialized}`;
    case 'apply_label':
      return `Apply an appropriate Gmail label to these exact thread IDs.\n${serialized}`;
    case 'remove_label':
      return `Remove the relevant Gmail label from these exact thread IDs.\n${serialized}`;
    case 'unsubscribe_sender':
      return `Check whether these sender threads support safe unsubscribe via List-Unsubscribe metadata.\n${serialized}`;
  }
}

function ListCard({ title, items }: { title: string; items: ResultListItem[] }) {
  if (items.length === 0) return null;

  return (
    <div className="mt-3 rounded-[12px] border border-[var(--border)] bg-[var(--bg)] overflow-hidden">
      <div className="border-b border-[var(--border)] px-3 py-2 text-[11px] font-mono uppercase tracking-[0.08em] text-[var(--text-faint)]">
        {title}
      </div>
      <div className="divide-y divide-[var(--border)]">
        {items.map((item, index) => (
          <div key={`${item.title}-${index}`} className="flex items-start gap-3 px-3 py-3">
            <div className="min-w-0 flex-1">
              <div className="text-[12px] font-medium text-[var(--text)]">{item.title}</div>
              {item.subtitle && (
                <div className="mt-0.5 text-[11px] text-[var(--text-dim)]">{item.subtitle}</div>
              )}
              {item.meta && (
                <div className="mt-1 text-[10px] font-mono text-[var(--text-faint)]">{item.meta}</div>
              )}
            </div>
            {item.url && (
              <button
                onClick={() => window.open(item.url, '_blank')}
                className="shrink-0 rounded-[6px] border border-[var(--border2)] bg-[var(--surface2)] p-1.5 text-[var(--text-faint)] hover:text-[var(--text)] cursor-pointer"
                title="Open"
              >
                <ExternalLink size={12} />
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function AgendaCard({ title, items }: { title: string; items: AgendaEvent[] }) {
  if (items.length === 0) return null;
  return (
    <div className="mt-3 rounded-[12px] border border-[var(--border)] bg-[var(--bg)] overflow-hidden">
      <div className="border-b border-[var(--border)] px-3 py-2 text-[11px] font-mono uppercase tracking-[0.08em] text-[var(--text-faint)]">
        {title}
      </div>
      <div className="divide-y divide-[var(--border)]">
        {items.map((ev, i) => (
          <div key={`${ev.title}-${i}`} className="px-3 py-3">
            <div className="flex items-start gap-3">
              <div className="w-12 shrink-0 text-[11px] font-mono text-[var(--accent)] font-medium">{ev.time}</div>
              <div className="min-w-0 flex-1">
                <div className="text-[12px] font-medium text-[var(--text)]">{ev.title}</div>
                {ev.attendees && ev.attendees.length > 0 && (
                  <div className="mt-0.5 text-[11px] text-[var(--text-dim)]">{ev.attendees.join(', ')}</div>
                )}
                {ev.prep_note && (
                  <div className="mt-1 text-[11px] text-[var(--amber)] bg-[var(--amber-dim)] rounded-[4px] px-2 py-1 inline-block">{ev.prep_note}</div>
                )}
                {ev.linked_docs && ev.linked_docs.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {ev.linked_docs.map((doc, j) => (
                      <button
                        key={j}
                        onClick={() => window.open(doc.url, '_blank')}
                        className="flex items-center gap-1 text-[10px] text-[var(--accent)] hover:underline cursor-pointer"
                      >
                        <FileText size={10} />
                        {doc.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {ev.url && (
                <button
                  onClick={() => window.open(ev.url, '_blank')}
                  className="shrink-0 rounded-[6px] border border-[var(--border2)] bg-[var(--surface2)] p-1.5 text-[var(--text-faint)] hover:text-[var(--text)] cursor-pointer"
                  title="Open event"
                >
                  <ExternalLink size={12} />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function TriageBucket({ label, items, color, selectedIds, onToggle }: { label: string; items: TriageItem[]; color: string; selectedIds: string[]; onToggle: (threadId: string) => void }) {
  if (items.length === 0) return null;
  return (
    <div>
      <div className={`px-3 py-1.5 text-[10px] font-mono uppercase tracking-[0.08em] ${color} border-b border-[var(--border)]`}>
        {label} ({items.length})
      </div>
      <div className="divide-y divide-[var(--border)]">
        {items.map((item, i) => (
          <div key={`${item.subject}-${i}`} className="px-3 py-2.5">
            <div className="flex items-start gap-2">
              {item.thread_id && (
                <input
                  type="checkbox"
                  checked={selectedIds.includes(item.thread_id)}
                  onChange={() => onToggle(item.thread_id!)}
                  className="mt-0.5 h-4 w-4 accent-[var(--accent)] cursor-pointer"
                  aria-label={`Select ${item.subject}`}
                />
              )}
              <div className="min-w-0 flex-1">
                <div className="text-[12px] font-medium text-[var(--text)]">{item.subject}</div>
                <div className="mt-0.5 text-[11px] text-[var(--text-dim)]">{item.sender}</div>
                {item.summary && (
                  <div className="mt-0.5 text-[11px] text-[var(--text-faint)]">{item.summary}</div>
                )}
                {item.reason && (
                  <div className="mt-1 inline-block rounded-[6px] bg-[var(--surface2)] px-2 py-1 text-[10px] text-[var(--text-faint)]">{item.reason}</div>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function TriageCard({ title, data }: { title: string; data: { action_required: TriageItem[]; review: TriageItem[]; low_priority: TriageItem[] } }) {
  const { sendMessage } = useChatContext();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const toggleSelected = (threadId: string) => {
    setSelectedIds((prev) => prev.includes(threadId) ? prev.filter((id) => id !== threadId) : [...prev, threadId]);
  };
  const selectedItems = [...data.action_required, ...data.review, ...data.low_priority].filter((item) => item.thread_id && selectedIds.includes(item.thread_id));

  return (
    <div className="mt-3 rounded-[12px] border border-[var(--border)] bg-[var(--bg)] overflow-hidden">
      <div className="border-b border-[var(--border)] px-3 py-2 text-[11px] font-mono uppercase tracking-[0.08em] text-[var(--text-faint)]">
        {title}
      </div>
      <div className="flex flex-wrap gap-2 border-b border-[var(--border)] px-3 py-2">
        <button
          onClick={() => void sendMessage(buildInboxActionPrompt('archive_threads', selectedItems.length > 0 ? selectedItems : data.low_priority))}
          className="inline-flex items-center gap-1 rounded-full border border-[var(--accent)]/30 bg-[var(--accent-dim)]/20 px-2.5 py-1 text-[11px] font-medium text-[var(--accent)] cursor-pointer"
        >
          <Archive size={12} />
          Archive low priority
        </button>
        <button
          onClick={() => void sendMessage(buildInboxActionPrompt('mute_threads', selectedItems.length > 0 ? selectedItems : data.low_priority))}
          className="inline-flex items-center gap-1 rounded-full border border-[var(--border)] px-2.5 py-1 text-[11px] text-[var(--text-dim)] cursor-pointer"
        >
          <VolumeX size={12} />
          Mute similar
        </button>
        <button
          onClick={() => void sendMessage(buildInboxActionPrompt('mark_read', selectedItems.length > 0 ? selectedItems : [...data.review, ...data.low_priority]))}
          className="inline-flex items-center gap-1 rounded-full border border-[var(--border)] px-2.5 py-1 text-[11px] text-[var(--text-dim)] cursor-pointer"
        >
          <Check size={12} />
          Mark all read
        </button>
        <button
          onClick={() => void sendMessage(buildInboxActionPrompt('create_filter', selectedItems.length > 0 ? selectedItems : data.low_priority))}
          className="inline-flex items-center gap-1 rounded-full border border-[var(--border)] px-2.5 py-1 text-[11px] text-[var(--text-dim)] cursor-pointer"
        >
          <Mail size={12} />
          Create filter
        </button>
      </div>
      <TriageBucket label="Action Required" items={data.action_required} color="text-[var(--error)]" selectedIds={selectedIds} onToggle={toggleSelected} />
      <TriageBucket label="Review" items={data.review} color="text-[var(--amber)]" selectedIds={selectedIds} onToggle={toggleSelected} />
      <TriageBucket label="Low Priority" items={data.low_priority} color="text-[var(--text-faint)]" selectedIds={selectedIds} onToggle={toggleSelected} />
    </div>
  );
}

function BulkActionPreviewCard({
  title,
  actionType,
  effect,
  items,
  undoAvailable,
  auditId,
  onUndo,
}: {
  title: string;
  actionType: InboxActionType;
  effect: string;
  items: BulkActionPreviewItem[];
  undoAvailable?: boolean;
  auditId?: string;
  onUndo?: (auditId: string) => void;
}) {
  return (
    <div className="mt-3 rounded-[12px] border border-[var(--border)] bg-[var(--bg)] overflow-hidden">
      <div className="border-b border-[var(--border)] px-3 py-2 text-[11px] font-mono uppercase tracking-[0.08em] text-[var(--text-faint)]">
        {title}
      </div>
      <div className="border-b border-[var(--border)] px-3 py-2 text-[11px] text-[var(--text-dim)] flex items-center justify-between gap-3">
        <span>{effect}</span>
        {undoAvailable && auditId && onUndo && (
          <button
            type="button"
            onClick={() => onUndo(auditId)}
            className="rounded-full border border-[var(--accent)]/30 bg-[var(--accent-dim)]/20 px-2.5 py-1 text-[10px] font-medium text-[var(--accent)] cursor-pointer"
          >
            Undo
          </button>
        )}
      </div>
      <div className="divide-y divide-[var(--border)]">
        {items.map((item) => (
          <div key={item.thread_id} className="px-3 py-2.5">
            <div className="text-[12px] font-medium text-[var(--text)]">{item.subject}</div>
            <div className="mt-0.5 text-[11px] text-[var(--text-dim)]">{item.sender}</div>
            {item.reason && <div className="mt-1 text-[11px] text-[var(--text-faint)]">{item.reason}</div>}
            {item.status && (
              <div className={`mt-1 text-[10px] font-mono uppercase tracking-[0.06em] ${item.status === 'failed' ? 'text-[var(--error)]' : item.status === 'completed' ? 'text-[var(--accent)]' : 'text-[var(--text-faint)]'}`}>
                {item.status}
                {item.error ? ` - ${item.error}` : ''}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function SheetCard({ title, data }: { title: string; data: { headers: string[]; rows: string[][] } }) {
  return (
    <div className="mt-3 rounded-[12px] border border-[var(--border)] bg-[var(--bg)] overflow-hidden overflow-x-auto">
      <div className="border-b border-[var(--border)] px-3 py-2 text-[11px] font-mono uppercase tracking-[0.08em] text-[var(--text-faint)]">
        {title}
      </div>
      <table className="w-full text-[12px]">
        <thead>
          <tr className="border-b border-[var(--border2)]">
            {data.headers.map((h, i) => (
              <th key={i} className="text-left px-3 py-2 text-[11px] font-semibold text-[var(--text)] uppercase tracking-[0.05em] whitespace-nowrap">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.rows.map((row, i) => (
            <tr key={i} className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--surface)]">
              {row.map((cell, j) => (
                <td key={j} className="px-3 py-2 text-[var(--text-dim)]">{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BlockRenderer({ block }: { block: AssistantBlock }) {
  const { undoInboxActionFromAudit } = useChatContext();

  console.log('[BlockRenderer] Rendering block type:', block.type, block);

  if (block.type === 'status') {
    return (
      <div className="mt-3 rounded-[12px] border border-[var(--border)] bg-[var(--bg)] px-3 py-3">
        <div className="text-[12px] font-medium text-[var(--text)]">{block.title}</div>
        <div className="mt-1 text-[12px] text-[var(--text-dim)] leading-relaxed md-content" dangerouslySetInnerHTML={{ __html: renderMarkdown(block.body) }} />
      </div>
    );
  }

  if (block.type === 'fact_list') {
    return (
      <div className="mt-3 rounded-[12px] border border-[var(--border)] bg-[var(--bg)] overflow-hidden">
        <div className="border-b border-[var(--border)] px-3 py-2 text-[11px] font-mono uppercase tracking-[0.08em] text-[var(--text-faint)]">
          {block.title}
        </div>
        <div className="divide-y divide-[var(--border)]">
          {block.items.map((item) => (
            <div key={item.label} className="flex items-start gap-3 px-3 py-2.5">
              <div className="w-20 shrink-0 text-[10px] font-mono uppercase tracking-[0.06em] text-[var(--text-faint)]">
                {item.label}
              </div>
              <div className="text-[12px] text-[var(--text)] break-words md-content" dangerouslySetInnerHTML={{ __html: renderMarkdown(item.value) }} />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (block.type === 'agenda') {
    return <AgendaCard title={block.title} items={block.items} />;
  }

  if (block.type === 'triage') {
    return <TriageCard title={block.title} data={block.data} />;
  }

  if (block.type === 'bulk_action_preview') {
    return (
      <BulkActionPreviewCard
        title={block.title}
        actionType={block.actionType}
        effect={block.effect}
        items={block.items}
        undoAvailable={block.undoAvailable}
        auditId={block.auditId}
        onUndo={(auditId) => void undoInboxActionFromAudit(auditId)}
      />
    );
  }

  if (block.type === 'sheet_data') {
    return <SheetCard title={block.title} data={block.data} />;
  }

  if (block.type === 'email_draft') {
    return <EmailDraftCard data={block.data} />;
  }

  return <ListCard title={block.title} items={(block as any).items} />;
}

function ApprovalCard({ approval, onApprove, onCancel }: {
  approval: ApprovalRequest;
  onApprove: (approval: ApprovalRequest) => void;
  onCancel: () => void;
}) {
  const [fields, setFields] = useState(approval.fields);

  useEffect(() => {
    setFields(approval.fields);
  }, [approval.id, approval.fields]);

  const requiredFields = useMemo(() => {
    switch (approval.toolName) {
      case 'send_email':
        return ['to', 'subject', 'body'];
      case 'create_calendar_event':
        return ['summary', 'start_time', 'end_time'];
      case 'create_task':
        return ['title'];
      case 'create_drive_folder':
        return ['name'];
      case 'docs_write':
        return ['doc_id', 'content'];
      case 'sheets_append':
        return ['spreadsheet_id', 'range', 'values'];
      case 'drive_upload':
        return ['file_path'];
      case 'save_email_to_doc':
        return ['thread_id'];
      case 'archive_email_threads':
      case 'trash_email_threads':
      case 'restore_email_threads':
      case 'mute_email_threads':
      case 'mark_threads_read':
      case 'unsubscribe_from_sender':
        return ['thread_ids'];
      case 'apply_label_to_threads':
        return ['thread_ids', 'label_name'];
      case 'create_gmail_filter':
        return [];
      default:
        return [];
    }
  }, [approval.toolName]);

  const isDisabled = useMemo(
    () => requiredFields.some((key) => !fields.find((field) => field.key === key)?.value.trim()),
    [fields, requiredFields],
  );

  return (
    <div className="mt-3 rounded-[14px] border border-[var(--amber-border)] bg-[var(--amber-dim)]/40 p-4">
      <div className="flex items-center gap-2">
        <Sparkles size={14} className="text-[var(--amber)]" />
        <div className="text-[13px] font-semibold text-[var(--text)]">{approval.title}</div>
      </div>
      <p className="mt-1 text-[12px] text-[var(--text-dim)] leading-relaxed">{approval.summary}</p>
      {(approval.beforePreview || approval.afterPreview) && (
        <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-2">
          {approval.beforePreview && (
            <div className="rounded-[10px] border border-[var(--border)] bg-[var(--bg)] p-2.5">
              <div className="text-[10px] font-mono uppercase tracking-[0.06em] text-[var(--text-faint)] mb-1">Before</div>
              {Object.entries(approval.beforePreview).map(([key, value]) => (
                <div key={key} className="text-[11px] text-[var(--text-dim)]">
                  <span className="text-[var(--text-faint)]">{key}:</span> {value}
                </div>
              ))}
            </div>
          )}
          {approval.afterPreview && (
            <div className="rounded-[10px] border border-[var(--amber-border)] bg-[var(--bg)] p-2.5">
              <div className="text-[10px] font-mono uppercase tracking-[0.06em] text-[var(--amber)] mb-1">After</div>
              {Object.entries(approval.afterPreview).map(([key, value]) => (
                <div key={key} className="text-[11px] text-[var(--text)]">
                  <span className="text-[var(--text-faint)]">{key}:</span> {value}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      <div className="mt-4 space-y-3">
        {fields.map((field) => (
          <label key={field.key} className="block">
            <div className="mb-1 text-[10px] font-mono uppercase tracking-[0.06em] text-[var(--text-faint)]">
              {field.label}
            </div>
            {field.multiline ? (
              <textarea
                value={field.value}
                onChange={(event) => setFields((prev) => prev.map((entry) => entry.key === field.key ? { ...entry, value: event.target.value } : entry))}
                rows={field.key === 'body' ? 6 : 3}
                className="w-full rounded-[10px] border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-[12px] text-[var(--text)] outline-none focus:border-[var(--amber-border)]"
                placeholder={field.placeholder}
              />
            ) : (
              <input
                value={field.value}
                onChange={(event) => setFields((prev) => prev.map((entry) => entry.key === field.key ? { ...entry, value: event.target.value } : entry))}
                className="w-full rounded-[10px] border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-[12px] text-[var(--text)] outline-none focus:border-[var(--amber-border)]"
                placeholder={field.placeholder}
              />
            )}
          </label>
        ))}
      </div>
      <div className="mt-4 flex gap-2">
        <button
          onClick={() => onApprove({ ...approval, fields })}
          disabled={isDisabled}
          className="rounded-[10px] bg-[var(--amber)] px-3 py-2 text-[12px] font-semibold text-black disabled:opacity-50 cursor-pointer"
        >
          {approval.confirmLabel}
        </button>
        <button
          onClick={onCancel}
          className="rounded-[10px] border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-[12px] font-medium text-[var(--text-dim)] cursor-pointer"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function SuggestionChips({ suggestions, preserveActiveView }: { suggestions: string[]; preserveActiveView: boolean }) {
  const { sendMessage } = useChatContext();

  return (
    <div className="flex flex-wrap gap-2 mt-3">
      {suggestions.map((text) => (
        <button
          key={text}
          onClick={() => void sendMessage(text, preserveActiveView ? { preserveActiveView: true } : undefined)}
          className="px-3 py-1.5 rounded-full text-[12px] font-medium border border-[var(--accent)]/30 text-[var(--accent)] bg-[var(--accent-dim)]/20 hover:bg-[var(--accent-dim)] hover:border-[var(--accent)]/50 transition-all cursor-pointer"
        >
          {text}
        </button>
      ))}
    </div>
  );
}

function MessageBubble({ msg, isLast }: { msg: Message; isLast?: boolean }) {
  const { activeView, approveAction, dismissApproval, editAssistantMessage } = useChatContext();
  const [toolsExpanded, setToolsExpanded] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [draftContent, setDraftContent] = useState(msg.content);
  const isUser = msg.role === 'user';

  useEffect(() => {
    setDraftContent(msg.content);
  }, [msg.id, msg.content]);

  if (isUser) {
    return (
      <div className="flex gap-3 flex-row-reverse mb-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
        <div className="w-8 h-8 rounded-full shrink-0 flex items-center justify-center mt-0.5 bg-[var(--surface3)] border border-[var(--border)]">
          <User size={14} className="text-[var(--text-dim)]" />
        </div>
        <div className="max-w-[82%] px-3.5 py-2.5 rounded-2xl text-[13px] leading-relaxed bg-[var(--surface2)] border border-[var(--border)] text-[var(--text)] shadow-sm">
          {msg.displayContent ?? msg.content}
        </div>
      </div>
    );
  }

  const hasToolEvents = msg.toolEvents && msg.toolEvents.length > 0;
  const isStreaming = msg.status === 'streaming';
  const toolErrors = msg.toolEvents?.filter((e) => e.status === 'error') ?? [];
  const canEdit = !isStreaming && !!msg.content.trim();

  return (
    <div className="flex gap-3 mb-5 animate-in fade-in slide-in-from-bottom-2 duration-400">
      <div className="w-7 h-7 rounded-full shrink-0 flex items-center justify-center mt-0.5 bg-gradient-to-tr from-[var(--accent-dim)] to-[var(--accent)]/20 border border-[var(--accent)]/30">
        <Bot size={13} className="text-[var(--accent)]" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex flex-col gap-2">
          {/* Tool activity log — Claude Code style */}
          {hasToolEvents && (
            <div className="mb-2">
              {/* Auto-expand during streaming, collapsible summary after */}
              {isStreaming ? (
                <ToolActivityLog events={msg.toolEvents} expanded={true} />
              ) : (
                <>
                  <button
                    onClick={() => setToolsExpanded(!toolsExpanded)}
                    className="flex items-center gap-1.5 font-mono text-[12px] text-[var(--text-faint)] hover:text-[var(--text-dim)] transition-colors cursor-pointer"
                  >
                    <ChevronRight size={11} className={`transition-transform duration-200 ${toolsExpanded ? 'rotate-90' : ''}`} />
                    <span>
                      {msg.toolEvents!.length} step{msg.toolEvents!.length !== 1 ? 's' : ''}
                      {toolErrors.length > 0 && (
                        <span className="text-[var(--error)] ml-1">· {toolErrors.length} failed</span>
                      )}
                    </span>
                  </button>
                  <ToolActivityLog events={msg.toolEvents} expanded={toolsExpanded} />
                </>
              )}
            </div>
          )}

          {/* Message content */}
          {(msg.content || (isStreaming && !hasToolEvents && !msg.approval && (msg.blocks ?? []).length === 0)) && (
            <div className="md-content text-[14px] leading-relaxed text-[var(--text)] prose prose-invert max-w-none">
              {msg.content && isEditing ? (
                <div className="mt-1 rounded-[12px] border border-[var(--border)] bg-[var(--bg)] p-2.5">
                  <textarea
                    value={draftContent}
                    onChange={(event) => setDraftContent(event.target.value)}
                    rows={Math.min(24, Math.max(8, draftContent.split('\n').length + 2))}
                    className="w-full resize-y rounded-[10px] border border-[var(--border2)] bg-[var(--surface)] px-3 py-2.5 text-[13px] leading-relaxed text-[var(--text)] outline-none focus:border-[var(--accent)]"
                  />
                  <div className="mt-2 flex items-center justify-end gap-2">
                    <button
                      onClick={() => {
                        setDraftContent(msg.content);
                        setIsEditing(false);
                      }}
                      className="rounded-[8px] border border-[var(--border)] bg-[var(--bg)] px-2.5 py-1.5 text-[11px] font-medium text-[var(--text-dim)] hover:text-[var(--text)] cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => {
                        editAssistantMessage(msg.id, draftContent);
                        setIsEditing(false);
                      }}
                      disabled={!draftContent.trim()}
                      className="inline-flex items-center gap-1 rounded-[8px] bg-[var(--accent)]/20 px-2.5 py-1.5 text-[11px] font-semibold text-[var(--accent)] disabled:opacity-50 cursor-pointer"
                    >
                      <Check size={12} />
                      Save
                    </button>
                  </div>
                </div>
              ) : msg.content ? (
                <div dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content) }} />
              ) : isStreaming && !hasToolEvents ? (
                <div className="flex gap-1.5 items-center h-6">
                  {[0, 1, 2].map((i) => (
                    <span
                      key={i}
                      className="w-1.5 h-1.5 rounded-full bg-[var(--accent)]"
                      style={{ animation: `pulse 1.2s ease-in-out ${i * 0.2}s infinite` }}
                    />
                  ))}
                </div>
              ) : null}
            </div>
          )}

          {canEdit && !msg.approval && (
            <div className="-mt-1">
              <button
                onClick={() => setIsEditing((prev) => !prev)}
                className="inline-flex items-center gap-1 rounded-[8px] border border-[var(--border)] bg-[var(--bg)] px-2 py-1 text-[10px] font-mono uppercase tracking-[0.04em] text-[var(--text-faint)] hover:text-[var(--text)] hover:border-[var(--border2)] cursor-pointer"
              >
                <PencilLine size={11} />
                {isEditing ? 'Close editor' : 'Edit plan'}
              </button>
            </div>
          )}

          {/* Status, email draft, and inbox action blocks render inline — larger data blocks go to Artifacts sidebar */}
          {(msg.blocks ?? []).filter((b) => b.type === 'status' || b.type === 'bulk_action_preview' || b.type === 'email_draft').length > 0 && (
            <div className="flex flex-col gap-4 mt-2">
              {(msg.blocks ?? []).filter((b) => b.type === 'status' || b.type === 'bulk_action_preview' || b.type === 'email_draft').map((block, index) => (
                <BlockRenderer key={`${block.type}-${index}`} block={block} />
              ))}
            </div>
          )}

          {/* Approval required - ensure this is visible */}
          {msg.approval && (
            <div className="mt-4 animate-in fade-in zoom-in-95 duration-500">
              <ApprovalCard
                approval={msg.approval}
                onApprove={(approval) => { void approveAction(msg.id, approval); }}
                onCancel={() => dismissApproval(msg.id)}
              />
            </div>
          )}

          {/* Suggestion chips — only on the last completed assistant message */}
          {isLast && !isStreaming && msg.suggestions && msg.suggestions.length > 0 && (
            <SuggestionChips suggestions={msg.suggestions} preserveActiveView={activeView !== 'chat' && activeView !== 'dashboard'} />
          )}
        </div>
      </div>
    </div>
  );
}

function TypingIndicator() {
  return (
    <div className="flex gap-4 mb-8">
      <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-[var(--surface3)] to-[var(--surface2)] shrink-0 flex items-center justify-center mt-1 border border-[var(--border)]">
        <Bot size={14} className="text-[var(--text-faint)] animate-pulse" />
      </div>
      <div className="flex gap-1.5 items-center px-4 py-3 rounded-2xl bg-[var(--surface)] border border-[var(--border)]">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="w-1.5 h-1.5 rounded-full bg-[var(--text-faint)]"
            style={{ animation: `pulse 1.2s ease-in-out ${i * 0.2}s infinite` }}
          />
        ))}
      </div>
    </div>
  );
}

interface Props {
  title?: string;
  showCloseButton?: boolean;
  hideHeader?: boolean;
}

export default function ChatThread({ title = AGENT_NAME, showCloseButton = true, hideHeader = false }: Props) {
  const { activeView, messages, isLoading, newChat, closeChat, sendMessage } = useChatContext();
  const scrollRef = useRef<HTMLDivElement>(null);
  const preserveActiveView = activeView !== 'chat' && activeView !== 'dashboard';

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, isLoading]);

  const isEmpty = messages.length === 0 && !isLoading;

  return (
    <div className="w-full px-4 flex flex-col flex-1 min-h-0 overflow-hidden relative">
      {!hideHeader && (
        <div className="flex items-center justify-between py-4 border-b border-[var(--border)] mb-4">
          <div className="flex flex-col">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-[var(--accent)] animate-pulse" />
              <span className="text-[14px] font-bold text-[var(--text)] tracking-tight">
                {title}
              </span>
            </div>
            <span className="text-[11px] text-[var(--text-faint)] mt-0.5">
              {isLoading ? 'Processing your request...' : 'Ready to help with your workspace'}
            </span>
          </div>
          <div className="flex gap-2">
            <button
              onClick={newChat}
              className="flex items-center gap-2 px-3 py-1.5 rounded-xl text-[11px] font-medium text-[var(--text-dim)] hover:text-[var(--text)] hover:bg-[var(--surface2)] border border-transparent hover:border-[var(--border)] transition-all cursor-pointer"
            >
              <RotateCcw size={13} />
              <span>New Chat</span>
            </button>
            {showCloseButton && (
              <button
                onClick={closeChat}
                className="w-8 h-8 rounded-xl flex items-center justify-center text-[var(--text-faint)] hover:text-[var(--text-dim)] hover:bg-[var(--surface2)] transition-all cursor-pointer"
              >
                <X size={16} />
              </button>
            )}
          </div>
        </div>
      )}

      <div ref={scrollRef} className="flex-1 overflow-y-auto flex flex-col gap-3 pb-2">
        {isEmpty ? (
          <div className="flex flex-col gap-3 pt-2">
            <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-4">
              <div className="flex items-center gap-2 text-[var(--accent)]">
                <Sparkles size={14} />
                <span className="text-[12px] font-mono uppercase tracking-[0.08em]">Ready to delegate</span>
              </div>
              <p className="mt-1.5 text-[12px] text-[var(--text-dim)] leading-relaxed">
                Describe the outcome you want. FlowSpace will run the steps and stop for approval before any write action.
              </p>
            </div>
            <div className="grid grid-cols-1 gap-2.5">
              {WORKFLOW_CARDS.map((card) => (
                <button
                  key={card.prompt}
                  onClick={() => void sendMessage(card.prompt, preserveActiveView ? { preserveActiveView: true } : undefined)}
                  className="flex items-start gap-3 p-4 rounded-[var(--radius-md)] bg-[var(--surface)] border border-[var(--border)] hover:border-[var(--border2)] hover:bg-[var(--surface2)] transition-all text-left cursor-pointer group"
                >
                  <div className="w-8 h-8 rounded-[var(--radius-sm)] bg-[var(--accent-dim)] flex items-center justify-center shrink-0 group-hover:bg-[var(--accent)] group-hover:text-black transition-colors">
                    <card.icon size={15} className="text-[var(--accent)] group-hover:text-black transition-colors" />
                  </div>
                  <div>
                    <div className="text-[13px] font-medium text-[var(--text)]">{card.label}</div>
                    <div className="text-[11px] text-[var(--text-faint)] mt-0.5">{card.desc}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            {messages.map((msg, index) => (
              <MessageBubble key={msg.id} msg={msg} isLast={index === messages.length - 1} />
            ))}
          </>
        )}
      </div>

      <style>{`
        @keyframes pulse {
          0%, 80%, 100% { opacity: 0.3; transform: scale(0.8); }
          40% { opacity: 1; transform: scale(1); }
        }

        .md-h1 { font-size: 16px; font-weight: 600; margin: 12px 0 6px; color: var(--text); }
        .md-h2 { font-size: 14px; font-weight: 600; margin: 10px 0 4px; color: var(--text); }
        .md-h3 { font-size: 13px; font-weight: 600; margin: 8px 0 4px; color: var(--text-dim); }
        .md-p { margin: 2px 0; }
        .md-hr { border: none; border-top: 1px solid var(--border); margin: 10px 0; }
        .md-code {
          background: var(--bg);
          padding: 1px 5px;
          border-radius: 4px;
          font-size: 11px;
          font-family: var(--font-mono);
          color: var(--text-dim);
        }
        .md-pre {
          background: var(--bg);
          border-radius: var(--radius-sm);
          padding: 12px;
          margin: 8px 0;
          overflow-x: auto;
          font-size: 11px;
          font-family: var(--font-mono);
          color: var(--text-dim);
          line-height: 1.5;
        }
        .md-ul, .md-ol {
          margin: 4px 0;
          padding-left: 20px;
        }
        .md-ul { list-style-type: disc; }
        .md-ol { list-style-type: decimal; }
        .md-ul li, .md-ol li {
          margin: 3px 0;
          padding-left: 4px;
        }
        .md-table {
          width: 100%;
          border-collapse: collapse;
          margin: 8px 0;
          font-size: 12px;
        }
        .md-table th {
          text-align: left;
          padding: 8px 12px;
          border-bottom: 2px solid var(--border2);
          color: var(--text);
          font-weight: 600;
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          white-space: nowrap;
        }
        .md-table td {
          padding: 7px 12px;
          border-bottom: 1px solid var(--border);
          color: var(--text-dim);
          vertical-align: top;
        }
        .md-table tbody tr:hover {
          background: var(--surface-hover);
        }
        .md-table tbody tr:last-child td {
          border-bottom: none;
        }
        .md-link {
          color: var(--accent);
          text-decoration: underline;
          text-decoration-color: var(--accent);
          text-underline-offset: 2px;
          word-break: break-all;
        }
        .md-link:hover {
          opacity: 0.8;
        }
        .md-deadline {
          color: var(--error);
          font-weight: 700;
        }
      `}</style>
    </div>
  );
}
