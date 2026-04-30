import { useState, useRef, useEffect, useCallback } from 'react';
import {
  RefreshCw, Paperclip, Zap, Clock, Calendar, Check, X, MessageSquare,
  ThumbsUp, Mail, FileText, ChevronDown, ChevronUp, ChevronRight,
  AlertTriangle, Users, Target, Send, Square, Sparkles,
  ExternalLink, Play, ListChecks, Wrench, Search, ArrowRight,
  Lightbulb, GripVertical
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useChatContext } from '../context/ChatContext';
import { safeMarkdown } from './ChatThread';
import type { UseDraftsReturn, ApproveResult } from '../hooks/useDrafts';
import type { StagedDraft } from '../agent/draft-types';
import type { ToolEvent } from '../shared/chat';

interface Props {
  draftsState: UseDraftsReturn;
  onApproved: (result: ApproveResult) => void;
  onDiscuss: (draft: StagedDraft) => void;
  agentName: string;
}

// ── Column resize ────────────────────────────────────────────────────────────

const LEFT_WIDTH_KEY = 'flowspace.horizon.leftW';
const RIGHT_WIDTH_KEY = 'flowspace.horizon.rightW';
const LEFT_DEFAULT = 240;
const RIGHT_DEFAULT = 280;
const MIN_SIDE = 180;
const MAX_SIDE = 420;

function ResizeHandle({ onDrag }: { onDrag: (delta: number) => void }) {
  const dragging = useRef(false);
  const lastX = useRef(0);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    dragging.current = true;
    lastX.current = e.clientX;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging.current) return;
    const delta = e.clientX - lastX.current;
    lastX.current = e.clientX;
    onDrag(delta);
  }, [onDrag]);

  const onPointerUp = useCallback(() => { dragging.current = false; }, []);

  return (
    <div
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      className="shrink-0 w-[5px] cursor-col-resize flex items-center justify-center group hover:bg-[var(--accent-glow)] active:bg-[var(--accent-glow-strong)] transition-colors relative z-10"
    >
      <div className="w-[1px] h-8 bg-[var(--border)] group-hover:bg-[var(--accent)] group-active:bg-[var(--accent)] transition-colors rounded-full" />
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatMeetingTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffDays = Math.floor((d.getTime() - now.getTime()) / 86400000);
  const timeStr = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  if (diffDays === 0) return `Today · ${timeStr}`;
  if (diffDays === 1) return `Tomorrow · ${timeStr}`;
  return `${d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} · ${timeStr}`;
}

function formatRelativeTime(iso: string): string {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function urgencyColor(iso: string): string {
  const d = new Date(iso);
  const diffHours = (d.getTime() - Date.now()) / 3600000;
  if (diffHours < 2) return '#ef4444';
  if (diffHours < 6) return '#f59e0b';
  if (diffHours < 24) return '#22c55e';
  return '#7d7d86';
}

function urgencyBg(iso: string): string {
  const d = new Date(iso);
  const diffHours = (d.getTime() - Date.now()) / 3600000;
  if (diffHours < 2) return 'rgba(239,68,68,0.08)';
  if (diffHours < 6) return 'rgba(245,158,11,0.08)';
  if (diffHours < 24) return 'rgba(34,197,94,0.08)';
  return 'rgba(125,125,134,0.08)';
}

// ── Step 1: parseSummary — extract structure from brief markdown ──────────────

interface ParsedSummary {
  objective: string;
  risks: string[];
  talkingPoints: string[];
  nextStep: string;
  sections: { title: string; content: string }[];
}

function parseSummary(markdown: string, suggestedActions: string[] = []): ParsedSummary {
  const result: ParsedSummary = {
    objective: '',
    risks: [],
    talkingPoints: [],
    nextStep: suggestedActions[0] || '',
    sections: [],
  };

  if (!markdown) return result;

  // Split on markdown headings or bold numbered lines
  const sectionRegex = /(?:^#{2,4}\s+(.+)$)|(?:^\*\*(\d+)\.\s*(.+?)\*\*)/gm;
  const parts: { title: string; start: number }[] = [];
  let match: RegExpExecArray | null;

  while ((match = sectionRegex.exec(markdown)) !== null) {
    const title = (match[1] || match[3] || '').trim();
    if (title) parts.push({ title, start: match.index });
  }

  if (parts.length === 0) {
    // No sections — treat entire text as objective
    const lines = markdown.split('\n').filter((l) => l.trim());
    result.objective = lines[0]?.replace(/^#+\s*/, '').replace(/\*\*/g, '').trim() || '';
    return result;
  }

  // Extract section content
  for (let i = 0; i < parts.length; i++) {
    const contentStart = markdown.indexOf('\n', parts[i].start);
    const contentEnd = i + 1 < parts.length ? parts[i + 1].start : markdown.length;
    const content = contentStart >= 0
      ? markdown.slice(contentStart, contentEnd).trim()
      : '';
    result.sections.push({ title: parts[i].title, content });
  }

  // Map sections to structured fields
  for (const sec of result.sections) {
    const t = sec.title.toLowerCase();
    if (t.includes('overview') || t.includes('objective') || t.includes('purpose') || t.includes('goal')) {
      if (!result.objective) {
        result.objective = sec.content.split('\n').filter((l) => l.trim())[0]?.replace(/\*\*/g, '').trim() || sec.title;
      }
    }
    if (t.includes('risk') || t.includes('concern') || t.includes('issue') || t.includes('challenge')) {
      result.risks = extractBullets(sec.content).slice(0, 3);
    }
    if (t.includes('talking point') || t.includes('discussion point') || t.includes('agenda')) {
      result.talkingPoints = extractBullets(sec.content);
    }
    if ((t.includes('next') && t.includes('step')) || t.includes('action item') || t.includes('follow')) {
      if (!result.nextStep) {
        result.nextStep = extractBullets(sec.content)[0] || sec.content.split('\n').filter((l) => l.trim())[0]?.replace(/\*\*/g, '').trim() || '';
      }
    }
  }

  // Fallback objective from first section
  if (!result.objective && result.sections.length > 0) {
    result.objective = result.sections[0].content.split('\n').filter((l) => l.trim())[0]?.replace(/\*\*/g, '').trim() || result.sections[0].title;
  }

  return result;
}

function extractBullets(content: string): string[] {
  return content
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /^[-•*]\s/.test(l) || /^\d+[.)]\s/.test(l))
    .map((l) => l.replace(/^[-•*]\s+/, '').replace(/^\d+[.)]\s+/, '').replace(/\*\*/g, '').trim())
    .filter(Boolean);
}

// ── Step 3: draftStatusBadge ─────────────────────────────────────────────────

function draftStatusBadge(draft: StagedDraft, isActive: boolean): { label: string; color: string; bgColor: string } | null {
  if (draft.status === 'approved') return { label: 'Opened', color: '#22c55e', bgColor: 'rgba(34,197,94,0.1)' };
  if (draft.status === 'dismissed') return { label: 'Skipped', color: '#7d7d86', bgColor: 'rgba(125,125,134,0.08)' };
  if (isActive) return { label: 'Viewing', color: '#3b82f6', bgColor: 'rgba(59,130,246,0.1)' };
  if (draft.status === 'pending') return { label: 'Ready', color: '#22c55e', bgColor: 'rgba(34,197,94,0.08)' };
  return null;
}

// ── Step 4: GuideChips ───────────────────────────────────────────────────────

const DEFAULT_GUIDE_PROMPTS = [
  'Focus on risks',
  'Prepare questions',
  "Don't send anything",
  'Prioritize key decisions',
];

function buildContextualChips(draft: StagedDraft | null): string[] {
  if (!draft) return DEFAULT_GUIDE_PROMPTS;
  const chips: string[] = [];
  // Contextual to meeting content
  if (draft.linkedDocs.some((d) => /zip|script|code/i.test(d.title)))
    chips.push('Validate reproducibility');
  if (draft.linkedDocs.some((d) => /figure|plot|visual|slide/i.test(d.title)))
    chips.push('Focus on figure accuracy');
  if (draft.attendees.some((a) => a.includes('utexas') || a.includes('.edu')))
    chips.push('Prepare reviewer questions');
  // Fill remaining with defaults
  for (const p of DEFAULT_GUIDE_PROMPTS) {
    if (chips.length >= 4) break;
    if (!chips.includes(p)) chips.push(p);
  }
  return chips.slice(0, 4);
}

function GuideChips({ onSelect, onExecute, draft }: { onSelect: (text: string) => void; onExecute: (text: string) => void; draft: StagedDraft | null }) {
  const chips = buildContextualChips(draft);
  return (
    <div className="flex flex-wrap gap-1 mt-2">
      {chips.map((prompt) => (
        <button
          key={prompt}
          onClick={() => onExecute(prompt)}
          onContextMenu={(e) => { e.preventDefault(); onSelect(prompt); }}
          title="Click to execute · Right-click to edit first"
          className="horizon-chip"
        >
          {prompt}
        </button>
      ))}
    </div>
  );
}

// ── Step 5: OperationalSummary ───────────────────────────────────────────────

function OperationalSummary({ draft, onSwitchToOutput }: { draft: StagedDraft; onSwitchToOutput: () => void }) {
  const parsed = parseSummary(draft.summary, draft.suggestedActions);

  const hasContent = parsed.objective || parsed.risks.length > 0 || parsed.nextStep;
  if (!hasContent) return null;

  const hasOutput = parsed.talkingPoints.length > 0 || (draft.suggestedActions?.length || 0) > 0;

  // Contextual recommendation instead of generic "Agent Needs"
  const recommendation = (() => {
    if (draft.status === 'approved' && parsed.talkingPoints.length > 0)
      return 'Review the talking points in the Output tab and decide whether to inspect attached sources.';
    if (draft.status === 'approved')
      return 'Prep session started. Ask the agent to generate talking points or analyze sources.';
    if (parsed.talkingPoints.length > 0)
      return 'Review the generated talking points, then start a prep session to refine them.';
    if (draft.linkedDocs.length > 0 || draft.relatedEmails.length > 0)
      return `Inspect the ${draft.linkedDocs.length + draft.relatedEmails.length} linked sources, then start a prep session.`;
    return 'Review the brief and start a prep session to generate outputs.';
  })();

  return (
    <div className="space-y-3 mb-5">
      {/* Objective card */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
        <div className="horizon-ops-summary">
          {parsed.objective && (
            <>
              <Target size={13} className="text-[var(--accent)] mt-0.5" />
              <div>
                <p className="text-[9px] font-semibold tracking-[0.08em] uppercase text-[var(--text-faint)] font-mono mb-0.5">Objective</p>
                <p className="text-[13px] text-[var(--text)] leading-snug">{parsed.objective}</p>
              </div>
            </>
          )}
          {parsed.risks.length > 0 && (
            <>
              <AlertTriangle size={13} className="text-[var(--amber)] mt-0.5" />
              <div>
                <p className="text-[9px] font-semibold tracking-[0.08em] uppercase text-[var(--text-faint)] font-mono mb-0.5">Key Risks</p>
                <ul className="text-[12px] text-[var(--text-dim)] leading-relaxed list-none">
                  {parsed.risks.map((r, i) => (
                    <li key={i} className="flex items-start gap-1.5 mb-0.5">
                      <span className="text-[var(--amber)] mt-1 shrink-0">•</span>
                      <span>{r}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Suggested next step — separate, prominent */}
      <div className="rounded-xl border border-[var(--accent-border)] bg-[var(--accent-dim)] px-4 py-3.5 flex items-start gap-3">
        <ArrowRight size={14} className="text-[var(--accent)] mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-[9px] font-semibold tracking-[0.08em] uppercase text-[var(--accent)] font-mono mb-1">Suggested Next Step</p>
          <p className="text-[13px] text-[var(--text)] leading-snug">{recommendation}</p>
          {hasOutput && (
            <button
              onClick={onSwitchToOutput}
              className="mt-2.5 inline-flex items-center gap-2 rounded-lg bg-[var(--accent)] px-4 py-2 text-[12px] font-semibold text-black hover:brightness-110 transition-all cursor-pointer"
            >
              <ListChecks size={12} />
              Review Output
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Step 8: NextBestAction ───────────────────────────────────────────────────

interface NextBestActionProps {
  draft: StagedDraft | null;
  onApprove: (id: string) => void;
  onDiscuss: (draft: StagedDraft) => void;
}

function NextBestAction({ draft, onApprove, onDiscuss }: NextBestActionProps) {
  if (!draft || draft.status !== 'pending') return null;

  const suggestion = draft.suggestedActions?.[0]
    || 'Review the brief and start a prep session';

  return (
    <div className="shrink-0 mx-4 mt-4 mb-1 rounded-lg bg-[var(--accent-dim)] border border-[var(--accent-border)] p-3">
      <p className="text-[9px] font-semibold tracking-[0.08em] uppercase text-[var(--accent)] font-mono mb-1.5 flex items-center gap-1">
        <ArrowRight size={8} /> Suggested Next
      </p>
      <p className="text-[11px] text-[var(--text-dim)] leading-snug mb-2.5">{suggestion}</p>
      <button
        onClick={() => onApprove(draft.id)}
        className="flex items-center gap-1.5 rounded-lg bg-[var(--accent)] px-3 py-1.5 text-[10px] font-semibold text-black hover:brightness-110 transition-all cursor-pointer"
      >
        <Play size={9} fill="currentColor" />
        Start Prep Session
      </button>
    </div>
  );
}

// ── Step 9: ActivityLog ──────────────────────────────────────────────────────

function ActivityLog({ collapsed, onToggle, draft, draftsState }: { collapsed: boolean; onToggle: () => void; draft: StagedDraft | null; draftsState: UseDraftsReturn }) {
  const { messages, isLoading } = useChatContext();

  // Build chronological feed — start with baseline events from draft state
  const entries: { icon: 'tool' | 'user' | 'agent' | 'system'; text: string; key: string }[] = [];

  // Baseline events from draft lifecycle
  if (draft) {
    entries.push({ icon: 'system', text: 'Brief generated for meeting prep', key: 'sys-brief' });
    if (draft.summary) entries.push({ icon: 'system', text: 'Meeting summarized and talking points extracted', key: 'sys-summary' });
    if (draft.relatedEmails.length > 0) entries.push({ icon: 'system', text: `${draft.relatedEmails.length} related email${draft.relatedEmails.length !== 1 ? 's' : ''} identified`, key: 'sys-emails' });
    if (draft.linkedDocs.length > 0) entries.push({ icon: 'system', text: `${draft.linkedDocs.length} linked doc${draft.linkedDocs.length !== 1 ? 's' : ''} found`, key: 'sys-docs' });
    if (draft.status === 'approved') entries.push({ icon: 'system', text: 'Brief approved — prep session started', key: 'sys-approved' });
  }
  if (draftsState.lastScan) {
    entries.push({ icon: 'system', text: `Calendar scanned: ${draftsState.lastScan.meetingsPrepped}/${draftsState.lastScan.meetingsFound} meetings prepped`, key: 'sys-scan' });
  }

  // Chat-derived events
  for (const msg of messages) {
    if (msg.role === 'user') {
      const text = typeof msg.content === 'string' ? msg.content : '';
      entries.push({ icon: 'user', text: text.slice(0, 80) + (text.length > 80 ? '…' : ''), key: `u-${msg.id}` });
    }
    if (msg.role === 'assistant' && msg.toolEvents) {
      for (const ev of msg.toolEvents) {
        entries.push({ icon: 'tool', text: `${ev.label || ev.toolName}${ev.detail ? ': ' + ev.detail.slice(0, 40) : ''}`, key: `t-${ev.id}` });
      }
    }
    if (msg.role === 'assistant' && msg.content) {
      const plain = msg.content.replace(/#{1,6}\s+/g, '').replace(/\*\*/g, '').trim();
      entries.push({ icon: 'agent', text: plain.slice(0, 80) + (plain.length > 80 ? '…' : ''), key: `a-${msg.id}` });
    }
  }

  const systemEntries = entries.filter((e) => e.icon === 'system');
  const interactionEntries = entries.filter((e) => e.icon !== 'system');
  const count = entries.length;

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <button
        onClick={onToggle}
        className="shrink-0 w-full flex items-center justify-between px-4 py-2 cursor-pointer hover:bg-[var(--surface)] transition-colors"
      >
        <p className="text-[9px] font-semibold tracking-[0.1em] uppercase text-[var(--text-faint)] font-mono">
          Activity {count > 0 && `· ${count}`}
        </p>
        {collapsed ? <ChevronRight size={10} className="text-[var(--text-faint)]" /> : <ChevronDown size={10} className="text-[var(--text-faint)]" />}
      </button>

      {!collapsed && (
        <div className="flex-1 overflow-y-auto px-4 py-1.5 border-t border-[var(--border)]">
          {entries.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-6 text-center gap-2 opacity-50">
              <Clock size={14} className="text-[var(--text-faint)]" />
              <p className="text-[10px] text-[var(--text-faint)]">No activity yet</p>
            </div>
          ) : (
            <>
              {/* Group: system baseline events */}
              {systemEntries.length > 0 && (
                <div className="mb-2">
                  <p className="text-[8px] font-mono font-semibold tracking-[0.1em] uppercase text-[var(--text-faint)] mb-1 opacity-60">Completed</p>
                  {systemEntries.map((entry) => (
                    <div key={entry.key} className="horizon-activity-entry">
                      <Check size={9} className="text-[var(--accent)] mt-[3px] shrink-0" />
                      <p className="text-[11px] leading-snug line-clamp-2 text-[var(--text-faint)]">{entry.text}</p>
                    </div>
                  ))}
                </div>
              )}
              {/* Group: interaction events */}
              {interactionEntries.length > 0 && (
                <div>
                  <p className="text-[8px] font-mono font-semibold tracking-[0.1em] uppercase text-[var(--text-faint)] mb-1 opacity-60">Interactions</p>
                  {interactionEntries.map((entry) => (
                    <div key={entry.key} className="horizon-activity-entry">
                      {entry.icon === 'tool' && <Wrench size={9} className="text-[var(--accent)] mt-[3px] shrink-0" />}
                      {entry.icon === 'user' && <Send size={9} className="text-[var(--blue)] mt-[3px] shrink-0" />}
                      {entry.icon === 'agent' && <MessageSquare size={9} className="text-[var(--text-faint)] mt-[3px] shrink-0" />}
                      <p className="text-[11px] leading-snug line-clamp-2 text-[var(--text-dim)]">{entry.text}</p>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
          {isLoading && (
            <div className="horizon-activity-entry">
              <div className="w-2 h-2 rounded-full bg-[var(--accent)] animate-pulse mt-[3px] shrink-0" />
              <p className="text-[10px] text-[var(--accent)] animate-pulse">Working…</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Left rail: brief list ─────────────────────────────────────────────────────

interface BriefListItemProps {
  draft: StagedDraft;
  selected: boolean;
  onSelect: () => void;
  justApproved: boolean;
  isActive: boolean;
}

function BriefListItem({ draft, selected, onSelect, justApproved, isActive }: BriefListItemProps) {
  const isDone = draft.status === 'approved' || draft.status === 'dismissed';
  const color = urgencyColor(draft.meetingTime);
  const badge = draftStatusBadge(draft, isActive);

  return (
    <button
      onClick={onSelect}
      className={`relative w-full text-left px-3 py-2.5 rounded-lg transition-all duration-150 group/item overflow-hidden ${
        selected
          ? 'bg-[var(--surface2)] ring-1 ring-[var(--border2)]'
          : 'hover:bg-[var(--surface)]'
      } ${isDone && !selected ? 'opacity-40' : ''}`}
    >
      {selected && (
        <span className="absolute left-0 top-2 bottom-2 w-[2.5px] rounded-full" style={{ background: color }} />
      )}
      <div className="flex items-start gap-2.5 pl-1">
        <div className="mt-[5px] shrink-0 relative">
          <div className="w-2 h-2 rounded-full" style={{ background: isDone ? '#4b4b52' : color }} />
          {!isDone && selected && (
            <div className="absolute inset-0 rounded-full animate-ping opacity-40" style={{ background: color }} />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium text-[var(--text)] truncate leading-tight">{draft.meetingTitle}</p>
          <p className="text-[10px] mt-0.5" style={{ color: isDone ? '#7d7d86' : color }}>
            {formatMeetingTime(draft.meetingTime)}
          </p>
          {/* Step 3: Status badge */}
          {badge && (
            <span
              className="horizon-status-badge mt-1 inline-flex"
              style={{ color: badge.color, background: badge.bgColor }}
            >
              {badge.label}
            </span>
          )}
          {!isDone && (
            <div className="flex items-center gap-2 mt-1">
              {draft.relatedEmails.length > 0 && (
                <span className="inline-flex items-center gap-0.5 text-[9px] text-[var(--text-faint)]">
                  <Mail size={8} /> {draft.relatedEmails.length}
                </span>
              )}
              {draft.linkedDocs.length > 0 && (
                <span className="inline-flex items-center gap-0.5 text-[9px] text-[var(--text-faint)]">
                  <FileText size={8} /> {draft.linkedDocs.length}
                </span>
              )}
              {draft.attendees.length > 0 && (
                <span className="inline-flex items-center gap-0.5 text-[9px] text-[var(--text-faint)]">
                  <Users size={8} /> {draft.attendees.length}
                </span>
              )}
            </div>
          )}
          {justApproved && (
            <span className="text-[9px] text-[var(--green)] flex items-center gap-0.5 mt-0.5">
              <Check size={8} /> Chat started
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

// ── Center: primary workspace ─────────────────────────────────────────────────

interface WorkspaceProps {
  draft: StagedDraft;
  onApprove: (id: string) => void;
  onDismiss: (id: string) => void;
  onDiscuss: (draft: StagedDraft) => void;
  onToggleUseful: (id: string, useful: boolean) => void;
  justApproved: boolean;
}

function WorkspacePanel({ draft, onApprove, onDismiss, onDiscuss, onToggleUseful, justApproved }: WorkspaceProps) {
  const { sendMessage, messages } = useChatContext();
  const isDone = draft.status === 'approved' || draft.status === 'dismissed';
  const color = urgencyColor(draft.meetingTime);
  const bgColor = urgencyBg(draft.meetingTime);
  const parsed = parseSummary(draft.summary, draft.suggestedActions);
  const hasOutputContent = parsed.talkingPoints.length > 0 || (draft.suggestedActions?.length || 0) > 0;

  // Default to Output tab when agent has produced work
  const [activeTab, setActiveTab] = useState<'brief' | 'sources' | 'participants' | 'output'>(
    hasOutputContent && (draft.status === 'approved' || isDone) ? 'output' : 'brief'
  );

  const tabs: { id: typeof activeTab; label: string; count?: number }[] = [
    { id: 'brief', label: 'Brief' },
    { id: 'sources', label: 'Sources', count: draft.relatedEmails.length + draft.linkedDocs.length },
    { id: 'participants', label: 'Participants', count: draft.attendees.length },
    { id: 'output', label: 'Output', count: parsed.talkingPoints.length + (draft.suggestedActions?.length || 0) },
  ];

  // Step 10: inline source action
  const handleSourceAction = (action: string, subject: string, detail: string) => {
    void sendMessage(`${action} "${subject}" from ${detail}. Surface key insights and anything relevant to the meeting.`, { preserveActiveView: true });
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Meeting header */}
      <div className="shrink-0 px-8 pt-7 pb-0 border-b border-[var(--border)]">
        <div className="flex items-center gap-3 mb-3">
          <span
            className="inline-flex items-center gap-1.5 text-[10px] font-semibold tracking-wide uppercase rounded-full px-2.5 py-1 border font-mono"
            style={{ color, borderColor: color, background: bgColor }}
          >
            <span className="w-1.5 h-1.5 rounded-full inline-block shrink-0" style={{ background: color }} />
            {formatMeetingTime(draft.meetingTime)}
          </span>
          {draft.status !== 'pending' && (
            <span className={`inline-flex items-center gap-1.5 text-[10px] font-medium rounded-full px-2 py-0.5 ${
              draft.status === 'approved'
                ? 'text-[var(--accent)] bg-[var(--accent-dim)] border border-[var(--accent-border)]'
                : 'text-[var(--text-faint)] bg-[var(--surface2)] border border-[var(--border)]'
            }`}>
              {draft.status === 'approved' ? <><Check size={9} /> Prep session active</> : <><X size={9} /> Dismissed</>}
            </span>
          )}
        </div>

        <h1 className="text-[20px] font-bold text-[var(--text)] tracking-[-0.02em] leading-tight mb-3">
          {draft.meetingTitle}
        </h1>

        {draft.attendees.length > 0 && (
          <div className="flex items-center gap-2 mb-4">
            <div className="flex -space-x-1.5">
              {draft.attendees.slice(0, 4).map((a, i) => (
                <div
                  key={i}
                  className="w-6 h-6 rounded-full border-2 border-[var(--bg-elevated)] text-[8px] font-bold flex items-center justify-center"
                  style={{ background: `hsl(${(a.charCodeAt(0) * 37) % 360}, 40%, 32%)`, color: 'rgba(255,255,255,0.9)', zIndex: 4 - i }}
                  title={a}
                >
                  {a[0]?.toUpperCase()}
                </div>
              ))}
            </div>
            <span className="text-[11px] text-[var(--text-faint)] truncate max-w-[320px]">
              {draft.attendees.slice(0, 2).join(', ')}
              {draft.attendees.length > 2 && ` +${draft.attendees.length - 2} more`}
            </span>
          </div>
        )}

        {/* Step 5: Operational Summary */}
        <OperationalSummary draft={draft} onSwitchToOutput={() => setActiveTab('output')} />

        {/* Tab bar */}
        <div className="flex items-end gap-0">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-[13px] font-medium transition-all border-b-[2px] cursor-pointer ${
                activeTab === tab.id
                  ? 'text-[var(--text)] border-[var(--accent)]'
                  : 'text-[var(--text-faint)] border-transparent hover:text-[var(--text-dim)]'
              }`}
            >
              {tab.label}
              {tab.count !== undefined && tab.count > 0 && (
                <span className={`text-[9px] font-mono rounded-full px-1.5 py-0.5 leading-none ${
                  activeTab === tab.id ? 'bg-[var(--accent-dim)] text-[var(--accent)]' : 'bg-[var(--surface2)] text-[var(--text-faint)]'
                }`}>{tab.count}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto px-8 py-6">
        <AnimatePresence mode="wait">
          {activeTab === 'brief' && (
            <motion.div key="brief" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
              {draft.summary ? (
                <div className="prose-horizon" dangerouslySetInnerHTML={{ __html: safeMarkdown(draft.summary) }} />
              ) : (
                <p className="text-[var(--text-faint)] text-sm italic">No brief generated yet.</p>
              )}
            </motion.div>
          )}

          {activeTab === 'sources' && (
            <motion.div key="sources" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }} className="space-y-4">
              {draft.relatedEmails.length === 0 && draft.linkedDocs.length === 0 ? (
                <p className="text-[var(--text-faint)] text-sm italic">No sources linked to this brief.</p>
              ) : (
                <>
                  {draft.relatedEmails.length > 0 && (
                    <div>
                      <p className="text-[10px] font-semibold tracking-[0.1em] uppercase text-[var(--text-faint)] mb-2 font-mono">Emails ({draft.relatedEmails.length})</p>
                      <div className="space-y-1.5">
                        {draft.relatedEmails.map((email, i) => (
                          <div key={i} className="group flex items-start gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 hover:border-[var(--border2)] transition-colors">
                            <div className="mt-0.5 w-6 h-6 rounded-md bg-[var(--blue-dim)] border border-[var(--blue-border)] flex items-center justify-center shrink-0">
                              <Mail size={11} className="text-[var(--blue)]" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="text-[13px] font-medium text-[var(--text)] leading-tight">{email.subject}</p>
                              <p className="text-[11px] text-[var(--text-faint)] mt-0.5">{email.from}</p>
                              {email.snippet && (
                                <p className="text-[11px] text-[var(--text-dim)] mt-1 line-clamp-2 leading-relaxed">{email.snippet}</p>
                              )}
                              {/* Step 10: source actions */}
                              <div className="flex items-center gap-1.5 mt-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                                <button onClick={() => handleSourceAction('Analyze this email', email.subject, email.from)} className="horizon-chip text-[9px]"><Search size={8} /> Analyze</button>
                                <button onClick={() => handleSourceAction('Summarize this email', email.subject, email.from)} className="horizon-chip text-[9px]"><ListChecks size={8} /> Summarize</button>
                                <button onClick={() => handleSourceAction('Use this email in meeting prep', email.subject, email.from)} className="horizon-chip text-[9px]"><Play size={8} /> Use in Prep</button>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {draft.linkedDocs.length > 0 && (
                    <div>
                      <p className="text-[10px] font-semibold tracking-[0.1em] uppercase text-[var(--text-faint)] mb-2 font-mono">Documents ({draft.linkedDocs.length})</p>
                      <div className="space-y-1.5">
                        {draft.linkedDocs.map((doc, i) => (
                          <div key={i} className="group flex items-center gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 hover:border-[var(--border2)] transition-colors">
                            <div className="w-6 h-6 rounded-md bg-[var(--surface2)] border border-[var(--border)] flex items-center justify-center shrink-0">
                              <FileText size={11} className="text-[var(--text-faint)]" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <span className="text-[13px] text-[var(--text)] truncate block">{doc.title}</span>
                              {/* Step 10: source actions */}
                              <div className="flex items-center gap-1.5 mt-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                                <button onClick={() => handleSourceAction('Analyze this document', doc.title, doc.url || 'Drive')} className="horizon-chip text-[9px]"><Search size={8} /> Analyze</button>
                                <button onClick={() => handleSourceAction('Summarize this document', doc.title, doc.url || 'Drive')} className="horizon-chip text-[9px]"><ListChecks size={8} /> Summarize</button>
                              </div>
                            </div>
                            {doc.url && (
                              <a href={doc.url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="text-[var(--accent)] opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                                <ExternalLink size={11} />
                              </a>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </motion.div>
          )}

          {activeTab === 'participants' && (
            <motion.div key="participants" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }} className="space-y-2">
              {draft.attendees.length === 0 ? (
                <p className="text-[var(--text-faint)] text-sm italic">No participants listed.</p>
              ) : (
                draft.attendees.map((attendee, i) => (
                  <div key={i} className="flex items-center gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5">
                    <div
                      className="w-7 h-7 rounded-full text-[11px] font-bold flex items-center justify-center shrink-0"
                      style={{ background: `hsl(${(attendee.charCodeAt(0) * 37) % 360}, 45%, 30%)`, color: 'white' }}
                    >
                      {attendee[0]?.toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <p className="text-[13px] text-[var(--text)] truncate">{attendee}</p>
                    </div>
                  </div>
                ))
              )}
            </motion.div>
          )}

          {/* Step 6: Output tab — card-based, action-oriented */}
          {activeTab === 'output' && (
            <motion.div key="output" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }} className="space-y-5">
              {parsed.talkingPoints.length === 0 && parsed.sections.length === 0 && (!draft.suggestedActions || draft.suggestedActions.length === 0) ? (
                <div className="flex flex-col items-center justify-center py-10 text-center gap-3">
                  <div className="w-12 h-12 rounded-xl bg-[var(--surface)] border border-[var(--border)] flex items-center justify-center">
                    <ListChecks size={20} className="text-[var(--text-faint)]" />
                  </div>
                  <div>
                    <p className="text-[13px] text-[var(--text-dim)] mb-1 font-medium">No outputs generated yet</p>
                    <p className="text-[11px] text-[var(--text-faint)] max-w-[240px] leading-relaxed">Start a prep session to generate talking points, questions, and agenda items.</p>
                  </div>
                  <button
                    onClick={() => { void sendMessage('Generate comprehensive prep notes for this meeting: talking points, key questions, risks to discuss, and follow-up actions.', { preserveActiveView: true }); }}
                    className="flex items-center gap-1.5 rounded-lg bg-[var(--accent-dim)] border border-[var(--accent-border)] px-4 py-2 text-[11px] text-[var(--accent)] font-medium hover:brightness-110 transition-all cursor-pointer mt-1"
                  >
                    <Sparkles size={10} /> Generate Prep Package
                  </button>
                </div>
              ) : (
                <>
                  {/* Talking Points card */}
                  {parsed.talkingPoints.length > 0 && (
                    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
                      <div className="flex items-center justify-between px-4 py-2.5 border-b border-[var(--border)]">
                        <p className="text-[10px] font-semibold tracking-[0.08em] uppercase text-[var(--text-faint)] font-mono flex items-center gap-1.5">
                          <MessageSquare size={10} className="text-[var(--accent)]" /> Talking Points
                        </p>
                        <div className="flex items-center gap-1">
                          <button onClick={() => { void sendMessage('Regenerate the talking points for this meeting with more detail and specificity.', { preserveActiveView: true }); }} className="horizon-chip text-[9px]">Regenerate</button>
                          <button onClick={() => { void sendMessage('Send the talking points to chat so I can edit them.', { preserveActiveView: true }); }} className="horizon-chip text-[9px]">Send to chat</button>
                        </div>
                      </div>
                      <div className="px-4 py-3">
                        <ol className="space-y-2 list-none">
                          {parsed.talkingPoints.map((tp, i) => (
                            <li key={i} className="flex items-start gap-2.5 text-[13px] text-[var(--text-dim)] leading-relaxed">
                              <span className="w-5 h-5 rounded-md bg-[var(--accent-dim)] text-[var(--accent)] text-[10px] font-mono font-bold flex items-center justify-center shrink-0 mt-0.5">{i + 1}</span>
                              <span className="pt-0.5">{tp}</span>
                            </li>
                          ))}
                        </ol>
                      </div>
                    </div>
                  )}

                  {/* Suggested Actions card */}
                  {draft.suggestedActions && draft.suggestedActions.length > 0 && (
                    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
                      <div className="flex items-center justify-between px-4 py-2.5 border-b border-[var(--border)]">
                        <p className="text-[10px] font-semibold tracking-[0.08em] uppercase text-[var(--text-faint)] font-mono flex items-center gap-1.5">
                          <ArrowRight size={10} className="text-[var(--blue)]" /> Suggested Actions
                        </p>
                      </div>
                      <div className="px-4 py-3 space-y-2">
                        {draft.suggestedActions.map((action, i) => (
                          <div key={i} className="flex items-center gap-3 group">
                            <div className="flex items-start gap-2 flex-1 min-w-0">
                              <Check size={10} className="text-[var(--text-faint)] mt-1 shrink-0 group-hover:text-[var(--accent)] transition-colors" />
                              <p className="text-[13px] text-[var(--text-dim)] leading-relaxed">{action}</p>
                            </div>
                            <button
                              onClick={() => { void sendMessage(`Execute this action: ${action}`, { preserveActiveView: true }); }}
                              className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity horizon-chip text-[9px]"
                            >
                              <Play size={7} /> Run
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Remaining parsed sections as cards */}
                  {parsed.sections
                    .filter((s) => {
                      const t = s.title.toLowerCase();
                      return !t.includes('overview') && !t.includes('objective') && !t.includes('talking') && !t.includes('risk');
                    })
                    .map((sec, i) => (
                      <div key={i} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
                        <div className="px-4 py-2.5 border-b border-[var(--border)]">
                          <p className="text-[10px] font-semibold tracking-[0.08em] uppercase text-[var(--text-faint)] font-mono">{sec.title}</p>
                        </div>
                        <div className="px-4 py-3 text-[13px] text-[var(--text-dim)] leading-relaxed prose-horizon" dangerouslySetInnerHTML={{ __html: safeMarkdown(sec.content) }} />
                      </div>
                    ))
                  }

                  {/* Quick generate actions */}
                  <div className="flex items-center gap-2 pt-1">
                    <p className="text-[9px] text-[var(--text-faint)] font-mono">Generate more:</p>
                    <button onClick={() => { void sendMessage('Generate a meeting agenda based on the brief and sources.', { preserveActiveView: true }); }} className="horizon-chip text-[9px]">Agenda</button>
                    <button onClick={() => { void sendMessage('Generate key questions to ask during this meeting.', { preserveActiveView: true }); }} className="horizon-chip text-[9px]">Questions</button>
                    <button onClick={() => { void sendMessage('List follow-up tasks that should be assigned after this meeting.', { preserveActiveView: true }); }} className="horizon-chip text-[9px]">Follow-ups</button>
                  </div>
                </>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Step 2: Renamed action bar */}
      <div className="shrink-0 px-8 py-4 border-t border-[var(--border)]">
        {isDone ? (
          <div className="flex items-center gap-2 text-[12px] text-[var(--text-faint)] italic">
            {draft.status === 'approved'
              ? <><Check size={13} className="text-[var(--green)]" /> This brief was approved and opened in chat.</>
              : <><X size={13} /> This brief was dismissed.</>
            }
          </div>
        ) : justApproved ? (
          <div className="flex items-center gap-2 text-[13px] text-[var(--green)] font-medium">
            <Check size={14} /> Approved — prep session started
          </div>
        ) : (
          <div className="flex items-center gap-2.5 flex-wrap">
            <button
              onClick={() => onApprove(draft.id)}
              className="flex items-center gap-2 rounded-xl border border-[var(--green-border)] bg-[var(--green-dim)] px-5 py-2.5 text-[13px] text-[var(--green)] hover:brightness-125 transition-all cursor-pointer font-semibold"
            >
              <Play size={13} fill="currentColor" />
              Start Prep Session
            </button>
            <button
              onClick={() => onDiscuss(draft)}
              className="flex items-center gap-2 rounded-xl border border-[var(--border2)] bg-[var(--surface)] px-4 py-2.5 text-[13px] text-[var(--text-dim)] hover:text-[var(--text)] hover:border-[var(--border2)] transition-all cursor-pointer"
            >
              <MessageSquare size={13} />
              Refine Brief
            </button>
            {/* Agent-powered quick actions */}
            <button
              onClick={() => { void sendMessage('Generate detailed prep notes for this meeting based on the brief and sources', { preserveActiveView: true }); }}
              className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[11px] text-[var(--text-faint)] hover:text-[var(--accent)] hover:border-[var(--accent-border)] transition-all cursor-pointer"
            >
              <ListChecks size={11} />
              Generate Notes
            </button>
            <button
              onClick={() => { void sendMessage('Analyze the sources used for this meeting brief and surface key insights', { preserveActiveView: true }); }}
              className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[11px] text-[var(--text-faint)] hover:text-[var(--accent)] hover:border-[var(--accent-border)] transition-all cursor-pointer"
            >
              <Search size={11} />
              Analyze Sources
            </button>
            <div className="flex-1" />
            <button
              onClick={() => onDismiss(draft.id)}
              className="flex items-center gap-1.5 px-3 py-2 text-[11px] text-[var(--text-faint)] hover:text-[var(--error)] transition-colors cursor-pointer rounded-lg hover:bg-[var(--error-dim)]"
            >
              <X size={11} /> Skip
            </button>
            <button
              onClick={() => onToggleUseful(draft.id, !draft.useful)}
              className={`flex items-center gap-1 px-2.5 py-2 rounded-lg text-[11px] transition-all cursor-pointer ${
                draft.useful
                  ? 'text-[var(--accent)] bg-[var(--accent-dim)] border border-[var(--accent-border)]'
                  : 'text-[var(--text-faint)] hover:text-[var(--text-dim)] border border-transparent hover:border-[var(--border)]'
              }`}
            >
              <ThumbsUp size={10} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Right panel: agent state + context ───────────────────────────────────────

interface AgentPanelProps {
  draftsState: UseDraftsReturn;
  draft: StagedDraft | null;
  onApprove: (id: string) => void;
  onDiscuss: (draft: StagedDraft) => void;
}

function AgentPanel({ draftsState, draft, onApprove, onDiscuss }: AgentPanelProps) {
  const { messages, isLoading, input, setInput, sendMessage, stopGeneration, pendingApprovals } = useChatContext();
  const [contextText, setContextText] = useState('');
  const [activityCollapsed, setActivityCollapsed] = useState(false);

  // Gather unique tool events
  const toolEvents: ToolEvent[] = [];
  for (const msg of messages) {
    if (msg.role === 'assistant' && msg.toolEvents) {
      for (const ev of msg.toolEvents) {
        if (!toolEvents.find((e) => e.toolName === ev.toolName)) toolEvents.push(ev);
      }
    }
  }

  const hasActivity = messages.length > 0;

  const handleAddContext = () => {
    const val = contextText.trim();
    if (!val) return;
    setInput(`[Instructions: ${val}]\n\n` + input);
    setContextText('');
  };

  const handleSend = () => {
    if (!input.trim() || isLoading) return;
    void sendMessage(undefined, { preserveActiveView: true });
  };

  // Step 7: contextual agent status
  const agentStatus = (() => {
    if (isLoading) return { dot: 'bg-[var(--accent)] animate-pulse', text: 'Working…', color: 'text-[var(--accent)]' };
    if (pendingApprovals.length > 0) return { dot: 'bg-[var(--amber)]', text: 'Awaiting your approval', color: 'text-[var(--amber)]' };
    if (toolEvents.length > 0 && !isLoading) return { dot: 'bg-[var(--accent)]', text: `Completed — used ${toolEvents.map((e) => e.label || e.toolName).slice(0, 2).join(', ')}`, color: 'text-[var(--text-dim)]' };
    if (draft && !hasActivity) return { dot: 'bg-[var(--accent)]', text: 'Context loaded — ready to assist', color: 'text-[var(--text-dim)]' };
    if (!draft) return { dot: 'bg-[var(--surface3)]', text: 'Select a brief to begin', color: 'text-[var(--text-faint)]' };
    return { dot: 'bg-[var(--surface3)]', text: 'Idle — awaiting direction', color: 'text-[var(--text-dim)]' };
  })();

  return (
    <div className="flex flex-col h-full overflow-hidden">

      {/* Step 8: Next Best Action */}
      <NextBestAction draft={draft} onApprove={onApprove} onDiscuss={onDiscuss} />

      {/* Step 7: Agent status */}
      <div className="shrink-0 px-4 pt-4 pb-3.5 border-b border-[var(--border)]">
        <p className="text-[9px] font-semibold tracking-[0.1em] uppercase text-[var(--text-faint)] font-mono mb-2.5">Agent Status</p>
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${agentStatus.dot}`} />
          <span className={`text-[12px] ${agentStatus.color}`}>{agentStatus.text}</span>
        </div>
        {isLoading && (
          <button
            onClick={stopGeneration}
            className="mt-2 flex items-center gap-1.5 text-[10px] text-[var(--error)] hover:brightness-125 transition-all cursor-pointer"
          >
            <Square size={9} fill="currentColor" /> Stop generation
          </button>
        )}

        {/* Agent understanding pills */}
        {draft && (
          <div className="flex flex-wrap gap-1 mt-2.5">
            <span className="horizon-status-badge" style={{ color: '#22c55e', background: 'rgba(34,197,94,0.08)' }}>Brief loaded</span>
            {draft.relatedEmails.length > 0 && (
              <span className="horizon-status-badge" style={{ color: '#3b82f6', background: 'rgba(59,130,246,0.08)' }}>{draft.relatedEmails.length} emails</span>
            )}
            {draft.linkedDocs.length > 0 && (
              <span className="horizon-status-badge" style={{ color: '#7c3aed', background: 'rgba(124,58,237,0.08)' }}>{draft.linkedDocs.length} docs</span>
            )}
            {draft.attendees.length > 0 && (
              <span className="horizon-status-badge" style={{ color: '#f59e0b', background: 'rgba(245,158,11,0.08)' }}>{draft.attendees.length} attendees</span>
            )}
          </div>
        )}
      </div>

      {/* Current task + progress */}
      {draft && (
        <div className="shrink-0 px-4 py-3.5 border-b border-[var(--border)]">
          <p className="text-[9px] font-semibold tracking-[0.1em] uppercase text-[var(--text-faint)] font-mono mb-2.5">Progress</p>
          <div className="space-y-1.5">
            {[
              { label: 'Context loaded', done: true },
              { label: 'Brief analyzed', done: !!draft.summary },
              { label: 'Output drafted', done: parseSummary(draft.summary, draft.suggestedActions).talkingPoints.length > 0 },
              { label: 'Prep session started', done: draft.status === 'approved' || hasActivity },
              { label: 'Awaiting your direction', done: false, active: !isLoading && (draft.status === 'approved' || hasActivity) },
            ].map((step, i) => (
              <div key={i} className="flex items-center gap-2">
                <div className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center shrink-0 ${
                  step.done
                    ? 'bg-[var(--accent-dim)] border-[var(--accent-border)]'
                    : step.active
                      ? 'border-[var(--accent)] bg-transparent'
                      : 'border-[var(--border)] bg-transparent'
                }`}>
                  {step.done && <Check size={7} className="text-[var(--accent)]" strokeWidth={3} />}
                  {step.active && !step.done && <div className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] animate-pulse" />}
                </div>
                <span className={`text-[11px] ${step.done ? 'text-[var(--text-dim)]' : step.active ? 'text-[var(--accent)]' : 'text-[var(--text-faint)]'}`}>
                  {step.label}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tools used */}
      {toolEvents.length > 0 && (
        <div className="shrink-0 px-4 py-3.5 border-b border-[var(--border)]">
          <p className="text-[9px] font-semibold tracking-[0.1em] uppercase text-[var(--text-faint)] font-mono mb-2.5">Tools Active</p>
          <div className="flex flex-wrap gap-1">
            {toolEvents.map((ev) => (
              <span key={ev.toolName} className="inline-flex items-center gap-1 rounded-md border border-[var(--accent-border)] bg-[var(--accent-dim)] px-1.5 py-0.5 text-[9px] text-[var(--accent)] font-mono">
                <Zap size={7} />
                {ev.label || ev.toolName}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Last scan — compact inline under progress */}
      {draftsState.lastScan && (
        <div className="shrink-0 px-4 pb-3.5 -mt-1">
          <p className="text-[10px] text-[var(--text-faint)] flex items-center gap-1.5">
            <Clock size={9} className="shrink-0" />
            {draft ? '1 brief processed' : `${draftsState.lastScan.meetingsPrepped} brief${draftsState.lastScan.meetingsPrepped !== 1 ? 's' : ''} ready`}
            {draftsState.lastScan.scannedAt && (
              <span className="opacity-50">· {formatRelativeTime(draftsState.lastScan.scannedAt)}</span>
            )}
          </p>
        </div>
      )}

      {/* Step 4: Guide the Agent */}
      <div className="shrink-0 px-4 py-3.5 border-b border-[var(--border)]">
        <p className="text-[9px] font-semibold tracking-[0.1em] uppercase text-[var(--text-faint)] font-mono mb-2.5 flex items-center gap-1">
          <Lightbulb size={9} /> Guide the Agent
        </p>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
          <textarea
            value={contextText}
            onChange={(e) => setContextText(e.target.value)}
            placeholder="Set priorities, constraints, or instructions…"
            className="w-full bg-transparent text-[12px] text-[var(--text)] placeholder:text-[var(--text-faint)] resize-none outline-none px-2.5 py-2 min-h-[48px] max-h-[80px]"
          />
          <div className="flex items-center justify-between px-2 py-1 border-t border-[var(--border)]">
            <Paperclip size={10} className="text-[var(--text-faint)]" />
            <button
              onClick={handleAddContext}
              disabled={!contextText.trim()}
              className="text-[10px] font-medium text-[var(--accent)] hover:brightness-110 disabled:opacity-40 transition-all cursor-pointer disabled:cursor-not-allowed"
            >
              Add to message
            </button>
          </div>
        </div>
        <GuideChips
          onSelect={(text) => setContextText(text)}
          onExecute={(text) => {
            const meetingCtx = draft ? ` for the meeting "${draft.meetingTitle}"` : '';
            void sendMessage(`${text}${meetingCtx}. Based on the brief and sources, produce structured output.`, { preserveActiveView: true });
          }}
          draft={draft}
        />
      </div>

      {/* Step 9: Activity Log */}
      <ActivityLog collapsed={activityCollapsed} onToggle={() => setActivityCollapsed((v) => !v)} draft={draft} draftsState={draftsState} />

      {/* Input at bottom */}
      <div className="shrink-0 px-3 pb-3 pt-1.5 border-t border-[var(--border)]">
        <div className="flex items-end gap-1.5 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 focus-within:border-[var(--accent)] transition-colors">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
            }}
            placeholder="Tell the agent what to do next…"
            rows={1}
            className="flex-1 bg-transparent text-[12px] text-[var(--text)] placeholder:text-[var(--text-faint)] resize-none outline-none py-0.5 min-h-[22px] max-h-[80px]"
            style={{ lineHeight: '1.5' }}
          />
          <button
            onClick={isLoading ? stopGeneration : handleSend}
            className="shrink-0 w-6 h-6 rounded-lg flex items-center justify-center transition-all cursor-pointer"
            style={{
              background: isLoading ? 'var(--error-dim)' : input.trim() ? 'var(--accent)' : 'var(--surface2)',
              color: isLoading ? 'var(--error)' : input.trim() ? 'black' : 'var(--text-faint)',
            }}
          >
            {isLoading ? <Square size={8} fill="currentColor" /> : <Send size={9} strokeWidth={2.5} />}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Empty / no selection state ────────────────────────────────────────────────

function EmptyWorkspace({ drafts, onScan, scanning }: { drafts: StagedDraft[]; onScan: () => void; scanning: boolean }) {
  const hasDrafts = drafts.some((d) => d.status === 'pending');

  return (
    <div className="flex flex-col items-center justify-center h-full text-center px-10 gap-6">
      <div className="relative">
        <div className="w-16 h-16 rounded-2xl bg-[var(--surface)] border border-[var(--border)] flex items-center justify-center">
          <Calendar size={28} className="text-[var(--text-faint)]" />
        </div>
        <div className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-[var(--accent-dim)] border border-[var(--accent-border)] flex items-center justify-center">
          <Sparkles size={9} className="text-[var(--accent)]" />
        </div>
      </div>
      <div>
        <h2 className="text-[16px] font-semibold text-[var(--text)] mb-2">
          {hasDrafts ? 'Select a brief to review' : 'No briefs yet'}
        </h2>
        <p className="text-[13px] text-[var(--text-faint)] leading-relaxed max-w-[260px]">
          {hasDrafts
            ? 'Choose a meeting from the list to see the full brief, sources, and actions.'
            : 'Scan your upcoming calendar to automatically prepare meeting briefs.'}
        </p>
      </div>
      {!hasDrafts && (
        <button
          onClick={onScan}
          disabled={scanning}
          className="flex items-center gap-2 rounded-xl border border-[var(--accent-border)] bg-[var(--accent-dim)] px-5 py-2.5 text-[13px] text-[var(--accent)] hover:brightness-125 disabled:opacity-50 transition-all cursor-pointer font-medium"
        >
          <RefreshCw size={13} className={scanning ? 'animate-spin' : ''} />
          {scanning ? 'Scanning your calendar…' : 'Scan for meetings'}
        </button>
      )}
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function HorizonView({ draftsState, onApproved, onDiscuss, agentName }: Props) {
  const { messages } = useChatContext();
  const [justApprovedIds, setJustApprovedIds] = useState<Set<string>>(new Set());
  const [selectedDraftId, setSelectedDraftId] = useState<string | null>(null);

  // Resizable column widths
  const [leftW, setLeftW] = useState(() => {
    const saved = localStorage.getItem(LEFT_WIDTH_KEY);
    return saved ? Math.max(MIN_SIDE, Math.min(MAX_SIDE, Number(saved))) : LEFT_DEFAULT;
  });
  const [rightW, setRightW] = useState(() => {
    const saved = localStorage.getItem(RIGHT_WIDTH_KEY);
    return saved ? Math.max(MIN_SIDE, Math.min(MAX_SIDE, Number(saved))) : RIGHT_DEFAULT;
  });

  useEffect(() => { localStorage.setItem(LEFT_WIDTH_KEY, String(leftW)); }, [leftW]);
  useEffect(() => { localStorage.setItem(RIGHT_WIDTH_KEY, String(rightW)); }, [rightW]);

  const handleLeftDrag = useCallback((delta: number) => {
    setLeftW((w) => Math.max(MIN_SIDE, Math.min(MAX_SIDE, w + delta)));
  }, []);
  const handleRightDrag = useCallback((delta: number) => {
    setRightW((w) => Math.max(MIN_SIDE, Math.min(MAX_SIDE, w - delta)));
  }, []);

  const { drafts, scanning, scan, approve, dismiss, toggleUseful, lastScan, scanProgress, error, loading } = draftsState;
  const pendingDrafts = drafts.filter((d) => d.status === 'pending');
  const allDrafts = drafts;

  useEffect(() => {
    if (!selectedDraftId && pendingDrafts.length > 0) {
      setSelectedDraftId(pendingDrafts[0].id);
    }
  }, [pendingDrafts.length, selectedDraftId]);

  const selectedDraft = allDrafts.find((d) => d.id === selectedDraftId) ?? null;

  const handleApprove = async (id: string) => {
    const result = await approve(id);
    if (result) {
      setJustApprovedIds((prev) => new Set([...prev, id]));
      setTimeout(() => onApproved(result), 200);
    }
  };

  const handleDismiss = async (id: string) => { await dismiss(id); };
  const handleToggleUseful = async (id: string, useful: boolean) => { await toggleUseful(id, useful); };

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left rail */}
      <div className="shrink-0 flex flex-col bg-[var(--bg)]" style={{ width: leftW }}>
        <div className="shrink-0 flex items-center justify-between px-3 pt-4 pb-2">
          <div>
            <p className="text-[9px] font-semibold tracking-[0.1em] uppercase text-[var(--text-faint)] font-mono">Briefs</p>
            {lastScan && !scanning && (
              <p className="text-[9px] text-[var(--text-faint)] mt-0.5 opacity-60">{lastScan.meetingsPrepped}/{lastScan.meetingsFound} ready</p>
            )}
          </div>
          <button
            onClick={scan}
            disabled={scanning}
            title="Re-scan calendar"
            className="w-6 h-6 rounded-md border border-[var(--border)] hover:border-[var(--border2)] flex items-center justify-center text-[var(--text-faint)] hover:text-[var(--text-dim)] disabled:opacity-40 transition-all cursor-pointer"
          >
            <RefreshCw size={10} className={scanning ? 'animate-spin' : ''} />
          </button>
        </div>

        {scanProgress && (
          <p className="px-3 pb-1 text-[9px] text-[var(--accent)] font-mono animate-pulse">{scanProgress}</p>
        )}

        {error && !scanning && (
          <div className="mx-3 mb-2 flex items-start gap-1.5 rounded-lg border border-[var(--red-border)] bg-[var(--red-dim)] p-2 text-[10px] text-[var(--red)]">
            <AlertTriangle size={9} className="shrink-0 mt-0.5" />
            <span className="line-clamp-2">{error}</span>
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-2 pb-3 space-y-0.5">
          {scanning && allDrafts.length === 0 ? (
            <div className="space-y-1 pt-1">
              {[1, 2, 3].map((i) => (
                <div key={i} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3 animate-pulse" style={{ animationDelay: `${i * 150}ms` }}>
                  <div className="h-2 w-3/4 rounded bg-[var(--surface2)] mb-1.5" />
                  <div className="h-1.5 w-1/2 rounded bg-[var(--surface2)]" />
                </div>
              ))}
            </div>
          ) : allDrafts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center gap-2 opacity-60">
              <Calendar size={16} className="text-[var(--text-faint)]" />
              <p className="text-[10px] text-[var(--text-faint)] leading-relaxed max-w-[150px]">Scan to find meetings that need prep.</p>
            </div>
          ) : (
            <AnimatePresence>
              {allDrafts.map((draft) => (
                <BriefListItem
                  key={draft.id}
                  draft={draft}
                  selected={selectedDraftId === draft.id}
                  onSelect={() => setSelectedDraftId(draft.id)}
                  justApproved={justApprovedIds.has(draft.id)}
                  isActive={selectedDraftId === draft.id}
                />
              ))}
            </AnimatePresence>
          )}
        </div>
      </div>

      <ResizeHandle onDrag={handleLeftDrag} />

      {/* Center */}
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden bg-[var(--bg-elevated)]">
        <AnimatePresence mode="wait">
          {selectedDraft ? (
            <motion.div key={selectedDraft.id} initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }} className="flex flex-col h-full overflow-hidden">
              <WorkspacePanel
                draft={selectedDraft}
                onApprove={handleApprove}
                onDismiss={handleDismiss}
                onDiscuss={onDiscuss}
                onToggleUseful={handleToggleUseful}
                justApproved={justApprovedIds.has(selectedDraft.id)}
              />
            </motion.div>
          ) : (
            <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }} className="h-full">
              <EmptyWorkspace drafts={allDrafts} onScan={scan} scanning={scanning} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <ResizeHandle onDrag={handleRightDrag} />

      {/* Right rail */}
      <div className="shrink-0 flex flex-col bg-[var(--bg)] overflow-hidden" style={{ width: rightW }}>
        <AgentPanel
          draftsState={draftsState}
          draft={selectedDraft}
          onApprove={handleApprove}
          onDiscuss={onDiscuss}
        />
      </div>
    </div>
  );
}
