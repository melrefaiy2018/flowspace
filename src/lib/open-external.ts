/**
 * Opens a URL in the system's default browser.
 *
 * In Tauri, uses the shell plugin's `open()` which reliably opens URLs
 * in the system browser without navigating the WebView.
 * In a regular browser, falls back to window.open().
 */

const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/** Open a URL in the system default browser. */
export function openExternalUrl(url: string): void {
  if (isTauri) {
    import('@tauri-apps/plugin-shell')
      .then(({ open }) => open(url))
      .catch(() => window.open(url, '_blank'));
  } else {
    window.open(url, '_blank');
  }
}

/** Pre-open a blank window during the click event, then navigate it later. */
export function preOpenWindow(): Window | null {
  return window.open('about:blank', '_blank', 'noopener');
}

/** Navigate a pre-opened window to the URL, or create a link fallback. */
export function navigateWindow(win: Window | null, url: string): void {
  if (win && !win.closed) {
    win.location.href = url;
  } else {
    const a = document.createElement('a');
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }
}
