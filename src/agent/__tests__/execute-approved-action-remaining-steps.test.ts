/**
 * TDD tests for executeApprovedAction — remaining steps interpolation
 *
 * User journey: As a workflow engine, after a write step is approved and
 * executed, I want remaining steps to receive their template args resolved
 * from the saved outputKey context (e.g. {{steps.credit_card_threads.thread_ids}})
 * so that downstream archive/mark-read steps operate on real thread IDs, not
 * literal template strings.
 *
 * Covers:
 *   1. Remaining read steps: template args are resolved via _outputKeys
 *   2. Remaining write steps: args are resolved before buildApprovalRequest
 *   3. _outputKeys is carried forward through chained approval toolArgs
 *   4. Graceful handling of missing or malformed _outputKeys
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock all external dependencies before importing the module under test
vi.mock('../tools.js', () => ({
  executeTool: vi.fn(),
  isWriteTool: vi.fn(),
  buildApprovalRequest: vi.fn(),
  buildBlocksFromToolResult: vi.fn().mockReturnValue([]),
}));

vi.mock('../memory/memory-store.js', () => ({
  setMemoryFileIO: vi.fn(),
  loadMemories: vi.fn(),
  getMemories: vi.fn().mockReturnValue([]),
  mergeMemory: vi.fn().mockReturnValue({ id: 'mem-1', content: '', tags: [] }),
  isMemoryInitialized: vi.fn().mockReturnValue(false),
  beginBatch: vi.fn(),
  flushBatch: vi.fn(),
}));

vi.mock('../memory/memory-extractor.js', () => ({
  extractFromToolResult: vi.fn().mockReturnValue([]),
}));

vi.mock('../memory/memory-embeddings.js', () => ({
  initEmbeddingStore: vi.fn(),
  loadEmbeddings: vi.fn(),
  saveEmbedding: vi.fn(),
  supportsEmbeddings: vi.fn().mockReturnValue(false),
  computeEmbedding: vi.fn(),
  beginEmbeddingBatch: vi.fn(),
  flushEmbeddingBatch: vi.fn(),
}));

vi.mock('../memory/memory-retriever.js', () => ({
  retrieveMemories: vi.fn().mockResolvedValue([]),
}));

vi.mock('../llm-client.js', () => ({
  createLLMClient: vi.fn(),
}));

vi.mock('../context-assembler.js', () => ({
  assembleContext: vi.fn().mockResolvedValue([]),
  truncateMessages: vi.fn().mockImplementation((msgs: unknown[]) => msgs),
  MAX_CONTEXT_TOKENS: 100_000,
  estimateTokens: vi.fn().mockReturnValue(0),
}));

vi.mock('../conversation-summary.js', () => ({
  getSummary: vi.fn().mockResolvedValue(null),
  saveSummary: vi.fn(),
  shouldGenerateSummary: vi.fn().mockReturnValue(false),
  generateSummary: vi.fn(),
}));

vi.mock('../../lib/user-hash.js', () => ({
  getUserHash: vi.fn().mockReturnValue('testhash'),
}));

vi.mock('../../lib/data-dir.js', () => ({
  getDataDir: vi.fn().mockReturnValue('/tmp/test-flowspace'),
}));

vi.mock('fs', () => ({
  default: {
    existsSync: vi.fn().mockReturnValue(false),
    mkdirSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
  },
  existsSync: vi.fn().mockReturnValue(false),
  mkdirSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

vi.mock('path', async () => {
  const actual = await vi.importActual<typeof import('path')>('path');
  return { ...actual, default: actual };
});

import { executeApprovedAction } from '../chat.js';
import { executeTool, isWriteTool, buildApprovalRequest } from '../tools.js';
import type { ApprovalRequest } from '../../shared/chat.js';

const mockedExecuteTool = vi.mocked(executeTool);
const mockedIsWriteTool = vi.mocked(isWriteTool);
const mockedBuildApprovalRequest = vi.mocked(buildApprovalRequest);

// ── helpers ──────────────────────────────────────────────────────────────────

/** Build a minimal ApprovalRequest for an already-approved write step. */
function makeApproval(overrides: Partial<ApprovalRequest> & { toolArgs?: Record<string, unknown> }): ApprovalRequest {
  return {
    id: 'test-approval-id',
    toolName: 'apply_label_to_threads',
    confirmLabel: 'Approve action',
    fields: [],
    ...overrides,
  };
}

/** Serialised outputKey map matching the real sweep workflow's step 0 result. */
const SAVED_OUTPUT_KEYS = JSON.stringify({
  credit_card_threads: {
    messages: [{ id: 'msg-1', threadId: 'thread-abc' }, { id: 'msg-2', threadId: 'thread-xyz' }],
    thread_ids: ['thread-abc', 'thread-xyz'],
    resultSizeEstimate: 2,
  },
});

beforeEach(() => {
  vi.clearAllMocks();
  mockedIsWriteTool.mockReturnValue(false);
});

// ── 1. Remaining read steps resolve template args ─────────────────────────────

describe('executeApprovedAction — remaining read steps interpolation', () => {
  it('resolves {{steps.<outputKey>.field}} in remaining read step args', async () => {
    // Approved step (apply_label) succeeds
    mockedExecuteTool.mockResolvedValueOnce(
      JSON.stringify({ succeeded_count: 2 }),
    );
    // Remaining step: archive_email_threads (read mock — isWriteTool returns false)
    mockedIsWriteTool.mockReturnValue(false);
    mockedExecuteTool.mockResolvedValueOnce(
      JSON.stringify({ archived: 2 }),
    );

    const approval = makeApproval({
      toolName: 'apply_label_to_threads',
      toolArgs: {
        thread_ids: 'thread-abc,thread-xyz',
        label_name: 'Credit Cards',
        _dynamicToolName: 'sweep_credit_card_emails',
        _stepIndex: 1,
        _outputKeys: SAVED_OUTPUT_KEYS,
        _remainingSteps: JSON.stringify([
          {
            action: 'archive_email_threads',
            args: { thread_ids: '{{steps.credit_card_threads.thread_ids}}' },
          },
        ]),
      },
    });

    await executeApprovedAction(approval, {});

    // executeTool was called twice: once for the approved step, once for the remaining step
    expect(mockedExecuteTool).toHaveBeenCalledTimes(2);

    // The second call (archive) must receive the resolved thread_ids, not the raw template
    const [, archiveArgs] = mockedExecuteTool.mock.calls[1];
    expect(archiveArgs).toBeDefined();
    expect((archiveArgs as Record<string, string>).thread_ids).toBe('thread-abc,thread-xyz');
    expect((archiveArgs as Record<string, string>).thread_ids).not.toContain('{{');
  });

  it('resolves multiple remaining read steps in sequence', async () => {
    mockedIsWriteTool.mockReturnValue(false);
    // approved step
    mockedExecuteTool.mockResolvedValueOnce(JSON.stringify({ succeeded_count: 1 }));
    // step 1: archive
    mockedExecuteTool.mockResolvedValueOnce(JSON.stringify({ archived: 1 }));
    // step 2: mark_threads_read
    mockedExecuteTool.mockResolvedValueOnce(JSON.stringify({ succeeded_count: 1 }));

    const approval = makeApproval({
      toolName: 'apply_label_to_threads',
      toolArgs: {
        thread_ids: 'thread-abc',
        label_name: 'Credit Cards',
        _dynamicToolName: 'sweep_credit_card_emails',
        _stepIndex: 1,
        _outputKeys: SAVED_OUTPUT_KEYS,
        _remainingSteps: JSON.stringify([
          { action: 'archive_email_threads', args: { thread_ids: '{{steps.credit_card_threads.thread_ids}}' } },
          { action: 'mark_threads_read', args: { thread_ids: '{{steps.credit_card_threads.thread_ids}}' } },
        ]),
      },
    });

    await executeApprovedAction(approval, {});

    expect(mockedExecuteTool).toHaveBeenCalledTimes(3);

    // Both remaining steps must have resolved thread_ids
    for (const callIdx of [1, 2]) {
      const [, stepArgs] = mockedExecuteTool.mock.calls[callIdx];
      expect((stepArgs as Record<string, string>).thread_ids).toBe('thread-abc,thread-xyz');
    }
  });
});

// ── 2. Remaining write steps resolve args before buildApprovalRequest ─────────

describe('executeApprovedAction — remaining write steps interpolation', () => {
  it('resolves args before calling buildApprovalRequest for the next write step', async () => {
    // First remaining step is a write tool
    mockedIsWriteTool.mockImplementation((name) => name === 'archive_email_threads');

    // approved step succeeds
    mockedExecuteTool.mockResolvedValueOnce(JSON.stringify({ succeeded_count: 2 }));

    const fakeNextApproval: ApprovalRequest = {
      id: 'archive:999',
      toolName: 'archive_email_threads',
      confirmLabel: 'Approve action',
      fields: [{ key: 'thread_ids', label: 'Thread IDs', value: 'thread-abc,thread-xyz' }],
    };
    mockedBuildApprovalRequest.mockReturnValue(fakeNextApproval);

    const approval = makeApproval({
      toolName: 'apply_label_to_threads',
      toolArgs: {
        thread_ids: 'thread-abc,thread-xyz',
        label_name: 'Credit Cards',
        _dynamicToolName: 'sweep_credit_card_emails',
        _stepIndex: 1,
        _outputKeys: SAVED_OUTPUT_KEYS,
        _remainingSteps: JSON.stringify([
          { action: 'archive_email_threads', args: { thread_ids: '{{steps.credit_card_threads.thread_ids}}' } },
        ]),
      },
    });

    const payload = await executeApprovedAction(approval, {});

    // Should have halted and returned an approval for archive_email_threads
    expect(payload.approval).toBeDefined();
    expect(payload.approval!.toolName).toBe('archive_email_threads');

    // buildApprovalRequest must have been called with the RESOLVED args, not the template string
    expect(mockedBuildApprovalRequest).toHaveBeenCalledWith(
      'archive_email_threads',
      expect.objectContaining({ thread_ids: 'thread-abc,thread-xyz' }),
    );
    const [, resolvedArgs] = mockedBuildApprovalRequest.mock.calls[0];
    expect((resolvedArgs as Record<string, string>).thread_ids).not.toContain('{{');
  });
});

// ── 3. _outputKeys is carried forward through chained approvals ───────────────

describe('executeApprovedAction — _outputKeys forwarded in chained approvals', () => {
  it('preserves _outputKeys in the next approval toolArgs', async () => {
    mockedIsWriteTool.mockImplementation((name) => name === 'archive_email_threads');
    mockedExecuteTool.mockResolvedValueOnce(JSON.stringify({ succeeded_count: 2 }));

    const fakeNextApproval: ApprovalRequest = {
      id: 'archive:999',
      toolName: 'archive_email_threads',
      confirmLabel: 'Approve action',
      fields: [],
    };
    mockedBuildApprovalRequest.mockReturnValue(fakeNextApproval);

    const approval = makeApproval({
      toolName: 'apply_label_to_threads',
      toolArgs: {
        thread_ids: 'thread-abc,thread-xyz',
        label_name: 'Credit Cards',
        _dynamicToolName: 'sweep_credit_card_emails',
        _stepIndex: 1,
        _outputKeys: SAVED_OUTPUT_KEYS,
        _remainingSteps: JSON.stringify([
          { action: 'archive_email_threads', args: { thread_ids: '{{steps.credit_card_threads.thread_ids}}' } },
          { action: 'mark_threads_read', args: { thread_ids: '{{steps.credit_card_threads.thread_ids}}' } },
        ]),
      },
    });

    const payload = await executeApprovedAction(approval, {});

    // The chained approval's toolArgs must carry _outputKeys forward
    expect(payload.approval).toBeDefined();
    const nextToolArgs = payload.approval!.toolArgs!;
    expect(nextToolArgs._outputKeys).toBe(SAVED_OUTPUT_KEYS);

    // And _remainingSteps must point to the step after archive (mark_threads_read)
    const nextRemaining = JSON.parse(nextToolArgs._remainingSteps as string);
    expect(nextRemaining).toHaveLength(1);
    expect(nextRemaining[0].action).toBe('mark_threads_read');
  });

  it('increments _stepIndex correctly in chained approval', async () => {
    mockedIsWriteTool.mockImplementation((name) => name === 'archive_email_threads');
    mockedExecuteTool.mockResolvedValueOnce(JSON.stringify({ succeeded_count: 1 }));
    mockedBuildApprovalRequest.mockReturnValue({
      id: 'archive:1',
      toolName: 'archive_email_threads',
      confirmLabel: 'Approve action',
      fields: [],
    } as ApprovalRequest);

    const approval = makeApproval({
      toolName: 'apply_label_to_threads',
      toolArgs: {
        thread_ids: 'thread-abc',
        label_name: 'Finance',
        _dynamicToolName: 'sweep_credit_card_emails',
        _stepIndex: 1,   // approved step was index 1
        _outputKeys: SAVED_OUTPUT_KEYS,
        _remainingSteps: JSON.stringify([
          { action: 'archive_email_threads', args: { thread_ids: '{{steps.credit_card_threads.thread_ids}}' } },
        ]),
      },
    });

    const payload = await executeApprovedAction(approval, {});

    // originalStepIndex = _stepIndex(1) + 1 + stepIdx(0) = 2
    expect(payload.approval!.toolArgs!._stepIndex).toBe(2);
  });
});

// ── 4. Graceful handling of missing/malformed _outputKeys ─────────────────────

describe('executeApprovedAction — missing or malformed _outputKeys', () => {
  it('executes remaining steps with empty strings when _outputKeys is absent', async () => {
    mockedIsWriteTool.mockReturnValue(false);
    // approved step
    mockedExecuteTool.mockResolvedValueOnce(JSON.stringify({ succeeded_count: 1 }));
    // remaining step (unresolved template → empty string)
    mockedExecuteTool.mockResolvedValueOnce(JSON.stringify({ archived: 0 }));

    const approval = makeApproval({
      toolName: 'apply_label_to_threads',
      toolArgs: {
        thread_ids: 'thread-abc',
        label_name: 'Finance',
        _dynamicToolName: 'sweep_credit_card_emails',
        _stepIndex: 1,
        // _outputKeys intentionally absent
        _remainingSteps: JSON.stringify([
          { action: 'archive_email_threads', args: { thread_ids: '{{steps.credit_card_threads.thread_ids}}' } },
        ]),
      },
    });

    // Should not throw
    await expect(executeApprovedAction(approval, {})).resolves.toBeDefined();

    // Remaining step ran with empty resolved arg (graceful degradation)
    const [, archiveArgs] = mockedExecuteTool.mock.calls[1];
    expect((archiveArgs as Record<string, string>).thread_ids).toBe('');
  });

  it('executes remaining steps gracefully when _outputKeys is malformed JSON', async () => {
    mockedIsWriteTool.mockReturnValue(false);
    mockedExecuteTool.mockResolvedValueOnce(JSON.stringify({ succeeded_count: 1 }));
    mockedExecuteTool.mockResolvedValueOnce(JSON.stringify({ archived: 0 }));

    const approval = makeApproval({
      toolName: 'apply_label_to_threads',
      toolArgs: {
        thread_ids: 'thread-abc',
        label_name: 'Finance',
        _dynamicToolName: 'sweep_credit_card_emails',
        _stepIndex: 1,
        _outputKeys: '{ this is not valid json !!!',
        _remainingSteps: JSON.stringify([
          { action: 'archive_email_threads', args: { thread_ids: '{{steps.credit_card_threads.thread_ids}}' } },
        ]),
      },
    });

    // Should not throw
    await expect(executeApprovedAction(approval, {})).resolves.toBeDefined();
    expect(mockedExecuteTool).toHaveBeenCalledTimes(2);
  });

  it('skips remaining steps entirely when _remainingSteps is malformed JSON', async () => {
    mockedIsWriteTool.mockReturnValue(false);
    mockedExecuteTool.mockResolvedValueOnce(JSON.stringify({ succeeded_count: 1 }));

    const approval = makeApproval({
      toolName: 'apply_label_to_threads',
      toolArgs: {
        thread_ids: 'thread-abc',
        label_name: 'Finance',
        _dynamicToolName: 'sweep_credit_card_emails',
        _stepIndex: 1,
        _outputKeys: SAVED_OUTPUT_KEYS,
        _remainingSteps: 'NOT_JSON',
      },
    });

    await expect(executeApprovedAction(approval, {})).resolves.toBeDefined();
    // Only the approved step ran — no remaining steps
    expect(mockedExecuteTool).toHaveBeenCalledTimes(1);
  });

  it('does not execute remaining steps when _dynamicToolName is absent', async () => {
    mockedIsWriteTool.mockReturnValue(false);
    mockedExecuteTool.mockResolvedValueOnce(JSON.stringify({ succeeded_count: 1 }));

    // Static write tool approval (no _dynamicToolName) — remaining steps must not run
    const approval = makeApproval({
      toolName: 'apply_label_to_threads',
      toolArgs: {
        thread_ids: 'thread-abc',
        label_name: 'Finance',
        // No _dynamicToolName
        _remainingSteps: JSON.stringify([
          { action: 'archive_email_threads', args: { thread_ids: 'thread-abc' } },
        ]),
      },
    });

    await executeApprovedAction(approval, {});
    expect(mockedExecuteTool).toHaveBeenCalledTimes(1);
  });
});
