import { describe, it, expect } from 'vitest';
import { parseThreadBrief } from '../chat.js';

describe('parseThreadBrief', () => {
  it('returns undefined for undefined input', () => {
    expect(parseThreadBrief(undefined)).toBeUndefined();
  });

  it('returns undefined for empty string', () => {
    expect(parseThreadBrief('')).toBeUndefined();
  });

  it('wraps a plain string as general type', () => {
    const result = parseThreadBrief('plain string');
    expect(result).toEqual({ type: 'general', summary: 'plain string' });
  });

  it('parses a valid meeting_prep JSON brief', () => {
    const input = JSON.stringify({ type: 'meeting_prep', summary: 'prep for design review' });
    const result = parseThreadBrief(input);
    expect(result).toEqual({ type: 'meeting_prep', summary: 'prep for design review' });
  });

  it('parses an email_thread JSON brief', () => {
    const input = JSON.stringify({ type: 'email_thread', summary: 'email about project', entityId: 'thread-123' });
    const result = parseThreadBrief(input);
    expect(result).toMatchObject({ type: 'email_thread', summary: 'email about project', entityId: 'thread-123' });
  });

  it('falls back to general for JSON without a type field', () => {
    const input = JSON.stringify({ summary: 'no type here' });
    const result = parseThreadBrief(input);
    expect(result).toEqual({ type: 'general', summary: input });
  });

  it('falls back to general for malformed JSON', () => {
    const result = parseThreadBrief('{not: valid json}');
    expect(result).toEqual({ type: 'general', summary: '{not: valid json}' });
  });

  it('preserves extra context fields from JSON', () => {
    const input = JSON.stringify({
      type: 'task',
      summary: 'task context',
      entityId: 'task-456',
      context: { priority: 'high' },
    });
    const result = parseThreadBrief(input);
    expect(result).toMatchObject({
      type: 'task',
      summary: 'task context',
      entityId: 'task-456',
      context: { priority: 'high' },
    });
  });
});
