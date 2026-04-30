import { useState, useMemo, useRef, useCallback } from 'react';
import { motion } from 'motion/react';
import {
  Mail,
  CheckSquare,
  CalendarDays,
  Clock,
  AlertCircle,
  ArrowRight,
  Sparkles,
  FileText,
  MessageSquare,
  Zap,
  ChevronDown,
  ChevronRight,
  Coffee,
  Target,
  TrendingUp,
  Inbox,
  Shield,
  Sun,
  Moon,
  Brain,
  Search,
  RefreshCw,
} from 'lucide-react';
import YourDayPanel from './YourDayPanel';
import TodayPanel from './TodayPanel';
import AttentionPanel from './AttentionPanel';
import InboxTriage from './InboxTriage';
import FollowupPanel from './FollowupPanel';
import BriefingSkeleton from './BriefingSkeleton';
import DraftQueue from './DraftQueue';
import type { ApproveResult, UseDraftsReturn } from '../hooks/useDrafts';
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
  onNavigate?: (view: 'mail' | 'tasks' | 'calendar') => void;
  onApproveToChat?: (result: ApproveResult) => void;
  onDiscussDraft?: (draft: import('../agent/draft-types').StagedDraft) => void;
  draftsState: UseDraftsReturn;
}

/* ── Time helpers ─────────────────────────────────────────────── */

function getHour(): number {
  return new Date().getHours();
}

function formatDate(): string {
  return new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
}

function isWeekday(): boolean {
  const day = new Date().getDay();
  return day >= 1 && day <= 5;
}

function formatEventTime(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  });
}

function minutesUntil(dateStr: string): number {
  return Math.round((new Date(dateStr).getTime() - Date.now()) / 60000);
}

/* ── Operational header sub-components ───────────────────────── */

interface StatTileProps {
  value: number;
  label: string;
  accent: string;
  zeroLabel?: string;
}

function StatTile({ value, label, accent, zeroLabel }: StatTileProps) {
  const isEmpty = value === 0;
  return (
    <div className="flex flex-col gap-1 min-w-[60px]">
      <span
        className="tabular-nums leading-none tracking-[-0.03em]"
        style={{
          fontSize: isEmpty ? '15px' : '22px',
          fontWeight: isEmpty ? 400 : 700,
          color: isEmpty ? 'var(--text-faint)' : accent,
          opacity: isEmpty ? 0.4 : 1,
        }}
      >
        {isEmpty ? '—' : value}
      </span>
      <span className="text-[10px] font-mono uppercase tracking-[0.06em] text-[var(--text-faint)]">
        {isEmpty && zeroLabel ? zeroLabel : label}
      </span>
    </div>
  );
}

const riseIn = {
  initial: { opacity: 0, y: 14 },
  animate: { opacity: 1, y: 0 },
};

/* ── Workspace state synthesis ────────────────────────────────── */

interface WorkspaceContext {
  unreadCount: number;
  eventCount: number;
  openTaskCount: number;
  attentionCount: number;
  overdueCount: number;
  needsReplyCount: number;
  nextEvent: CalendarEvent | null;
  nextEventMinutes: number;
  hasBriefing: boolean;
  isCalm: boolean;
  isBusy: boolean;
  dayPhase: 'early' | 'morning' | 'midday' | 'afternoon' | 'evening' | 'night';
}

function synthesizeContext(
  stats: WorkspaceStats | null,
  events: CalendarEvent[],
  briefing: Briefing | null,
  hasBriefing: boolean,
): WorkspaceContext {
  const h = getHour();
  const dayPhase: WorkspaceContext['dayPhase'] =
    h < 7 ? 'early' : h < 10 ? 'morning' : h < 12 ? 'midday' : h < 17 ? 'afternoon' : h < 21 ? 'evening' : 'night';

  const unreadCount = stats?.unreadEmails ?? 0;
  const eventCount = hasBriefing ? (briefing?.day_at_a_glance.length ?? 0) : events.length;
  const openTaskCount = stats?.openTasks ?? 0;
  const attentionCount = briefing?.attention_items?.length ?? 0;
  const overdueCount = (briefing?.followups ?? []).filter((f) => f.status === 'overdue').length;
  const needsReplyCount = briefing?.inbox_triage?.needs_reply?.length ?? 0;

  const futureEvents = events.filter((ev) => new Date(ev.start).getTime() > Date.now());
  const nextEvent = futureEvents[0] ?? null;
  const nextEventMinutes = nextEvent ? minutesUntil(nextEvent.start) : Infinity;

  const urgentItems = attentionCount + overdueCount + needsReplyCount;
  const isCalm = urgentItems === 0 && unreadCount < 5 && eventCount < 3;
  const isBusy = urgentItems > 3 || unreadCount > 30 || eventCount > 5;

  return {
    unreadCount, eventCount, openTaskCount, attentionCount, overdueCount,
    needsReplyCount, nextEvent, nextEventMinutes, hasBriefing, isCalm, isBusy, dayPhase,
  };
}

/* ── Interpretive subtext for signal cards ────────────────────── */

function interpretUnread(count: number, ctx: WorkspaceContext): string {
  if (count === 0) return 'Inbox clear — nothing waiting';
  if (count > 100) return 'Heavily backed up — triage recommended';
  if (count > 50) return 'Building up — consider a sweep';
  if (ctx.needsReplyCount > 0) return `${ctx.needsReplyCount} need a reply`;
  if (count > 10) return 'A few things to review';
  return 'Light load — easy to clear';
}

function interpretMeetings(count: number, ctx: WorkspaceContext): string {
  if (count === 0) {
    if (isWeekday()) return 'Open day — deep work opportunity';
    return 'Clear schedule';
  }
  if (ctx.nextEvent && ctx.nextEventMinutes < 30) {
    return `Next in ${ctx.nextEventMinutes}m — ${ctx.nextEvent.summary?.slice(0, 20) || 'meeting'}`;
  }
  if (ctx.nextEvent && ctx.nextEventMinutes < 60) {
    return `Next at ${formatEventTime(ctx.nextEvent.start)}`;
  }
  if (count >= 6) return 'Meeting-heavy day — protect focus time';
  if (count >= 4) return 'Several meetings — batch prep';
  return count === 1 ? 'Light meeting day' : 'Moderate schedule';
}

function interpretTasks(count: number): string {
  if (count === 0) return 'All tasks complete';
  if (count > 20) return 'High load — prioritize or delegate';
  if (count > 10) return 'Significant backlog building';
  if (count > 5) return 'Active workload';
  return 'Manageable load';
}

function interpretAttention(count: number, ctx: WorkspaceContext): string {
  if (count === 0 && ctx.overdueCount === 0) return 'Nothing urgent right now';
  if (ctx.overdueCount > 0) return `${ctx.overdueCount} overdue — address first`;
  if (count > 5) return 'Multiple items competing — triage';
  return 'Review before moving on';
}

/* ── Contextual suggestions — adapt to live workspace state ──── */

type Suggestion = { label: string; prompt: string; icon: typeof Mail };

function buildSuggestions(ctx: WorkspaceContext): Suggestion[] {
  const items: Suggestion[] = [];
  const h = getHour();

  // Imminent meeting prep (highest priority)
  if (ctx.nextEvent && ctx.nextEventMinutes < 90 && ctx.nextEventMinutes > 0) {
    const name = ctx.nextEvent.summary?.slice(0, 28) || 'meeting';
    items.push({
      label: ctx.nextEventMinutes < 30 ? `Quick prep: ${name}` : `Prep for ${name}`,
      prompt: `Prepare for my meeting: ${ctx.nextEvent.summary}`,
      icon: CalendarDays,
    });
  }

  // Overdue follow-ups
  if (ctx.overdueCount > 0) {
    items.push({
      label: `Resolve ${ctx.overdueCount} overdue follow-up${ctx.overdueCount > 1 ? 's' : ''}`,
      prompt: 'Review my overdue follow-ups and suggest actions for each',
      icon: AlertCircle,
    });
  }

  // Inbox triage when backed up
  if (ctx.unreadCount > 10) {
    items.push({
      label: `Triage ${ctx.unreadCount} unread`,
      prompt: 'Triage my inbox — summarize the most important emails and suggest replies',
      icon: Mail,
    });
  }

  // Attention items
  if (ctx.attentionCount > 0 && items.length < 3) {
    items.push({
      label: `Handle ${ctx.attentionCount} attention item${ctx.attentionCount > 1 ? 's' : ''}`,
      prompt: 'What needs my attention right now? Prioritize and suggest actions.',
      icon: Target,
    });
  }

  // Time-of-day contextual actions when nothing urgent
  if (items.length < 2) {
    if (h < 10 && isWeekday()) {
      items.push(
        { label: 'Morning standup', prompt: 'Give me a standup report for today', icon: Sun },
      );
    } else if (h >= 16 && isWeekday()) {
      items.push(
        { label: 'End-of-day wrap-up', prompt: 'Summarize what happened today and what carries over to tomorrow', icon: Moon },
      );
    }
  }

  // Calm state — opportunity-oriented suggestions
  if (ctx.isCalm && items.length < 3) {
    if (ctx.openTaskCount > 0) {
      items.push({
        label: 'Plan task priorities',
        prompt: 'Review my open tasks and suggest which to focus on next, considering deadlines and importance',
        icon: TrendingUp,
      });
    }
    items.push({
      label: 'Weekly digest',
      prompt: 'Give me a weekly digest — what did I accomplish, what is pending, what needs attention next week?',
      icon: FileText,
    });
  }

  // Fallback when nothing else fits
  if (items.length === 0) {
    items.push(
      { label: 'Generate briefing', prompt: 'Generate my daily briefing', icon: Brain },
      { label: 'Search workspace', prompt: 'Search my Drive for recent documents I was working on', icon: Search },
    );
  }

  // Always offer walk-through if there's room
  if (items.length < 4 && ctx.eventCount > 0) {
    items.push({
      label: 'Walk me through my day',
      prompt: 'Walk me through my day — what meetings need prep, what can I skip, and what gaps do I have?',
      icon: Zap,
    });
  }

  return items.slice(0, 4);
}

/* ── Signal cards — operational status with metadata ─────────── */

function SignalCard({
  icon: Icon,
  label,
  value,
  accent,
  subtext,
  source,
  onClick,
}: {
  icon: typeof Mail;
  label: string;
  value: number;
  accent: string;
  subtext: string;
  source: string;
  onClick?: () => void;
}) {
  const isZero = value === 0;
  const stateColor = isZero ? 'var(--green)' : accent;
  return (
    <button
      onClick={onClick}
      className="signal-card group flex flex-col rounded-lg border px-3 py-2.5 text-left transition-all cursor-pointer"
      style={{
        borderColor: isZero ? 'var(--border)' : `color-mix(in srgb, ${accent} 25%, var(--border))`,
        background: isZero ? 'var(--surface)' : `color-mix(in srgb, ${accent} 5%, var(--surface))`,
      }}
    >
      {/* Header row: icon + source label */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <Icon size={12} style={{ color: isZero ? 'var(--text-faint)' : accent }} />
          <span className="text-[9px] font-mono uppercase tracking-[0.12em] text-[var(--text-faint)]">
            {source}
          </span>
        </div>
        <div
          className="w-1.5 h-1.5 rounded-full"
          style={{ background: stateColor, opacity: isZero ? 0.4 : 0.9 }}
        />
      </div>
      {/* Value */}
      <span
        className="text-[22px] font-semibold tracking-[-0.05em] leading-none"
        style={{ color: isZero ? 'var(--text-faint)' : 'var(--text)' }}
      >
        {value}
      </span>
      {/* Label */}
      <span className="text-[10px] font-mono text-[var(--text-faint)] mt-0.5 leading-tight uppercase tracking-[0.05em]">
        {label}
      </span>
      {/* Status line */}
      <div
        className="mt-2 pt-2 border-t text-[10px] leading-tight"
        style={{ borderColor: 'var(--border)', color: 'var(--text-faint)' }}
      >
        {subtext}
      </div>
    </button>
  );
}

/* ── Collapsible workspace section with state + traceability ──── */

type SectionState = 'live' | 'stale' | 'empty' | 'loading';

function WorkspaceSection({
  title,
  count,
  accent,
  defaultOpen = true,
  preview,
  source,
  sectionState = 'live',
  onAskAgent,
  children,
}: {
  title: string;
  count: number;
  accent: string;
  defaultOpen?: boolean;
  preview?: string;
  source?: string;
  sectionState?: SectionState;
  onAskAgent?: () => void;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  const stateLabel: Record<SectionState, string> = {
    live: 'LIVE',
    stale: 'STALE',
    empty: 'CLEAR',
    loading: 'SYNC',
  };
  const stateColor: Record<SectionState, string> = {
    live: 'var(--green)',
    stale: 'var(--amber)',
    empty: 'var(--text-faint)',
    loading: 'var(--blue)',
  };

  return (
    <div
      className="workspace-section rounded-lg border overflow-hidden transition-colors"
      style={{
        borderColor: open
          ? `color-mix(in srgb, ${accent} 18%, var(--border))`
          : 'var(--border)',
      }}
    >
      {/* Header */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2.5 px-3.5 py-2.5 cursor-pointer group"
        style={{ background: open ? `color-mix(in srgb, ${accent} 3%, var(--surface))` : 'var(--surface)' }}
      >
        {/* Left accent bar */}
        <div
          className="w-[3px] h-3.5 rounded-sm shrink-0 transition-opacity"
          style={{ background: accent, opacity: open ? 0.8 : 0.25 }}
        />
        {/* Title */}
        <div className="flex-1 min-w-0 text-left">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-mono font-medium uppercase tracking-[0.08em] text-[var(--text-dim)]">
              {title}
            </span>
            {source && (
              <span className="text-[9px] font-mono uppercase tracking-[0.1em] text-[var(--text-faint)] opacity-60">
                · {source}
              </span>
            )}
          </div>
          {!open && preview && (
            <p className="text-[11px] text-[var(--text-dim)] truncate mt-0.5 leading-tight">
              {preview}
            </p>
          )}
        </div>
        {/* Count badge */}
        {count > 0 ? (
          <span
            className="text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded-sm shrink-0 tabular-nums"
            style={{
              background: `color-mix(in srgb, ${accent} 14%, transparent)`,
              color: accent,
            }}
          >
            {count}
          </span>
        ) : (
          <span
            className="text-[9px] font-mono uppercase tracking-[0.1em] shrink-0"
            style={{ color: stateColor[sectionState] }}
          >
            {stateLabel[sectionState]}
          </span>
        )}
        {/* Ask agent */}
        {onAskAgent && open && (
          <span
            onClick={(e) => { e.stopPropagation(); onAskAgent(); }}
            className="flex h-5 w-5 items-center justify-center rounded-sm border border-[var(--border)] text-[var(--text-faint)] hover:border-[var(--accent-border)] hover:text-[var(--accent)] transition-all cursor-pointer shrink-0"
            title={`Ask agent about ${title}`}
          >
            <Sparkles size={9} />
          </span>
        )}
        {open
          ? <ChevronDown size={12} className="text-[var(--text-faint)] shrink-0" />
          : <ChevronRight size={12} className="text-[var(--text-faint)] shrink-0" />
        }
      </button>
      {/* Body */}
      {open && (
        <div
          className="border-t"
          style={{ borderColor: `color-mix(in srgb, ${accent} 8%, var(--border))` }}
        >
          {children}
        </div>
      )}
    </div>
  );
}

/* ── Preview summaries for collapsed sections ─────────────────── */

function buildDayPreview(
  events: CalendarEvent[] | DayEvent[],
  ctx: WorkspaceContext,
): string {
  if (events.length === 0) {
    return isWeekday() ? 'No meetings — open for deep work' : 'Clear schedule';
  }
  // For CalendarEvent[] (no briefing path): find next upcoming by ISO start
  const firstAsCalendar = events[0] as CalendarEvent;
  if (firstAsCalendar.start) {
    const now = Date.now();
    const upcoming = (events as CalendarEvent[])
      .filter((ev) => new Date(ev.start).getTime() > now)
      .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
    const next = upcoming[0] ?? null;
    if (next) {
      const time = formatEventTime(next.start);
      const name = (next.summary ?? 'Meeting').slice(0, 30);
      const minsUntil = Math.round((new Date(next.start).getTime() - now) / 60000);
      if (minsUntil < 30) return `Starting soon: ${name} at ${time}`;
      return `Next: ${name} at ${time} · ${events.length} total`;
    }
    return `${events.length} event${events.length > 1 ? 's' : ''} today`;
  }
  // For DayEvent[] (briefing path): use pre-formatted time string
  const firstAsDayEvent = events[0] as DayEvent;
  const name = firstAsDayEvent.title?.slice(0, 30) ?? 'Meeting';
  return `${name} · ${events.length} total`;
}

function buildInboxPreview(
  count: number,
  ctx: WorkspaceContext,
): string {
  if (count === 0) return 'All caught up — no emails need action';
  if (ctx.needsReplyCount > 0) {
    return `${ctx.needsReplyCount} need a reply · ${count} actionable total`;
  }
  return `${count} email${count > 1 ? 's' : ''} need attention`;
}

function buildFollowupPreview(
  activeCount: number,
  ctx: WorkspaceContext,
): string {
  if (activeCount === 0) return 'No open commitments';
  if (ctx.overdueCount > 0) return `${ctx.overdueCount} overdue — review today`;
  return `${activeCount} active follow-up${activeCount > 1 ? 's' : ''}`;
}

/* ── Next Best Action — proactive guidance module ─────────────── */

function buildNextAction(ctx: WorkspaceContext): {
  heading: string;
  body: string;
  prompt: string;
  accent: string;
  icon: typeof Mail;
} | null {
  // Imminent meeting — highest priority
  if (ctx.nextEvent && ctx.nextEventMinutes > 0 && ctx.nextEventMinutes < 30) {
    return {
      heading: `${ctx.nextEvent.summary?.slice(0, 35) || 'Meeting'} starts in ${ctx.nextEventMinutes}m`,
      body: 'Prep talking points, review attendees, and pull linked documents.',
      prompt: `Prepare for my meeting: ${ctx.nextEvent.summary}`,
      accent: 'var(--blue)',
      icon: CalendarDays,
    };
  }

  // Overdue follow-ups
  if (ctx.overdueCount > 0) {
    return {
      heading: `${ctx.overdueCount} follow-up${ctx.overdueCount > 1 ? 's' : ''} overdue`,
      body: 'Resolve these before they become blockers. Agent can draft messages or close them.',
      prompt: 'Review my overdue follow-ups and suggest actions for each',
      accent: 'var(--red)',
      icon: AlertCircle,
    };
  }

  // Attention items
  if (ctx.attentionCount > 3) {
    return {
      heading: `${ctx.attentionCount} items competing for your attention`,
      body: 'Let the agent triage and suggest which to handle first.',
      prompt: 'Prioritize my attention items and suggest what to handle first',
      accent: 'var(--amber)',
      icon: Target,
    };
  }

  // Heavy inbox
  if (ctx.unreadCount > 30) {
    return {
      heading: `Inbox has ${ctx.unreadCount} unread`,
      body: 'A triage pass will surface what needs a reply and what can be archived.',
      prompt: 'Triage my inbox — focus on emails that need a reply',
      accent: 'var(--amber)',
      icon: Mail,
    };
  }

  // Upcoming meeting with time to prep
  if (ctx.nextEvent && ctx.nextEventMinutes > 30 && ctx.nextEventMinutes < 90) {
    return {
      heading: `Prep: ${ctx.nextEvent.summary?.slice(0, 30) || 'Meeting'} at ${formatEventTime(ctx.nextEvent.start)}`,
      body: 'You have time to review the agenda and prepare notes.',
      prompt: `Prepare for my meeting: ${ctx.nextEvent.summary}`,
      accent: 'var(--blue)',
      icon: CalendarDays,
    };
  }

  // Calm state — forward-looking
  if (ctx.isCalm && isWeekday()) {
    const h = getHour();
    if (h < 11) {
      return {
        heading: 'Open morning — good time for deep work',
        body: 'No urgent items. Plan your focus time or tackle your most important task.',
        prompt: 'Review my open tasks and suggest what to focus on this morning, considering deadlines and importance',
        accent: 'var(--accent)',
        icon: Coffee,
      };
    }
    if (h >= 16) {
      return {
        heading: 'Wind down — wrap up the day',
        body: 'Summarize progress, check for loose ends, and prep for tomorrow.',
        prompt: 'Summarize what happened today and what I need to prepare for tomorrow',
        accent: 'var(--purple)',
        icon: Moon,
      };
    }
    return {
      heading: 'Clear schedule — plan your next move',
      body: 'Nothing urgent. Good time to review priorities or plan ahead.',
      prompt: 'Review my open tasks and suggest what to focus on next',
      accent: 'var(--accent)',
      icon: TrendingUp,
    };
  }

  return null;
}

function NextBestAction({
  ctx,
  onSendMessage,
}: {
  ctx: WorkspaceContext;
  onSendMessage: (msg: string) => void;
}) {
  const action = useMemo(() => buildNextAction(ctx), [ctx]);
  if (!action) return null;

  const IconComponent = action.icon;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.12, duration: 0.25, ease: 'easeOut' }}
      className="max-w-4xl mx-auto px-4 md:px-6 pb-1"
    >
      <button
        onClick={() => onSendMessage(action.prompt)}
        className="w-full text-left rounded-lg border transition-all cursor-pointer group hover:brightness-110 active:brightness-95"
        style={{
          borderColor: `color-mix(in srgb, ${action.accent} 22%, var(--border))`,
          background: `color-mix(in srgb, ${action.accent} 4%, var(--surface))`,
        }}
      >
        {/* Header bar */}
        <div
          className="flex items-center gap-2 px-3.5 py-2 border-b"
          style={{ borderColor: `color-mix(in srgb, ${action.accent} 10%, var(--border))` }}
        >
          <IconComponent size={11} style={{ color: action.accent }} />
          <span className="text-[9px] font-mono uppercase tracking-[0.12em] text-[var(--text-faint)]">
            Recommended action
          </span>
          <div className="flex-1" />
          <span
            className="text-[9px] font-mono uppercase tracking-[0.1em]"
            style={{ color: action.accent }}
          >
            run →
          </span>
        </div>
        {/* Body */}
        <div className="flex items-start gap-3 px-3.5 py-3">
          <div className="flex-1 min-w-0">
            <h3 className="text-[13px] font-semibold text-[var(--text)] leading-tight">
              {action.heading}
            </h3>
            <p className="text-[11px] text-[var(--text-faint)] mt-1 leading-relaxed">
              {action.body}
            </p>
          </div>
        </div>
      </button>
    </motion.div>
  );
}

/* ── System Context Band — horizontal status rail ─────────────── */

function buildOneLinerSummary(ctx: WorkspaceContext, briefing: Briefing | null): string {
  const parts: string[] = [];
  if (ctx.eventCount === 0) parts.push('Calendar clear');
  else parts.push(`${ctx.eventCount} meeting${ctx.eventCount > 1 ? 's' : ''} today`);
  if (ctx.attentionCount > 0) parts.push(`${ctx.attentionCount} flagged`);
  if (ctx.needsReplyCount > 0) parts.push(`${ctx.needsReplyCount} awaiting reply`);
  if (ctx.overdueCount > 0) parts.push(`${ctx.overdueCount} overdue`);
  if (parts.length === 1 && ctx.openTaskCount > 0) parts.push(`${ctx.openTaskCount} open tasks`);
  return parts.join(' · ');
}

function SystemContextBand({
  briefing,
  briefingLoading,
  ctx,
  onSendMessage,
  onReviewFlags,
}: {
  briefing: Briefing | null;
  briefingLoading: boolean;
  ctx: WorkspaceContext;
  onSendMessage: (msg: string) => void;
  onReviewFlags: () => void;
}) {
  const now = new Date();
  const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });

  const totalFlags = ctx.attentionCount + ctx.overdueCount + ctx.needsReplyCount;
  const summary = briefing?.summary;
  const oneLiner = buildOneLinerSummary(ctx, briefing);

  const sources = [
    { label: 'Gmail', ok: true },
    { label: 'Calendar', ok: true },
    { label: 'Tasks', ok: true },
    { label: 'Briefing', ok: ctx.hasBriefing },
  ];

  return (
    <div className="shrink-0 px-4 md:px-6 py-2">
      <div className="max-w-4xl mx-auto">
        <div className="context-band-container rounded-lg border border-[var(--border)] overflow-hidden">

          {/* ── Single content row — title + 4 columns inline ── */}
          <div className="flex items-stretch divide-x divide-[var(--border)]">

            {/* Identity tab */}
            <div className="flex items-center gap-2 px-3 py-2.5 shrink-0 context-band-header">
              <div className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] live-dot shrink-0" />
              <span className="text-[9px] font-mono uppercase tracking-[0.14em] text-[var(--text-dim)] whitespace-nowrap">
                System
              </span>
            </div>

            {/* Col 1 — Briefing */}
            <button
              onClick={() => onSendMessage(summary ? 'Give me the full daily briefing' : 'Generate my daily briefing')}
              className="context-band-col flex-1 min-w-0 flex flex-col justify-center gap-0.5 px-3.5 py-2.5 text-left"
            >
              <span className="text-[9px] font-mono uppercase tracking-[0.1em] text-[var(--text-faint)]">Briefing</span>
              {briefingLoading ? (
                <div className="h-2 w-28 rounded bg-[var(--surface2)] animate-pulse" />
              ) : (
                <span className="text-[11px] text-[var(--text-dim)] truncate leading-tight">
                  {summary
                    ? (typeof summary === 'string' ? summary.slice(0, 72) : 'Briefing ready')
                    : oneLiner
                  }
                </span>
              )}
              <span className="text-[9px] font-mono text-[var(--accent)] leading-tight">
                {summary ? 'Open →' : 'Generate →'}
              </span>
            </button>

            {/* Col 2 — Flags */}
            <button
              onClick={onReviewFlags}
              className="context-band-col w-[148px] shrink-0 flex flex-col justify-center gap-0.5 px-3.5 py-2.5 text-left"
            >
              <span className="text-[9px] font-mono uppercase tracking-[0.1em] text-[var(--text-faint)]">Flags</span>
              <div className="flex items-baseline gap-1">
                <span
                  className="text-[16px] font-semibold tabular-nums leading-none tracking-[-0.03em]"
                  style={{ color: totalFlags > 0 ? 'var(--amber)' : 'var(--text-faint)' }}
                >
                  {totalFlags}
                </span>
                <span className="text-[10px] text-[var(--text-faint)] leading-none">
                  {totalFlags === 0
                    ? 'clear'
                    : [
                        ctx.attentionCount > 0 ? `${ctx.attentionCount} ai` : '',
                        ctx.needsReplyCount > 0 ? `${ctx.needsReplyCount} reply` : '',
                        ctx.overdueCount > 0 ? `${ctx.overdueCount} late` : '',
                      ].filter(Boolean).join(' · ')
                  }
                </span>
              </div>
              <span className="text-[9px] font-mono text-[var(--accent)] leading-tight">
                {totalFlags > 0 ? 'Review →' : '—'}
              </span>
            </button>

            {/* Col 3 — Next */}
            <button
              onClick={() =>
                ctx.nextEvent
                  ? onSendMessage(`Prepare for my meeting: ${ctx.nextEvent!.summary}`)
                  : onSendMessage('When is my next block of focus time today?')
              }
              className="context-band-col w-[160px] shrink-0 flex flex-col justify-center gap-0.5 px-3.5 py-2.5 text-left"
            >
              <span className="text-[9px] font-mono uppercase tracking-[0.1em] text-[var(--text-faint)]">
                {ctx.nextEvent ? 'Next meeting' : 'Schedule'}
              </span>
              {ctx.nextEvent ? (
                <div className="flex items-baseline gap-1.5 min-w-0">
                  <span className="text-[11px] font-medium text-[var(--text)] truncate leading-tight">
                    {ctx.nextEvent.summary?.slice(0, 20) || 'Meeting'}
                  </span>
                  <span
                    className="text-[10px] font-mono shrink-0 tabular-nums leading-tight"
                    style={{ color: ctx.nextEventMinutes < 30 ? 'var(--red)' : 'var(--blue)' }}
                  >
                    {ctx.nextEventMinutes}m
                  </span>
                </div>
              ) : (
                <span className="text-[11px] font-medium leading-tight" style={{ color: 'var(--green)' }}>
                  {ctx.eventCount === 0 ? 'Clear' : `${ctx.eventCount} meetings`}
                </span>
              )}
              <span className="text-[10px] font-mono text-[var(--text-faint)] leading-tight">
                {ctx.nextEvent
                  ? `${ctx.eventCount} total today`
                  : ctx.eventCount === 0 ? 'Deep work available' : 'No conflicts'
                }
              </span>
            </button>

            {/* Col 4 — Sources */}
            <div className="context-band-col w-[168px] shrink-0 flex flex-col justify-center gap-1 px-3.5 py-2.5">
              <span className="text-[9px] font-mono uppercase tracking-[0.1em] text-[var(--text-faint)]">Sources</span>
              <div className="grid grid-cols-2 gap-x-2 gap-y-0.5">
                {sources.map((s) => (
                  <button
                    key={s.label}
                    onClick={() => onSendMessage(`What is the current status of my ${s.label.toLowerCase()} data?`)}
                    className="flex items-center gap-1 cursor-pointer group/src min-w-0"
                  >
                    <div className="w-1 h-1 rounded-full shrink-0" style={{ background: s.ok ? 'var(--green)' : 'var(--amber)' }} />
                    <span className="text-[9px] font-mono text-[var(--text-faint)] group-hover/src:text-[var(--text-dim)] transition-colors truncate leading-tight">
                      {s.label}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {/* Right meta */}
            {briefingLoading ? (
              <div className="flex items-center gap-1.5 px-3 py-2.5 shrink-0 context-band-header">
                <RefreshCw size={9} className="text-[var(--text-faint)] animate-spin" />
                <span className="text-[9px] font-mono text-[var(--text-faint)]">sync</span>
              </div>
            ) : (
              <div className="flex items-center px-3 py-2.5 shrink-0 context-band-header">
                <span className="text-[9px] font-mono text-[var(--text-faint)] tabular-nums opacity-50">{timeStr}</span>
              </div>
            )}

          </div>
        </div>
      </div>
    </div>
  );
}


/* ══════════════════════════════════════════════════════════════════
   HomeDashboard — Main Component
   ══════════════════════════════════════════════════════════════════ */

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
  onApproveToChat,
  onDiscussDraft,
  draftsState,
}: Props) {
  const dayFilter = useHomeDayFilter();
  const firstName = displayName?.split(' ')[0] || 'there';

  const ctx = useMemo(
    () => synthesizeContext(stats, events, briefing, hasBriefing),
    [stats, events, briefing, hasBriefing],
  );

  const suggestions = useMemo(() => buildSuggestions(ctx), [ctx]);

  const inboxActionCount = hasBriefing && briefing
    ? briefing.inbox_triage.needs_reply.length + (briefing.inbox_triage.needs_input?.length ?? 0)
    : fallbackTriage
      ? fallbackTriage.needs_reply.length + fallbackTriage.needs_input.length
      : 0;
  const followupActiveCount = (briefing?.followups ?? []).filter(
    (f) => f.status !== 'completed',
  ).length;

  // Build preview summaries for collapsed sections
  const dayEvents = hasBriefing && briefing
    ? dayFilter.filterDayEvents(briefing.day_at_a_glance)
    : dayFilter.filterCalendarEvents(events);
  const dayPreview = buildDayPreview(dayEvents, ctx);
  const inboxPreview = buildInboxPreview(inboxActionCount, ctx);
  const followupPreview = buildFollowupPreview(followupActiveCount, ctx);

  const attentionRef = useRef<HTMLDivElement>(null);

  const handleReviewFlags = useCallback(() => {
    if (ctx.attentionCount > 0 && attentionRef.current) {
      attentionRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
      // Brief highlight pulse via class toggle
      attentionRef.current.classList.add('attention-highlight');
      setTimeout(() => attentionRef.current?.classList.remove('attention-highlight'), 1200);
    } else {
      // No attention items — ask agent with a specific, traceable prompt
      const parts: string[] = [];
      if (ctx.needsReplyCount > 0) parts.push(`${ctx.needsReplyCount} email${ctx.needsReplyCount > 1 ? 's' : ''} awaiting reply`);
      if (ctx.overdueCount > 0) parts.push(`${ctx.overdueCount} overdue follow-up${ctx.overdueCount > 1 ? 's' : ''}`);
      const detail = parts.length > 0 ? ` I can see ${parts.join(' and ')} flagged.` : '';
      onSendMessage(
        `Show me each item currently flagged by the system and explain specifically why it was flagged.${detail}`
      );
    }
  }, [ctx, onSendMessage]);

  return (
    <div className="home-dashboard flex h-full w-full">
      {/* ── Main column (scrollable) ─────────────────────── */}
      <div className="flex-1 min-w-0 flex flex-col h-full overflow-y-auto">
        {/* ── Executive header ── */}
        <motion.div
          {...riseIn}
          transition={{ duration: 0.3, ease: 'easeOut' }}
          className="shrink-0 px-4 md:px-5 pt-6 pb-5"
        >
          <div className="max-w-[1200px]">
            {/* Page header */}
            <div className="mb-4">
              <h1 className="text-[22px] font-semibold text-[var(--text)] tracking-[-0.03em] leading-none">
                Operations overview
              </h1>
              <p className="text-[12px] text-[var(--text-faint)] mt-1.5">
                {formatDate()} · {firstName}
              </p>
            </div>
            {/* Stat strip */}
            <div className="flex items-stretch gap-px rounded-[var(--radius-md)] overflow-hidden border border-[var(--border)] bg-[var(--border)]">
              <div className="flex-1 bg-[var(--surface2)] px-4 py-3">
                <StatTile value={ctx.eventCount} label="today's meetings" accent="var(--blue)" zeroLabel="today's meetings" />
              </div>
              <div className="flex-1 bg-[var(--surface2)] px-4 py-3">
                <StatTile value={ctx.needsReplyCount} label="needs reply" accent="var(--amber)" zeroLabel="needs reply" />
              </div>
              <div className="flex-1 bg-[var(--surface2)] px-4 py-3">
                <StatTile value={ctx.attentionCount} label="needs attention" accent="var(--amber)" zeroLabel="needs attention" />
              </div>
              <div className="flex-1 bg-[var(--surface2)] px-4 py-3">
                <StatTile value={ctx.overdueCount} label="overdue" accent="var(--red)" zeroLabel="overdue" />
              </div>
            </div>
          </div>
        </motion.div>

        {/* ── Draft Queue — the Phase 1 hero panel ── */}
        <motion.div
          {...riseIn}
          transition={{ delay: 0.04, duration: 0.25, ease: 'easeOut' }}
          className="shrink-0 px-4 md:px-5 pb-4"
        >
          <div className="max-w-[1200px]">
            <DraftQueue
              state={draftsState}
              onApproved={(result) => onApproveToChat?.(result)}
              onDiscuss={(draft) => onDiscussDraft?.(draft)}
            />
          </div>
        </motion.div>

        {/* ── Workspace panels ── */}
        {briefingLoading ? (
          <motion.div
            {...riseIn}
            transition={{ delay: 0.1, duration: 0.25, ease: 'easeOut' }}
            className="flex-1 min-h-0 px-4 md:px-5 pb-6"
          >
            <div className="max-w-[1200px]">
              <BriefingSkeleton />
            </div>
          </motion.div>
        ) : (
          <motion.div
            {...riseIn}
            transition={{ delay: 0.1, duration: 0.28, ease: 'easeOut' }}
            className="flex-1 min-h-0 px-4 md:px-5 pb-6"
          >
            {/*
              Grid strategy:
              - mobile  (<768px):  1 col, all panels stack
              - tablet  (768–1023): 1 col, all panels stack
              - desktop (≥1024px): 2 col equal — left: Needs Attention + Calendar
                                                  right: Gmail + Tasks
              Needs Attention only spans full width when it has >4 items
              (too many cards for a half-width column to feel right).
            */}
            <div className="max-w-[1200px]">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 items-start">

                {/* ── Left column: Needs Attention + Calendar ── */}
                <div className="flex flex-col gap-3">

                  {hasBriefing && briefing && ctx.attentionCount > 0 && (
                    <div ref={attentionRef} className="scroll-mt-4">
                      <WorkspaceSection
                        title="Needs Attention"
                        count={ctx.attentionCount}
                        accent="var(--amber)"
                        source="ai · briefing"
                        sectionState="live"
                        preview={`${ctx.overdueCount > 0 ? `${ctx.overdueCount} overdue · ` : ''}${ctx.attentionCount} total items`}
                        onAskAgent={() =>
                          onSendMessage(
                            'Summarize the items that need my attention right now and suggest what to handle first',
                          )
                        }
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
                      </WorkspaceSection>
                    </div>
                  )}

                  {hasBriefing && briefing ? (
                    <WorkspaceSection
                      title="Calendar"
                      count={dayEvents.length}
                      accent="var(--blue)"
                      source="google calendar"
                      sectionState={dayEvents.length > 0 ? 'live' : 'empty'}
                      preview={dayPreview}
                      onAskAgent={() =>
                        onSendMessage(
                          'Walk me through my day — what meetings need prep, what can I skip, and what gaps do I have?',
                        )
                      }
                    >
                      <YourDayPanel
                        kanbanMode
                        events={dayFilter.filterDayEvents(briefing.day_at_a_glance)}
                        onCreateDoc={onCreateDoc}
                        filter={dayFilter.filter}
                        onFilterChange={dayFilter.setFilter}
                      />
                    </WorkspaceSection>
                  ) : (
                    <WorkspaceSection
                      title="Calendar"
                      count={dayFilter.filterCalendarEvents(events).length}
                      accent="var(--blue)"
                      source="google calendar"
                      sectionState={dayFilter.filterCalendarEvents(events).length > 0 ? 'live' : 'empty'}
                      preview={dayPreview}
                    >
                      <TodayPanel
                        kanbanMode
                        events={dayFilter.filterCalendarEvents(events)}
                        stats={stats}
                        onAction={onTriggerAction}
                        filter={dayFilter.filter}
                        onFilterChange={dayFilter.setFilter}
                      />
                    </WorkspaceSection>
                  )}

                  {hasBriefing && briefing ? (
                    <WorkspaceSection
                      title="Tasks"
                      count={followupActiveCount}
                      accent="var(--purple)"
                      source="tasks · drive"
                      sectionState={followupActiveCount > 0 ? (ctx.overdueCount > 0 ? 'stale' : 'live') : 'empty'}
                      defaultOpen={followupActiveCount > 0}
                      preview={followupPreview}
                      onAskAgent={() =>
                        onSendMessage(
                          'Review my open follow-ups — which are overdue, which need action today, and what can I close?',
                        )
                      }
                    >
                      <FollowupPanel
                        kanbanMode
                        followups={briefing.followups ?? []}
                        accountEmail={accountEmail}
                        onComplete={onFollowupComplete}
                        onSnooze={onFollowupSnooze}
                        onDelete={onFollowupDelete}
                        onOpenThread={onOpenThread}
                      />
                    </WorkspaceSection>
                  ) : (
                    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
                      <div className="flex items-center gap-2">
                        <Brain size={14} className="text-[var(--accent)]" />
                        <span className="text-[12px] font-medium text-[var(--text-dim)]">
                          No briefing yet
                        </span>
                      </div>
                      <p className="mt-1.5 text-[12px] leading-relaxed text-[var(--text-faint)]">
                        Generate a daily briefing to surface inbox priorities, attention items, overdue commitments, and scheduling gaps across Gmail, Calendar, and Tasks.
                      </p>
                      <button
                        onClick={() => onSendMessage('Generate my daily briefing')}
                        className="mt-2.5 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--accent-dim)] border border-[var(--accent-border)] text-[12px] text-[var(--accent)] hover:brightness-110 transition-all cursor-pointer"
                      >
                        <Sparkles size={11} />
                        Generate briefing
                      </button>
                    </div>
                  )}

                </div>

                {/* ── Right column: Gmail + Saved Emails ── */}
                <div className="flex flex-col gap-3">

                  <WorkspaceSection
                    title="Gmail"
                    count={inboxActionCount}
                    accent="var(--amber)"
                    source="gmail"
                    sectionState={inboxActionCount > 0 ? 'live' : 'empty'}
                    defaultOpen={inboxActionCount > 0}
                    preview={inboxPreview}
                    onAskAgent={
                      hasBriefing
                        ? () =>
                            onSendMessage(
                              'Triage my inbox — summarize the most important emails and suggest replies',
                            )
                        : undefined
                    }
                  >
                    {hasBriefing && briefing ? (
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
                    ) : fallbackTriage ? (
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
                      <div className="px-4 py-5 text-[12px] text-[var(--text-faint)]">
                        All caught up — no emails need action right now.
                      </div>
                    )}
                  </WorkspaceSection>

                  {/* Saved Emails */}
                  {savedEmails && savedEmails.length > 0 && (
                    <WorkspaceSection
                      title="Saved Emails"
                      count={savedEmails.length}
                      accent="var(--accent)"
                      source="gmail"
                      sectionState="live"
                      defaultOpen={false}
                      preview={`${savedEmails.length} saved for later`}
                    >
                      <FollowupPanel
                        kanbanMode
                        followups={[]}
                        accountEmail={accountEmail}
                        onComplete={onFollowupComplete}
                        onSnooze={onFollowupSnooze}
                        onDelete={onFollowupDelete}
                        onOpenThread={onOpenThread}
                        savedEmails={savedEmails}
                        onOpenSavedThread={onOpenSavedThread}
                        onUnsaveEmail={onUnsaveEmail}
                      />
                    </WorkspaceSection>
                  )}

                </div>

              </div>
            </div>
          </motion.div>
        )}
      </div>

    </div>
  );
}
