import { useState, useEffect, useCallback } from 'react';
import {
  Bell,
  Mail,
  Calendar,
  ShieldCheck,
  CheckCircle2,
  FileText,
  Sparkles,
  Loader2,
  X,
  Info,
  ExternalLink,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import EmptyState from './EmptyState';
import type { Notification, NotificationGroup, NotificationType } from '../hooks/useNotifications';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatAgo(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

const GROUP_LABELS: Record<NotificationGroup, string> = {
  new: 'New',
  today: 'Today',
  earlier: 'Earlier',
};

// ---------------------------------------------------------------------------
// Icon per notification type
// ---------------------------------------------------------------------------

function NotifIcon({ type, unread }: { type: NotificationType; unread: boolean }) {
  const base = 'w-8 h-8 rounded-[8px] flex items-center justify-center shrink-0';

  switch (type) {
    case 'email':
      return (
        <div className={`${base} bg-[var(--blue-dim)] border border-[var(--blue-border)]`}>
          <Mail size={14} className="text-[var(--blue)]" />
        </div>
      );
    case 'meeting_prep':
      return (
        <div className={`${base} bg-[var(--amber-dim)] border border-[var(--amber-border)]`}>
          <Calendar size={14} className="text-[var(--amber)]" />
        </div>
      );
    case 'approval_request':
      return (
        <div className={`${base} bg-[var(--amber-dim)] border border-[var(--amber-border)]`}>
          <ShieldCheck size={14} className={`text-[var(--amber)] ${unread ? 'animate-pulse' : ''}`} />
        </div>
      );
    case 'task_suggestion':
      return (
        <div className={`${base} bg-[var(--accent-dim)] border border-[var(--accent-border)]`}>
          <CheckCircle2 size={14} className="text-[var(--accent)]" />
        </div>
      );
    case 'document_update':
      return (
        <div className={`${base} bg-[var(--blue-dim)] border border-[var(--blue-border)]`}>
          <FileText size={14} className="text-[var(--blue)]" />
        </div>
      );
    case 'draft_queue_item':
      return (
        <div className={`${base} bg-[var(--accent-dim)] border border-[var(--accent-border)]`}>
          <Sparkles size={14} className="text-[var(--accent)]" />
        </div>
      );
  }
}

// ---------------------------------------------------------------------------
// Single notification row
// ---------------------------------------------------------------------------

function NotificationRow({
  notification,
  onOpen,
  onDismiss,
  onMarkRead,
}: {
  notification: Notification;
  onOpen: (n: Notification) => void;
  onDismiss: (id: string) => void;
  onMarkRead: (id: string) => void;
}) {
  const { isRead, type, title, summary, sourceBadge, timestamp } = notification;

  const handleOpen = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onOpen(notification);
    },
    [notification, onOpen],
  );

  const handleDismiss = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onDismiss(notification.id);
    },
    [notification.id, onDismiss],
  );

  const handleMarkRead = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onMarkRead(notification.id);
    },
    [notification.id, onMarkRead],
  );

  return (
    <div
      className={`group relative rounded-[10px] border p-3 transition-colors cursor-pointer ${
        !isRead
          ? 'border-[var(--accent-border)] bg-[var(--accent-dim)]/10 hover:border-[var(--accent-border)]'
          : 'border-[var(--border)] bg-[var(--bg)] hover:border-[var(--border2)]'
      }`}
      onClick={handleOpen}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(notification); } }}
    >
      <div className="flex items-start gap-2.5">
        <NotifIcon type={type} unread={!isRead} />

        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2 mb-0.5">
            <span className="text-[13px] font-semibold text-[var(--text)] leading-tight truncate">
              {title}
            </span>
            <div className="flex items-center gap-1.5 shrink-0">
              <span className="text-[10px] text-[var(--text-faint)] font-mono whitespace-nowrap">
                {formatAgo(timestamp)}
              </span>
              {!isRead && (
                <span className="w-[6px] h-[6px] rounded-full bg-[var(--accent)] shrink-0" />
              )}
            </div>
          </div>

          <p className="text-[11px] text-[var(--text-dim)] leading-snug line-clamp-2 mb-2">
            {summary}
          </p>

          <div className="flex items-center justify-between">
            <span className="text-[9px] px-1.5 py-0.5 rounded-md bg-[var(--surface2)] text-[var(--text-faint)] border border-[var(--border)] uppercase font-medium tracking-wide">
              {sourceBadge}
            </span>

            {/* Action buttons — always visible on mobile, hover on desktop */}
            <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
              {!isRead && (
                <button
                  onClick={handleMarkRead}
                  className="text-[10px] text-[var(--text-faint)] hover:text-[var(--text-dim)] transition-colors cursor-pointer"
                  title="Mark as read"
                >
                  Mark read
                </button>
              )}
              <button
                onClick={handleOpen}
                className="text-[10px] font-semibold text-[var(--accent)] hover:underline flex items-center gap-0.5 cursor-pointer"
              >
                Open <ExternalLink size={9} />
              </button>
              <button
                onClick={handleDismiss}
                className="text-[10px] text-[var(--text-faint)] hover:text-[var(--error)] transition-colors cursor-pointer"
                title="Dismiss"
              >
                <X size={11} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section label
// ---------------------------------------------------------------------------

function SectionLabel({ group }: { group: NotificationGroup }) {
  return (
    <div className="sticky top-0 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-faint)] bg-[var(--surface)] z-10 border-b border-[var(--border)]">
      {GROUP_LABELS[group]}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

interface NotificationCenterProps {
  notifications: Notification[];
  unreadCount: number;
  onMarkRead: (id: string) => void;
  onMarkAllRead: () => void;
  onDismiss: (id: string) => void;
  onOpen: (notification: Notification) => void;
  briefingLoading?: boolean;
  onPanelOpen?: () => void;
}

export default function NotificationCenter({
  notifications,
  unreadCount,
  onMarkRead,
  onMarkAllRead,
  onDismiss,
  onOpen,
  briefingLoading = false,
  onPanelOpen,
}: NotificationCenterProps) {
  const [isOpen, setIsOpen] = useState(false);

  // Keyboard dismiss
  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false);
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [isOpen]);

  const handleToggle = useCallback(() => {
    const next = !isOpen;
    setIsOpen(next);
    if (next && onPanelOpen) onPanelOpen();
  }, [isOpen, onPanelOpen]);

  // Group notifications into sections
  const sections = notifications.reduce<Record<NotificationGroup, Notification[]>>(
    (acc, n) => {
      acc[n.group].push(n);
      return acc;
    },
    { new: [], today: [], earlier: [] },
  );

  const hasContent = notifications.length > 0;
  const groups: NotificationGroup[] = ['new', 'today', 'earlier'];

  return (
    <div className="relative flex items-center">
      {/* Trigger button */}
      <button
        onClick={handleToggle}
        aria-label={`Notifications${unreadCount > 0 ? `, ${unreadCount} unread` : ''}`}
        aria-expanded={isOpen}
        className={`flex items-center gap-2 px-3 py-1.5 rounded-full border transition-all duration-200 cursor-pointer ${
          isOpen
            ? 'bg-[var(--surface3)] border-[var(--border2)] text-[var(--text)] shadow-sm'
            : unreadCount > 0
              ? 'bg-[var(--accent-dim)] border-[var(--accent-border)] text-[var(--accent)]'
              : 'bg-[var(--surface2)] border-[var(--border2)] text-[var(--text-dim)] hover:text-[var(--text)]'
        }`}
      >
        <Bell size={14} className="shrink-0" />
        <span className="hidden sm:inline text-[12px] font-medium whitespace-nowrap">
          Notifications
        </span>
        {unreadCount > 0 && (
          <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] rounded-full bg-[var(--accent)] text-white text-[10px] font-semibold px-1.5 leading-none">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {/* Panel */}
      <AnimatePresence>
        {isOpen && (
          <>
            {/* Backdrop */}
            <div className="fixed inset-0 z-20" onClick={() => setIsOpen(false)} />

            <motion.div
              initial={{ opacity: 0, y: 10, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.95 }}
              transition={{ duration: 0.15, ease: 'easeOut' }}
              className="absolute right-0 top-[40px] z-30 w-[420px] max-h-[580px] flex flex-col rounded-[12px] bg-[var(--surface)] border border-[var(--border)] shadow-2xl overflow-hidden"
            >
              {/* Header */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)] bg-[var(--surface2)] shrink-0">
                <span className="text-[13px] font-semibold text-[var(--text)]">Notifications</span>
                {unreadCount > 0 && (
                  <button
                    onClick={onMarkAllRead}
                    className="text-[11px] font-medium text-[var(--accent)] hover:underline cursor-pointer"
                  >
                    Mark all read
                  </button>
                )}
              </div>

              {/* Content */}
              <div className="flex-1 overflow-y-auto min-h-0 custom-scrollbar">
                {briefingLoading && !hasContent ? (
                  <div className="p-4">
                    <EmptyState
                      icon={Loader2}
                      title="Loading notifications…"
                      description="Fetching your latest items."
                      size="sm"
                    />
                  </div>
                ) : !hasContent ? (
                  <div className="p-4">
                    <EmptyState
                      icon={CheckCircle2}
                      title="You're all caught up"
                      description="No pending items right now."
                      size="sm"
                    />
                  </div>
                ) : (
                  <>
                    {groups.map((group) => {
                      const items = sections[group];
                      if (items.length === 0) return null;
                      return (
                        <div key={group}>
                          <SectionLabel group={group} />
                          <div className="p-3 space-y-2">
                            {items.map((n) => (
                              <NotificationRow
                                key={n.id}
                                notification={n}
                                onOpen={(notif) => {
                                  onOpen(notif);
                                  // Keep panel open to allow multi-item triage
                                }}
                                onDismiss={onDismiss}
                                onMarkRead={onMarkRead}
                              />
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </>
                )}
              </div>

              {/* Footer */}
              <div className="border-t border-[var(--border)] bg-[var(--surface2)] px-3 py-2 flex items-center justify-between shrink-0">
                <div className="text-[10px] text-[var(--text-faint)] flex items-center gap-1">
                  <Info size={10} />
                  Dismiss removes items from this list only.
                </div>
                <button
                  onClick={() => setIsOpen(false)}
                  className="text-[10px] font-medium text-[var(--text-dim)] hover:text-[var(--text)] cursor-pointer"
                >
                  Close
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
