/**
 * Clears ALL FlowSpace client-side data from localStorage.
 * Call on logout, account removal, or any account boundary change
 * to prevent stale data from leaking across accounts.
 */
export function clearAllClientData(): void {
  if (typeof window === 'undefined') return;

  const keysToRemove: string[] = [];
  for (let i = 0; i < window.localStorage.length; i++) {
    const key = window.localStorage.key(i);
    if (!key) continue;
    // All FlowSpace localStorage keys use one of these prefixes
    if (key.startsWith('flowspace.') || key.startsWith('flowspace:')) {
      keysToRemove.push(key);
    }
  }
  for (const key of keysToRemove) {
    window.localStorage.removeItem(key);
  }
}
