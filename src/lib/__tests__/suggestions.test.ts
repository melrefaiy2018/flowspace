import { describe, it, expect } from 'vitest';
import { parseSuggestions } from '../suggestions';

describe('parseSuggestions', () => {
  it('extracts SUGGEST markers from text', () => {
    const text = `Here are the details.\n\n[SUGGEST: Add to my calendar]\n[SUGGEST: Create a task]`;
    const result = parseSuggestions(text);
    expect(result.suggestions).toEqual(['Add to my calendar', 'Create a task']);
    expect(result.cleanContent).toBe('Here are the details.');
  });

  it('handles 3 suggestions', () => {
    const text = `Workshop info.\n[SUGGEST: Add to calendar]\n[SUGGEST: Create task]\n[SUGGEST: Draft reply]`;
    const result = parseSuggestions(text);
    expect(result.suggestions).toHaveLength(3);
    expect(result.suggestions[0]).toBe('Add to calendar');
    expect(result.suggestions[2]).toBe('Draft reply');
  });

  it('returns empty suggestions when no markers present', () => {
    const text = 'Just a normal response with no suggestions.';
    const result = parseSuggestions(text);
    expect(result.suggestions).toEqual([]);
    expect(result.cleanContent).toBe(text);
  });

  it('strips trailing whitespace and empty lines after removing markers', () => {
    const text = `Some content.\n\n\n[SUGGEST: Do something]\n\n`;
    const result = parseSuggestions(text);
    expect(result.cleanContent).toBe('Some content.');
    expect(result.suggestions).toEqual(['Do something']);
  });

  it('handles markers with extra whitespace', () => {
    const text = `Info.\n[SUGGEST:  Spaced out  ]\n[ SUGGEST: Also spaced ]`;
    const result = parseSuggestions(text);
    expect(result.suggestions).toContain('Spaced out');
  });

  it('ignores markers embedded in the middle of text', () => {
    const text = `First paragraph.\n\n[SUGGEST: Action one]\n\nSome follow-up text.\n\n[SUGGEST: Action two]`;
    const result = parseSuggestions(text);
    // Both should be extracted regardless of position
    expect(result.suggestions).toContain('Action one');
    expect(result.suggestions).toContain('Action two');
    expect(result.cleanContent).toContain('First paragraph.');
    expect(result.cleanContent).toContain('Some follow-up text.');
  });

  it('limits to max 4 suggestions', () => {
    const text = `Info.\n[SUGGEST: A]\n[SUGGEST: B]\n[SUGGEST: C]\n[SUGGEST: D]\n[SUGGEST: E]`;
    const result = parseSuggestions(text);
    expect(result.suggestions).toHaveLength(4);
  });

  it('skips empty suggest markers', () => {
    const text = `Info.\n[SUGGEST: ]\n[SUGGEST: Real action]`;
    const result = parseSuggestions(text);
    expect(result.suggestions).toEqual(['Real action']);
  });
});
