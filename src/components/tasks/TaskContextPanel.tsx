/**
 * TaskContextPanel — collapses completely when no context is available.
 * Same card system as other detail cards. Standard card = rounded-[16px] px-5 py-4.
 */

import { ChevronDown, ChevronRight, Mail, User } from 'lucide-react';
import { useState } from 'react';
import type { TaskItem } from '../../services/api';
import { gmailThreadUrl } from '../../lib/google-account-links';

interface ContextRow {
  icon: React.ReactNode;
  label: string;
  value: string;
  href?: string;
}

function buildRows(task: TaskItem, accountEmail?: string | null): ContextRow[] {
  const rows: ContextRow[] = [];

  if (task.recipient) {
    rows.push({
      icon: <User size={12} aria-hidden />,
      label: 'Recipient',
      value: task.recipient,
    });
  }

  if (task.subject && task.threadId) {
    rows.push({
      icon: <Mail size={12} aria-hidden />,
      label: 'Source email',
      value: task.subject,
      href: gmailThreadUrl(task.threadId, accountEmail),
    });
  } else if (task.subject) {
    rows.push({
      icon: <Mail size={12} aria-hidden />,
      label: 'Source',
      value: task.subject,
    });
  }

  return rows;
}

export function TaskContextPanel({
  task,
  accountEmail,
}: {
  task: TaskItem;
  accountEmail?: string | null;
}) {
  const [open, setOpen] = useState(true);
  const rows = buildRows(task, accountEmail);

  // Return nothing — don't waste vertical space — when there's nothing to show
  if (rows.length === 0) return null;

  const Chevron = open ? ChevronDown : ChevronRight;

  return (
    <div className="rounded-[16px] border border-[var(--border)] bg-[var(--surface)]">

      {/* Header row — also the toggle */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-5 py-3.5 text-left cursor-pointer"
        aria-expanded={open}
        aria-label={open ? 'Collapse related context' : 'Expand related context'}
      >
        <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-faint)]">
          Related context
        </span>
        <Chevron size={13} className="text-[var(--text-faint)]" aria-hidden />
      </button>

      {open && (
        <div className="border-t border-[var(--border)]">
          {rows.map((row, i) => (
            <div
              key={i}
              className="flex items-start gap-3 px-5 py-3 border-b border-[var(--border)] last:border-b-0"
            >
              <span className="mt-0.5 text-[var(--text-faint)]">{row.icon}</span>
              <div className="min-w-0 flex-1">
                <div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--text-faint)]">
                  {row.label}
                </div>
                {row.href ? (
                  <a
                    href={row.href}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-0.5 block truncate text-[12px] text-[var(--blue)] underline-offset-2 hover:underline"
                  >
                    {row.value}
                  </a>
                ) : (
                  <div className="mt-0.5 truncate text-[12px] text-[var(--text-dim)]">
                    {row.value}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
