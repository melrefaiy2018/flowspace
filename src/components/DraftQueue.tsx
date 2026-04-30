import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Calendar, Check, X, ThumbsUp, RefreshCw, AlertTriangle, Mail, FileText, ChevronDown, ChevronUp, MessageSquare, Shield } from 'lucide-react';
import type { StagedDraft, ScanMeta } from '../agent/draft-types';
import type { UseDraftsReturn, ApproveResult } from '../hooks/useDrafts';
import { safeMarkdown } from './ChatThread';
import MeetingPrepMetaBar from './MeetingPrepMetaBar';

// ── Helpers ────────────────────────────────────────────────────────────────

function formatMeetingTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = d.getTime() - now.getTime();
  const diffDays = Math.floor(diffMs / 86400000);

  const timeStr = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

  if (diffDays === 0) return `Today ${timeStr}`;
  if (diffDays === 1) return `Tomorrow ${timeStr}`;
  return `${d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} ${timeStr}`;
}

// ── Draft Card ─────────────────────────────────────────────────────────────

interface DraftCardProps {
  draft: StagedDraft;
  onApprove: (id: string) => void;
  onDismiss: (id: string) => void;
  onToggleUseful: (id: string, useful: boolean) => void;
  onDiscuss: (draft: StagedDraft) => void;
  justApproved: boolean;
}

function DraftCard({ draft, onApprove, onDismiss, onToggleUseful, onDiscuss, justApproved }: DraftCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(false);

  // Strip markdown for plain-text preview (first 2 lines, max 120 chars)
  const plainPreview = draft.summary
    .replace(/#{1,6}\s+/g, '')       // headings
    .replace(/\*\*([^*]+)\*\*/g, '$1') // bold
    .replace(/\*([^*]+)\*/g, '$1')   // italic
    .replace(/`[^`]+`/g, '')          // inline code
    .trim()
    .split('\n')
    .filter(Boolean)
    .slice(0, 2)
    .join(' ')
    .slice(0, 120);
  const previewText = plainPreview.length < draft.summary.replace(/\s+/g, ' ').trim().length
    ? plainPreview + '…'
    : plainPreview;

  const isDone = draft.status === 'approved' || draft.status === 'dismissed';

  return (
    <motion.article
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97 }}
      transition={{ duration: 0.2 }}
      role="article"
      aria-label={`Meeting prep: ${draft.meetingTitle} at ${formatMeetingTime(draft.meetingTime)}`}
      className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow-card)] p-3"
    >
      {/* Time */}
      <p className="text-[12px] text-[var(--text-faint)] flex items-center gap-1 mb-1">
        <Calendar size={11} />
        {formatMeetingTime(draft.meetingTime)}
      </p>

      {/* Title */}
      <h3 className="text-[15px] font-semibold text-[var(--text)] leading-snug">{draft.meetingTitle}</h3>

      {/* Attendees */}
      <p className="text-[12px] text-[var(--text-faint)] mt-0.5 truncate">
        {draft.attendees.slice(0, 3).join(', ')}
        {draft.attendees.length > 3 && ` +${draft.attendees.length - 3} more`}
      </p>

      {/* Brief preview */}
      <div className="mt-2">
        {expanded ? (
          <div
            className="text-[13px] text-[var(--text-dim)] leading-relaxed prose-sm max-h-64 overflow-y-auto pr-1 [&_h1]:text-[13px] [&_h2]:text-[13px] [&_h3]:text-[13px] [&_h1]:font-semibold [&_h2]:font-semibold [&_h3]:font-semibold [&_h1]:text-[var(--text)] [&_h2]:text-[var(--text)] [&_h3]:text-[var(--text)] [&_ul]:pl-3 [&_li]:mb-0.5 [&_strong]:text-[var(--text)] [&_p]:mb-1"
            dangerouslySetInnerHTML={{ __html: safeMarkdown(draft.summary) }}
          />
        ) : (
          <p className="text-[13px] text-[var(--text-dim)] leading-relaxed line-clamp-2">
            {previewText}
          </p>
        )}
        <button
          className="text-[12px] text-[var(--accent)] mt-1 hover:underline"
          onClick={() => setExpanded((v) => !v)}
          onKeyDown={(e) => e.key === 'Enter' && setExpanded((v) => !v)}
          aria-expanded={expanded}
        >
          {expanded ? 'Show less' : 'Read brief'}
        </button>
      </div>

      {/* Sources */}
      {(draft.relatedEmails.length > 0 || draft.linkedDocs.length > 0) && (
        <div className="mt-2 rounded-[var(--radius-sm)] border border-[var(--border)] overflow-hidden">
          <button
            onClick={() => setSourcesOpen((v) => !v)}
            className="w-full flex items-center justify-between px-2.5 py-1.5 text-[11px] text-[var(--text-faint)] hover:bg-[var(--surface2)] transition-colors"
            aria-expanded={sourcesOpen}
          >
            <span className="flex items-center gap-2">
              {draft.relatedEmails.length > 0 && (
                <span className="flex items-center gap-1"><Mail size={10} /> {draft.relatedEmails.length} email{draft.relatedEmails.length !== 1 ? 's' : ''}</span>
              )}
              {draft.linkedDocs.length > 0 && (
                <span className="flex items-center gap-1"><FileText size={10} /> {draft.linkedDocs.length} doc{draft.linkedDocs.length !== 1 ? 's' : ''}</span>
              )}
              <span className="text-[var(--text-faint)] opacity-60">— sources used</span>
            </span>
            {sourcesOpen ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
          </button>

          {sourcesOpen && (
            <div className="border-t border-[var(--border)] divide-y divide-[var(--border)]">
              {draft.relatedEmails.map((email, i) => (
                <div key={i} className="flex items-start gap-2 px-2.5 py-1.5">
                  <Mail size={10} className="text-[var(--text-faint)] mt-0.5 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-[11px] text-[var(--text)] truncate font-medium">{email.subject}</p>
                    <p className="text-[11px] text-[var(--text-faint)] truncate">{email.from}</p>
                    {email.snippet && (
                      <p className="text-[11px] text-[var(--text-faint)] opacity-70 mt-0.5 line-clamp-2">{email.snippet}</p>
                    )}
                  </div>
                </div>
              ))}
              {draft.linkedDocs.map((doc, i) => (
                <div key={i} className="flex items-start gap-2 px-2.5 py-1.5">
                  <FileText size={10} className="text-[var(--text-faint)] mt-0.5 shrink-0" />
                  <div className="min-w-0">
                    {doc.url ? (
                      <a
                        href={doc.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[11px] text-[var(--accent)] truncate block hover:underline"
                      >
                        {doc.title}
                      </a>
                    ) : (
                      <p className="text-[11px] text-[var(--text)] truncate">{doc.title}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Action row */}
      {!isDone && (
        <div className="flex items-center gap-2 mt-3">
          {justApproved ? (
            <motion.span
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="flex items-center gap-1 text-[12px] text-[var(--green)] font-medium"
            >
              <Check size={13} /> Approved
            </motion.span>
          ) : (
            <button
              onClick={() => onApprove(draft.id)}
              aria-label="Approve and open in chat"
              className="flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--green-border)] bg-[var(--green-dim)] px-2.5 py-1 text-[12px] text-[var(--green)] hover:brightness-110 transition-all"
            >
              <Check size={12} /> Approve
            </button>
          )}
          <button
            onClick={() => onDiscuss(draft)}
            aria-label="Open this draft in chat"
            className="flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface2)] px-2.5 py-1 text-[12px] text-[var(--text-dim)] hover:text-[var(--text)] hover:border-[var(--accent)] transition-all"
          >
            <MessageSquare size={12} /> Open in chat
          </button>
          <button
            onClick={() => onDismiss(draft.id)}
            aria-label="Dismiss this draft"
            className="flex items-center gap-1 text-[12px] text-[var(--text-faint)] hover:text-[var(--text-dim)] transition-colors"
          >
            <X size={12} /> Dismiss
          </button>
          <button
            onClick={() => onToggleUseful(draft.id, !draft.useful)}
            aria-label="Mark as useful"
            role="switch"
            aria-checked={draft.useful ?? false}
            className={`ml-auto transition-colors ${
              draft.useful
                ? 'text-[var(--accent)]'
                : 'text-[var(--text-faint)] hover:text-[var(--text-dim)]'
            }`}
          >
            <ThumbsUp size={13} />
          </button>
        </div>
      )}

      {isDone && (
        <p className="text-[12px] text-[var(--text-faint)] mt-2 italic">
          {draft.status === 'approved' ? 'Approved — opened in chat.' : 'Dismissed.'}
        </p>
      )}
    </motion.article>
  );
}

// ── Strip card (compact, for the top strip) ────────────────────────────────

interface DraftStripCardProps {
  draft: StagedDraft;
  onApprove: (id: string) => void;
  onDismiss: (id: string) => void;
  onDiscuss: (draft: StagedDraft) => void;
  justApproved: boolean;
}

function DraftStripCard({ draft, onApprove, onDismiss, onDiscuss, justApproved }: DraftStripCardProps) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: 8 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -8 }}
      transition={{ duration: 0.15 }}
      className="shrink-0 flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-[12px] max-w-[380px]"
    >
      <Calendar size={11} className="shrink-0 text-[var(--text-faint)]" />
      <span className="font-medium text-[var(--text)] truncate max-w-[140px]">{draft.meetingTitle}</span>
      <span className="text-[var(--text-faint)] shrink-0">{formatMeetingTime(draft.meetingTime)}</span>
      <span className="w-px h-3 bg-[var(--border)] shrink-0" />
      {justApproved ? (
        <motion.span
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="flex items-center gap-1 text-[11px] text-[var(--green)] font-medium shrink-0"
        >
          <Check size={10} /> Approved
        </motion.span>
      ) : (
        <>
          <button
            onClick={() => onApprove(draft.id)}
            className="shrink-0 flex items-center gap-1 rounded-full border border-[var(--green-border)] bg-[var(--green-dim)] px-2 py-0.5 text-[11px] text-[var(--green)] hover:brightness-110 transition-all cursor-pointer"
          >
            <Check size={10} /> Approve
          </button>
          <button
            onClick={() => onDiscuss(draft)}
            className="shrink-0 flex items-center gap-1 rounded-full border border-[var(--border)] bg-[var(--surface2)] px-2 py-0.5 text-[11px] text-[var(--text-dim)] hover:border-[var(--accent)] transition-all cursor-pointer"
          >
            <MessageSquare size={10} /> Open in chat
          </button>
          <button
            onClick={() => onDismiss(draft.id)}
            aria-label="Dismiss"
            className="shrink-0 text-[var(--text-faint)] hover:text-[var(--text-dim)] transition-colors cursor-pointer"
          >
            <X size={11} />
          </button>
        </>
      )}
    </motion.div>
  );
}

// ── Agent Drafts Strip (horizontal, above kanban) ──────────────────────────

interface AgentDraftsStripProps {
  state: UseDraftsReturn;
  onApproved: (result: ApproveResult) => void;
  onDiscuss: (draft: StagedDraft) => void;
}

export function AgentDraftsStrip({ state, onApproved, onDiscuss }: AgentDraftsStripProps) {
  const { drafts, scanning, scan } = state;
  const [justApprovedIds, setJustApprovedIds] = useState<Set<string>>(new Set());
  const pendingDrafts = drafts.filter((d) => d.status === 'pending');

  // Only render when there's something to show
  if (!scanning && pendingDrafts.length === 0) return null;

  const handleApprove = async (id: string) => {
    const result = await state.approve(id);
    if (result) {
      setJustApprovedIds((prev) => new Set([...prev, id]));
      setTimeout(() => onApproved(result), 200);
    }
  };

  const handleDismiss = async (id: string) => {
    await state.dismiss(id);
  };

  return (
    <div className="shrink-0 border-b border-[var(--border)] bg-[var(--bg-elevated)]/60 px-4 py-2 flex items-center gap-3 overflow-x-auto">
      <span className="text-[10px] font-semibold tracking-widest uppercase text-[var(--text-faint)] font-mono shrink-0">
        Meeting Prep
      </span>
      <AnimatePresence mode="popLayout">
        {scanning ? (
          <>
            {[1, 2].map((i) => (
              <div key={i} className="shrink-0 h-7 w-48 rounded-full border border-[var(--border)] bg-[var(--surface)] animate-pulse" />
            ))}
          </>
        ) : (
          pendingDrafts.map((draft) => (
            <DraftStripCard
              key={draft.id}
              draft={draft}
              onApprove={handleApprove}
              onDismiss={handleDismiss}
              onDiscuss={onDiscuss}
              justApproved={justApprovedIds.has(draft.id)}
            />
          ))
        )}
      </AnimatePresence>
      <button
        onClick={scan}
        disabled={scanning}
        aria-label="Re-scan"
        className="ml-auto shrink-0 flex items-center gap-1 rounded-full border border-[var(--border)] bg-[var(--surface2)] px-2.5 py-1 text-[11px] text-[var(--text-faint)] hover:text-[var(--text-dim)] hover:border-[var(--accent)] disabled:opacity-50 transition-all cursor-pointer"
      >
        <RefreshCw size={10} className={scanning ? 'animate-spin' : ''} />
        {scanning ? 'Scanning…' : 'Re-scan'}
      </button>
    </div>
  );
}

// ── Skeleton card ──────────────────────────────────────────────────────────

function SkeletonCard() {
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-3 animate-pulse">
      <div className="h-3 w-24 rounded bg-[var(--surface2)] mb-2" />
      <div className="h-4 w-3/4 rounded bg-[var(--surface2)] mb-1" />
      <div className="h-3 w-1/2 rounded bg-[var(--surface2)] mb-3" />
      <div className="h-3 w-full rounded bg-[var(--surface2)] mb-1" />
      <div className="h-3 w-5/6 rounded bg-[var(--surface2)]" />
    </div>
  );
}

// ── Panel header ───────────────────────────────────────────────────────────

interface MeetingPrepHeaderProps {
  scanning: boolean;
  scanProgress: string | null;
  onScan: () => void;
  hasPreviousScan: boolean;
  lastScan: ScanMeta | null;
}

function MeetingPrepHeader({ scanning, scanProgress, onScan, hasPreviousScan, lastScan }: MeetingPrepHeaderProps) {
  return (
    <div className="mb-4">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <div className="flex items-center gap-2 mb-0.5">
            <h2 className="text-[17px] font-semibold text-[var(--text)] tracking-[-0.02em]">Meeting Prep</h2>
            <span className="text-[9px] font-mono uppercase tracking-[0.08em] text-[var(--text-faint)] opacity-50 mt-0.5">
              next 48h
            </span>
          </div>
          <p className="text-[12px] text-[var(--text-faint)]">
            Prep briefs drawn from your calendar, inbox, and linked docs
          </p>
        </div>
        <button
          onClick={onScan}
          disabled={scanning}
          aria-busy={scanning}
          aria-label="Scan next 48 hours"
          className="shrink-0 inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--accent-border)] bg-[var(--accent-dim)] px-3 py-1.5 text-[13px] font-medium text-[var(--accent)] hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
        >
          <RefreshCw size={12} className={scanning ? 'animate-spin' : ''} />
          {scanning ? 'Scanning…' : hasPreviousScan ? 'Re-scan' : 'Scan 48h'}
        </button>
      </div>
      <MeetingPrepMetaBar lastScan={lastScan} scanning={scanning} scanProgress={scanProgress} />
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

export interface DraftQueueProps {
  state: UseDraftsReturn;
  onApproved: (result: ApproveResult) => void;
  onDiscuss: (draft: StagedDraft) => void;
}

export default function DraftQueue({ state, onApproved, onDiscuss }: DraftQueueProps) {
  const { drafts, lastScan, loading, scanning, scanProgress, error, scan, approve, dismiss, toggleUseful } = state;
  const [justApprovedIds, setJustApprovedIds] = useState<Set<string>>(new Set());

  const pendingDrafts = drafts.filter((d) => d.status === 'pending');
  const allActioned = drafts.length > 0 && pendingDrafts.length === 0;

  const handleApprove = async (id: string) => {
    const result = await approve(id);
    if (result) {
      setJustApprovedIds((prev) => new Set([...prev, id]));
      // Brief animation delay then trigger chat
      setTimeout(() => {
        onApproved(result);
      }, 200);
    }
  };

  const handleDismiss = async (id: string) => {
    await dismiss(id);
  };

  const handleToggleUseful = async (id: string, useful: boolean) => {
    await toggleUseful(id, useful);
  };

  // ── State: FIRST_RUN (no scan yet, no drafts) ──────────────────────
  if (!loading && !scanning && drafts.length === 0 && !lastScan && !error) {
    return (
      <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--home-panel-bg,var(--surface))] p-5">
        <MeetingPrepHeader scanning={false} scanProgress={null} onScan={scan} hasPreviousScan={false} lastScan={null} />
        <div className="py-3 px-1">
          <p className="text-[15px] font-semibold text-[var(--text)] leading-snug tracking-[-0.01em]">
            Ready to scan your next 48 hours.
          </p>
          <p className="text-[13px] text-[var(--text-dim)] mt-2 leading-relaxed max-w-md">
            FlowSpace will identify upcoming meetings, cross-reference relevant emails and documents, and generate a focused prep brief for each. Nothing opens in chat until you approve.
          </p>
          <div className="flex items-center gap-1.5 mt-3 text-[11px] font-mono text-[var(--text-faint)]">
            <Shield size={10} />
            <span>Calendar read-only · Approval required before any action</span>
          </div>
        </div>
      </div>
    );
  }

  // ── State: ERROR ───────────────────────────────────────────────────
  if (error && !scanning) {
    return (
      <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--home-panel-bg,var(--surface))] p-5">
        <MeetingPrepHeader scanning={false} scanProgress={null} onScan={scan} hasPreviousScan={!!lastScan} lastScan={lastScan} />
        <div className="flex items-start gap-2 rounded-[var(--radius-sm)] border border-[var(--red-border)] bg-[var(--red-dim)] p-3 text-[13px] text-[var(--red)]">
          <AlertTriangle size={14} className="shrink-0 mt-0.5" />
          <span>Scan failed: {error} · Re-scan to retry</span>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--home-panel-bg,var(--surface))] p-4">
      <MeetingPrepHeader scanning={scanning} scanProgress={scanProgress} onScan={scan} hasPreviousScan={!!lastScan} lastScan={lastScan} />

      {/* Partial failure banner */}
      {lastScan && lastScan.errors.length > 0 && !scanning && (
        <div className="flex items-start gap-2 rounded-[var(--radius-sm)] border border-[var(--amber-border)] bg-[var(--amber-dim)] p-2.5 text-[12px] text-[var(--amber)] mb-3">
          <AlertTriangle size={12} className="shrink-0 mt-0.5" />
          <span>{lastScan.errors.length} meeting{lastScan.errors.length !== 1 ? 's' : ''} couldn't be prepped — check calendar permissions or Re-scan to retry.</span>
        </div>
      )}

      {/* State: SCANNING */}
      {scanning && (
        <div className="flex flex-col gap-2" aria-live="polite">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      )}

      {/* State: POPULATED or ALL_ACTIONED or EMPTY */}
      {!scanning && (
        <AnimatePresence mode="popLayout">
          {pendingDrafts.length > 0 ? (
            <>
              <p className="text-[10px] font-mono text-[var(--text-faint)] mb-2 opacity-70">
                {pendingDrafts.length} brief{pendingDrafts.length !== 1 ? 's' : ''} ready · Approve to open in chat
              </p>
              {pendingDrafts.map((draft) => (
                <DraftCard
                  key={draft.id}
                  draft={draft}
                  onApprove={handleApprove}
                  onDismiss={handleDismiss}
                  onToggleUseful={handleToggleUseful}
                  onDiscuss={onDiscuss}
                  justApproved={justApprovedIds.has(draft.id)}
                />
              ))}
            </>
          ) : allActioned ? (
            // State: ALL_ACTIONED
            <motion.div
              key="all-actioned"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex items-center gap-2 py-4 px-1"
            >
              <Check size={14} className="text-[var(--green)] shrink-0" />
              <p className="text-[13px] text-[var(--text-dim)]">All {drafts.length} brief{drafts.length !== 1 ? 's' : ''} reviewed.</p>
            </motion.div>
          ) : (
            // State: EMPTY (scan ran but no qualifying meetings)
            <motion.div
              key="empty"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              className="py-4 px-1"
            >
              <p className="text-[15px] font-semibold text-[var(--text)] tracking-[-0.01em]">No meetings need prep in the next 48h.</p>
              <p className="text-[13px] text-[var(--text-dim)] mt-1.5">
                {lastScan && lastScan.meetingsFound === 0
                  ? 'No meetings found in your calendar for this window.'
                  : lastScan
                    ? `${lastScan.meetingsFound} meeting${lastScan.meetingsFound !== 1 ? 's' : ''} found — none required prep.`
                    : 'Scan your calendar to check for upcoming meetings.'
                }
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      )}
    </div>
  );
}
