export type TaskStatus = 'overdue' | 'due_today' | 'upcoming' | 'no_due_date' | 'completed';
export type TaskSource = 'flowspace_followup' | 'flowspace_task' | 'google_task';

export interface FlowSpaceTaskMetadata {
  source?: 'flowspace-followup' | 'flowspace-task';
  thread_id?: string;
  recipient?: string;
  subject?: string;
  confidence?: 'high' | 'medium';
  created_at?: string;
  user_notes?: string;
}

export interface GoogleTaskLike {
  id?: string | null;
  title?: string | null;
  notes?: string | null;
  due?: string | null;
  completed?: string | null;
  status?: string | null;
  selfLink?: string | null;
}

export interface NormalizedTask {
  id: string;
  title: string;
  notes: string;
  due: string | null;
  completedAt: string | null;
  status: TaskStatus;
  taskListId: string;
  taskListTitle: string;
  source: TaskSource;
  threadId?: string;
  recipient?: string;
  subject?: string;
  selfLink?: string;
  daysOverdue?: number;
}

const FLOWSPACE_METADATA_LABEL = 'FlowSpace metadata:';
const ISO_DATE_PREFIX = /^(\d{4})-(\d{2})-(\d{2})/;

function safeJsonParse(input: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(input);
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

export function buildFlowSpaceTaskNotes(userNotes?: string, metadata: FlowSpaceTaskMetadata = {}): string {
  const notes = userNotes?.trim() ?? '';
  const payload = JSON.stringify({
    source: 'flowspace-task',
    created_at: new Date().toISOString(),
    user_notes: notes || undefined,
    ...metadata,
  });

  if (!notes) return `${FLOWSPACE_METADATA_LABEL} ${payload}`;
  return `${notes}\n\n---\n${FLOWSPACE_METADATA_LABEL} ${payload}`;
}

export function parseTaskNotes(rawNotes?: string | null): { displayNotes: string; metadata: FlowSpaceTaskMetadata | null } {
  const notes = rawNotes?.trim() ?? '';
  if (!notes) return { displayNotes: '', metadata: null };

  const wholeJson = safeJsonParse(notes);
  if (wholeJson) {
    return {
      displayNotes: typeof wholeJson.user_notes === 'string' ? wholeJson.user_notes : '',
      metadata: wholeJson as FlowSpaceTaskMetadata,
    };
  }

  const markerIndex = notes.lastIndexOf(FLOWSPACE_METADATA_LABEL);
  if (markerIndex === -1) return { displayNotes: notes, metadata: null };

  const jsonSlice = notes.slice(markerIndex + FLOWSPACE_METADATA_LABEL.length).trim();
  const metadata = safeJsonParse(jsonSlice) as FlowSpaceTaskMetadata | null;
  const displayNotes = notes.slice(0, markerIndex).replace(/\n*---\n*$/, '').trim();

  return {
    displayNotes: metadata?.user_notes && !displayNotes ? metadata.user_notes : displayNotes,
    metadata,
  };
}

function localDateStamp(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseDueDateOnly(rawDue?: string | null): { stamp: string; utcMs: number } | null {
  if (!rawDue) return null;
  const match = rawDue.match(ISO_DATE_PREFIX);
  if (!match) return null;

  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const day = Number(match[3]);
  const utcMs = Date.UTC(year, monthIndex, day);
  if (Number.isNaN(utcMs)) return null;

  return {
    stamp: `${match[1]}-${match[2]}-${match[3]}`,
    utcMs,
  };
}

export function formatTaskDueDate(rawDue?: string | null, locale = 'en-US'): string {
  const dueDate = parseDueDateOnly(rawDue);
  if (!dueDate) return 'No due date';
  return new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
    weekday: 'short',
    timeZone: 'UTC',
  }).format(new Date(dueDate.utcMs));
}

export function classifyTaskStatus(task: Pick<GoogleTaskLike, 'due' | 'completed' | 'status'>, now = new Date()): { status: TaskStatus; daysOverdue?: number } {
  if (task.status === 'completed' || task.completed) {
    return { status: 'completed' };
  }

  const dueDate = parseDueDateOnly(task.due);
  if (!dueDate) {
    return { status: 'no_due_date' };
  }

  const todayStamp = localDateStamp(now);
  const todayParts = parseDueDateOnly(todayStamp);
  if (!todayParts) return { status: 'no_due_date' };

  if (dueDate.stamp < todayStamp) {
    return {
      status: 'overdue',
      daysOverdue: Math.round((todayParts.utcMs - dueDate.utcMs) / 86400000),
    };
  }

  if (dueDate.stamp === todayStamp) {
    return { status: 'due_today' };
  }

  return { status: 'upcoming' };
}

export function normalizeGoogleTask(
  task: GoogleTaskLike,
  options: { taskListId: string; taskListTitle: string; now?: Date }
): NormalizedTask {
  const { displayNotes, metadata } = parseTaskNotes(task.notes);
  const { status, daysOverdue } = classifyTaskStatus(task, options.now);
  const source: TaskSource = metadata?.source === 'flowspace-followup'
    ? 'flowspace_followup'
    : metadata?.source === 'flowspace-task'
      ? 'flowspace_task'
      : 'google_task';

  return {
    id: String(task.id ?? ''),
    title: String(task.title ?? 'Untitled task'),
    notes: displayNotes,
    due: task.due ?? null,
    completedAt: task.completed ?? null,
    status,
    taskListId: options.taskListId,
    taskListTitle: options.taskListTitle,
    source,
    threadId: typeof metadata?.thread_id === 'string' ? metadata.thread_id : undefined,
    recipient: typeof metadata?.recipient === 'string' ? metadata.recipient : undefined,
    subject: typeof metadata?.subject === 'string' ? metadata.subject : undefined,
    selfLink: task.selfLink ?? undefined,
    daysOverdue,
  };
}

export function sortTasks(tasks: NormalizedTask[]): NormalizedTask[] {
  const rank: Record<TaskStatus, number> = {
    overdue: 0,
    due_today: 1,
    upcoming: 2,
    no_due_date: 3,
    completed: 4,
  };

  return [...tasks].sort((a, b) => {
    if (rank[a.status] !== rank[b.status]) return rank[a.status] - rank[b.status];

    if (a.status === 'upcoming' && a.due && b.due) {
      const aDue = parseDueDateOnly(a.due)?.utcMs ?? Number.MAX_SAFE_INTEGER;
      const bDue = parseDueDateOnly(b.due)?.utcMs ?? Number.MAX_SAFE_INTEGER;
      return aDue - bDue;
    }

    if (a.status === 'completed' && a.completedAt && b.completedAt) {
      return new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime();
    }

    return a.title.localeCompare(b.title);
  });
}
