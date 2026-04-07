/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useBriefing } from '../useBriefing';
import { api, type Briefing } from '../../services/api';

vi.mock('../../services/api', () => ({
  api: {
    getBriefing: vi.fn(),
  },
}));

const STORAGE_KEY = 'flowspace:briefing-cache';
let storage = new Map<string, string>();

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function makeBriefing(overrides: Partial<Briefing> = {}): Briefing {
  return {
    greeting: 'Good morning, Mohamed',
    summary: 'You have two meetings and three emails that need attention.',
    attention_items: [
      {
        type: 'email_reply',
        priority: 'high',
        title: 'Reply to Alice',
        description: 'Budget approval needs a response.',
        action_label: 'Draft reply',
        action_context: 'thread-1',
        feedback_target: {
          scope: 'attention_item',
          item_type: 'email_reply',
          entity_id: 'thread-1',
          title: 'Reply to Alice',
        },
      },
    ],
    inbox_triage: {
      needs_reply: [],
      needs_input: [],
      fyi_only: [],
      can_ignore: [],
    },
    day_at_a_glance: [],
    followups: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  storage = new Map<string, string>();
  Object.defineProperty(window, 'localStorage', {
    value: {
      getItem: vi.fn((key: string) => storage.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => {
        storage.set(key, value);
      }),
      removeItem: vi.fn((key: string) => {
        storage.delete(key);
      }),
      clear: vi.fn(() => {
        storage.clear();
      }),
    },
    configurable: true,
  });
});

describe('useBriefing', () => {
  it('hydrates from local storage before the refresh completes', async () => {
    const cached = makeBriefing({ greeting: 'Cached greeting' });
    const fresh = makeBriefing({ greeting: 'Fresh greeting', summary: 'Fresh summary' });
    const request = deferred<Briefing>();

    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
      briefing: cached,
      savedAt: Date.now(),
    }));
    vi.mocked(api.getBriefing).mockReturnValue(request.promise);

    const { result } = renderHook(() => useBriefing());

    expect(result.current.loading).toBe(false);
    expect(result.current.briefing?.greeting).toBe('Cached greeting');
    expect(api.getBriefing).toHaveBeenCalledWith(false);

    request.resolve(fresh);

    await waitFor(() => {
      expect(result.current.briefing?.greeting).toBe('Fresh greeting');
    });

    const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}');
    expect(stored.briefing.greeting).toBe('Fresh greeting');
  });

  it('shows loading when no cached briefing exists', async () => {
    vi.mocked(api.getBriefing).mockResolvedValue(makeBriefing());

    const { result } = renderHook(() => useBriefing());

    expect(result.current.loading).toBe(true);

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
  });

  it('hides an ignored target for the current session', async () => {
    vi.mocked(api.getBriefing).mockResolvedValue(makeBriefing());

    const { result } = renderHook(() => useBriefing());

    await waitFor(() => {
      expect(result.current.briefing?.attention_items).toHaveLength(1);
    });

    const target = result.current.briefing?.attention_items[0].feedback_target;
    act(() => {
      result.current.ignoreTarget(target);
    });

    await waitFor(() => {
      expect(result.current.briefing?.attention_items).toHaveLength(0);
    });
    expect(result.current.isTargetIgnored(target)).toBe(true);

    act(() => {
      result.current.restoreTarget(target);
    });

    await waitFor(() => {
      expect(result.current.briefing?.attention_items).toHaveLength(1);
    });
  });

  it('can hide cached briefing items that do not yet include feedback_target', async () => {
    vi.mocked(api.getBriefing).mockResolvedValue(makeBriefing({
      attention_items: [{
        type: 'email_reply',
        priority: 'high',
        title: 'Reply to Alice',
        description: 'Budget approval needs a response.',
        action_label: 'Draft reply',
        action_context: 'thread-1',
      }],
    }));

    const { result } = renderHook(() => useBriefing());

    await waitFor(() => {
      expect(result.current.briefing?.attention_items).toHaveLength(1);
    });

    act(() => {
      result.current.ignoreTarget({
        scope: 'attention_item',
        item_type: 'email_reply',
        entity_id: 'thread-1',
        title: 'Reply to Alice',
      });
    });

    await waitFor(() => {
      expect(result.current.briefing?.attention_items).toHaveLength(0);
    });
  });
});
