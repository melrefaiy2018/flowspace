import { ExternalLink, FolderKanban, CalendarDays, HardDrive, Sparkles } from 'lucide-react';
import type { DriveFile, WorkspaceStats } from '../services/api';
import MiniRing from './ui/MiniRing';

interface Props {
  files: DriveFile[];
  stats: WorkspaceStats | null;
  onAskAgent?: () => void;
  kanbanMode?: boolean;
}

function formatModifiedTime(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default function HomeActivityPanel({ files, stats, onAskAgent, kanbanMode = false }: Props) {
  const recentFiles = files.slice(0, 4);
  const unread = stats?.unreadEmails ?? 0;
  const upcoming = stats?.upcomingEvents ?? 0;
  const filesCount = stats?.driveFilesRecent ?? recentFiles.length;

  return (
    <section className={kanbanMode ? 'flex flex-col' : 'home-panel home-panel-secondary flex h-full flex-col overflow-hidden'}>
      {!kanbanMode && (
        <div className="home-section-header">
          <div>
            <div className="home-section-kicker">Activity</div>
            <h3 className="home-section-title">Workspace pulse</h3>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-black/20 px-2.5 py-1 text-[10px] font-mono uppercase tracking-[0.16em] text-[var(--text-faint)]">
              <span className="live-dot inline-block w-1.5 h-1.5 rounded-full bg-[var(--accent)]" />
              Live
            </div>
            {onAskAgent && (
              <button
                onClick={onAskAgent}
                className="flex h-7 w-7 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[var(--text-faint)] transition-all hover:border-[var(--accent-border)] hover:text-[var(--accent)] hover:bg-[var(--accent-glow)] cursor-pointer"
                title="Ask AI about workspace activity"
                aria-label="Ask AI about workspace activity"
              >
                <Sparkles size={13} />
              </button>
            )}
          </div>
        </div>
      )}

      {/* Compact stats row */}
      <div className="flex items-center gap-3 border-b border-[var(--section-divider)] px-4 py-3">
        <MiniRing
          value={Math.min(unread, 200)}
          total={200}
          size={44}
          strokeWidth={4}
          color={unread > 50 ? 'var(--amber)' : 'var(--accent)'}
        >
          <span className="text-[9px] font-semibold text-[var(--text)]">{Math.round(Math.min(unread / 200, 1) * 100)}%</span>
        </MiniRing>
        <div className="flex flex-1 gap-2">
          <div className="flex-1 rounded-[12px] border border-white/5 bg-black/15 px-3 py-2">
            <div className="flex items-center gap-1.5 text-[var(--blue)]" style={{ opacity: 0.7 }}>
              <CalendarDays size={10} />
              <span className="text-[10px] font-mono uppercase tracking-[0.1em]">Upcoming</span>
            </div>
            <div className="mt-0.5 text-[13px] font-medium text-[var(--text)]">{upcoming} today</div>
          </div>
          <div className="flex-1 rounded-[12px] border border-white/5 bg-black/15 px-3 py-2">
            <div className="flex items-center gap-1.5 text-[var(--accent)]" style={{ opacity: 0.6 }}>
              <HardDrive size={10} />
              <span className="text-[10px] font-mono uppercase tracking-[0.1em]">Files</span>
            </div>
            <div className="mt-0.5 text-[13px] font-medium text-[var(--text)]">{filesCount} recent</div>
          </div>
        </div>
      </div>

      <div className="flex flex-1 flex-col px-4 py-4">
        <div className="mb-3 flex items-center gap-2 text-[var(--text-faint)]">
          <FolderKanban size={13} />
          <span className="text-[10px] font-mono uppercase tracking-[0.14em]">Recently touched</span>
        </div>
        {recentFiles.length === 0 ? (
          <div className="flex flex-1 items-center justify-center rounded-[18px] border border-dashed border-[var(--border)] bg-white/[0.02] px-5 text-center text-[12px] text-[var(--text-faint)]">
            Recent files will appear here after your next doc, sheet, or shared file update.
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {recentFiles.map((file) => (
              <a
                key={file.id}
                href={file.webViewLink}
                target="_blank"
                rel="noopener noreferrer"
                className="group flex items-center gap-3 rounded-[14px] border border-white/6 bg-white/[0.03] px-3 py-2 transition-all duration-200 hover:border-[var(--accent)]/30 hover:bg-white/[0.05]"
              >
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] bg-[var(--accent-glow)] text-[var(--accent)]">
                  <HardDrive size={12} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12px] font-medium text-[var(--text)]">{file.name}</div>
                  <div className="mt-0.5 text-[10px] text-[var(--text-faint)]">
                    {formatModifiedTime(file.modifiedTime)}
                  </div>
                </div>
                <ExternalLink size={11} className="shrink-0 text-[var(--text-faint)] transition-colors group-hover:text-[var(--text)]" />
              </a>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
