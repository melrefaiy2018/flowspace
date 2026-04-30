import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import type { Briefing } from '../services/api';
import type { StagedDraft } from '../agent/draft-types';
import type { ApprovalRequest } from '../shared/chat';
import type { ActiveView } from '../context/ChatContext';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type NotificationType =
  | 'email'
  | 'meeting_prep'
  | 'approval_request'
  | 'task_suggestion'
  | 'document_update'
  | 'draft_queue_item';

export type NotificationGroup = 'new' | 'today' | 'earlier';

export type NotificationNavigationTarget =
  | { kind: 'gmail_thread'; threadId: string }
  | { kind: 'app_view'; view: ActiveView }
  | { kind: 'chat_approval'; messageId: string; conversationId: string }
  | { kind: 'draft_queue'; draftId: string };

export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  summary: string;
  sourceBadge: string;
  timestamp: number;
  isRead: boolean;
  group: NotificationGroup;
  navigationTarget: NotificationNavigationTarget;
}

export interface PendingApproval {
  conversationId: string;
  messageId: string;
  title: string;
  approval: ApprovalRequest;
}

export interface UseNotificationsReturn {
  notifications: Notification[];
  unreadCount: number;
  markRead: (id: string) => void;
  markAllRead: () => void;
  dismiss: (id: string) => void;
  clearAll: () => void;
}

// ---------------------------------------------------------------------------
// localStorage helpers (account-scoped)
// ---------------------------------------------------------------------------

function readIdsKey(accountKey?: string) {
  return accountKey ? `flowspace:notif-read:${accountKey}` : 'flowspace:notif-read';
}

function dismissedIdsKey(accountKey?: string) {
  return accountKey ? `flowspace:notif-dismissed:${accountKey}` : 'flowspace:notif-dismissed';
}

function loadSet(key: string): Set<string> {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as string[];
    return new Set(arr);
  } catch {
    return new Set();
  }
}

function persistSet(key: string, set: Set<string>): void {
  try {
    localStorage.setItem(key, JSON.stringify(Array.from(set)));
  } catch {
    // localStorage may be unavailable in some environments; fail silently
  }
}

// ---------------------------------------------------------------------------
// Stable subject hash (no crypto, no external dep)
// ---------------------------------------------------------------------------

function subjectHash(subject: string): string {
  // Simple deterministic hash for display-string subjects with no thread_id
  let h = 0;
  for (let i = 0; i < subject.length; i++) {
    h = (h * 31 + subject.charCodeAt(i)) >>> 0;
  }
  return h.toString(36);
}

// ---------------------------------------------------------------------------
// Today boundary check
// ---------------------------------------------------------------------------

function isToday(ts: number): boolean {
  const d = new Date(ts);
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useNotifications({
  briefing,
  pendingApprovals,
  drafts,
  accountKey,
}: {
  briefing: Briefing | null;
  pendingApprovals: PendingApproval[];
  drafts: StagedDraft[];
  accountKey?: string;
}): UseNotificationsReturn {
  const rKey = readIdsKey(accountKey);
  const dKey = dismissedIdsKey(accountKey);

  const [readIds, setReadIds] = useState<Set<string>>(() => loadSet(rKey));
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(() => loadSet(dKey));

  // Reload sets when accountKey changes (user switched accounts)
  useEffect(() => {
    setReadIds(loadSet(readIdsKey(accountKey)));
    setDismissedIds(loadSet(dismissedIdsKey(accountKey)));
  }, [accountKey]);

  // Stable timestamp for briefing items that have no real timestamp
  const briefingLoadedAt = useRef<number>(0);
  useEffect(() => {
    if (briefing && briefingLoadedAt.current === 0) {
      briefingLoadedAt.current = Date.now();
    }
  }, [briefing]);

  // ---------------------------------------------------------------------------
  // Aggregation
  // ---------------------------------------------------------------------------
  const notifications = useMemo<Notification[]>(() => {
    const base = briefingLoadedAt.current || Date.now();
    const raw: Omit<Notification, 'isRead' | 'group'>[] = [];

    // ---- email: needs_reply ------------------------------------------------
    const needsReply = briefing?.inbox_triage?.needs_reply ?? [];
    needsReply.forEach((item, i) => {
      const key = item.thread_id ?? subjectHash(item.subject);
      raw.push({
        id: `notif:email:reply:${key}`,
        type: 'email',
        title: item.subject,
        summary: item.summary ?? item.reason ?? `Reply needed from ${item.sender}`,
        sourceBadge: 'Gmail',
        timestamp: base - i * 30_000,
        navigationTarget: item.thread_id
          ? { kind: 'gmail_thread', threadId: item.thread_id }
          : { kind: 'app_view', view: 'mail' },
      });
    });

    // ---- email: needs_input ------------------------------------------------
    const needsInput = briefing?.inbox_triage?.needs_input ?? [];
    needsInput.forEach((item, i) => {
      const key = item.thread_id ?? subjectHash(item.subject);
      raw.push({
        id: `notif:email:input:${key}`,
        type: 'email',
        title: item.subject,
        summary: item.summary ?? item.reason ?? 'Needs your input',
        sourceBadge: 'Gmail',
        timestamp: base - (needsReply.length + i) * 30_000,
        navigationTarget: item.thread_id
          ? { kind: 'gmail_thread', threadId: item.thread_id }
          : { kind: 'app_view', view: 'mail' },
      });
    });

    // ---- meeting_prep ------------------------------------------------------
    const dayEvents = briefing?.day_at_a_glance ?? [];
    dayEvents
      .filter((e) => e.priority_group === 'needs_prep')
      .forEach((item, i) => {
        const parsed = Date.parse(item.time);
        const ts = Number.isFinite(parsed) ? parsed : base - i * 60_000;
        raw.push({
          id: `notif:meetingprep:${item.event_id}`,
          type: 'meeting_prep',
          title: item.title,
          summary: item.prep_note ?? 'Prep materials ready for this meeting',
          sourceBadge: 'Calendar',
          timestamp: ts,
          navigationTarget: { kind: 'app_view', view: 'calendar' },
        });
      });

    // ---- document_update (attention items of type drive_file) -------------
    const attentionItems = briefing?.attention_items ?? [];
    attentionItems
      .filter((a) => a.type === 'drive_file')
      .forEach((item, i) => {
        raw.push({
          id: `notif:docupdate:${item.action_context}`,
          type: 'document_update',
          title: item.title,
          summary: item.description,
          sourceBadge: 'Drive',
          timestamp: base - i * 45_000,
          navigationTarget: { kind: 'app_view', view: 'dashboard' },
        });
      });

    // ---- task_suggestion (followups) ----------------------------------------
    const followups = briefing?.followups ?? [];
    followups.forEach((item, i) => {
      const parsed = item.due ? Date.parse(item.due) : NaN;
      const ts = Number.isFinite(parsed) ? parsed : base - i * 60_000;
      const daysLabel =
        item.status === 'overdue' && item.days_overdue != null
          ? `Overdue ${item.days_overdue}d`
          : item.due;
      raw.push({
        id: `notif:followup:${item.task_id}`,
        type: 'task_suggestion',
        title: item.title,
        summary: `${daysLabel} · ${item.commitment.slice(0, 80)}`,
        sourceBadge: 'Tasks',
        timestamp: ts,
        navigationTarget: item.thread_id
          ? { kind: 'gmail_thread', threadId: item.thread_id }
          : { kind: 'app_view', view: 'tasks' },
      });
    });

    // ---- approval_request --------------------------------------------------
    pendingApprovals.forEach((item) => {
      raw.push({
        id: `notif:approval:${item.messageId}`,
        type: 'approval_request',
        title: item.approval.title,
        summary: item.approval.summary,
        sourceBadge: 'Agent',
        timestamp: Date.now(),
        navigationTarget: {
          kind: 'chat_approval',
          messageId: item.messageId,
          conversationId: item.conversationId,
        },
      });
    });

    // ---- draft_queue_item --------------------------------------------------
    drafts
      .filter((d) => d.status === 'pending')
      .forEach((draft) => {
        const attendeeStr =
          draft.attendees.slice(0, 2).join(', ') +
          (draft.attendees.length > 2 ? '…' : '');
        raw.push({
          id: `notif:draft:${draft.id}`,
          type: 'draft_queue_item',
          title: `Meeting prep ready: ${draft.meetingTitle}`,
          summary: attendeeStr || 'Meeting brief ready for review',
          sourceBadge: 'Agent',
          timestamp: Date.parse(draft.createdAt),
          navigationTarget: { kind: 'draft_queue', draftId: draft.id },
        });
      });

    // ---- filter dismissed, assign isRead + group, sort --------------------
    const result: Notification[] = raw
      .filter((n) => !dismissedIds.has(n.id))
      .map((n) => {
        const isRead = readIds.has(n.id);
        let group: NotificationGroup;
        if (n.type === 'approval_request') {
          group = 'new';
        } else if (!isRead) {
          group = 'new';
        } else if (isToday(n.timestamp)) {
          group = 'today';
        } else {
          group = 'earlier';
        }
        return { ...n, isRead, group };
      });

    // Sort: new first, approvals top within new, then descending timestamp
    result.sort((a, b) => {
      const groupOrder = { new: 0, today: 1, earlier: 2 };
      if (a.group !== b.group) return groupOrder[a.group] - groupOrder[b.group];
      // Within 'new': approvals always first
      if (a.group === 'new' && b.group === 'new') {
        const aApproval = a.type === 'approval_request' ? 0 : 1;
        const bApproval = b.type === 'approval_request' ? 0 : 1;
        if (aApproval !== bApproval) return aApproval - bApproval;
      }
      return b.timestamp - a.timestamp;
    });

    return result;
  }, [briefing, pendingApprovals, drafts, readIds, dismissedIds]);

  const unreadCount = useMemo(
    () => notifications.filter((n) => !n.isRead).length,
    [notifications],
  );

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  const markRead = useCallback(
    (id: string) => {
      setReadIds((prev) => {
        if (prev.has(id)) return prev;
        const next = new Set(prev);
        next.add(id);
        persistSet(rKey, next);
        return next;
      });
    },
    [rKey],
  );

  const markAllRead = useCallback(() => {
    setReadIds((prev) => {
      const next = new Set(prev);
      notifications.forEach((n) => next.add(n.id));
      persistSet(rKey, next);
      return next;
    });
  }, [notifications, rKey]);

  const dismiss = useCallback(
    (id: string) => {
      // Mark dismissed (removes from list) AND read (drops unread count)
      setDismissedIds((prev) => {
        if (prev.has(id)) return prev;
        const next = new Set(prev);
        next.add(id);
        persistSet(dKey, next);
        return next;
      });
      setReadIds((prev) => {
        if (prev.has(id)) return prev;
        const next = new Set(prev);
        next.add(id);
        persistSet(rKey, next);
        return next;
      });
    },
    [dKey, rKey],
  );

  const clearAll = useCallback(() => {
    setDismissedIds(new Set());
    setReadIds(new Set());
    try {
      localStorage.removeItem(rKey);
      localStorage.removeItem(dKey);
    } catch {
      // ignore
    }
  }, [rKey, dKey]);

  return { notifications, unreadCount, markRead, markAllRead, dismiss, clearAll };
}
