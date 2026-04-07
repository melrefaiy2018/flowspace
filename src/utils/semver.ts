/**
 * Returns true if `latest` is a strictly newer semver than `current`.
 * Strips leading 'v' prefix. Returns false for malformed input.
 */
export function isNewerVersion(latest: string, current: string): boolean {
  const parse = (v: string): number[] | null => {
    const cleaned = v.replace(/^v/, '');
    const parts = cleaned.split('.').map(Number);
    if (parts.length < 3 || parts.some(isNaN)) return null;
    return parts;
  };

  const l = parse(latest);
  const c = parse(current);
  if (!l || !c) return false;

  for (let i = 0; i < 3; i++) {
    if (l[i] > c[i]) return true;
    if (l[i] < c[i]) return false;
  }
  return false;
}
