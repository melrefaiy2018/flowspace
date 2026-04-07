# Quickstart: GWS Auth Integration

> No GCP project creation needed. FlowSpace bundles a pre-configured `client_secret.json`.

## For Users (Published App)

### 1. Open FlowSpace
Launch the app (Tauri desktop or `make dev` for browser).

### 2. Sign in with Google
Click "Sign in with Google" — the app automatically:
- Installs gws CLI if not found
- Writes the bundled `client_secret.json` to `~/.config/gws/`
- Opens your browser for Google consent
- Imports credentials once you approve

### 3. Done
FlowSpace loads your Drive, Gmail, Calendar, and Tasks data.

## For Developers

### Backend changes (server.ts)
- New `loadGwsCredentials()` function reads `.gws-credentials.json` or shells out to `gws auth export`
- New endpoints: `GET /api/auth/gws-status`, `POST /api/auth/gws-install`, `POST /api/auth/gws-login`, `POST /api/auth/gws-import`
- Modified `loadCredentials()` priority: gws → ADC (dev fallback)
- Modified `GET /api/auth/status` to include `auth_method` and `gws_available`

### Frontend changes
- `SignInScreen` — full-page auth gate
- `SignInModal` — state machine: checking → installing → login → polling → importing → success
- All gws commands are run server-side via `execFile` (no terminal needed)

### Testing
```bash
# Verify gws is authenticated
gws auth status

# Verify credentials can be exported
gws auth export --unmasked

# Start FlowSpace dev server
make dev

# Should auto-detect gws credentials on startup
```
