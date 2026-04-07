import { describe, expect, it, vi } from 'vitest';
import { formatHeroGreeting, getFirstName, getTimeGreeting } from '../greeting';

describe('getTimeGreeting', () => {
  it('formats time-of-day greetings', () => {
    expect(getTimeGreeting(new Date('2026-03-13T08:00:00'))).toBe('Good morning');
    expect(getTimeGreeting(new Date('2026-03-13T14:00:00'))).toBe('Good afternoon');
    expect(getTimeGreeting(new Date('2026-03-13T19:00:00'))).toBe('Good evening');
  });
});

describe('getFirstName', () => {
  it('returns the first token from the display name', () => {
    expect(getFirstName('Mohamed Elrefaify')).toBe('Mohamed');
    expect(getFirstName('  Mo  ')).toBe('Mo');
    expect(getFirstName('')).toBe('');
  });
});

describe('formatHeroGreeting', () => {
  it('uses only the first name in the hero greeting', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-13T14:00:00'));

    expect(formatHeroGreeting('Mohamed Elrefaify')).toBe('Good afternoon Mohamed');
    expect(formatHeroGreeting('Mohamed, Mo')).toBe('Good afternoon Mohamed');

    vi.useRealTimers();
  });
});
