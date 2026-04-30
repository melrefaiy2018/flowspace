import { hashArgsShape } from './args-hasher.js';
import { recordDispatch } from './ring-buffer.js';
import { appendEntry, newInvocationId, _flushPendingForTests as flushLog } from './invocation-log.js';
import { loadSettings, loadSettingsSync, isSettingsHydrated } from './settings.js';
import type { ApprovalOutcome, InvocationSource, ToolInvocation } from './types.js';

interface RecordInput {
  readonly name: string;
  readonly args: Record<string, unknown>;
  readonly success: boolean;
  readonly approval: ApprovalOutcome;
  readonly source: InvocationSource;
}

// Track in-flight writes so tests can flush. Each promise removes itself
// from the set on completion to prevent unbounded growth in long-running
// server processes.
let pendingWrites: Set<Promise<void>> = new Set();
let settingsHydrated = false;
let settingsHydration: Promise<void> | null = null;

function hydrateSettingsOnce(): void {
  if (settingsHydrated) return;
  settingsHydrated = true;
  settingsHydration = loadSettings()
    .then(
      () => undefined,
      () => undefined,
    );
}

// Kick off settings hydration on module import so the first dispatch is
// not silently dropped if the user enabled the flag on disk. Without this,
// loadSettingsSync() returns DEFAULT (enabled: false) until the async load
// settles on the next tick.
hydrateSettingsOnce();

export function _resetForTests(): void {
  pendingWrites = new Set();
  settingsHydrated = false;
  settingsHydration = null;
}

export async function _flushPendingForTests(): Promise<void> {
  if (settingsHydration) await settingsHydration;
  await Promise.allSettled([...pendingWrites]);
  pendingWrites = new Set();
  await flushLog();
}

export function recordInvocation(input: RecordInput): void {
  try {
    // Capture the timestamp synchronously, before any await. If settings
    // haven't hydrated yet, the actual recording is deferred — but the
    // observed time of the dispatch is now, not when the queue drains.
    const observedAt = new Date().toISOString();

    // Snapshot args once: the caller's reference may mutate after we
    // return (we are fire-and-forget) and the deferred path below would
    // otherwise read a moving target.
    const safeArgs = input.args ?? {};

    hydrateSettingsOnce();

    // First dispatch in a fresh process can race the async settings load.
    // If hydration is still pending, wait for it (still fire-and-forget
    // from the caller's perspective — recordInvocation is void) so the
    // dispatch is not silently dropped when the user enabled the flag on
    // disk in a prior session.
    const persistPromise: Promise<void> = (async () => {
      if (!isSettingsHydrated() && settingsHydration) {
        try {
          await settingsHydration;
        } catch {
          /* settings load failed; loadSettingsSync returns DEFAULTS */
        }
      }
      const settings = loadSettingsSync();
      if (!settings.enabled) return;

      // Feed the in-memory ring (literal args) so the detector can
      // capture a sample at the moment a proposal is emitted. Bounded,
      // never persisted to disk.
      recordDispatch({ name: input.name, args: safeArgs });

      const invocation: ToolInvocation = {
        id: newInvocationId(),
        name: input.name,
        argsHash: hashArgsShape(safeArgs),
        timestamp: observedAt,
        success: input.success,
        approval: input.approval,
        source: input.source,
      };

      await appendEntry(invocation, {
        logCapEntries: settings.logCapEntries,
        logRetentionDays: settings.logRetentionDays,
      });
    })();

    const p: Promise<void> = persistPromise
      .catch(() => {
        /* swallow — observer must never throw into the dispatch path */
      })
      .finally(() => {
        pendingWrites.delete(p);
      });
    pendingWrites.add(p);
  } catch {
    /* fail-closed: observer never throws */
  }
}
