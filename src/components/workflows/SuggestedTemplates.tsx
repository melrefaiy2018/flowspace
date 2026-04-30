interface Template {
  id: string;
  label: string;
  description: string;
}

export const SUGGESTED_TEMPLATES: Template[] = [
  {
    id: 'meeting-prep',
    label: 'Prep me for my next meeting',
    description: 'Look up attendees, find related docs, and summarize what I need to know before each calendar event.',
  },
  {
    id: 'weekly-digest',
    label: 'Weekly digest of what I shipped',
    description: 'Every Friday, summarize what I worked on based on my calendar, recent docs, and sent emails, then draft a note to my manager.',
  },
  {
    id: 'inbox-triage',
    label: 'Triage my inbox every morning',
    description: 'Each morning, sort my unread emails into buckets: needs reply, needs input, FYI, and can ignore.',
  },
  {
    id: 'email-to-task',
    label: 'Turn action emails into tasks',
    description: 'When I flag an email as action needed, create a task in Google Tasks with a due date pulled from the email body.',
  },
  {
    id: 'followup',
    label: 'Follow up on unanswered emails',
    description: 'Find emails I sent more than 3 days ago that never got a reply, and draft polite follow-ups.',
  },
  {
    id: 'save-email',
    label: 'Save important emails to Drive',
    description: 'When I star an email, save a formatted copy to a Google Doc in my Drive for reference.',
  },
];

interface Props {
  onSelect: (description: string) => void;
  compact?: boolean;
}

export default function SuggestedTemplates({ onSelect, compact = false }: Props) {
  if (compact) {
    return (
      <div className="flex flex-wrap gap-2">
        {SUGGESTED_TEMPLATES.map((t) => (
          <button
            key={t.id}
            onClick={() => onSelect(t.description)}
            className="rounded-full border border-[var(--border)] px-3 py-1.5 text-[12px] text-[var(--text-dim)] transition hover:border-[var(--accent)]/50 hover:bg-[var(--accent)]/8 hover:text-white"
          >
            {t.label}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {SUGGESTED_TEMPLATES.map((t) => (
        <button
          key={t.id}
          onClick={() => onSelect(t.description)}
          className="group text-left rounded-[18px] border border-white/6 bg-white/[0.03] p-4 transition-all hover:border-white/12 hover:bg-white/[0.05]"
        >
          <div className="flex items-start justify-between gap-2">
            <p className="text-[13px] font-medium text-[var(--text-dim)] group-hover:text-white transition-colors leading-snug">{t.label}</p>
            <span className="text-[18px] text-[var(--text-faint)] group-hover:text-[var(--accent)] transition-colors shrink-0">+</span>
          </div>
          <p className="mt-1 text-[11px] text-[var(--text-faint)] leading-relaxed line-clamp-2">{t.description}</p>
        </button>
      ))}
    </div>
  );
}
