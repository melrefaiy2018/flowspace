/**
 * TaskSummaryCard — carries the primary content of the workspace.
 * Parses notes into three labeled rows: Objective, Risk, Next step.
 * Each row is label (10px uppercase) + value (13px), stacked vertically.
 * No long paragraphs. Readable in under 3 seconds.
 */

import { ExternalLink } from 'lucide-react';
import type { TaskItem } from '../../services/api';

interface ParsedContent {
  objective: string;
  risk: string | null;
  nextStep: string | null;
}

type RichSegment =
  | { type: 'text'; value: string }
  | { type: 'link'; href: string; label: string; trailing: string };

const urlPattern = /https?:\/\/[^\s]+/g;
const trailingPunctuationPattern = /[),.;!?]+$/;

function linkLabel(href: string): string {
  try {
    const url = new URL(href);
    const pathname = url.pathname.replace(/\/$/, '');
    return `${url.hostname}${pathname ? pathname : ''}`;
  } catch {
    return href;
  }
}

function splitRichText(value: string): RichSegment[] {
  const segments: RichSegment[] = [];
  let cursor = 0;

  for (const match of value.matchAll(urlPattern)) {
    const raw = match[0];
    const index = match.index ?? 0;
    const trailing = raw.match(trailingPunctuationPattern)?.[0] ?? '';
    const href = trailing ? raw.slice(0, -trailing.length) : raw;

    if (index > cursor) {
      segments.push({ type: 'text', value: value.slice(cursor, index) });
    }

    segments.push({ type: 'link', href, label: linkLabel(href), trailing });
    cursor = index + raw.length;
  }

  if (cursor < value.length) {
    segments.push({ type: 'text', value: value.slice(cursor) });
  }

  return segments.length > 0 ? segments : [{ type: 'text', value }];
}

function parseContent(task: TaskItem): ParsedContent {
  const notes = task.notes?.trim() ?? '';
  const title = task.title.trim();

  if (!notes) {
    return { objective: title, risk: null, nextStep: null };
  }

  const lines = notes.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const riskRx = /^(risk|danger|warning|consequence|impact)[:.]?\s*/i;
  const nextRx = /^(next step|action|todo|to-do|do|step)[:.]?\s*/i;

  const riskLine = lines.find((l) => riskRx.test(l));
  const nextLine = lines.find((l) => nextRx.test(l));

  // First line becomes objective unless it exactly matches the title
  const objective = lines[0] !== title ? lines[0] : title;

  const risk = riskLine ? riskLine.replace(riskRx, '') : null;

  // Next step: explicit label wins; else second distinct line
  const nextStep = nextLine
    ? nextLine.replace(nextRx, '')
    : lines.length > 1 && lines[1] !== objective
      ? lines[1]
      : null;

  return { objective, risk, nextStep };
}

// ─── row sub-component ───────────────────────────────────────────────────────

function Row({
  label,
  value,
  valueClass = 'text-[var(--text-dim)]',
}: {
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div className="space-y-1">
      <div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--text-faint)]">
        {label}
      </div>
      <div className={`space-y-2 text-[13px] leading-snug ${valueClass}`}>
        <RichValue value={value} />
      </div>
    </div>
  );
}

function RichValue({ value }: { value: string }) {
  const segments = splitRichText(value);
  return (
    <>
      <p>
        {segments.map((segment, index) => {
          if (segment.type === 'text') return <span key={index}>{segment.value}</span>;
          return (
            <span key={index} className="inline-flex items-center align-baseline">
              <a
                href={segment.href}
                target="_blank"
                rel="noreferrer"
                className="mx-1 inline-flex max-w-[420px] items-center gap-1 rounded-[8px] border border-[var(--blue-border)] bg-[var(--blue-dim)]/40 px-2 py-1 text-[12px] font-medium text-[var(--blue)] transition-colors hover:border-[var(--blue)]/60 hover:bg-[var(--blue-dim)]"
                title={segment.href}
              >
                <ExternalLink size={12} aria-hidden />
                <span className="truncate">{segment.label}</span>
              </a>
              {segment.trailing}
            </span>
          );
        })}
      </p>
    </>
  );
}

// ─── component ───────────────────────────────────────────────────────────────

export function TaskSummaryCard({ task }: { task: TaskItem }) {
  const { objective, risk, nextStep } = parseContent(task);
  const hasExtra = Boolean(risk ?? nextStep);

  return (
    <div className="rounded-[16px] border border-[var(--border)] bg-[var(--surface)] px-5 py-4 space-y-3">
      {/* Objective — always present, highest contrast */}
      <Row
        label="Objective"
        value={objective}
        valueClass="text-[var(--text)] font-medium"
      />

      {hasExtra && <div className="h-px bg-[var(--border)]" />}

      {risk && <Row label="Risk" value={risk} />}
      {nextStep && <Row label="Next step" value={nextStep} />}
    </div>
  );
}
