import { describe, it, expect } from 'vitest';
import { computeDeterministicChips } from '../thread-brief-utils.js';
import type { GmailThreadDetail } from '../../services/api.js';

// ── Helpers ────────────────────────────────────────────────────────────────

const BASE_NOW = new Date('2026-04-11T14:00:00Z').getTime();

function makeThread(overrides: Partial<GmailThreadDetail> & { messages: GmailThreadDetail['messages'] }): GmailThreadDetail {
  return {
    id: 'thread-1',
    subject: 'Test subject',
    labelIds: ['INBOX'],
    ...overrides,
  };
}

function makeMessage(overrides: Partial<GmailThreadDetail['messages'][0]>): GmailThreadDetail['messages'][0] {
  return {
    id: 'msg-1',
    from: 'sender@example.com',
    to: '',
    cc: '',
    date: new Date(BASE_NOW - 30 * 60_000).toISOString(), // 30m ago
    body: 'Hello world',
    bodyType: 'text',
    attachments: [],
    ...overrides,
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('computeDeterministicChips', () => {
  it('single fresh message (minutes ago) → last_message_age chip + new_thread chip', () => {
    const msgDate = new Date(BASE_NOW - 45 * 60_000).toISOString(); // 45m ago
    const thread = makeThread({
      messages: [makeMessage({ date: msgDate })],
    });

    const chips = computeDeterministicChips(thread, BASE_NOW);

    const ageChip = chips.find((c) => c.kind === 'last_message_age');
    expect(ageChip).toBeDefined();
    expect(ageChip?.label).toBe('Last message 45m ago');

    const threadChip = chips.find((c) => c.kind === 'thread_age');
    expect(threadChip).toBeDefined();
    expect(threadChip?.label).toBe('New thread');
  });

  it('multi-message old thread → both age chips with larger units (hours/days)', () => {
    const firstMsgDate = new Date(BASE_NOW - 11 * 24 * 3600_000).toISOString(); // 11 days ago
    const lastMsgDate = new Date(BASE_NOW - 3 * 3600_000).toISOString(); // 3h ago

    const thread = makeThread({
      messages: [
        makeMessage({ date: firstMsgDate }),
        makeMessage({ id: 'msg-2', date: lastMsgDate }),
      ],
    });

    const chips = computeDeterministicChips(thread, BASE_NOW);

    const ageChip = chips.find((c) => c.kind === 'last_message_age');
    expect(ageChip?.label).toBe('Last message 3h ago');

    const threadChip = chips.find((c) => c.kind === 'thread_age');
    expect(threadChip?.label).toBe('Thread active 11 days');
  });

  it('only internal participants → no participants chip', () => {
    const thread = makeThread({
      messages: [
        makeMessage({ from: 'alice@example.com', to: '', cc: '' }),
        makeMessage({ id: 'msg-2', from: 'alice@example.com', to: '', cc: '' }),
      ],
    });

    const chips = computeDeterministicChips(thread, BASE_NOW);
    const participantChip = chips.find((c) => c.kind === 'participants');
    expect(participantChip).toBeUndefined();
  });

  it('many external participants → participants chip with count', () => {
    const thread = makeThread({
      messages: [
        makeMessage({
          from: 'me@company.com',
          to: 'alice@external.com, bob@partner.org, carol@vendor.io',
          cc: 'dave@client.com',
        }),
      ],
    });

    const chips = computeDeterministicChips(thread, BASE_NOW);
    const participantChip = chips.find((c) => c.kind === 'participants');
    expect(participantChip).toBeDefined();
    expect(participantChip?.label).toMatch(/\d+ external participant/);
    const countMatch = participantChip?.label.match(/^(\d+)/);
    expect(Number(countMatch?.[1])).toBeGreaterThan(1);
  });

  it('boundary conditions: exactly 1 day old, exactly 1 hour old, 0 minutes', () => {
    const exactlyOneDay = new Date(BASE_NOW - 24 * 3600_000).toISOString();
    const exactlyOneHour = new Date(BASE_NOW - 3600_000).toISOString();
    const justNow = new Date(BASE_NOW).toISOString();

    const dayThread = makeThread({ messages: [makeMessage({ date: exactlyOneDay })] });
    const hourThread = makeThread({ messages: [makeMessage({ date: exactlyOneHour })] });
    const nowThread = makeThread({ messages: [makeMessage({ date: justNow })] });

    const dayChips = computeDeterministicChips(dayThread, BASE_NOW);
    const hourChips = computeDeterministicChips(hourThread, BASE_NOW);
    const nowChips = computeDeterministicChips(nowThread, BASE_NOW);

    // Exactly 1 day old → last_message_age shows "1d ago"
    expect(dayChips.find((c) => c.kind === 'last_message_age')?.label).toBe('Last message 1d ago');
    // Single-message thread exactly 1 day old → NOT "New thread" (>= 1d threshold)
    // In our implementation < 1 day = "New thread"; >= 1 day = no thread_age chip for single-msg threads
    // Actually for single msg: if ageMs >= MS_PER_DAY, no thread_age chip is emitted
    expect(dayChips.find((c) => c.kind === 'thread_age')).toBeUndefined();

    // Exactly 1 hour → shows "1h ago"
    expect(hourChips.find((c) => c.kind === 'last_message_age')?.label).toBe('Last message 1h ago');

    // Just now (0ms age) → shows "0m ago"
    expect(nowChips.find((c) => c.kind === 'last_message_age')?.label).toBe('Last message 0m ago');
  });

  it('never returns more than 4 chips even with many participants', () => {
    // Create a thread with many external participants to potentially trigger many chips
    const manyRecipients = Array.from({ length: 20 }, (_, i) => `user${i}@external.com`).join(', ');

    const firstDate = new Date(BASE_NOW - 5 * 24 * 3600_000).toISOString();
    const lastDate = new Date(BASE_NOW - 3600_000).toISOString();

    const thread = makeThread({
      messages: [
        makeMessage({ date: firstDate, to: manyRecipients }),
        makeMessage({ id: 'msg-2', date: lastDate, to: manyRecipients }),
      ],
    });

    const chips = computeDeterministicChips(thread, BASE_NOW);
    expect(chips.length).toBeLessThanOrEqual(4);
  });
});
