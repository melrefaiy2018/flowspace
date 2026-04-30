/**
 * Horizon Scanner — proactive meeting prep for the next 48 hours.
 *
 * Scans the calendar, gathers email/Drive context per meeting,
 * generates LLM briefs, and returns StagedDraft[].
 */

import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import { executeTool } from './tools.js';
import { createLLMClient } from './llm-client.js';
import type { StagedDraft, ScanResult, ScanMeta, ScanError } from './draft-types.js';
import { mergeMemory, setMemoryFileIO, isMemoryInitialized, loadMemories, beginBatch, flushBatch } from './memory/memory-store.js';
import { extractTagsFromText } from './memory/memory-extractor.js';
import { getUserHash } from '../lib/user-hash.js';
import { getDataDir } from '../lib/data-dir.js';
import { isEventAlreadyPrepped } from './conversation-index.js';

// ── Tool guard ─────────────────────────────────────────────────────────────

/** Tools the scanner is permitted to call. Write tools are excluded. */
export const ALLOWED_SCANNER_TOOLS = new Set([
  'calendar_agenda',
  'search_drive',
  'search_emails',
  'docs_read',
]);

/**
 * Execute a tool only if it is in the scanner allowlist.
 * Throws for disallowed or unknown tools to prevent accidental writes.
 */
export async function guardedExecuteTool(
  toolName: string,
  args: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<string> {
  if (!ALLOWED_SCANNER_TOOLS.has(toolName)) {
    throw new Error(`Scanner: tool "${toolName}" is not in ALLOWED_SCANNER_TOOLS`);
  }
  return executeTool(toolName, args, signal);
}

// ── Meeting filter ──────────────────────────────────────────────────────────

interface RawCalendarEvent {
  id?: string;
  summary?: string;
  title?: string;
  start?: { dateTime?: string } | string;
  end?: { dateTime?: string } | string;
  attendees?: Array<{ email?: string; self?: boolean }>;
}

interface FilteredMeeting {
  id: string;
  title: string;
  startTime: string;
  endTime: string;
  externalAttendees: string[];
}

function parseDateTime(v: unknown): Date | null {
  if (!v) return null;
  const str = typeof v === 'object' ? (v as any).dateTime ?? '' : String(v);
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d;
}

function durationMinutes(start: Date, end: Date): number {
  return (end.getTime() - start.getTime()) / 60000;
}

function extractDomain(email: string): string {
  return email.split('@')[1]?.toLowerCase() ?? '';
}

/**
 * Given raw calendar JSON, return meetings that qualify for prep:
 *  - duration >= 30 min
 *  - >= 2 attendees who are not the self/organizer (anyone else in the meeting)
 *  - capped at 10
 *
 * selfDomain is used as a fallback when no attendee has self=true.
 */
export function filterMeetings(
  events: RawCalendarEvent[],
  selfDomain: string,
): FilteredMeeting[] {
  const results: FilteredMeeting[] = [];

  for (const ev of events) {
    if (results.length >= 10) break;

    const start = parseDateTime(ev.start);
    const end = parseDateTime(ev.end);
    if (!start || !end) continue;
    if (durationMinutes(start, end) < 30) continue;

    const attendees = Array.isArray(ev.attendees) ? ev.attendees : [];

    // Detect the owner's domain from the self=true attendee, fallback to selfDomain
    const selfAttendee = attendees.find((a) => a.self && a.email);
    const ownerDomain = selfAttendee
      ? extractDomain(selfAttendee.email!)
      : selfDomain.toLowerCase();

    // External = anyone who is not self AND has a different domain than owner
    const external = attendees
      .filter((a) => !a.self && a.email && extractDomain(a.email) !== ownerDomain)
      .map((a) => a.email as string);

    if (external.length < 2) continue;

    results.push({
      id: ev.id ?? `unknown-${start.toISOString()}`,
      title: ev.summary ?? ev.title ?? 'Untitled Meeting',
      startTime: start.toISOString(),
      endTime: end.toISOString(),
      externalAttendees: external,
    });
  }

  return results;
}

// ── Context gathering ───────────────────────────────────────────────────────

interface MeetingContext {
  emails: Array<{ subject: string; from: string; snippet: string }>;
  docs: Array<{ title: string; url: string }>;
}

async function gatherContext(
  meeting: FilteredMeeting,
  signal?: AbortSignal,
): Promise<MeetingContext> {
  const emailQuery = meeting.externalAttendees.slice(0, 3).join(' OR ');
  const driveQuery = meeting.title;

  const [emailRaw, driveRaw] = await Promise.allSettled([
    guardedExecuteTool('search_emails', { query: emailQuery, max_results: 10, days: 7 }, signal),
    guardedExecuteTool('search_drive', { query: driveQuery }, signal),
  ]);

  const emails: MeetingContext['emails'] = [];
  if (emailRaw.status === 'fulfilled' && !emailRaw.value.startsWith('Error:')) {
    try {
      const parsed = JSON.parse(emailRaw.value);
      const messages = parsed?.messages ?? [];
      for (const m of messages.slice(0, 5)) {
        emails.push({
          subject: String(m.subject ?? '(No subject)'),
          from: String(m.from ?? ''),
          snippet: String(m.snippet ?? ''),
        });
      }
    } catch { /* non-critical */ }
  }

  const docs: MeetingContext['docs'] = [];
  if (driveRaw.status === 'fulfilled' && !driveRaw.value.startsWith('Error:')) {
    try {
      const parsed = JSON.parse(driveRaw.value);
      const files = parsed?.files ?? parsed?.items ?? [];
      for (const f of files.slice(0, 5)) {
        docs.push({
          title: String(f.name ?? f.title ?? 'Untitled'),
          url: String(f.webViewLink ?? f.url ?? ''),
        });
      }
    } catch { /* non-critical */ }
  }

  return { emails, docs };
}

// ── LLM brief generation ────────────────────────────────────────────────────

function buildBriefPrompt(meeting: FilteredMeeting, ctx: MeetingContext): string {
  const attendeeList = meeting.externalAttendees.slice(0, 5).join(', ');

  const emailSection =
    ctx.emails.length > 0
      ? ctx.emails
          .map((e) => `- [${e.from}] ${e.subject}: ${e.snippet}`)
          .join('\n')
      : 'No recent emails found.';

  const docSection =
    ctx.docs.length > 0
      ? ctx.docs.map((d) => `- ${d.title}: ${d.url}`).join('\n')
      : 'No related Drive files found.';

  return `You are a meeting prep assistant. Generate a concise meeting brief (max 500 words, markdown).

Meeting: ${meeting.title}
Time: ${meeting.startTime}
External attendees: ${attendeeList}

Recent emails from attendees (last 7 days):
${emailSection}

Related Drive files:
${docSection}

Write a brief that covers:
1. What this meeting is likely about
2. Key context from recent email threads
3. Relevant documents to review
4. 2-3 suggested talking points or questions

Be specific and actionable. Do not pad with generic advice.`;
}

async function generateBrief(
  meeting: FilteredMeeting,
  ctx: MeetingContext,
): Promise<string> {
  const client = createLLMClient();
  const prompt = buildBriefPrompt(meeting, ctx);

  const response = await client.complete([
    { role: 'user', content: prompt },
  ], { temperature: 0.3 });

  const content = response.choices[0]?.message?.content ?? '';
  if (!content) throw new Error('LLM returned empty brief');
  return content;
}

// ── Scan orchestrator ───────────────────────────────────────────────────────

export interface CalendarEventRaw {
  id?: string;
  summary?: string;
  start?: { dateTime?: string; date?: string } | string;
  end?: { dateTime?: string; date?: string } | string;
  attendees?: Array<{ email?: string; self?: boolean }>;
}

export interface ScanOptions {
  /** The authenticated user's email domain (for external attendee detection). */
  selfDomain: string;
  signal?: AbortSignal;
  /** Optional injected calendar fetcher — bypasses gws when provided (e.g. direct Google API). */
  fetchCalendarEvents?: (timeMin: string, timeMax: string) => Promise<CalendarEventRaw[]>;
  /** When provided, draft context (linkedDocs + relatedEmails) is indexed into memory. */
  userEmail?: string;
}

/**
 * Run a full horizon scan:
 * 1. Fetch calendar for next 48h
 * 2. Filter qualifying meetings
 * 3. Gather email + Drive context per meeting
 * 4. Generate LLM brief per meeting
 * 5. Return ScanResult (drafts + metadata)
 *
 * Per-meeting failures are captured as ScanError and don't abort the scan.
 */
export async function runHorizonScan(options: ScanOptions): Promise<ScanResult> {
  const { selfDomain, signal, fetchCalendarEvents, userEmail } = options;
  const scannedAt = new Date().toISOString();
  const errors: ScanError[] = [];
  const drafts: StagedDraft[] = [];

  // Step 1: fetch calendar (48h window)
  const now = new Date();
  const timeMin = now.toISOString();
  const timeMax = new Date(now.getTime() + 48 * 60 * 60 * 1000).toISOString();

  let rawEvents: RawCalendarEvent[] = [];
  try {
    if (fetchCalendarEvents) {
      // Use injected fetcher (direct Google API with attendees)
      rawEvents = await fetchCalendarEvents(timeMin, timeMax);
    } else {
      // Fall back to gws calendar_agenda (no attendees — limited filtering)
      const endDateStr = timeMax.slice(0, 10);
      const raw = await guardedExecuteTool('calendar_agenda', { date: endDateStr }, signal);
      if (raw.startsWith('Error:')) throw new Error(raw.slice(7).trim());
      const parsed = JSON.parse(raw);
      rawEvents = parsed?.events ?? parsed?.items ?? (Array.isArray(parsed) ? parsed : []);
    }
  } catch (err: any) {
    return {
      drafts: [],
      meta: {
        scannedAt,
        meetingsFound: 0,
        meetingsPrepped: 0,
        errors: [{ meetingId: 'calendar', meetingTitle: 'Calendar fetch', error: err?.message ?? 'Unknown error' }],
      },
    };
  }

  // Step 2: filter
  const meetings = filterMeetings(rawEvents, selfDomain);
  const meetingsFound = meetings.length;

  // Compute userHash once for "already prepped?" checks
  const userHashForIndex = userEmail ? getUserHash(userEmail) : undefined;

  // Step 3+4: per-meeting context + brief
  for (const meeting of meetings) {
    if (signal?.aborted) break;

    // Skip meetings that have already been prepped in a prior conversation
    if (userHashForIndex && isEventAlreadyPrepped(userHashForIndex, meeting.id)) {
      console.log(`[horizon-scanner] Skipping already-prepped meeting: ${meeting.title}`);
      continue;
    }

    try {
      const ctx = await gatherContext(meeting, signal);
      const summary = await generateBrief(meeting, ctx);

      const draft: StagedDraft = {
        id: randomUUID(),
        meetingId: meeting.id,
        meetingTitle: meeting.title,
        meetingTime: meeting.startTime,
        attendees: meeting.externalAttendees,
        summary,
        linkedDocs: ctx.docs.map((d) => ({ title: d.title, url: d.url })),
        relatedEmails: ctx.emails.map((e) => ({ subject: e.subject, from: e.from, snippet: e.snippet })),
        suggestedActions: [],
        confidence: 1.0,
        confidenceReason: '',
        createdAt: new Date().toISOString(),
        status: 'pending',
      };

      drafts.push(draft);

      // Index draft context into memory when user is identified
      if (userEmail) {
        // Ensure memory store is initialized before calling mergeMemory
        if (!isMemoryInitialized()) {
          try {
            const userHash = getUserHash(userEmail);
            const memoryDir = path.join(getDataDir(), '.memory');
            if (!fs.existsSync(memoryDir)) {
              fs.mkdirSync(memoryDir, { recursive: true });
            }
            const memoryPath = path.join(memoryDir, `${userHash}.json`);
            setMemoryFileIO({
              exists: (p: string) => fs.existsSync(p),
              read: (p: string) => fs.readFileSync(p, 'utf-8'),
              write: (p: string, data: string) => fs.writeFileSync(p, data, 'utf-8'),
              rename: (oldP: string, newP: string) => fs.renameSync(oldP, newP),
              getFilePath: () => memoryPath,
            }, userHash);
            // Load existing entries so mergeMemory operates on the full cache,
            // not an empty array (which would overwrite on-disk data).
            loadMemories();
            console.log('[horizon-scanner] Memory initialized for user hash:', userHash);
          } catch (initErr) {
            console.warn('[horizon-scanner] Memory initialization failed:', initErr);
          }
        }

        if (isMemoryInitialized()) {
          try {
            // Batch all writes so the memory file is written once at the end,
            // not once per linked doc / related email.
            beginBatch();
            for (const doc of draft.linkedDocs) {
              mergeMemory({
                category: 'resource',
                content: doc.title,
                tags: [...extractTagsFromText(doc.title), 'meeting-prep', ...extractTagsFromText(meeting.title)],
                metadata: { url: doc.url, meetingId: meeting.id, meetingTitle: meeting.title },
                resourceIds: [doc.url],
                source: { type: 'auto_extraction', toolName: 'horizon_scanner' },
              });
            }
            for (const email of draft.relatedEmails) {
              mergeMemory({
                category: 'fact',
                content: `Email for meeting "${meeting.title}": ${email.subject}`,
                tags: [...extractTagsFromText(email.subject), 'meeting-prep', 'email'],
                metadata: { meetingId: meeting.id, meetingTitle: meeting.title, subject: email.subject, from: email.from },
                source: { type: 'auto_extraction', toolName: 'horizon_scanner' },
              });
            }
            flushBatch();
          } catch (memErr) {
            flushBatch(); // ensure batch mode is reset even on error
            console.warn('[horizon-scanner] Memory indexing failed:', memErr);
          }
        }
      }
    } catch (err: any) {
      errors.push({
        meetingId: meeting.id,
        meetingTitle: meeting.title,
        error: err?.message ?? 'Unknown error',
      });
    }
  }

  const meta: ScanMeta = {
    scannedAt,
    meetingsFound,
    meetingsPrepped: drafts.length,
    errors,
  };

  return { drafts, meta };
}
