/**
 * ContextTab — brief summary, thread metadata, and attachments.
 */
import type { WorkItem } from '../../../../lib/work-item.js';
import type { GmailThreadDetail } from '../../../../services/api.js';

interface Props {
  item: WorkItem;
  threadDetail: GmailThreadDetail | null;
}

export default function ContextTab({ item, threadDetail }: Props) {
  // Collect all attachments across messages
  const allAttachments = threadDetail
    ? threadDetail.messages.flatMap((m) => m.attachments ?? [])
    : [];

  // Collect unique participants from message from/to/cc fields
  const participantSet = new Set<string>();
  if (threadDetail) {
    for (const msg of threadDetail.messages) {
      if (msg.from) participantSet.add(msg.from);
      if (msg.to) {
        msg.to.split(',').forEach((p) => participantSet.add(p.trim()));
      }
      if (msg.cc) {
        msg.cc.split(',').forEach((p) => { if (p.trim()) participantSet.add(p.trim()); });
      }
    }
  }

  const messageCount = threadDetail?.messages.length ?? 0;
  const firstDate = threadDetail?.messages[0]?.date;
  const labels = threadDetail?.labelIds ?? [];

  return (
    <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
      {/* Summary card */}
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-[10px] p-4">
        <h3 className="text-[11px] font-semibold text-[var(--text-faint)] uppercase tracking-wider mb-2">
          Summary
        </h3>
        {item.enrichment?.whyItMatters ? (
          <p className="text-[13px] text-[var(--text-dim)] leading-relaxed">
            {item.enrichment.whyItMatters}
          </p>
        ) : (
          <p className="text-[13px] text-[var(--text-faint)] italic">
            No summary yet — enrichment in progress.
          </p>
        )}
      </div>

      {/* Thread metadata card */}
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-[10px] p-4">
        <h3 className="text-[11px] font-semibold text-[var(--text-faint)] uppercase tracking-wider mb-2">
          Thread
        </h3>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5">
          <dt className="text-[11px] text-[var(--text-faint)]">Messages</dt>
          <dd className="text-[11px] text-[var(--text-dim)]">{messageCount} message{messageCount !== 1 ? 's' : ''}</dd>

          <dt className="text-[11px] text-[var(--text-faint)]">Participants</dt>
          <dd className="text-[11px] text-[var(--text-dim)]">{participantSet.size}</dd>

          {firstDate && (
            <>
              <dt className="text-[11px] text-[var(--text-faint)]">Started</dt>
              <dd className="text-[11px] text-[var(--text-dim)]">
                {new Date(firstDate).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}
              </dd>
            </>
          )}

          {labels.length > 0 && (
            <>
              <dt className="text-[11px] text-[var(--text-faint)]">Labels</dt>
              <dd className="text-[11px] text-[var(--text-dim)] truncate">{labels.join(', ')}</dd>
            </>
          )}
        </dl>
      </div>

      {/* Attachments card — only shown when attachments exist */}
      {allAttachments.length > 0 && (
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-[10px] p-4">
          <h3 className="text-[11px] font-semibold text-[var(--text-faint)] uppercase tracking-wider mb-2">
            Attachments
          </h3>
          <ul className="flex flex-col gap-1.5">
            {allAttachments.map((att) => (
              <li
                key={att.attachmentId}
                className="flex items-center gap-2 text-[12px] text-[var(--text-dim)]"
              >
                <span className="truncate">{att.filename}</span>
                <span className="text-[10px] text-[var(--text-faint)] shrink-0">
                  {att.size < 1024 ? `${att.size} B` : att.size < 1024 * 1024 ? `${Math.round(att.size / 1024)} KB` : `${(att.size / (1024 * 1024)).toFixed(1)} MB`}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
