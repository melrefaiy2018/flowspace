import { describe, it, expect } from 'vitest';
import { validateEmail, validatePassword, type ValidationResult } from '../auth-validation';

describe('validateEmail', () => {
  it('accepts valid emails', () => {
    expect(validateEmail('user@example.com')).toEqual({ valid: true, error: null });
    expect(validateEmail('name.last@domain.org')).toEqual({ valid: true, error: null });
    expect(validateEmail('user+tag@gmail.com')).toEqual({ valid: true, error: null });
  });

  it('rejects empty string', () => {
    const result = validateEmail('');
    expect(result.valid).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('rejects strings without @', () => {
    const result = validateEmail('notanemail');
    expect(result.valid).toBe(false);
  });

  it('rejects strings without domain', () => {
    const result = validateEmail('user@');
    expect(result.valid).toBe(false);
  });

  it('trims whitespace before validating', () => {
    expect(validateEmail('  user@example.com  ')).toEqual({ valid: true, error: null });
  });
});

describe('validatePassword', () => {
  it('accepts strong passwords (8+ chars)', () => {
    expect(validatePassword('MyPass123')).toEqual({ valid: true, error: null });
    expect(validatePassword('abcdefgh')).toEqual({ valid: true, error: null });
  });

  it('rejects empty password', () => {
    const result = validatePassword('');
    expect(result.valid).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('rejects passwords shorter than 8 chars', () => {
    const result = validatePassword('abc123');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('8');
  });

  it('rejects passwords that are all spaces', () => {
    const result = validatePassword('        ');
    expect(result.valid).toBe(false);
  });
});
