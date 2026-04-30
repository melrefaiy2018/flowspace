import { describe, it, expect } from 'vitest';
import {
  ACTION_REGISTRY,
  THREAD_TYPES,
  lookupAction,
  isThreadType,
} from '../gmail-work-registry.js';
import type { PaneKind } from '../gmail-work-registry.js';

const VALID_PANE_KINDS: PaneKind[] = ['draft', 'schedule', 'file', 'review', 'tasks', 'summary', 'discuss'];

describe('ACTION_REGISTRY', () => {
  it('every THREAD_TYPES entry has a corresponding row in ACTION_REGISTRY', () => {
    for (const type of THREAD_TYPES) {
      expect(ACTION_REGISTRY[type]).toBeDefined();
      expect(ACTION_REGISTRY[type].type).toBe(type);
    }
  });

  it('every paneKind in ACTION_REGISTRY is one of the 7 valid PaneKind values', () => {
    for (const type of THREAD_TYPES) {
      expect(VALID_PANE_KINDS).toContain(ACTION_REGISTRY[type].paneKind);
    }
  });

  it('every entry has a non-empty primaryActionLabel and description', () => {
    for (const type of THREAD_TYPES) {
      expect(ACTION_REGISTRY[type].primaryActionLabel.length).toBeGreaterThan(0);
      expect(ACTION_REGISTRY[type].description.length).toBeGreaterThan(0);
    }
  });
});

describe('lookupAction', () => {
  it('returns the correct entry for personal_reply_needed', () => {
    const entry = lookupAction('personal_reply_needed');
    expect(entry.type).toBe('personal_reply_needed');
    expect(entry.primaryActionLabel).toBe('Draft reply');
    expect(entry.paneKind).toBe('draft');
  });

  it('returns the other entry for undefined (fallback)', () => {
    const entry = lookupAction(undefined);
    expect(entry.type).toBe('other');
    expect(entry.primaryActionLabel).toBe('Discuss');
    expect(entry.paneKind).toBe('discuss');
  });

  it('returns the other entry for null (fallback)', () => {
    const entry = lookupAction(null);
    expect(entry.type).toBe('other');
    expect(entry.paneKind).toBe('discuss');
  });

  it('returns the other entry for an unrecognised string (fallback)', () => {
    const entry = lookupAction('not_a_real_type');
    expect(entry.type).toBe('other');
  });

  it('returns the other entry for an empty string (fallback)', () => {
    const entry = lookupAction('');
    expect(entry.type).toBe('other');
  });

  it('returns the meeting_request entry for meeting_request', () => {
    const entry = lookupAction('meeting_request');
    expect(entry.type).toBe('meeting_request');
    expect(entry.primaryActionLabel).toBe('Pick times');
    expect(entry.paneKind).toBe('schedule');
  });
});

describe('isThreadType', () => {
  it('returns true for a valid ThreadType', () => {
    expect(isThreadType('personal_reply_needed')).toBe(true);
  });

  it('returns false for a non-ThreadType string', () => {
    expect(isThreadType('gibberish')).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isThreadType(undefined)).toBe(false);
  });

  it('returns false for null', () => {
    expect(isThreadType(null)).toBe(false);
  });

  it('returns true for all 8 thread types', () => {
    for (const type of THREAD_TYPES) {
      expect(isThreadType(type)).toBe(true);
    }
  });
});
