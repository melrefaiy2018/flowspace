/**
 * Conversation summarization module.
 *
 * Generates, stores, and retrieves plain-text summaries of long conversations.
 * Summaries are used to replace older messages in the context window, preserving
 * conversation continuity without the token cost of full message history.
 *
 * Storage: DATA_DIR/.conversation-summaries.{userHash}.json
 */

import fs from 'fs';
import path from 'path';
import { getDataDir } from '../lib/data-dir.js';
import { createLLMClient } from './llm-client.js';
import type { ChatMessage } from './llm-types.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SummarySections {
  objective?: string;
  decisions?: string[];
  resources?: string[];
  openQuestions?: string[];
  currentState?: string;
}

export interface ConversationSummary {
  conversationId: string;
  version: number;
  updatedAt: number;
  messageCountAtLastSummary: number;
  summaryText: string;
  sections?: SummarySections;
}

export interface ConversationSummaryStore {
  version: 1;
  summaries: Record<string, ConversationSummary>;
}

// ── Constants ────────────────────────────────────────────────────────────────

/** Minimum conversation token count before summarization is triggered. */
export const SUMMARY_TOKEN_THRESHOLD = 30_000;

/** Minimum new messages since last summary before an update is triggered. */
export const SUMMARY_UPDATE_INTERVAL = 10;

/** Maximum characters for summaryText (hard cap). */
const SUMMARY_TEXT_MAX_CHARS = 2000;

// ── File path helpers ─────────────────────────────────────────────────────────

function getSummaryStorePath(userHash: string): string {
  return path.join(getDataDir(), `.conversation-summaries.${userHash}.json`);
}

// ── Store CRUD ────────────────────────────────────────────────────────────────

/**
 * Load the summary store for a user.
 * Returns an empty store if the file is missing or the version doesn't match.
 */
export function loadSummaryStore(userHash: string): ConversationSummaryStore {
  const filePath = getSummaryStorePath(userHash);
  if (!fs.existsSync(filePath)) {
    return { version: 1, summaries: {} };
  }

  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as unknown;
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      (parsed as { version?: unknown }).version === 1 &&
      typeof (parsed as { summaries?: unknown }).summaries === 'object'
    ) {
      return parsed as ConversationSummaryStore;
    }
    // Version mismatch or unexpected shape — return empty
    return { version: 1, summaries: {} };
  } catch {
    return { version: 1, summaries: {} };
  }
}

/**
 * Persist the summary store using an atomic write (temp file + rename).
 */
export function saveSummaryStore(userHash: string, store: ConversationSummaryStore): void {
  const filePath = getSummaryStorePath(userHash);
  const tmpPath = filePath + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(store, null, 2), 'utf-8');
  fs.renameSync(tmpPath, filePath);
}

/**
 * Retrieve a single conversation summary by conversationId.
 * Returns undefined if not found.
 */
export function getSummary(userHash: string, conversationId: string): ConversationSummary | undefined {
  const store = loadSummaryStore(userHash);
  return store.summaries[conversationId];
}

/**
 * Upsert a conversation summary into the store.
 */
export function saveSummary(userHash: string, summary: ConversationSummary): void {
  const store = loadSummaryStore(userHash);
  const updatedStore: ConversationSummaryStore = {
    ...store,
    summaries: {
      ...store.summaries,
      [summary.conversationId]: summary,
    },
  };
  saveSummaryStore(userHash, updatedStore);
}

// ── Trigger logic ─────────────────────────────────────────────────────────────

/**
 * Determine whether a summary should be generated or updated.
 *
 * Returns true when:
 *   - conversationTokens > SUMMARY_TOKEN_THRESHOLD, AND
 *   - either no summary exists, OR >= SUMMARY_UPDATE_INTERVAL new messages since last summary.
 */
export function shouldGenerateSummary(
  conversationTokens: number,
  existingSummary: ConversationSummary | undefined,
  currentMessageCount: number,
): boolean {
  if (conversationTokens <= SUMMARY_TOKEN_THRESHOLD) {
    return false;
  }

  if (!existingSummary) {
    return true;
  }

  const messagesSinceLastSummary = currentMessageCount - existingSummary.messageCountAtLastSummary;
  return messagesSinceLastSummary >= SUMMARY_UPDATE_INTERVAL;
}

// ── Prompt helpers ────────────────────────────────────────────────────────────

/**
 * Format a list of messages for inclusion in a summarization prompt.
 * Skips system and tool messages. Truncates each message to 500 characters.
 */
export function formatMessagesForSummary(messages: ChatMessage[]): string {
  return messages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => {
      const content = typeof m.content === 'string' ? m.content : '';
      const truncated = content.length > 500 ? content.slice(0, 500) + '...' : content;
      const label = m.role === 'user' ? 'User' : 'Assistant';
      return `${label}: ${truncated}`;
    })
    .join('\n');
}

function buildFirstGenerationPrompt(messages: ChatMessage[]): string {
  const formatted = formatMessagesForSummary(messages);
  return `Summarize this conversation concisely. Capture:
- The user's main objective
- Key decisions made
- Important resources or documents mentioned
- Any unresolved questions
- The current state of the work

Keep the summary under 500 words. Write in third person ("The user...").

Conversation:
${formatted}`;
}

function buildIncrementalUpdatePrompt(
  previousSummary: string,
  newMessages: ChatMessage[],
): string {
  const formatted = formatMessagesForSummary(newMessages);
  return `Here is the current summary of this conversation:
${previousSummary}

The following new messages have been exchanged since the summary was last updated:
${formatted}

Update the summary to incorporate the new messages. Preserve all important decisions, objectives, and context from the existing summary. Add any new decisions, context, or state changes from the new messages. Keep the summary under 500 words. Write in third person.`;
}

// ── Generation ────────────────────────────────────────────────────────────────

/**
 * Generate or update a conversation summary using the configured LLM provider.
 *
 * - If no existing summary: builds a full-history prompt.
 * - If existing summary: builds an incremental prompt (previous summary + new messages only).
 *
 * Returns null on any error (LLM failure, empty response, etc.).
 * summaryText is capped at 2000 characters.
 */
export async function generateSummary(
  messages: ChatMessage[],
  existingSummary: ConversationSummary | undefined,
  conversationId: string,
): Promise<ConversationSummary | null> {
  try {
    const client = createLLMClient();

    let promptContent: string;

    if (!existingSummary) {
      promptContent = buildFirstGenerationPrompt(messages);
    } else {
      const newMessages = messages.slice(existingSummary.messageCountAtLastSummary);
      promptContent = buildIncrementalUpdatePrompt(existingSummary.summaryText, newMessages);
    }

    const completionMessages: ChatMessage[] = [
      { role: 'user', content: promptContent },
    ];

    const response = await client.complete(completionMessages);
    const rawText = response.choices[0]?.message?.content;

    if (!rawText || rawText.trim().length === 0) {
      return null;
    }

    const summaryText =
      rawText.length > SUMMARY_TEXT_MAX_CHARS
        ? rawText.slice(0, SUMMARY_TEXT_MAX_CHARS)
        : rawText;

    const newVersion = existingSummary ? existingSummary.version + 1 : 1;

    return {
      conversationId,
      version: newVersion,
      updatedAt: Date.now(),
      messageCountAtLastSummary: messages.length,
      summaryText,
    };
  } catch (err) {
    console.warn('[summary] generateSummary failed:', err);
    return null;
  }
}
