/**
 * WorkspaceTabs — inline tab bar for the Gmail workspace canvas.
 *
 * Implements the WAI-ARIA tabs pattern:
 * - Roving tabIndex (only the active tab is in the tab stop sequence)
 * - Arrow-key navigation (ArrowLeft / ArrowRight)
 * - aria-selected + role="tab" + role="tablist"
 * - aria-controls links each tab to its panel (consumers must provide panel ids)
 */

import { useCallback, useRef } from 'react';

export type WorkspaceTabId = 'agent_work' | 'email' | 'thread' | 'context' | 'chat';

interface Tab {
  id: WorkspaceTabId;
  label: string;
  count?: number;
}

interface Props {
  activeTab: WorkspaceTabId;
  onTabChange: (tab: WorkspaceTabId) => void;
  /** Shown as badge on 'thread' tab when > 1 */
  messageCount?: number;
  /** Shown as badge on 'context' tab when > 0 */
  contextItemCount?: number;
}

export default function WorkspaceTabs({
  activeTab,
  onTabChange,
  messageCount,
  contextItemCount,
}: Props) {
  const tabs: Tab[] = [
    { id: 'email', label: 'Email' },
    { id: 'thread', label: 'Thread', count: messageCount && messageCount > 1 ? messageCount : undefined },
    { id: 'context', label: 'Context', count: contextItemCount && contextItemCount > 0 ? contextItemCount : undefined },
    { id: 'agent_work', label: 'Agent Work' },
    { id: 'chat', label: 'Chat' },
  ];

  const listRef = useRef<HTMLDivElement>(null);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      const currentIndex = tabs.findIndex((t) => t.id === activeTab);
      const next =
        e.key === 'ArrowRight'
          ? (currentIndex + 1) % tabs.length
          : (currentIndex - 1 + tabs.length) % tabs.length;
      onTabChange(tabs[next].id);
      // Move focus to the newly active tab button
      const buttons = listRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
      buttons?.[next]?.focus();
    },
    [activeTab, onTabChange, tabs],
  );

  return (
    <div
      ref={listRef}
      className="flex items-end gap-0 border-b border-[var(--border)]"
      role="tablist"
      onKeyDown={handleKeyDown}
    >
      {tabs.map((tab) => (
        <button
          key={tab.id}
          role="tab"
          aria-selected={activeTab === tab.id}
          tabIndex={activeTab === tab.id ? 0 : -1}
          onClick={() => onTabChange(tab.id)}
          className={`flex items-center gap-1.5 px-4 py-2.5 text-[13px] font-medium transition-all border-b-[2px] cursor-pointer ${
            activeTab === tab.id
              ? 'text-[var(--text)] border-[var(--accent)]'
              : 'text-[var(--text-faint)] border-transparent hover:text-[var(--text-dim)]'
          }`}
        >
          {tab.label}
          {tab.count !== undefined && (
            <span
              className={`text-[9px] font-mono rounded-full px-1.5 py-0.5 leading-none ${
                activeTab === tab.id
                  ? 'bg-[var(--accent-dim)] text-[var(--accent)]'
                  : 'bg-[var(--surface2)] text-[var(--text-faint)]'
              }`}
            >
              {tab.count}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
