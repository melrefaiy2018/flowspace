import { useEffect, useRef, useState, type ElementType } from 'react';
import {
  Home,
  Mail,
  Calendar,
  CheckSquare,
  Workflow,
  Zap,
  PanelLeft,
  Search,
  Settings,
  Trash2,
  X,
  MessageSquare,
  FileText,
  Sparkles,
  ListChecks,
  ChevronDown,
  Plus,
} from 'lucide-react';
import type { ConnectedAccount, UserProfile } from '../services/api';
import type { ActiveView, Conversation, ThreadGroup } from '../context/ChatContext';
import FlowSpaceLogo from './FlowSpaceLogo';
import ThemeToggle from './ThemeToggle';

const RAIL_COLLAPSED_KEY = 'flowspace.rail.collapsed';
const INITIAL_THREAD_COUNT = 12;

type NavSection =
  | 'home'
  | 'chats'
  | 'mail'
  | 'calendar'
  | 'tasks'
  | 'workflows'
  | 'automations'
  | 'settings';

interface Props {
  user: UserProfile | null;
  accounts?: ConnectedAccount[];
  activeAccountId?: string | null;
  accountBusy?: boolean;
  onAction: (prompt: string, autoSend: boolean) => void;
  activeSection: NavSection;
  forceExpanded?: boolean;
  forceCollapsed?: boolean;
  pendingDraftCount?: number;
  onNavigate?: (view: ActiveView) => void;
  conversations: Conversation[];
  threadGroups: ThreadGroup[];
  currentConversationId: string | null;
  onSwitchConversation: (id: string) => void;
  onDeleteConversation: (id: string) => void;
  onNewChat: () => void;
  onCreateThreadGroup: (name: string) => string | null;
  onRenameThreadGroup: (id: string, name: string) => void;
  onDeleteThreadGroup: (id: string) => void;
  onSwitchAccount?: (id: string) => void;
  onAddAccount?: () => void;
  onRemoveAccount?: (id: string) => void;
}

/* ── Helpers ──────────────────────────────────────────────────── */

function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function getTimeBucket(ts: number): 'Today' | 'Yesterday' | 'This week' | 'Older' {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfYesterday = startOfToday - 86400000;
  const startOfWeek = startOfToday - now.getDay() * 86400000;
  if (ts >= startOfToday) return 'Today';
  if (ts >= startOfYesterday) return 'Yesterday';
  if (ts >= startOfWeek) return 'This week';
  return 'Older';
}

function groupByTime(
  conversations: Conversation[],
): { label: string; items: Conversation[] }[] {
  const bucketOrder = ['Today', 'Yesterday', 'This week', 'Older'] as const;
  const buckets: Record<string, Conversation[]> = {};
  for (const c of conversations) {
    const label = getTimeBucket(c.updatedAt);
    if (!buckets[label]) buckets[label] = [];
    buckets[label].push(c);
  }
  return bucketOrder
    .filter((l) => buckets[l]?.length)
    .map((l) => ({ label: l, items: buckets[l] }));
}

/** Infer a tiny icon for the conversation based on title keywords */
function conversationIcon(title: string): ElementType {
  const t = title.toLowerCase();
  if (t.includes('draft') || t.includes('reply') || t.includes('email')) return FileText;
  if (t.includes('brief') || t.includes('standup') || t.includes('digest')) return Sparkles;
  if (t.includes('task') || t.includes('todo') || t.includes('plan')) return ListChecks;
  return MessageSquare;
}

/** How aggressively to dim old conversations (0–1 scale) */
function ageFade(bucket: string): number {
  switch (bucket) {
    case 'Today':
      return 1;
    case 'Yesterday':
      return 0.85;
    case 'This week':
      return 0.7;
    default:
      return 0.55;
  }
}

/* ── NavItem — refined, compact ──────────────────────────────── */

interface NavItemProps {
  icon: ElementType;
  label: string;
  active?: boolean;
  collapsed?: boolean;
  badge?: number;
  'aria-expanded'?: boolean;
  onClick?: () => void;
}

function NavItem({
  icon: Icon,
  label,
  active,
  collapsed,
  badge,
  onClick,
  'aria-expanded': ariaExpanded,
}: NavItemProps) {
  return (
    <button
      onClick={onClick}
      aria-label={collapsed ? label : undefined}
      aria-expanded={ariaExpanded}
      className={[
        'group/item relative w-full flex items-center gap-2.5 rounded-md cursor-pointer transition-all duration-150',
        collapsed ? 'px-0 py-2.5 justify-center' : 'px-2.5 py-2',
        active
          ? 'text-[var(--text)]'
          : 'text-[var(--text-faint)] hover:text-[var(--text-dim)]',
      ].join(' ')}
    >
      {/* Active indicator — 2px solid left bar */}
      {active && (
        <span
          className="absolute left-0 top-1/2 -translate-y-1/2 w-[2px] rounded-r-full"
          style={{ background: 'var(--accent)', height: '60%', opacity: 1 }}
        />
      )}
      {/* Active background */}
      {active && (
        <span className="absolute inset-0 rounded-md bg-white/[0.055] pointer-events-none" />
      )}
      {/* Hover background */}
      {!active && (
        <span className="absolute inset-0 rounded-md opacity-0 group-hover/item:opacity-100 bg-white/[0.03] transition-opacity pointer-events-none" />
      )}
      <span
        className={`relative shrink-0 flex items-center justify-center transition-colors ${
          active
            ? 'text-[var(--accent)]'
            : 'text-[var(--text-faint)] group-hover/item:text-[var(--text-dim)]'
        }`}
      >
        <Icon size={16} strokeWidth={1.7} />
        {collapsed && badge !== undefined && badge > 0 && (
          <span className="absolute -top-[2px] -right-[2px] w-[5px] h-[5px] rounded-full bg-[var(--accent)]" />
        )}
      </span>
      {!collapsed && (
        <span
          className={`text-[12.5px] whitespace-nowrap overflow-hidden tracking-[-0.01em] flex-1 text-left transition-colors ${
            active ? 'font-[500]' : 'font-normal'
          }`}
        >
          {label}
        </span>
      )}
      {!collapsed && badge !== undefined && badge > 0 && (
        <span className="text-[9px] font-bold font-mono bg-[var(--accent-dim)] text-[var(--accent)] border border-[var(--accent-border)] rounded-full px-1 leading-[16px] min-w-[14px] text-center">
          {badge}
        </span>
      )}
    </button>
  );
}

/* ── Account Section — rail footer ──────────────────────────── */

interface AccountSectionProps {
  accounts: ConnectedAccount[];
  activeAccountId?: string | null;
  busy?: boolean;
  collapsed: boolean;
  onExpand?: () => void;
  onSwitch?: (id: string) => void;
  onAdd?: () => void;
  onRemove?: (id: string) => void;
}

function AccountSection({ accounts, activeAccountId, busy = false, collapsed, onExpand, onSwitch, onAdd, onRemove }: AccountSectionProps) {
  const [open, setOpen] = useState(false);
  const [positioned, setPositioned] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [panelStyle, setPanelStyle] = useState<React.CSSProperties>({});

  // Position the panel after the rail's 250ms expand animation completes
  useEffect(() => {
    if (!open) { setPositioned(false); return; }
    setPositioned(false);
    const id = setTimeout(() => {
      if (!triggerRef.current) return;
      const rect = triggerRef.current.getBoundingClientRect();
      setPanelStyle({
        position: 'fixed',
        bottom: window.innerHeight - rect.top + 8,
        left: 4,
        width: rect.right - 4,
        zIndex: 9999,
      });
      setPositioned(true);
    }, 260);
    return () => clearTimeout(id);
  }, [open, collapsed]);

  // Close on Escape or click outside
  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    const handlePointerDown = (e: PointerEvent) => {
      if (
        panelRef.current && !panelRef.current.contains(e.target as Node) &&
        triggerRef.current && !triggerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('keydown', handleKey);
    document.addEventListener('pointerdown', handlePointerDown);
    return () => {
      document.removeEventListener('keydown', handleKey);
      document.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [open]);

  const activeAccount = accounts.find((a) => a.id === activeAccountId) ?? accounts[0] ?? null;
  if (!activeAccount) return null;

  const initials = (activeAccount.name || activeAccount.email)
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0].toUpperCase())
    .join('');

  return (
    <div>
      <button
        ref={triggerRef}
        type="button"
        onClick={(e) => { e.stopPropagation(); if (collapsed) { onExpand?.(); } setOpen((v) => !v); }}
        aria-label="Account menu"
        aria-expanded={open}
        className={[
          'group w-full flex items-center rounded-md cursor-pointer transition-all duration-150',
          'hover:bg-white/[0.03]',
          collapsed ? 'px-0 py-2.5 justify-center' : 'px-2.5 py-2 gap-2.5',
        ].join(' ')}
      >
        {/* Avatar */}
        <span className="shrink-0 w-6 h-6 rounded-full bg-[var(--accent-dim)] border border-[var(--accent-border)] flex items-center justify-center text-[9px] font-bold text-[var(--accent)] leading-none">
          {initials || '?'}
        </span>
        {!collapsed && (
          <>
            <span className="flex-1 min-w-0 text-left">
              <span className="block text-[12px] font-medium text-[var(--text-dim)] truncate leading-tight">
                {activeAccount.name || activeAccount.email.split('@')[0]}
              </span>
              <span className="block text-[10px] text-[var(--text-faint)] truncate leading-tight opacity-70">
                {activeAccount.email}
              </span>
            </span>
            <ChevronDown size={11} className={`shrink-0 text-[var(--text-faint)] opacity-50 transition-transform ${open ? 'rotate-180' : ''}`} />
          </>
        )}
      </button>

      {open && positioned && (
        <div
          ref={panelRef}
          style={panelStyle}
          className="rounded-[14px] border border-[var(--border)] bg-[var(--bg-elevated)] p-2 shadow-2xl"
        >
          <div className="px-2 py-1 text-[9px] font-mono uppercase tracking-[0.14em] text-[var(--text-faint)] opacity-60">
            Connected accounts
          </div>
          <div className="mt-1 flex flex-col gap-1">
            {accounts.map((account) => {
              const isActive = account.id === activeAccountId;
              return (
                <div
                  key={account.id}
                  className={`flex items-center gap-2 rounded-[10px] border px-3 py-2 ${isActive ? 'border-[var(--accent)]/30 bg-[var(--accent-dim)]/15' : 'border-transparent'}`}
                >
                  <button
                    type="button"
                    disabled={busy || isActive}
                    onClick={() => { setOpen(false); onSwitch?.(account.id); }}
                    className="min-w-0 flex-1 text-left disabled:opacity-60 cursor-pointer"
                  >
                    <div className="truncate text-[12px] font-medium text-[var(--text)]">{account.name || account.email}</div>
                    <div className="truncate text-[10px] text-[var(--text-faint)]">{account.email}</div>
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => { setOpen(false); onRemove?.(account.id); }}
                    className="rounded-md p-1 text-[var(--text-faint)] hover:text-[var(--error)] cursor-pointer disabled:opacity-50"
                    title={`Remove ${account.email}`}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              );
            })}
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={() => { setOpen(false); onAdd?.(); }}
            className="mt-2 flex w-full items-center justify-center gap-2 rounded-[10px] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[11px] text-[var(--text)] hover:bg-[var(--surface2)] cursor-pointer disabled:opacity-50"
          >
            <Plus size={12} />
            Add Google account
          </button>
        </div>
      )}
    </div>
  );
}

/* ── Main Component ──────────────────────────────────────────── */

export default function AppRail({
  user,
  onAction,
  activeSection,
  forceExpanded = false,
  forceCollapsed = false,
  onNavigate,
  conversations,
  threadGroups,
  currentConversationId,
  onSwitchConversation,
  onDeleteConversation,
  onNewChat,
  onCreateThreadGroup,
  onRenameThreadGroup,
  onDeleteThreadGroup,
  accounts = [],
  activeAccountId = null,
  accountBusy = false,
  pendingDraftCount = 0,
  onSwitchAccount,
  onAddAccount,
  onRemoveAccount,
}: Props) {
  const [chatFilter, setChatFilter] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const [showAllThreads, setShowAllThreads] = useState(false);
  const [collapsed, setCollapsed] = useState(() => {
    const saved = window.localStorage.getItem(RAIL_COLLAPSED_KEY);
    // Default to collapsed if no preference has been saved yet (Phase 1 decision)
    return saved === null ? false : saved === 'true';
  });

  const recentConversations = [...conversations].sort(
    (a, b) => b.updatedAt - a.updatedAt,
  );
  const filteredConversations = recentConversations.filter((c) =>
    c.title.toLowerCase().includes(chatFilter.toLowerCase()),
  );
  const limitedConversations = filteredConversations.slice(
    0,
    showAllThreads ? undefined : INITIAL_THREAD_COUNT,
  );
  const hasMoreThreads =
    filteredConversations.length > INITIAL_THREAD_COUNT && !showAllThreads;

  useEffect(() => {
    window.localStorage.setItem(RAIL_COLLAPSED_KEY, String(collapsed));
  }, [collapsed]);

  useEffect(() => {
    if (forceExpanded && collapsed) setCollapsed(false);
  }, [collapsed, forceExpanded]);

  const prevForceCollapsed = useRef(forceCollapsed);
  useEffect(() => {
    if (forceCollapsed && !prevForceCollapsed.current) setCollapsed(true);
    prevForceCollapsed.current = forceCollapsed;
  }, [forceCollapsed]);

  useEffect(() => {
    setShowAllThreads(false);
  }, [chatFilter]);

  return (
    <nav
      aria-label="Main navigation"
      className="app-rail h-screen flex flex-col shrink-0 overflow-hidden"
      style={{
        width: collapsed ? 48 : 248,
        transition: 'width 250ms cubic-bezier(0.4,0,0.2,1)',
      }}
    >
      {/* ── Brand ── */}
      <div className={`shrink-0 flex items-center gap-2 pt-3 pb-2 ${collapsed ? 'px-0 justify-center' : 'px-3'}`}>
        <button
          onClick={() => {
            if (collapsed) {
              setCollapsed(false);
              return;
            }
            onNavigate?.('dashboard');
          }}
          className="shrink-0 cursor-pointer group flex items-center justify-center"
          title={collapsed ? 'Expand sidebar' : 'Home'}
        >
          <FlowSpaceLogo
            size={20}
            className="group-hover:opacity-80 transition-opacity"
          />
        </button>
        {!collapsed && (
          <>
            <span className="text-[12px] font-semibold tracking-[0.01em] whitespace-nowrap text-[var(--text-faint)] uppercase">
              FlowSpace
            </span>
            <button
              onClick={() => setCollapsed(true)}
              className="ml-auto p-1 rounded text-[var(--text-faint)] hover:text-[var(--text-dim)] transition-colors cursor-pointer opacity-40 hover:opacity-80"
              aria-label="Collapse sidebar"
            >
              <PanelLeft size={12} strokeWidth={1.6} />
            </button>
          </>
        )}
      </div>

      {/* ── Primary nav ── */}
      <div className={`shrink-0 py-1 flex flex-col gap-0.5 ${collapsed ? 'px-1' : 'px-2'}`}>
        {collapsed && (
          <NavItem
            icon={PanelLeft}
            label="Expand"
            collapsed={collapsed}
            onClick={() => setCollapsed(false)}
          />
        )}
        <NavItem
          icon={Home}
          label="Home"
          active={activeSection === 'home'}
          collapsed={collapsed}
          onClick={() => onNavigate?.('dashboard')}
        />

        {/* Section divider */}
        {!collapsed && (
          <div className="mx-1 mt-2 mb-1 flex items-center gap-2">
            <span className="flex-1 h-px bg-[var(--border)] opacity-50" />
          </div>
        )}
        {collapsed && <div className="my-1 mx-auto w-4 h-px bg-[var(--border)] opacity-40" />}

        <NavItem
          icon={Mail}
          label="Mail"
          active={activeSection === 'mail'}
          collapsed={collapsed}
          onClick={() => onNavigate?.('mail')}
        />
        <NavItem
          icon={Calendar}
          label="Calendar"
          active={activeSection === 'calendar'}
          collapsed={collapsed}
          onClick={() => onNavigate?.('calendar')}
        />
        <NavItem
          icon={CheckSquare}
          label="Tasks"
          active={activeSection === 'tasks'}
          collapsed={collapsed}
          onClick={() => onNavigate?.('tasks')}
        />
        <NavItem
          icon={Workflow}
          label="Workflows"
          active={activeSection === 'workflows'}
          collapsed={collapsed}
          onClick={() => onNavigate?.('workflows')}
        />
        <NavItem
          icon={Zap}
          label="Automations"
          active={activeSection === 'automations'}
          collapsed={collapsed}
          onClick={() => onNavigate?.('automations')}
        />
      </div>

      {/* ── History section (expanded only) ── */}
      {!collapsed && (
        <div className="rail-history flex-1 overflow-y-auto flex flex-col min-h-0 mt-1">
          {/* Section header */}
          <div className="flex items-center gap-1.5 px-3 pt-2 pb-1">
            <span className="text-[9px] font-mono uppercase tracking-[0.12em] text-[var(--text-faint)] opacity-40 flex-1">
              Recents
            </span>
            {chatFilter && (
              <button
                onClick={() => setChatFilter('')}
                className="p-0.5 rounded text-[var(--text-faint)] hover:text-[var(--text)] transition-colors cursor-pointer"
              >
                <X size={10} />
              </button>
            )}
          </div>

          {/* Search — ghost-style, minimal */}
          <div className="px-2 mb-1.5">
            <div
              className="flex items-center gap-1.5 rounded-md px-2 py-[3px] transition-all duration-150"
              style={{
                background: searchFocused
                  ? 'rgba(255,255,255,0.04)'
                  : 'transparent',
                border: `1px solid ${searchFocused ? 'var(--border)' : 'transparent'}`,
              }}
            >
              <Search
                size={11}
                className="shrink-0 text-[var(--text-faint)] opacity-50"
              />
              <input
                value={chatFilter}
                onChange={(e) => setChatFilter(e.target.value)}
                onFocus={() => setSearchFocused(true)}
                onBlur={() => setSearchFocused(false)}
                placeholder="Search..."
                aria-label="Search conversations"
                className="flex-1 bg-transparent text-[11px] text-[var(--text-dim)] placeholder:text-[var(--text-faint)] placeholder:opacity-50 outline-none min-w-0"
              />
            </div>
          </div>

          {/* Thread list */}
          <div className="flex-1 overflow-y-auto px-1.5 pb-2 scrollbar-thin">
            {filteredConversations.length === 0 ? (
              <div className="px-2 py-2 text-[11px] text-[var(--text-faint)] opacity-60">
                {chatFilter ? 'No matches' : 'No conversations yet'}
              </div>
            ) : (
              <div className="flex flex-col gap-2.5">
                {groupByTime(limitedConversations).map(({ label, items }) => {
                  const fade = ageFade(label);
                  return (
                    <div key={label}>
                      <div className="px-2 pb-0.5 text-[9px] font-mono text-[var(--text-faint)] uppercase tracking-[0.08em] opacity-50">
                        {label}
                      </div>
                      <div className="flex flex-col">
                        {items.map((conversation) => {
                          const isActive =
                            conversation.id === currentConversationId;
                          const ConvIcon = conversationIcon(conversation.title);
                          return (
                            <div key={conversation.id} className="group relative">
                              <button
                                className={[
                                  'w-full flex items-center gap-2 rounded-md px-2 py-[5px] transition-all duration-150 cursor-pointer text-left',
                                  isActive
                                    ? 'bg-white/[0.05]'
                                    : 'hover:bg-white/[0.025]',
                                ].join(' ')}
                                style={{ opacity: isActive ? 1 : fade }}
                                onClick={() =>
                                  onSwitchConversation(conversation.id)
                                }
                                aria-label={`Open: ${conversation.title}`}
                                aria-current={isActive ? 'true' : undefined}
                              >
                                {/* Accent dot for active */}
                                {isActive && (
                                  <span className="absolute left-0.5 top-1/2 -translate-y-1/2 w-[2px] h-2.5 rounded-full bg-[var(--accent)] opacity-70" />
                                )}
                                <ConvIcon
                                  size={12}
                                  strokeWidth={1.5}
                                  className={`shrink-0 ${
                                    isActive
                                      ? 'text-[var(--accent)]'
                                      : 'text-[var(--text-faint)]'
                                  }`}
                                />
                                <span
                                  className={`text-[12px] truncate flex-1 leading-tight ${
                                    isActive
                                      ? 'text-[var(--text)] font-medium'
                                      : 'text-[var(--text-dim)]'
                                  }`}
                                >
                                  {conversation.title}
                                </span>
                                <span className="text-[9px] text-[var(--text-faint)] font-mono shrink-0 opacity-40 group-hover:opacity-0 transition-opacity">
                                  {formatRelativeTime(conversation.updatedAt)}
                                </span>
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onDeleteConversation(conversation.id);
                                }}
                                className="absolute right-1.5 top-1/2 -translate-y-1/2 h-[18px] w-[18px] rounded text-[var(--text-faint)] hover:text-[var(--error)] hover:bg-[var(--error-dim)] opacity-0 group-hover:opacity-100 transition-all flex items-center justify-center cursor-pointer"
                                aria-label={`Delete: ${conversation.title}`}
                              >
                                <Trash2 size={10} />
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
                {hasMoreThreads && (
                  <button
                    onClick={() => setShowAllThreads(true)}
                    className="text-left px-2 py-0.5 text-[10px] text-[var(--text-faint)] opacity-50 hover:opacity-100 hover:text-[var(--text-dim)] transition-all cursor-pointer"
                  >
                    +{filteredConversations.length - INITIAL_THREAD_COUNT} more
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Spacer in collapsed mode */}
      {collapsed && <div className="flex-1" />}

      {/* ── Footer — quiet utility row ── */}
      <div className={`shrink-0 pb-2 pt-0.5 ${collapsed ? 'px-1' : 'px-2'}`}>
        <ThemeToggle variant="icon" collapsed={collapsed} />
        <NavItem
          icon={Settings}
          label="Settings"
          active={activeSection === 'settings'}
          collapsed={collapsed}
          onClick={() => onNavigate?.('settings')}
        />
        {accounts.length > 0 && (
          <>
            {!collapsed && <div className="mx-1 my-1 h-px bg-[var(--border)] opacity-40" />}
            {collapsed && <div className="my-1 mx-auto w-4 h-px bg-[var(--border)] opacity-40" />}
            <AccountSection
              accounts={accounts}
              activeAccountId={activeAccountId}
              busy={accountBusy}
              collapsed={collapsed}
              onExpand={() => setCollapsed(false)}
              onSwitch={onSwitchAccount}
              onAdd={onAddAccount}
              onRemove={onRemoveAccount}
            />
          </>
        )}
      </div>
    </nav>
  );
}
