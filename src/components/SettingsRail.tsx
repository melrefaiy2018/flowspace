import { ArrowLeft, Cpu, Lightbulb, RefreshCw, Settings, Sparkles, UserRound, type LucideIcon } from 'lucide-react';

export type SettingsSection = 'general' | 'providers' | 'account' | 'personalization' | 'updates' | 'suggestions';

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
      className={`flex w-full items-center gap-2.5 rounded-[12px] px-3 py-2.5 text-left transition ${
        active
          ? 'border border-[var(--border2)] bg-[var(--surface2)] text-[var(--text)]'
          : 'border border-transparent text-[var(--text-dim)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]'
      }`}
    >
      <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] border ${
        active ? 'border-[var(--blue)]/30 bg-[var(--blue)]/12 text-[var(--blue)]' : 'border-[var(--border)] bg-[var(--surface2)] text-[var(--text-faint)]'
      }`}>
        <Icon size={15} />
      </span>
      <span className="text-[13px] font-medium tracking-[-0.01em]">{label}</span>
    </button>
  );
}

export default function SettingsRail({ selectedSection, onSelect, onBack }: SettingsRailProps) {
  const items: { id: SettingsSection; label: string; icon: LucideIcon }[] = [
    { id: 'general', label: 'General', icon: Settings },
    { id: 'account', label: 'User Account', icon: UserRound },
    { id: 'personalization', label: 'Personalization', icon: Sparkles },
    { id: 'providers', label: 'LLM Providers', icon: Cpu },
    { id: 'suggestions', label: 'Workflow Suggestions', icon: Lightbulb },
    { id: 'updates', label: 'Updates', icon: RefreshCw },
  ];

  return (
    <aside className="flex h-screen w-[260px] shrink-0 flex-col border-r border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-4">
      <button
        onClick={onBack}
        className="mb-4 inline-flex items-center gap-2 rounded-[10px] px-3 py-2 text-[12px] font-medium text-[var(--text-dim)] transition hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
      >
        <ArrowLeft size={16} />
        Back to app
      </button>

      <div className="mb-4 px-2">
        <div className="text-[13px] font-semibold tracking-[-0.02em] text-[var(--text)]">Settings</div>
      </div>

      <div className="space-y-1">
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
