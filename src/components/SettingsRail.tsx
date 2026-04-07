import { ArrowLeft, Cpu, RefreshCw, Settings, Sparkles, UserRound, type LucideIcon } from 'lucide-react';

export type SettingsSection = 'general' | 'providers' | 'account' | 'personalization' | 'updates';

interface SettingsRailProps {
  selectedSection: SettingsSection;
  onSelect: (section: SettingsSection) => void;
  onBack: () => void;
}

function RailItem({
  icon: Icon,
  label,
  active,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-3 rounded-[14px] px-3 py-3 text-left transition ${
        active
          ? 'border border-white/10 bg-white/[0.06] text-white'
          : 'border border-transparent text-[var(--text-dim)] hover:bg-white/[0.04] hover:text-white'
      }`}
    >
      <span className={`flex h-9 w-9 items-center justify-center rounded-[12px] border ${active ? 'border-[var(--blue)]/30 bg-[var(--blue)]/12 text-[var(--blue)]' : 'border-white/8 bg-white/[0.03]'}`}>
        <Icon size={16} />
      </span>
      <span className="text-[14px] font-medium tracking-[-0.01em]">{label}</span>
    </button>
  );
}

export default function SettingsRail({ selectedSection, onSelect, onBack }: SettingsRailProps) {
  const items: { id: SettingsSection; label: string; icon: LucideIcon }[] = [
    { id: 'general', label: 'General', icon: Settings },
    { id: 'account', label: 'User Account', icon: UserRound },
    { id: 'personalization', label: 'Personalization', icon: Sparkles },
    { id: 'providers', label: 'LLM Providers', icon: Cpu },
    { id: 'updates', label: 'Updates', icon: RefreshCw },
  ];

  return (
    <aside className="flex h-screen w-[280px] shrink-0 flex-col border-r border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-4">
      <button
        onClick={onBack}
        className="mb-4 inline-flex items-center gap-2 rounded-[12px] px-3 py-2 text-[13px] font-medium text-[var(--text-dim)] transition hover:bg-white/[0.04] hover:text-white"
      >
        <ArrowLeft size={19} />
        Back to app
      </button>

      <div className="mb-5 px-2">
        <div className="text-[14px] font-semibold tracking-[-0.02em] text-white">Settings</div>
        <div className="mt-1 text-[11px] uppercase tracking-[0.2em] text-[var(--text-faint)]">
          Workspace controls
        </div>
      </div>

      <div className="space-y-1.5">
        {items.map((item) => (
          <RailItem
            key={item.id}
            icon={item.icon}
            label={item.label}
            active={selectedSection === item.id}
            onClick={() => onSelect(item.id)}
          />
        ))}
      </div>
    </aside>
  );
}
