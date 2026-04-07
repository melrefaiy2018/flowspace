import { AlertTriangle, Mail, Calendar, FileText, Clock, ExternalLink, ListChecks, BarChart3, Sparkles, CheckCircle2 } from 'lucide-react';
import type { AttentionItem } from '../services/api';
import { useChatContext } from '../context/ChatContext';
import { AGENT_NAME } from '../lib/branding';
import { buildAttentionFeedbackTarget, type ImportanceFeedbackTarget } from '../lib/importance-feedback';
import { gmailThreadUrl } from '../lib/google-account-links';

interface Props {
  items: AttentionItem[];
  accountEmail?: string | null;
  onDraftReply: (threadId: string) => void;
  onCreateDoc: (eventId: string) => void;
  onIgnore: (target?: ImportanceFeedbackTarget) => void;
  onImportant: (target?: ImportanceFeedbackTarget) => void;
  onNotImportant: (target?: ImportanceFeedbackTarget) => void;
  isFeedbackPending: (target?: ImportanceFeedbackTarget) => boolean;
  getFeedbackError: (target?: ImportanceFeedbackTarget) => string | undefined;
  onOpenThread?: (threadId: string) => void;
  onAskAgent?: () => void;
  kanbanMode?: boolean;
}

const TYPE_ICONS: Record<string, typeof Mail> = {
  email_reply: Mail,
  meeting_prep: Calendar,
  drive_file: BarChart3,
  deadline: Clock,
  followup: ListChecks,
};

function getGoogleUrl(type: string, id: string, accountEmail?: string | null): string {
  switch (type) {
    case 'email_reply': return gmailThreadUrl(id, accountEmail);
    case 'meeting_prep': return `https://calendar.google.com/calendar/event?eid=${id}`;
    case 'drive_file': return `https://drive.google.com/file/d/${id}/view`;
    default: return '#';
  }
}

function priorityColor(priority: string) {
  if (priority === 'high') return {
    bg: 'var(--amber-dim)',
    border: 'var(--amber)',
    text: 'var(--amber)',
    tag: 'bg-[var(--amber-dim)] text-[var(--amber)] border border-[var(--amber-border)]',
  };
  return {
    bg: 'var(--blue-dim)',
    border: 'var(--blue)',
    text: 'var(--blue)',
    tag: 'bg-[var(--blue-dim)] text-[var(--blue)] border border-[var(--blue-border)]',
  };
}

export default function AttentionPanel({
  items,
  accountEmail,
  onDraftReply,
  onCreateDoc,
  onIgnore,
  onImportant,
  onNotImportant,
  isFeedbackPending,
  getFeedbackError,
  onOpenThread,
  onAskAgent,
  kanbanMode = false,
}: Props) {
  const { triggerAction } = useChatContext();

  const sorted = [...items].sort((a, b) => {
    if (a.priority !== b.priority) return a.priority === 'high' ? -1 : 1;
    return 0;
  });

  const handleAction = (item: AttentionItem) => {
    if (item.action_label === 'Draft reply' && item.action_context) {
      onDraftReply(item.action_context);
    } else if (item.action_label === 'Create notes doc' && item.action_context) {
      onCreateDoc(item.action_context);
    } else if (item.type === 'email_reply' && item.action_context && onOpenThread) {
      onOpenThread(item.action_context);
    } else {
      const url = getGoogleUrl(item.type, item.action_context, accountEmail);
      if (url !== '#') window.open(url, '_blank');
    }
  };

  const handleDelegate = (item: AttentionItem) => {
    const prompt = `Help me with this attention item: ${item.title}. ${item.description}`;
    triggerAction(prompt, true);
  };

  return (
    <div className={kanbanMode ? 'flex flex-col' : 'home-panel overflow-hidden'}>
      {!kanbanMode && (
        <div className="home-section-header" style={{ '--section-accent': 'var(--amber)' } as React.CSSProperties}>
          <div>
            <div className="home-section-kicker">Primary workspace</div>
            <h3 className="home-section-title">Needs Attention</h3>
          </div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-[11px] text-[var(--text-faint)]" aria-live="polite" aria-atomic="true">
              {sorted.length} item{sorted.length !== 1 ? 's' : ''}
            </span>
            {onAskAgent && (
              <button
                onClick={onAskAgent}
                className="flex h-7 w-7 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[var(--text-faint)] transition-all hover:border-[var(--accent-border)] hover:text-[var(--accent)] hover:bg-[var(--accent-glow)] cursor-pointer"
                title="Ask AI about attention items"
                aria-label="Ask AI about attention items"
              >
                <Sparkles size={13} />
              </button>
            )}
          </div>
        </div>
      )}

      <div className="p-4 flex flex-col gap-3">
        {sorted.length === 0 ? (
          <div className="py-10 text-center">
            <div className="relative inline-flex items-center justify-center mb-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--green-dim)] border border-[var(--green-border)]">
                <CheckCircle2 size={22} className="text-[var(--green)]" />
              </div>
            </div>
            <div className="text-[13px] font-semibold text-[var(--text-dim)]">All clear</div>
            <div className="text-[12px] mt-1 text-[var(--text-faint)]">Nothing urgent right now</div>
          </div>
        ) : (
          <>
            {sorted.map((item, i) => {
              const Icon = TYPE_ICONS[item.type] || FileText;
              const colors = priorityColor(item.priority);
              const isHigh = item.priority === 'high';
              const feedbackTarget = buildAttentionFeedbackTarget(item);
              const pending = isFeedbackPending(feedbackTarget);
              const feedbackError = getFeedbackError(feedbackTarget);

              return (
                <article
                  key={i}
                  aria-label={item.title}
                  className="group relative overflow-hidden rounded-[22px] border border-white/6 p-4 flex flex-col gap-[9px] transition-transform hover:-translate-y-px"
                  style={{ opacity: isHigh ? 1 : 0.75 }}
                >
                  <div
                    className="absolute inset-0 opacity-70"
                    style={{ background: isHigh ? `linear-gradient(180deg, ${colors.bg}, rgba(255,255,255,0.02))` : 'rgba(255,255,255,0.02)' }}
                  />

                  {/* Card header */}
                  <div className="relative flex items-start gap-[10px]">
                    <div
                      className="w-[34px] h-[34px] rounded-[12px] flex items-center justify-center shrink-0"
                      style={{ background: colors.bg }}
                    >
                      <Icon size={14} style={{ color: colors.text }} />
                    </div>
                    <div className="flex-1 text-[13px] font-semibold text-[var(--text)] leading-tight">
                      {item.title}
                    </div>
                    <span className={`font-mono text-[9px] uppercase tracking-[0.06em] px-[6px] py-[2px] rounded shrink-0 ${colors.tag}`}>
                      {item.priority}
                    </span>
                  </div>

                  {/* Description */}
                  <div className="relative text-[12px] text-[var(--text-dim)] leading-snug pl-[44px]">
                    {item.description}
                  </div>

                  {/* Actions */}
                  <div className="relative pl-[44px] flex flex-wrap items-center gap-2">
                    <button
                      onClick={() => handleAction(item)}
                      className="flex items-center gap-1 text-[11px] font-medium px-[10px] py-1.5 rounded-[6px] cursor-pointer hover:brightness-125 active:translate-y-px transition-all min-h-[32px]"
                      style={{
                        background: colors.bg,
                        border: `1px solid ${colors.border}`,
                        color: colors.text,
                      }}
                    >
                      {item.action_label}
                      {item.action_label !== 'Draft reply' && item.action_label !== 'Create notes doc' && (
                        <ExternalLink size={10} aria-hidden="true" />
                      )}
                    </button>
                    <button
                      onClick={() => handleDelegate(item)}
                      className="flex items-center gap-1 text-[11px] font-medium px-[10px] py-1.5 rounded-[6px] cursor-pointer bg-[var(--surface3)] border border-[var(--border2)] text-[var(--text-dim)] hover:text-[var(--text)] hover:border-[var(--text-faint)] transition-all min-h-[32px]"
                      aria-label={`Delegate "${item.title}" to ${AGENT_NAME}`}
                    >
                      <Sparkles size={10} aria-hidden="true" />
                      Delegate
                    </button>
                    <button
                      onClick={() => onIgnore(feedbackTarget)}
                      disabled={pending}
                      aria-label={`Ignore: ${item.title}`}
                      className="text-[11px] font-medium px-[10px] py-1.5 rounded-[6px] cursor-pointer bg-[var(--surface3)] border border-[var(--border2)] text-[var(--text-faint)] hover:text-[var(--text-dim)] transition-all disabled:opacity-50 min-h-[32px]"
                    >
                      Ignore
                    </button>
                    <button
                      onClick={() => onImportant(feedbackTarget)}
                      disabled={pending}
                      aria-label={`Mark important: ${item.title}`}
                      className="text-[11px] font-medium px-[10px] py-1.5 rounded-[6px] cursor-pointer bg-[var(--surface3)] border border-[var(--green-border)] text-[var(--green)] hover:brightness-110 transition-all disabled:opacity-50 min-h-[32px]"
                    >
                      Important
                    </button>
                    <button
                      onClick={() => onNotImportant(feedbackTarget)}
                      disabled={pending}
                      aria-label={`Mark not important: ${item.title}`}
                      className="text-[11px] font-medium px-[10px] py-1.5 rounded-[6px] cursor-pointer bg-[var(--surface3)] border border-[var(--border2)] text-[var(--text-faint)] hover:text-[var(--text)] transition-all disabled:opacity-50 min-h-[32px]"
                    >
                      Not important
                    </button>
                  </div>
                  {feedbackError && (
                    <div className="relative pl-[44px] text-[11px] text-[var(--red)]" role="alert">
                      {feedbackError}
                    </div>
                  )}
                </article>
              );
            })}

            <div className="py-2 text-center text-[11px] text-[var(--text-faint)] italic">
              Nothing else needs your attention today
            </div>
          </>
        )}
      </div>
    </div>
  );
}
