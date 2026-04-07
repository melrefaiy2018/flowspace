import { motion } from 'motion/react';
import { Mail, CheckSquare, CalendarDays } from 'lucide-react';
import CommandInput from './CommandInput';
import QuickActions from './QuickActions';
import YourDayPanel from './YourDayPanel';
import TodayPanel from './TodayPanel';
import AttentionPanel from './AttentionPanel';
import InboxTriage from './InboxTriage';
import FollowupPanel from './FollowupPanel';
import HomeActivityPanel from './HomeActivityPanel';
import KanbanColumn from './KanbanColumn';
import BriefingSkeleton from './BriefingSkeleton';
import { useHomeDayFilter } from '../hooks/useHomeDayFilter';
import type {
  Briefing,
  CalendarEvent,
  DayEvent,
  DriveFile,
  EmailAction,
  FallbackTriageResult,
  InboxTriageItem,
  SavedEmail,
  WorkspaceStats,
} from '../services/api';
import type { InboxActionType } from '../shared/chat';
import type { ImportanceFeedbackTarget } from '../lib/importance-feedback';

interface Props {
  displayName: string;
  briefing: Briefing | null;
  briefingLoading: boolean;
  hasBriefing: boolean;
  stats: WorkspaceStats | null;
  events: CalendarEvent[];
  files: DriveFile[];
  accountEmail?: string | null;
  fallbackTriage: FallbackTriageResult | null;
  onSendMessage: (message: string) => void;
  onTriggerAction: (prompt: string, autoSend: boolean) => void;
  onCreateDoc: (eventOrId: DayEvent | string) => void | Promise<void>;
  onDraftReply: (threadId: string) => void;
  onEmailAction: (action: EmailAction) => void;
  onBulkAction: (actionType: InboxActionType, items: InboxTriageItem[]) => void;
  onIgnore: (target?: ImportanceFeedbackTarget) => void;
  onImportant: (target?: ImportanceFeedbackTarget) => void;
  onNotImportant: (target?: ImportanceFeedbackTarget) => void;
  isFeedbackPending: (target?: ImportanceFeedbackTarget) => boolean;
  getFeedbackError: (target?: ImportanceFeedbackTarget) => string | undefined;
  onFollowupComplete: (taskId: string) => void;
  onFollowupSnooze: (taskId: string, due: string) => void;
  onFollowupDelete: (taskId: string) => void;
  onOpenThread: (threadId: string) => void;
  savedEmails?: SavedEmail[];
  onOpenSavedThread?: (threadId: string) => void;
  onUnsaveEmail?: (id: string) => void;
  onNavigate?: (view: 'gmail' | 'tasks' | 'calendar') => void;
}

function getGreeting(name: string): string {
  const h = new Date().getHours();
  const period = h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening';
  return `Good ${period}, ${name}`;
}

function formatDate(): string {
  return new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
}

const riseIn = {
  initial: { opacity: 0, y: 14 },
  animate: { opacity: 1, y: 0 },
};

export default function HomeDashboard({
  displayName,
  briefing,
  briefingLoading,
  hasBriefing,
  stats,
  events,
  files,
  accountEmail,
  fallbackTriage,
  onSendMessage,
  onTriggerAction,
  onCreateDoc,
  onDraftReply,
  onEmailAction,
  onBulkAction,
  onIgnore,
  onImportant,
  onNotImportant,
  isFeedbackPending,
  getFeedbackError,
  onFollowupComplete,
  onFollowupSnooze,
  onFollowupDelete,
  onOpenThread,
  savedEmails,
  onOpenSavedThread,
  onUnsaveEmail,
  onNavigate,
}: Props) {
  const dayFilter = useHomeDayFilter();
  const firstName = displayName?.split(' ')[0] || 'there';
  const eventCount = hasBriefing ? (briefing?.day_at_a_glance.length ?? 0) : events.length;
  const unreadCount = stats?.unreadEmails ?? 0;
  const openTaskCount = stats?.openTasks ?? 0;

  return (
    <div className="home-dashboard flex h-full w-full flex-col">
      {/* ── Header strip ─────────────────────────────────── */}
      <motion.header
        {...riseIn}
        transition={{ duration: 0.3, ease: 'easeOut' }}
        className="shrink-0 flex items-center justify-between gap-4 px-5 pt-4 pb-3"
      >
        <div className="shrink-0">
          <h1 className="text-[16px] font-semibold text-[var(--text)] tracking-[-0.02em]">
            {getGreeting(firstName)}
          </h1>
          <p className="text-[11px] font-mono text-[var(--text-faint)] mt-0.5">
            {formatDate()}
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => onNavigate?.('gmail')}
            aria-label={`${unreadCount} unread emails`}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12px] transition-colors cursor-pointer hover:brightness-110 ${
              unreadCount > 50
                ? 'border-[var(--amber-border)] bg-[var(--amber-dim)] text-[var(--amber)]'
                : 'border-[var(--border)] bg-[var(--surface)] text-[var(--text-dim)] hover:bg-[var(--surface2)]'
            }`}
          >
            <Mail size={12} className="shrink-0" />
            <span className="font-semibold">{unreadCount}</span>
          </button>
          <button
            onClick={() => onNavigate?.('tasks')}
            aria-label={`${openTaskCount} open tasks`}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12px] transition-colors cursor-pointer hover:brightness-110 ${
              openTaskCount === 0
                ? 'border-[var(--green-border)] bg-[var(--green-dim)] text-[var(--green)]'
                : 'border-[var(--border)] bg-[var(--surface)] text-[var(--text-dim)] hover:bg-[var(--surface2)]'
            }`}
          >
            <CheckSquare size={12} className="shrink-0" />
            <span className="font-semibold">{openTaskCount}</span>
          </button>
          <button
            onClick={() => onNavigate?.('calendar')}
            aria-label={`${eventCount} meetings today`}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12px] transition-colors cursor-pointer hover:brightness-110 ${
              eventCount === 0
                ? 'border-[var(--green-border)] bg-[var(--green-dim)] text-[var(--green)]'
                : 'border-[var(--border)] bg-[var(--surface)] text-[var(--text-dim)] hover:bg-[var(--surface2)]'
            }`}
          >
            <CalendarDays size={12} className="shrink-0" />
            <span className="font-semibold">{eventCount}</span>
          </button>
        </div>
      </motion.header>

      {/* ── Content ───────────────────────────────────────── */}
      {briefingLoading ? (
        <motion.div
          {...riseIn}
          transition={{ delay: 0.06, duration: 0.25, ease: 'easeOut' }}
          className="flex-1 min-h-0"
        >
          <BriefingSkeleton />
        </motion.div>
      ) : hasBriefing && briefing ? (
        <motion.div
          {...riseIn}
          transition={{ delay: 0.06, duration: 0.28, ease: 'easeOut' }}
          className="kanban-board flex-1 min-h-0"
        >
          <KanbanColumn
            title="Needs Attention"
            count={briefing.attention_items.length}
            accentColor="var(--amber)"
            onAskAgent={() => onSendMessage('Summarize the items that need my attention right now and suggest what to handle first')}
          >
            <AttentionPanel
              kanbanMode
              items={briefing.attention_items}
              accountEmail={accountEmail}
              onDraftReply={onDraftReply}
              onCreateDoc={(eventId) => onCreateDoc(eventId)}
              onIgnore={onIgnore}
              onImportant={onImportant}
              onNotImportant={onNotImportant}
              isFeedbackPending={isFeedbackPending}
              getFeedbackError={getFeedbackError}
            />
          </KanbanColumn>

          <KanbanColumn
            title="Your Day"
            count={dayFilter.filterDayEvents(briefing.day_at_a_glance).length}
            accentColor="var(--blue)"
            onAskAgent={() => onSendMessage('Walk me through my day — what meetings need prep, what can I skip, and what gaps do I have?')}
          >
            <YourDayPanel
              kanbanMode
              events={dayFilter.filterDayEvents(briefing.day_at_a_glance)}
              onCreateDoc={onCreateDoc}
              filter={dayFilter.filter}
              onFilterChange={dayFilter.setFilter}
            />
          </KanbanColumn>

          <KanbanColumn
            title="Inbox"
            wide
            count={(briefing.inbox_triage.needs_reply.length) + (briefing.inbox_triage.needs_input?.length ?? 0)}
            accentColor="var(--amber)"
            onAskAgent={() => onSendMessage('Triage my inbox — summarize the most important emails and suggest replies for those that need a response')}
          >
            <InboxTriage
              kanbanMode
              needsReply={briefing.inbox_triage.needs_reply}
              needsInput={briefing.inbox_triage.needs_input ?? []}
              fyiOnly={briefing.inbox_triage.fyi_only}
              canIgnore={briefing.inbox_triage.can_ignore}
              accountEmail={accountEmail}
              onDraftReply={onDraftReply}
              onEmailAction={onEmailAction}
              onBulkAction={onBulkAction}
              onIgnore={onIgnore}
              onImportant={onImportant}
              onNotImportant={onNotImportant}
              isFeedbackPending={isFeedbackPending}
              getFeedbackError={getFeedbackError}
              onOpenThread={onOpenThread}
            />
          </KanbanColumn>

          <KanbanColumn
            title="Follow-ups"
            count={(briefing.followups ?? []).filter(f => f.status !== 'completed').length}
            accentColor="var(--purple)"
            onAskAgent={() => onSendMessage('Review my open follow-ups — which are overdue, which need action today, and what can I close?')}
          >
            <FollowupPanel
              kanbanMode
              followups={briefing.followups ?? []}
              accountEmail={accountEmail}
              onComplete={onFollowupComplete}
              onSnooze={onFollowupSnooze}
              onDelete={onFollowupDelete}
              onOpenThread={onOpenThread}
              savedEmails={savedEmails}
              onOpenSavedThread={onOpenSavedThread}
              onUnsaveEmail={onUnsaveEmail}
            />
          </KanbanColumn>

          <KanbanColumn title="Workspace">
            <div className="p-3 flex flex-col gap-3 border-b border-[var(--border)]">
              <div className="home-section-kicker px-1">Quick actions</div>
              <QuickActions stats={stats} events={events} onAction={onSendMessage} />
            </div>
            <HomeActivityPanel
              kanbanMode
              files={files}
              stats={stats}
              onAskAgent={() => onSendMessage('Give me a quick workspace status report — unread emails, tasks, and recent file activity')}
            />
          </KanbanColumn>
        </motion.div>
      ) : (
        /* ── Fallback (no briefing) ──────────────────────── */
        <motion.div
          {...riseIn}
          transition={{ delay: 0.06, duration: 0.28, ease: 'easeOut' }}
          className="kanban-board flex-1 min-h-0"
        >
          <KanbanColumn
            title="Inbox"
            wide
            count={fallbackTriage ? (fallbackTriage.needs_reply.length + fallbackTriage.needs_input.length) : 0}
            accentColor="var(--amber)"
          >
            {fallbackTriage ? (
              <InboxTriage
                kanbanMode
                needsReply={fallbackTriage.needs_reply}
                needsInput={fallbackTriage.needs_input}
                fyiOnly={fallbackTriage.fyi_only}
                canIgnore={fallbackTriage.can_ignore}
                accountEmail={accountEmail}
                onDraftReply={onDraftReply}
                onEmailAction={onEmailAction}
                onBulkAction={onBulkAction}
                onIgnore={onIgnore}
                onImportant={onImportant}
                onNotImportant={onNotImportant}
                isFeedbackPending={isFeedbackPending}
                getFeedbackError={getFeedbackError}
                onOpenThread={onOpenThread}
              />
            ) : (
              <div className="flex flex-1 items-center justify-center p-6 text-center text-[13px] text-[var(--text-faint)]">
                Your inbox is clear. New mail will appear here when there is something worth triaging.
              </div>
            )}
          </KanbanColumn>

          <KanbanColumn
            title="Today"
            count={dayFilter.filterCalendarEvents(events).length}
            accentColor="var(--blue)"
          >
            <TodayPanel
              kanbanMode
              events={dayFilter.filterCalendarEvents(events)}
              stats={stats}
              onAction={onTriggerAction}
              filter={dayFilter.filter}
              onFilterChange={dayFilter.setFilter}
            />
          </KanbanColumn>

          <KanbanColumn title="Status">
            <div className="p-5">
              <div className="home-section-kicker">Status</div>
              <h3 className="mt-2 text-[18px] font-semibold tracking-[-0.03em] text-[var(--text)]">AI briefing unavailable</h3>
              <p className="mt-2 text-[13px] leading-6 text-[var(--text-dim)]">
                Raw workspace data is still available. Use the command bar to triage inbox, prep meetings, or review tasks.
              </p>
            </div>
          </KanbanColumn>

          <KanbanColumn title="Workspace">
            <div className="p-3 flex flex-col gap-3 border-b border-[var(--border)]">
              <div className="home-section-kicker px-1">Quick actions</div>
              <QuickActions stats={stats} events={events} onAction={onSendMessage} />
            </div>
            <HomeActivityPanel
              kanbanMode
              files={files}
              stats={stats}
              onAskAgent={() => onSendMessage('Give me a quick workspace status report — unread emails, tasks, and recent file activity')}
            />
          </KanbanColumn>
        </motion.div>
      )}

      {/* ── Persistent bottom command bar ─────────────────── */}
      <div className="sticky bottom-0 z-30 shrink-0">
        <div className="bg-gradient-to-t from-[var(--bg)] via-[var(--bg)]/95 to-transparent pt-6 px-4 pb-4 md:px-6 md:pb-5">
          <div className="mx-auto max-w-2xl rounded-2xl border border-[var(--border)] bg-[var(--surface)]/95 p-2 shadow-[0_-4px_24px_rgba(0,0,0,0.4)] backdrop-blur-xl">
            <CommandInput variant="compact" />
          </div>
        </div>
      </div>
    </div>
  );
}
