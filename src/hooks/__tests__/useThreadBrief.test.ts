/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useThreadBrief } from '../useThreadBrief';
import { api } from '../../services/api';
import type { ThreadBriefResponse } from '../../shared/gmail-enrichment-types';

vi.mock('../../services/api', () => ({
  api: {
    getThreadBrief: vi.fn(),
  },
}));

function makeThreadBriefResponse(threadId = 'thread-1'): ThreadBriefResponse {
  return {
    brief: {
      threadId,
      summary: 'This is a summary of the thread.',
      recommendedAction: 'Reply with an answer to their question.',
      contextChips: [
        { label: 'Awaiting reply', kind: 'reply_state' },
        { label: '2 days old', kind: 'thread_age' },
      ],
      firstClassActions: [
        { kind: 'draft_reply' },
        { kind: 'pick_times' },
      ],
      isFallback: false,
      cachedAt: '2026-04-11T10:00:00Z',
    },
    cacheHit: false,
    durationMs: 120,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useThreadBrief', () => {
  it('returns null brief with no loading when threadId is null', () => {
    const { result } = renderHook(() => useThreadBrief(null));
    expect(result.current.brief).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(vi.mocked(api.getThreadBrief)).not.toHaveBeenCalled();
  });

  it('fetches brief and transitions loading → ready', async () => {
    vi.mocked(api.getThreadBrief).mockResolvedValue(makeThreadBriefResponse('thread-1'));

    const { result } = renderHook(() => useThreadBrief('thread-1'));

    // Should be loading initially
    expect(result.current.loading).toBe(true);
    expect(result.current.brief).toBeNull();

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.brief).toBeTruthy();
    expect(result.current.brief?.threadId).toBe('thread-1');
    expect(result.current.brief?.isFallback).toBe(false);
    expect(result.current.error).toBeNull();
    expect(vi.mocked(api.getThreadBrief)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(api.getThreadBrief)).toHaveBeenCalledWith('thread-1');
  });

  it('uses memo cache — fetches a and b, then returns a from cache on second visit', async () => {
    vi.mocked(api.getThreadBrief)
      .mockResolvedValueOnce(makeThreadBriefResponse('thread-a'))
      .mockResolvedValueOnce(makeThreadBriefResponse('thread-b'));

    const { result, rerender } = renderHook(
      ({ threadId }: { threadId: string }) => useThreadBrief(threadId),
      { initialProps: { threadId: 'thread-a' } },
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.brief?.threadId).toBe('thread-a');

    // Switch to thread-b
    rerender({ threadId: 'thread-b' });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.brief?.threadId).toBe('thread-b');

    // Switch back to thread-a — should hit cache
    rerender({ threadId: 'thread-a' });
    // Loading should not be true because it's a cache hit
    expect(result.current.loading).toBe(false);
    expect(result.current.brief?.threadId).toBe('thread-a');

    // api should have been called exactly twice (a, b — not again for a)
    expect(vi.mocked(api.getThreadBrief)).toHaveBeenCalledTimes(2);
  });

  it('sets fallback brief and error when fetch fails', async () => {
    const networkError = new Error('Network failure');
    vi.mocked(api.getThreadBrief).mockRejectedValue(networkError);

    const { result } = renderHook(() => useThreadBrief('thread-err'));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBeTruthy();
    expect(result.current.error?.message).toBe('Network failure');
    expect(result.current.brief).toBeTruthy();
    expect(result.current.brief?.isFallback).toBe(true);
    expect(result.current.brief?.threadId).toBe('thread-err');
    expect(result.current.brief?.firstClassActions[0].kind).toBe('draft_reply');
  });
});
