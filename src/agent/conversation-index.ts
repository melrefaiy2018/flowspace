/**
 * Server-side conversation index.
 *
 * Metadata-only store keyed by conversationId. Never stores message content.
 * File: DATA_DIR/.conversations.{userHash}.json
 *
 * Design principles:
 * - The index is a derived projection. The frontend remains authoritative.
 * - First value wins: existing title and eventId are never overwritten.
 * - threadBrief is capped at 500 chars.
 * - Atomic write: temp file + rename.
 */

import fs from 'fs';
import path from 'path';
import { getDataDir } from '../lib/data-dir.js';

// ── Types ────────────────────────────────────────────────────────────────────

export type ConversationOrigin = 'chat' | 'meeting_prep' | 'draft_discuss' | 'action_trigger';

export interface ConversationIndexEntry {
  id: string;
  lastMessageAt: number;
  messageCount: number;
  title?: string;
  eventId?: string;
  threadBrief?: string;
  createdAt?: number;
  origin?: ConversationOrigin;
}

export interface ConversationIndex {
  version: 1;
  entries: Record<string, ConversationIndexEntry>;
}

export interface ConversationUpdate {
  id: string;
  title?: string;
  eventId?: string;
  threadBrief?: string;
  origin?: ConversationOrigin;
}

// ── File path ─────────────────────────────────────────────────────────────────

function getIndexFilePath(userHash: string): string {
  return path.join(getDataDir(), `.conversations.${userHash}.json`);
}

// ── Load / Save ───────────────────────────────────────────────────────────────

export function loadConversationIndex(userHash: string): ConversationIndex {
  const filePath = getIndexFilePath(userHash);
  if (!fs.existsSync(filePath)) {
    return { version: 1, entries: {} };
  }
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (parsed?.version !== 1 || typeof parsed?.entries !== 'object' || parsed.entries === null) {
      return { version: 1, entries: {} };
    }
    return parsed as ConversationIndex;
  } catch {
    return { version: 1, entries: {} };
  }
}

export function saveConversationIndex(userHash: string, index: ConversationIndex): void {
  const filePath = getIndexFilePath(userHash);
  const tmpPath = filePath + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(index, null, 2), 'utf-8');
  fs.renameSync(tmpPath, filePath);
}

// ── Upsert ────────────────────────────────────────────────────────────────────

export function upsertConversation(userHash: string, update: ConversationUpdate): void {
  if (!update.id) return;

  const index = loadConversationIndex(userHash);
  const existing = index.entries[update.id];
  const now = Date.now();

  const truncatedBrief =
    typeof update.threadBrief === 'string'
      ? update.threadBrief.slice(0, 500)
      : undefined;

  let updatedEntry: ConversationIndexEntry;

  if (existing) {
    updatedEntry = {
      ...existing,
      lastMessageAt: now,
      messageCount: existing.messageCount + 1,
      // First value wins: only set title if entry has no title
      title: existing.title ?? (update.title || undefined),
      // First value wins: only set eventId if entry has no eventId
      eventId: existing.eventId ?? (update.eventId || undefined),
      // Always update threadBrief if provided (server uses latest for context)
      threadBrief: truncatedBrief !== undefined ? truncatedBrief : existing.threadBrief,
    };
  } else {
    updatedEntry = {
      id: update.id,
      createdAt: now,
      lastMessageAt: now,
      messageCount: 1,
      title: update.title || undefined,
      eventId: update.eventId || undefined,
      threadBrief: truncatedBrief,
      origin: update.origin,
    };
  }

  const updatedIndex: ConversationIndex = {
    ...index,
    entries: {
      ...index.entries,
      [update.id]: updatedEntry,
    },
  };

  saveConversationIndex(userHash, updatedIndex);
}

// ── Queries ────────────────────────────────────────────────────────────────────

/**
 * Returns true if any conversation linked to the given eventId has been
 * actively messaged (messageCount > 0).
 */
export function isEventAlreadyPrepped(userHash: string, eventId: string): boolean {
  const index = loadConversationIndex(userHash);
  return Object.values(index.entries).some(
    (entry) => entry.eventId === eventId && entry.messageCount > 0,
  );
}

/**
 * Look up the title of a conversation by its ID.
 * Returns undefined when the conversation is not in the index or has no title.
 */
export function getConversationTitle(userHash: string, conversationId: string): string | undefined {
  const index = loadConversationIndex(userHash);
  return index.entries[conversationId]?.title;
}
