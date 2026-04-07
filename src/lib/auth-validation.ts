export interface ValidationResult {
  valid: boolean;
  error: string | null;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;

export function validateEmail(email: string): ValidationResult {
  const trimmed = email.trim();
  if (!trimmed) return { valid: false, error: 'Email is required.' };
  if (!EMAIL_REGEX.test(trimmed)) return { valid: false, error: 'Enter a valid email address.' };
  return { valid: true, error: null };
}

export function validatePassword(password: string): ValidationResult {
  if (!password || !password.trim()) return { valid: false, error: 'Password is required.' };
  if (password.length < MIN_PASSWORD_LENGTH) return { valid: false, error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` };
  return { valid: true, error: null };
}
