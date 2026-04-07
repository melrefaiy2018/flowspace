# Feature Spec: GWS CLI Auth Integration

## Problem

FlowSpace currently requires users to:
1. Create a Google Cloud project
2. Configure OAuth consent screen
3. Create OAuth client credentials (client ID + client secret)
4. Add them to `.env` as `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`

This is a high-friction onboarding process that most users won't complete.

## Solution

Replace FlowSpace's custom OAuth flow with [`gws` (Google Workspace CLI)](https://github.com/googleworkspace/cli) as the authentication backend. Users authenticate via `gws auth login` (which handles OAuth consent and token management), then FlowSpace imports those credentials automatically. A pre-configured `client_secret.json` is bundled with the app so users never need to create a GCP project.

## User Flow

1. User opens FlowSpace → sees "Sign in with Google" button
2. Clicks button → a polished modal appears with an animated illustration and status line
3. FlowSpace checks if `gws` is installed; if not, auto-installs via npm ("Setting up...")
4. FlowSpace writes bundled `client_secret.json` to `~/.config/gws/` (if not already present)
5. FlowSpace auto-runs `gws auth login -s drive,gmail,calendar,tasks` ("Opening browser for sign-in...")
6. Browser opens → user approves Google permissions
7. FlowSpace detects auth completion, imports credentials ("Completing sign-in...")
8. Modal shows success state → user is signed in

## Requirements

- **R1**: Remove dependency on `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` env vars for auth
- **R2**: Use `gws auth export --unmasked` to obtain `authorized_user` credentials (client_id, client_secret, refresh_token)
- **R3**: Detect if `gws` CLI is installed and authenticated
- **R4**: FlowSpace auto-runs `gws auth login` from within the app — user never opens Terminal
- **R5**: Auto-install gws via npm if not present (Node.js is already a runtime dependency)
- **R6**: Bundle a pre-configured `client_secret.json` in the app so `gws auth setup` is never needed
- **R7**: Store imported credentials in the same format FlowSpace already uses (`.tokens.json` compatible)
- **R8**: Support re-authentication (token refresh, re-login)
- **R9**: The sign-in UX should work in both browser (dev) and Tauri WebView (production)
- **R10**: The sign-in flow must be gws-only by default. No legacy OAuth UI is shown. The app is a macOS desktop app — users will not have .env files or their own GCP projects.
- **R11**: Sign-in UI is a polished modal with animated illustration and single status line, giving an app-like feel during the multi-step process.

## GWS Credential Format

`gws auth export --unmasked` outputs:
```json
{
  "type": "authorized_user",
  "client_id": "...",
  "client_secret": "...",
  "refresh_token": "..."
}
```

This is the standard Google `authorized_user` format that `google-auth-library` can consume directly.

## Bundled Client Secret Format

FlowSpace ships a `client_secret.json` written to `~/.config/gws/client_secret.json`:
```json
{
  "installed": {
    "client_id": "<FlowSpace OAuth client ID>",
    "client_secret": "<FlowSpace OAuth client secret>",
    "auth_uri": "https://accounts.google.com/o/oauth2/auth",
    "token_uri": "https://oauth2.googleapis.com/token",
    "redirect_uris": ["http://localhost"]
  }
}
```

This is FlowSpace's own OAuth app registered in Google Cloud Console. Users never need to create their own.

## Scopes Required

FlowSpace needs: `drive`, `gmail`, `calendar`, `tasks` (plus `openid`, `email`, `profile`)

With gws: `gws auth login -s drive,gmail,calendar,tasks`

## Sign-in Modal UX

The sign-in modal has a polished, app-like feel:
- Centered modal with subtle backdrop blur
- Animated illustration (e.g., lock → unlocked transition, or FlowSpace logo with a pulse)
- Single status line that updates through each phase:
  - "Setting up..." (installing gws if needed)
  - "Opening browser for sign-in..." (gws auth login running)
  - "Waiting for approval..." (browser consent in progress)
  - "Completing sign-in..." (importing credentials)
  - "Welcome to FlowSpace!" (success, with user avatar if available)
- Error state: red status text with "Try again" button
- The modal blocks interaction with the rest of the app during sign-in

## Clarifications

### Session 2026-03-06
- Q: Which sign-in flow should be primary — gws-first, auto-detect, or side-by-side? → A: gws-only by default. This is a macOS desktop app for non-technical users; no legacy OAuth UI shown.
- Q: How should FlowSpace handle gws terminal commands for non-technical users? → A: Auto-run. FlowSpace spawns gws commands via shell and opens browser for consent automatically. User never opens Terminal.
- Q: What should FlowSpace do if gws CLI is not installed? → A: Auto-install via `npm install -g @googleworkspace/cli` since Node.js is already required. Fall back to showing instructions if npm fails.
- Q: How to handle gws auth setup requiring gcloud CLI? → A: Ship a pre-configured `client_secret.json` bundled in the app. Write it to `~/.config/gws/` so gws auth setup is never needed. Users go directly to gws auth login.
- Q: What should the user see during the multi-step sign-in process? → A: A polished modal with animated illustration and single status line that updates through each step. App-like feel, not a developer setup wizard.
