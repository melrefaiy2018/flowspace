import { useEffect, useRef, useState, type ElementType } from 'react';
import {
  Bot,
  Circle,
  Home,
  LayoutGrid,
  MessageSquarePlus,
  PanelLeft,
  Plus,
  Search,
  Settings,
  Trash2,
} from 'lucide-react';
import type { ConnectedAccount, UserProfile } from '../services/api';
import type { ActiveView, Conversation, ThreadGroup } from '../context/ChatContext';
import FlowSpaceLogo from './FlowSpaceLogo';

const RAIL_COLLAPSED_KEY = 'flowspace.rail.collapsed';
const INITIAL_THREAD_COUNT = 12;

type NavSection = 'home' | 'chats' | 'workspace' | 'skills' | 'settings' | 'gmail' | 'drive' | 'calendar' | 'tasks';

interface Props {
  user: UserProfile | null;
  accounts?: ConnectedAccount[];
  activeAccountId?: string | null;
  accountBusy?: boolean;
  onAction: (prompt: string, autoSend: boolean) => void;
  activeSection: NavSection;
  forceExpanded?: boolean;
  forceCollapsed?: boolean;
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

interface NavItemProps {
  icon: ElementType;
  label: string;
  active?: boolean;
  collapsed?: boolean;
  'aria-expanded'?: boolean;
  onClick?: () => void;
}

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
  const date = new Date(ts);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfYesterday = startOfToday - 86400000;
  const startOfWeek = startOfToday - now.getDay() * 86400000;
  if (ts >= startOfToday) return 'Today';
  if (ts >= startOfYesterday) return 'Yesterday';
  if (ts >= startOfWeek) return 'This week';
  return 'Older';
}

function groupByTime(conversations: Conversation[]): { label: string; items: Conversation[] }[] {
  const bucketOrder = ['Today', 'Yesterday', 'This week', 'Older'] as const;
  const buckets: Record<string, Conversation[]> = {};
  for (const c of conversations) {
    const label = getTimeBucket(c.updatedAt);
    if (!buckets[label]) buckets[label] = [];
    buckets[label].push(c);
  }
  return bucketOrder.filter((l) => buckets[l]?.length).map((l) => ({ label: l, items: buckets[l] }));
}

// Icons always at the same left X position — labels slide in/out beside them.
function NavItem({ icon: Icon, label, active, collapsed, onClick, 'aria-expanded': ariaExpanded }: NavItemProps) {
  return (
    <button
      onClick={onClick}
      aria-label={collapsed ? label : undefined}
      aria-expanded={ariaExpanded}
      className={`group/item relative w-full flex items-center gap-[10px] rounded-[8px] cursor-pointer transition-all duration-150 px-[10px] py-[8px] ${
        active
          ? 'bg-[var(--surface2)] text-[var(--text)] shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]'
          : 'text-[var(--text-dim)] hover:bg-[var(--surface2)]/70 hover:text-[var(--text)]'
      }`}
    >
      {active && !collapsed && (
        <span className="absolute left-0 top-[6px] bottom-[6px] w-[2.5px] rounded-full bg-[var(--accent)]" />
      )}
      <span className={`shrink-0 flex items-center justify-center transition-colors ${
        active ? 'text-[var(--accent)]' : 'text-[var(--text-faint)] group-hover/item:text-[var(--text-dim)]'
      }`}>
        <Icon size={24} strokeWidth={1.5} />
      </span>
      {!collapsed && (
        <span className="text-[13.5px] whitespace-nowrap overflow-hidden tracking-[-0.01em] font-medium">{label}</span>
      )}
    </button>
  );
}

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
  onSwitchAccount,
  onAddAccount,
  onRemoveAccount,
}: Props) {
  const [chatFilter, setChatFilter] = useState('');
  const [showAllThreads, setShowAllThreads] = useState(false);
  const [collapsed, setCollapsed] = useState(() => window.localStorage.getItem(RAIL_COLLAPSED_KEY) === 'true');

  const recentConversations = [...conversations].sort((a, b) => b.updatedAt - a.updatedAt);
  const filteredConversations = recentConversations.filter((c) =>
    c.title.toLowerCase().includes(chatFilter.toLowerCase()),
  );
  const limitedConversations = filteredConversations.slice(0, showAllThreads ? undefined : INITIAL_THREAD_COUNT);
  const hasMoreThreads = filteredConversations.length > INITIAL_THREAD_COUNT && !showAllThreads;

  useEffect(() => { window.localStorage.setItem(RAIL_COLLAPSED_KEY, String(collapsed)); }, [collapsed]);

  useEffect(() => {
    if (forceExpanded && collapsed) setCollapsed(false);
  }, [collapsed, forceExpanded]);

  const prevForceCollapsed = useRef(forceCollapsed);
  useEffect(() => {
    if (forceCollapsed && !prevForceCollapsed.current) setCollapsed(true);
    prevForceCollapsed.current = forceCollapsed;
  }, [forceCollapsed]);

  useEffect(() => { setShowAllThreads(false); }, [chatFilter]);

  return (
    <nav
      aria-label="Main navigation"
      className="h-screen flex flex-col bg-[var(--bg-elevated)] border-r border-[var(--border)] shrink-0 overflow-hidden"
      style={{ width: collapsed ? 56 : 280, transition: 'max-width 300ms cubic-bezier(0.4,0,0.2,1), width 300ms cubic-bezier(0.4,0,0.2,1)' }}
    >
      {/* ── Brand row — same height in both states ── */}
      <div className="shrink-0 flex items-center gap-[10px] px-[10px] py-[10px] border-b border-[var(--border)]">
        <button
          onClick={() => {
            if (collapsed) { setCollapsed(false); return; }
            onAction('Give me a workspace summary', true);
          }}
          className="shrink-0 cursor-pointer group flex items-center justify-center"
          title={collapsed ? 'Expand sidebar' : 'Workspace summary'}
        >
          <FlowSpaceLogo size={28} className="group-hover:scale-110 transition-transform" />
        </button>
        {!collapsed && (
          <span className="text-[14px] font-semibold tracking-[-0.2px] whitespace-nowrap overflow-hidden text-[var(--text)]">
            FlowSpace
          </span>
        )}
      </div>

      {/* ── Top nav items — always rendered, labels slide in ── */}
      <div className="shrink-0 px-[6px] py-[6px] flex flex-col gap-[1px]">
        <NavItem
          icon={PanelLeft}
          label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          active={false}
          collapsed={collapsed}
          aria-expanded={!collapsed}
          onClick={() => setCollapsed((v) => !v)}
        />
        <NavItem
          icon={MessageSquarePlus}
          label="New chat"
          active={false}
          collapsed={collapsed}
          onClick={onNewChat}
        />
        <NavItem
          icon={Home}
          label="Home"
          active={activeSection === 'home'}
          collapsed={collapsed}
          onClick={() => onNavigate?.('dashboard')}
        />
        <NavItem
          icon={LayoutGrid}
          label="Tools"
          active={activeSection === 'workspace' || activeSection === 'gmail' || activeSection === 'calendar' || activeSection === 'drive' || activeSection === 'tasks'}
          collapsed={collapsed}
          onClick={() => onNavigate?.('workspace')}
        />
        <NavItem
          icon={Bot}
          label="Skills"
          active={activeSection === 'skills'}
          collapsed={collapsed}
          onClick={() => onNavigate?.('skills')}
        />
      </div>

      {/* ── Conversations (expanded only) ── */}
      {!collapsed && (
        <div className="flex-1 overflow-y-auto px-[8px] pt-[4px] pb-2">
          {/* Search */}
          <div className="mb-[24px] flex items-center gap-[10px] rounded-[8px] bg-[var(--surface2)] pl-[14px] pr-[10px] py-[7px]">
            <Search size={15} className="shrink-0 text-[var(--text-faint)]" />
            <input
              value={chatFilter}
              onChange={(e) => setChatFilter(e.target.value)}
              placeholder="Search conversations"
              aria-label="Search conversations"
              className="flex-1 bg-transparent text-[13px] text-[var(--text)] placeholder:text-[var(--text-faint)] outline-none"
            />
          </div>

          {/* Time-grouped threads */}
          {filteredConversations.length === 0 ? (
            <div className="px-[6px] py-3 text-[12px] text-[var(--text-faint)]">No conversations yet</div>
          ) : (
            <div className="space-y-[20px]">
              {groupByTime(limitedConversations).map(({ label, items }) => (
                <div key={label}>
                  <div className="px-[8px] pb-[8px] text-[13px] font-medium text-[var(--text-dim)]">
                    {label}
                  </div>
                  <div className="space-y-[2px]">
                    {items.map((conversation) => (
                      <div key={conversation.id} className="group relative">
                        <button
                          className={`w-full flex items-center rounded-[8px] px-[8px] py-[10px] transition-colors cursor-pointer gap-[10px] text-left ${
                            conversation.id === currentConversationId
                              ? 'bg-[var(--surface2)]'
                              : 'hover:bg-[var(--surface2)]/75'
                          }`}
                          onClick={() => onSwitchConversation(conversation.id)}
                          aria-label={`Open conversation: ${conversation.title}`}
                          aria-current={conversation.id === currentConversationId ? 'true' : undefined}
                        >
                          <Circle size={16} strokeWidth={1.4} className="shrink-0 text-[var(--text-faint)]" />
                          <span className="text-[14px] text-[var(--text)] truncate flex-1 pr-6">{conversation.title}</span>
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); onDeleteConversation(conversation.id); }}
                          className="absolute right-[8px] top-1/2 -translate-y-1/2 shrink-0 h-[24px] w-[24px] rounded-md text-[var(--text-faint)] hover:text-[var(--error)] hover:bg-[var(--error-dim)] opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-all flex items-center justify-center cursor-pointer"
                          aria-label={`Delete conversation: ${conversation.title}`}
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              {hasMoreThreads && (
                <button
                  onClick={() => setShowAllThreads(true)}
                  className="w-full text-left px-[14px] py-1.5 text-[12px] text-[var(--text-faint)] hover:text-[var(--text)] hover:bg-[var(--surface2)] rounded-[7px]"
                >
                  Show more
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Spacer in collapsed mode */}
      {collapsed && <div className="flex-1" />}

      {/* ── Footer — settings + user ── */}
      <div className="shrink-0 border-t border-[var(--border)] px-[6px] pt-[5px] pb-[6px]">
        <NavItem
          icon={Settings}
          label="Settings"
          active={activeSection === 'settings'}
          collapsed={collapsed}
          onClick={() => onNavigate?.('settings')}
        />
      </div>
    </nav>
  );
}
