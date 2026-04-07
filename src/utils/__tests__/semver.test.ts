import { describe, it, expect } from 'vitest';
import { isNewerVersion } from '../semver';

describe('isNewerVersion', () => {
  it('returns false when versions are equal', () => {
    expect(isNewerVersion('1.0.0', '1.0.0')).toBe(false);
  });

  it('returns true for patch bump', () => {
    expect(isNewerVersion('1.0.1', '1.0.0')).toBe(true);
  });

  it('returns true for minor bump', () => {
    expect(isNewerVersion('1.1.0', '1.0.0')).toBe(true);
  });

  it('returns true for major bump', () => {
    expect(isNewerVersion('2.0.0', '1.0.0')).toBe(true);
  });

  it('returns false when current is newer', () => {
    expect(isNewerVersion('1.0.0', '1.0.1')).toBe(false);
  });

  it('strips leading v from latest', () => {
    expect(isNewerVersion('v1.1.0', '1.0.0')).toBe(true);
  });

  it('strips leading v from current', () => {
    expect(isNewerVersion('1.1.0', 'v1.0.0')).toBe(true);
  });

  it('handles malformed strings gracefully', () => {
    expect(isNewerVersion('', '1.0.0')).toBe(false);
    expect(isNewerVersion('abc', '1.0.0')).toBe(false);
    expect(isNewerVersion('1.0.0', '')).toBe(false);
  });

  it('compares major before minor', () => {
    expect(isNewerVersion('2.0.0', '1.9.9')).toBe(true);
  });

  it('compares minor before patch', () => {
    expect(isNewerVersion('1.2.0', '1.1.9')).toBe(true);
  });
});
