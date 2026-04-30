import type { ScanMeta } from '../agent/draft-types';

interface MeetingPrepMetaBarProps {
  lastScan: ScanMeta | null;
  scanning: boolean;
  scanProgress: string | null;
}

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 2) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

interface MetaItemProps {
  label: string;
  value: string;
  accent?: string;
}

function MetaItem({ label, value, accent }: MetaItemProps) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[9px] font-mono uppercase tracking-[0.07em] text-[var(--text-faint)] opacity-60">{label}</span>
      <span
        className="text-[13px] font-semibold tabular-nums"
        style={{ color: accent ?? 'var(--text-dim)' }}
      >
        {value}
      </span>
    </div>
  );
}

export default function MeetingPrepMetaBar({ lastScan, scanning, scanProgress }: MeetingPrepMetaBarProps) {
  if (scanning) {
    return (
      <div className="flex items-center gap-2 rounded-[var(--radius-sm)] bg-[var(--surface2)] border border-[var(--border)] px-3 py-2">
        <span className="text-[11px] font-mono text-[var(--text-faint)] animate-pulse">
          {scanProgress ?? 'Checking your calendar…'}
        </span>
      </div>
    );
  }

  if (!lastScan) {
    return (
      <div className="flex items-stretch gap-px rounded-[var(--radius-sm)] overflow-hidden border border-[var(--border)] bg-[var(--border)]">
        {[
          { label: 'Last scan', value: 'Never' },
          { label: 'Window', value: 'Next 48h' },
          { label: 'Meetings', value: '—' },
          { label: 'Ready', value: '—' },
        ].map(({ label, value }) => (
          <div key={label} className="flex-1 bg-[var(--surface2)] px-3 py-2">
            <MetaItem label={label} value={value} />
          </div>
        ))}
      </div>
    );
  }

  const { scannedAt, meetingsFound, meetingsPrepped, errors } = lastScan;
  const hasErrors = errors.length > 0;

  return (
    <div className="flex items-stretch gap-px rounded-[var(--radius-sm)] overflow-hidden border border-[var(--border)] bg-[var(--border)]">
      <div className="flex-1 bg-[var(--surface2)] px-3 py-2">
        <MetaItem label="Last scan" value={relativeTime(scannedAt)} />
      </div>
      <div className="flex-1 bg-[var(--surface2)] px-3 py-2">
        <MetaItem label="Window" value="Next 48h" />
      </div>
      <div className="flex-1 bg-[var(--surface2)] px-3 py-2">
        <MetaItem label="Meetings" value={String(meetingsFound)} />
      </div>
      <div className="flex-1 bg-[var(--surface2)] px-3 py-2">
        <MetaItem
          label="Ready"
          value={hasErrors ? `${meetingsPrepped} (${errors.length} failed)` : String(meetingsPrepped)}
          accent={hasErrors ? 'var(--amber)' : 'var(--text-dim)'}
        />
      </div>
    </div>
  );
}
