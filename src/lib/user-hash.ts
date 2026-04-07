import crypto from 'crypto';

/**
 * Derive a stable, short hash from a user email for use as a file-name-safe
 * identifier (e.g. per-user memory files).
 */
export function getUserHash(userEmail: string): string {
  return crypto.createHash('sha256').update(userEmail.toLowerCase().trim()).digest('hex').slice(0, 16);
}
