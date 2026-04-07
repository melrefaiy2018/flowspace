import { FileText, FileSpreadsheet, Presentation, Image, File, Sparkles, HardDrive } from 'lucide-react';
import type { DriveFile } from '../services/api';

interface Props {
  files: DriveFile[];
  onAction: (prompt: string, autoSend: boolean) => void;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function fileIcon(mimeType: string) {
  if (mimeType.includes('document') || mimeType.includes('text')) return FileText;
  if (mimeType.includes('spreadsheet') || mimeType.includes('csv')) return FileSpreadsheet;
  if (mimeType.includes('presentation') || mimeType.includes('slide')) return Presentation;
  if (mimeType.includes('image')) return Image;
  return File;
}

export default function RecentFiles({ files, onAction }: Props) {
  if (files.length === 0) return null;

  return (
    <div className="w-full">
      <div className="flex items-center gap-2 mb-2.5">
        <HardDrive size={12} className="text-[var(--blue)]" />
        <span className="text-[11px] font-mono text-[var(--text-faint)] uppercase tracking-widest">Recent files</span>
      </div>
      <div className="flex gap-2.5 overflow-x-auto pb-1">
        {files.map((f) => {
          const Icon = fileIcon(f.mimeType);
          return (
            <a
              key={f.id}
              href={f.webViewLink}
              target="_blank"
              rel="noopener"
              className="group flex-shrink-0 w-[160px] p-3 rounded-[var(--radius-md)] bg-[var(--surface)] border border-[var(--border)] hover:border-[var(--border2)] hover:bg-[var(--surface2)] transition-all relative"
            >
              <Icon size={16} className="text-[var(--blue)] mb-2" />
              <div className="text-[12px] text-[var(--text)] truncate">{f.name}</div>
              <div className="text-[10px] text-[var(--text-faint)] mt-0.5 font-mono">{timeAgo(f.modifiedTime)}</div>
              <button
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onAction(`Summarize my file: ${f.name}`, true);
                }}
                className="absolute top-2 right-2 w-6 h-6 rounded-[var(--radius-sm)] bg-[var(--blue-dim)] flex items-center justify-center text-[var(--blue)] opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 hover:bg-[var(--blue)] hover:text-black transition-all cursor-pointer"
                title="Summarize"
              >
                <Sparkles size={11} />
              </button>
            </a>
          );
        })}
      </div>
    </div>
  );
}
