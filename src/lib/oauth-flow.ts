/**
 * Opens the Google OAuth flow in the system browser and polls for completion.
 *
 * In the Tauri WKWebView, Google OAuth consent can't use passkeys/WebAuthn.
 * The server opens the auth URL in the system browser via `open` (macOS),
 * and we poll /api/auth/status until the callback completes.
 */

export interface OAuthFlowCallbacks {
  onWaiting?: () => void;
  onSuccess?: () => void;
  onError?: (message: string) => void;
}

export async function startOAuthFlow(
  endpoint: '/api/auth/login' | '/api/accounts/connect',
  callbacks: OAuthFlowCallbacks = {},
): Promise<void> {
  try {
    const resp = await fetch(endpoint);
    if (!resp.ok) {
      const data = await resp.json().catch(() => ({ error: 'Failed to start auth' }));
      callbacks.onError?.(data.error ?? 'Failed to start auth');
      return;
    }

    const data = await resp.json();
    if (!data.url) {
      callbacks.onError?.('No auth URL returned');
      return;
    }

    // The server opens the URL in the system browser via `open` (macOS).
    // No need for window.open() from the WebView.
    callbacks.onWaiting?.();

    // Poll auth status every 2s for up to 2 minutes
    const maxAttempts = 60;
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      try {
        const statusResp = await fetch('/api/auth/status');
        const status = await statusResp.json();
        if (status.authenticated) {
          callbacks.onSuccess?.();
          return;
        }
      } catch {
        // Network error during poll — keep trying
      }
    }

    callbacks.onError?.('Authentication timed out. Please try again.');
  } catch (err: any) {
    callbacks.onError?.(err.message ?? 'Unexpected error during sign-in');
  }
}
