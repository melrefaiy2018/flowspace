import { useState, useRef, useEffect } from 'react';
import { ArrowUpCircle, X } from 'lucide-react';
import type { VersionInfo } from '../services/api';

interface Props {
  versionInfo: VersionInfo | null;
  collapsed?: boolean;
}

export default function UpdateBadge({ versionInfo, collapsed }: Props) {
  const [open, setOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  if (!versionInfo?.updateAvailable) return null;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-[color-mix(in_srgb,var(--accent)_12%,transparent)] hover:bg-[color-mix(in_srgb,var(--accent)_20%,transparent)] transition-colors cursor-pointer"
        title={`Update available: v${versionInfo.latest}`}
      >
        <div className="relative">
          <ArrowUpCircle size={14} className="text-[var(--accent)]" />
          <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-green-500 rounded-full" />
        </div>
        {!collapsed && (
          <span className="text-[11px] text-[var(--accent)] font-medium">
            v{versionInfo.latest}
          </span>
        )}
      </button>

      {open && (
        <div
          ref={popoverRef}
          className="absolute bottom-full left-0 mb-2 w-64 bg-[var(--bg)] border border-[var(--border)] rounded-xl p-4 shadow-xl z-50"
        >
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-[13px] font-semibold text-[var(--text)]">Update Available</h4>
            <button onClick={() => setOpen(false)} className="text-[var(--text-dim)] hover:text-[var(--text)] cursor-pointer">
              <X size={14} />
            </button>
          </div>
          <p className="text-[12px] text-[var(--text-dim)] mb-3">
            FlowSpace v{versionInfo.latest} is available (you have v{versionInfo.current}).
          </p>
          <div className="bg-[var(--surface)] rounded-lg p-2.5 mb-3">
            <code className="text-[11px] text-[var(--text)] select-all">npx flowspace-ai</code>
          </div>
          {versionInfo.releaseUrl && (
            <a
              href={versionInfo.releaseUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[12px] text-[var(--accent)] hover:underline"
            >
              View release notes
            </a>
          )}
        </div>
      )}
    </div>
  );
}
