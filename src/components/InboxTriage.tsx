import { useState } from 'react';
import {
  Mail, ChevronRight, Reply, Eye, Trash2, ExternalLink,
  Archive, CalendarCheck, CalendarX, Clock, ListPlus, CheckCircle,
  AlertTriangle, HelpCircle, Sparkles,
} from 'lucide-react';
import type { InboxTriageItem, EmailAction, EmailActionType } from '../services/api';
import type { InboxActionType } from '../shared/chat';
import { buildTriageFeedbackTarget, type ImportanceFeedbackTarget } from '../lib/importance-feedback';

interface Props {
  needsReply: InboxTriageItem[];
  needsInput: InboxTriageItem[];
  fyiOnly: InboxTriageItem[];
  canIgnore: InboxTriageItem[];
  accountEmail?: string | null;
  onDraftReply: (threadId: string) => void;
  onEmailAction?: (action: EmailAction) => void;
  onBulkAction?: (actionType: InboxActionType, items: InboxTriageItem[]) => void;
  onIgnore: (target?: ImportanceFeedbackTarget) => void;
  onImportant: (target?: ImportanceFeedbackTarget) => void;
  onNotImportant: (target?: ImportanceFeedbackTarget) => void;
  isFeedbackPending: (target?: ImportanceFeedbackTarget) => boolean;
  getFeedbackError: (target?: ImportanceFeedbackTarget) => string | undefined;
  onOpenThread?: (threadId: string) => void;
  onAskAgent?: () => void;
  kanbanMode?: boolean;
}

const ACTION_STYLES: Record<EmailActionType, { color: string; bg: string; border: string; Icon: typeof Reply }> = {
  draft_reply:      { color: 'var(--amber)',  bg: 'var(--amber-dim)',   border: 'var(--amber-border)', Icon: Reply },
  accept_meeting:   { color: 'var(--green)',  bg: 'var(--green-dim)',   border: 'var(--green-border)', Icon: CalendarCheck },
  reject_meeting:   { color: 'var(--red)',    bg: 'var(--red-dim)',     border: 'var(--red-border)',   Icon: CalendarX },
  suggest_time:     { color: 'var(--blue)',   bg: 'var(--blue-dim)',    border: 'var(--blue-border)',  Icon: Clock },
  create_task:      { color: 'var(--blue)',   bg: 'var(--blue-dim)',    border: 'var(--blue-border)',  Icon: ListPlus },
  approve_request:  { color: 'var(--green)',  bg: 'var(--green-dim)',   border: 'var(--green-border)', Icon: CheckCircle },
  open_form:        { color: 'var(--text-dim)', bg: 'var(--surface3)', border: 'var(--border)',       Icon: ExternalLink },
  add_to_calendar:  { color: 'var(--blue)',   bg: 'var(--blue-dim)',    border: 'var(--blue-border)',  Icon: CalendarCheck },
  archive_threads:  { color: 'var(--text-dim)', bg: 'var(--surface3)', border: 'var(--border)',       Icon: Archive },
  mute_threads:     { color: 'var(--text-dim)', bg: 'var(--surface3)', border: 'var(--border)',       Icon: Mail },
  mark_read:        { color: 'var(--text-dim)', bg: 'var(--surface3)', border: 'var(--border)',       Icon: Eye },
  apply_label:      { color: 'var(--blue)',   bg: 'var(--blue-dim)',    border: 'var(--blue-border)',  Icon: CheckCircle },
  unsubscribe_sender:{ color: 'var(--text-dim)', bg: 'var(--surface3)', border: 'var(--border)',      Icon: ExternalLink },
  create_filter:    { color: 'var(--text-dim)', bg: 'var(--surface3)', border: 'var(--border)',       Icon: Mail },
};

function EmailActionChip({ action, onAction }: { action: EmailAction; onAction?: (action: EmailAction) => void }) {
  const style = ACTION_STYLES[action.type] ?? ACTION_STYLES.draft_reply;
  const { Icon } = style;

  return (
    <button
      onClick={(e) => { e.stopPropagation(); onAction?.(action); }}
      className="inline-flex items-center gap-[4px] text-[10px] font-medium px-[7px] py-[4px] min-h-[28px] rounded-[5px] cursor-pointer hover:brightness-125 active:translate-y-px transition-all whitespace-nowrap"
      style={{
        backgroundColor: style.bg,
        border: `1px solid ${style.border}`,
        color: style.color,
      }}
      aria-label={action.conflict ? `${action.label} — warning: ${action.conflict}` : action.label}
      title={action.conflict ? `⚠ ${action.conflict}` : action.detail || action.label}
    >
      {action.conflict && <AlertTriangle size={9} className="shrink-0" aria-hidden="true" />}
      <Icon size={10} className="shrink-0" aria-hidden="true" />
      <span>{action.label}</span>
    </button>
  );
}

function senderName(from: string): string {
  const match = from.match(/^([^<]+)/);
  return match ? match[1].trim() : from;
}

function Section({
  title,
  icon: Icon,
  items,
  defaultOpen,
  onDraftReply,
  accountEmail,
  onEmailAction,
  accentColor,
  countStyle,
  showActions = false,
  onBulkAction,
  bulkActions = [],
  onIgnore,
  onImportant,
  onNotImportant,
  isFeedbackPending,
  getFeedbackError,
  onOpenThread,
  bucket,
}: {
  title: string;
  icon: typeof Mail;
  items: InboxTriageItem[];
  bucket: 'needs_reply' | 'needs_input' | 'fyi_only' | 'can_ignore';
  defaultOpen: boolean;
  onDraftReply: (threadId: string) => void;
  accountEmail?: string | null;
  onEmailAction?: (action: EmailAction) => void;
  accentColor?: string;
  countStyle: string;
  showActions?: boolean;
  onBulkAction?: (actionType: InboxActionType, items: InboxTriageItem[]) => void;
  bulkActions?: Array<{ type: InboxActionType; label: string }>;
  onIgnore: (target?: ImportanceFeedbackTarget) => void;
  onImportant: (target?: ImportanceFeedbackTarget) => void;
  onNotImportant: (target?: ImportanceFeedbackTarget) => void;
  isFeedbackPending: (target?: ImportanceFeedbackTarget) => boolean;
  getFeedbackError: (target?: ImportanceFeedbackTarget) => string | undefined;
  onOpenThread?: (threadId: string) => void;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  if (items.length === 0 && !defaultOpen) return null;
  const selectedItems = items.filter((item) => item.thread_id && selectedIds.includes(item.thread_id));

  return (
    <div className="border-b border-[var(--border)] last:border-b-0">
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-controls={`section-${title.replace(/\s+/g, '-').toLowerCase()}`}
        className="w-full flex items-center gap-2 px-4 py-[12px] hover:bg-white/[0.03] transition-colors cursor-pointer select-none"
      >
        <ChevronRight
          size={10}
          className={`text-[var(--text-faint)] transition-transform duration-150 ${open ? 'rotate-90' : ''}`}
        />
        <Icon size={13} style={{ color: accentColor }} />
        <span className="text-[12px] font-semibold flex-1 text-left" style={{ color: accentColor || 'var(--text-dim)' }}>
          {title}
        </span>
        <span className={`font-mono text-[10px] px-[7px] py-px rounded-[10px] ${countStyle}`}>
          {items.length}
        </span>
      </button>

      {open && items.length > 0 && (
        <div id={`section-${title.replace(/\s+/g, '-').toLowerCase()}`} className="py-2 pb-3">
          {bulkActions.length > 0 && onBulkAction && (
            <div className="px-4 py-2 flex flex-wrap gap-2">
              {bulkActions.map((action) => (
                <button
                  key={action.type}
                  onClick={(event) => {
                    event.stopPropagation();
                    onBulkAction(action.type, selectedItems.length > 0 ? selectedItems : items);
                  }}
                  className="inline-flex items-center gap-1 rounded-full border border-[var(--border)] px-2.5 py-1 text-[10px] text-[var(--text-dim)] cursor-pointer"
                >
                  <Archive size={10} />
                  {action.label}
                </button>
              ))}
            </div>
          )}
          {items.map((item, idx) => (
            (() => {
              const feedbackTarget = buildTriageFeedbackTarget(item, bucket);
              const pending = isFeedbackPending(feedbackTarget);
              const feedbackError = getFeedbackError(feedbackTarget);
              return (
                <div
                  key={item.thread_id ?? `${item.subject}-${idx}`}
                  role={item.thread_id ? 'button' : undefined}
                  tabIndex={item.thread_id ? 0 : undefined}
                  aria-label={item.thread_id ? `Open thread: ${item.subject || '(No subject)'} from ${senderName(item.sender)}` : undefined}
                  onClick={() => item.thread_id && onOpenThread?.(item.thread_id)}
                  onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && item.thread_id) { e.preventDefault(); onOpenThread?.(item.thread_id); } }}
                  className={`mx-3 mb-2 flex items-start gap-[10px] rounded-[18px] border border-white/6 bg-white/[0.03] px-4 py-3 transition-all hover:border-white/12 hover:bg-white/[0.045] hover:-translate-y-px ${
                    item.thread_id ? 'cursor-pointer' : ''
                  }`}
                >
              {item.thread_id && onBulkAction && (
                <input
                  type="checkbox"
                  checked={selectedIds.includes(item.thread_id)}
                  onClick={(e) => e.stopPropagation()}
                  onChange={() => setSelectedIds((prev) => prev.includes(item.thread_id!) ? prev.filter((id) => id !== item.thread_id) : [...prev, item.thread_id!])}
                  className="mt-[2px] h-4 w-4 shrink-0 accent-[var(--accent)] cursor-pointer"
                  aria-label={`Select ${item.subject}`}
                />
              )}
              <div
                className="w-[6px] h-[6px] rounded-full shrink-0 mt-[5px]"
                style={{ background: accentColor || 'var(--blue)' }}
              />
              <div className="flex-1 min-w-0">
                <div className="text-[12px] font-medium text-[var(--text)] truncate">
                  {item.subject || '(No subject)'}
                </div>
                <div className="text-[11px] text-[var(--text-faint)]">
                  {senderName(item.sender)}
                </div>
                {/* Action chips */}
                {showActions && item.actions && item.actions.length > 0 && (
                  <div className="flex flex-wrap gap-[5px] mt-[5px]">
                    {item.actions.map((action, ai) => (
                      <EmailActionChip key={ai} action={action} onAction={onEmailAction} />
                    ))}
                  </div>
                )}
                <div className="mt-[6px] flex flex-wrap gap-[5px]">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onIgnore(feedbackTarget);
                    }}
                    disabled={pending}
                    aria-label={`Ignore: ${item.subject || '(No subject)'}`}
                    className="inline-flex items-center gap-[4px] text-[10px] font-medium px-[7px] py-[4px] min-h-[28px] rounded-[5px] cursor-pointer bg-[var(--surface3)] border border-[var(--border)] text-[var(--text-faint)] hover:text-[var(--text-dim)] disabled:opacity-50"
                  >
                    Ignore
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onImportant(feedbackTarget);
                    }}
                    disabled={pending}
                    aria-label={`Mark important: ${item.subject || '(No subject)'}`}
                    className="inline-flex items-center gap-[4px] text-[10px] font-medium px-[7px] py-[4px] min-h-[28px] rounded-[5px] cursor-pointer bg-[var(--surface3)] border border-[var(--green-border)] text-[var(--green)] hover:brightness-110 disabled:opacity-50"
                  >
                    Important
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onNotImportant(feedbackTarget);
                    }}
                    disabled={pending}
                    aria-label={`Mark not important: ${item.subject || '(No subject)'}`}
                    className="inline-flex items-center gap-[4px] text-[10px] font-medium px-[7px] py-[4px] min-h-[28px] rounded-[5px] cursor-pointer bg-[var(--surface3)] border border-[var(--border)] text-[var(--text-faint)] hover:text-[var(--text)] disabled:opacity-50"
                  >
                    Not important
                  </button>
                </div>
                {feedbackError && (
                  <div className="mt-[4px] text-[10px] text-[var(--red)]">
                    {feedbackError}
                  </div>
                )}
              </div>
              <div className="shrink-0 flex items-center gap-1.5 mt-[2px]">
                {/* Fallback: show old-style Draft reply button when no actions */}
                {item.thread_id && title === 'Needs your reply' && (!item.actions || item.actions.length === 0) && (
                  <button
                    onClick={(e) => { e.stopPropagation(); onDraftReply(item.thread_id!); }}
                    className="text-[11px] font-medium px-[9px] py-[3px] rounded-[5px] bg-[var(--amber-dim)] border border-[var(--amber-border)] text-[var(--amber)] cursor-pointer hover:brightness-125 transition-all"
                  >
                    Draft reply
                  </button>
                )}
                {item.thread_id && (
                  <ExternalLink size={12} className="text-[var(--text-faint)]" aria-hidden="true" />
                )}
              </div>
                </div>
              );
            })()
          ))}
        </div>
      )}

      {open && items.length === 0 && (
        <div className="px-4 pb-3 text-[12px] text-[var(--text-faint)] italic">
          No emails in this category
        </div>
      )}
    </div>
  );
}

export default function InboxTriage({
  needsReply,
  needsInput,
  fyiOnly,
  canIgnore,
  accountEmail,
  onDraftReply,
  onEmailAction,
  onBulkAction,
  onIgnore,
  onImportant,
  onNotImportant,
  isFeedbackPending,
  getFeedbackError,
  onOpenThread,
  onAskAgent,
  kanbanMode = false,
}: Props) {
  const totalProcessed = needsReply.length + needsInput.length + fyiOnly.length + canIgnore.length;
  const hasActions = needsReply.some(i => i.actions && i.actions.length > 0)
    || needsInput.some(i => i.actions && i.actions.length > 0);

  return (
    <div className={kanbanMode ? 'flex flex-col' : 'home-panel home-panel-secondary overflow-hidden'}>
      {!kanbanMode && (
        <div className="home-section-header" style={{ '--section-accent': 'var(--amber)' } as React.CSSProperties}>
          <div>
            <div className="home-section-kicker">Secondary workspace</div>
            <h3 className="home-section-title">Inbox Triage</h3>
          </div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-[11px] text-[var(--text-faint)]">
              {totalProcessed} emails processed
            </span>
            {onAskAgent && (
              <button
                onClick={onAskAgent}
                className="flex h-7 w-7 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[var(--text-faint)] transition-all hover:border-[var(--accent-border)] hover:text-[var(--accent)] hover:bg-[var(--accent-glow)] cursor-pointer"
                title="Ask AI about your inbox"
                aria-label="Ask AI about your inbox"
              >
                <Sparkles size={13} />
              </button>
            )}
          </div>
        </div>
      )}

      {/* Distribution bar */}
      {totalProcessed > 0 && (
        <div className="px-4 pb-3 pt-2">
          <div className="flex h-[5px] w-full overflow-hidden rounded-full gap-[2px]">
            {needsReply.length > 0 && (
              <div style={{ flex: needsReply.length, background: 'var(--amber)', opacity: 0.85 }} />
            )}
            {needsInput.length > 0 && (
              <div style={{ flex: needsInput.length, background: 'var(--purple)', opacity: 0.85 }} />
            )}
            {fyiOnly.length > 0 && (
              <div style={{ flex: fyiOnly.length, background: 'var(--surface-hover)', opacity: 0.8 }} />
            )}
            {canIgnore.length > 0 && (
              <div style={{ flex: canIgnore.length, background: 'var(--border)', opacity: 0.6 }} />
            )}
          </div>
          <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5">
            {needsReply.length > 0 && (
              <span className="flex items-center gap-1 text-[10px] text-[var(--text-faint)]">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-[var(--amber)]" />
                {needsReply.length} reply
              </span>
            )}
            {needsInput.length > 0 && (
              <span className="flex items-center gap-1 text-[10px] text-[var(--text-faint)]">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-[var(--purple)]" />
                {needsInput.length} input
              </span>
            )}
            {fyiOnly.length > 0 && (
              <span className="flex items-center gap-1 text-[10px] text-[var(--text-faint)]">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-[var(--surface-hover)]" />
                {fyiOnly.length} FYI
              </span>
            )}
            {canIgnore.length > 0 && (
              <span className="flex items-center gap-1 text-[10px] text-[var(--text-faint)]">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-[var(--border)]" />
                {canIgnore.length} skip
              </span>
            )}
          </div>
        </div>
      )}

      <Section
        title="Needs your reply"
        icon={Reply}
        items={needsReply}
        bucket="needs_reply"
        accountEmail={accountEmail}
        defaultOpen={true}
        onDraftReply={onDraftReply}
        onEmailAction={onEmailAction}
        accentColor="var(--amber)"
        countStyle="bg-[var(--amber-dim)] text-[var(--amber)] border border-[var(--amber-border)]"
        showActions={hasActions}
        onBulkAction={onBulkAction}
        bulkActions={[{ type: 'mark_read', label: 'Mark all read' }]}
        onIgnore={onIgnore}
        onImportant={onImportant}
        onNotImportant={onNotImportant}
        isFeedbackPending={isFeedbackPending}
        getFeedbackError={getFeedbackError}
        onOpenThread={onOpenThread}
      />

      {needsInput.length > 0 && (
        <Section
          title="Needs your input"
          icon={HelpCircle}
          items={needsInput}
          bucket="needs_input"
          accountEmail={accountEmail}
          defaultOpen={true}
          onDraftReply={onDraftReply}
          onEmailAction={onEmailAction}
          accentColor="var(--purple)"
          countStyle="bg-[var(--purple-dim)] text-[var(--purple)] border border-[var(--purple-border)]"
          showActions={true}
          onBulkAction={onBulkAction}
          bulkActions={[{ type: 'mark_read', label: 'Mark all read' }]}
          onIgnore={onIgnore}
          onImportant={onImportant}
          onNotImportant={onNotImportant}
          isFeedbackPending={isFeedbackPending}
          getFeedbackError={getFeedbackError}
          onOpenThread={onOpenThread}
        />
      )}

      <Section
        title="FYI"
        icon={Eye}
        items={fyiOnly}
        bucket="fyi_only"
        accountEmail={accountEmail}
        defaultOpen={fyiOnly.length <= 5}
        onDraftReply={onDraftReply}
        onEmailAction={onEmailAction}
        countStyle="bg-[var(--surface3)] text-[var(--text-faint)]"
        showActions={hasActions}
        onBulkAction={onBulkAction}
        bulkActions={[{ type: 'archive_threads', label: 'Archive low priority' }, { type: 'mute_threads', label: 'Mute similar' }, { type: 'create_filter', label: 'Create filter' }]}
        onIgnore={onIgnore}
        onImportant={onImportant}
        onNotImportant={onNotImportant}
        isFeedbackPending={isFeedbackPending}
        getFeedbackError={getFeedbackError}
        onOpenThread={onOpenThread}
      />

      <Section
        title="Can ignore"
        icon={Trash2}
        items={canIgnore}
        bucket="can_ignore"
        accountEmail={accountEmail}
        defaultOpen={false}
        onDraftReply={onDraftReply}
        onEmailAction={onEmailAction}
        countStyle="bg-[var(--surface3)] text-[var(--text-faint)]"
        onIgnore={onIgnore}
        onImportant={onImportant}
        onNotImportant={onNotImportant}
        isFeedbackPending={isFeedbackPending}
        getFeedbackError={getFeedbackError}
        onOpenThread={onOpenThread}
      />
    </div>
  );
}
