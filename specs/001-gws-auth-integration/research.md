# Research: GWS CLI Auth Integration

## Decision 1: How to consume gws credentials in Node.js

**Decision**: Use `gws auth export --unmasked` output directly with `google-auth-library`'s `OAuth2Client`

**Rationale**: The export format is:
```json
{
  "type": "authorized_user",
  "client_id": "...",
  "client_secret": "...",
  "refresh_token": "..."
}
```
This maps directly to `OAuth2Client` constructor + `setCredentials()`:
```typescript
const client = new OAuth2Client(creds.client_id, creds.client_secret);
client.setCredentials({ refresh_token: creds.refresh_token });
```
No transformation needed. The client handles token refresh automatically.

**Alternatives considered**:
- `GOOGLE_WORKSPACE_CLI_TOKEN` env var (access token only, expires in 1 hour, no auto-refresh)
- Reading encrypted `~/.config/gws/credentials.enc` directly (complex, requires decryption key from OS keyring)
- Using `gws` as an MCP server (overkill — FlowSpace already has Google API integration)

## Decision 2: How to detect gws installation and auth status

**Decision**: Shell out to `gws auth status` and parse JSON output

**Rationale**: `gws auth status` returns structured JSON with:
- `token_valid: true/false` — whether current auth is valid
- `has_refresh_token: true/false` — whether credentials exist
- `scope_count` / `scopes` — what scopes are authorized

We can check: (1) if `gws` binary exists (`which gws`), (2) if authenticated (`gws auth status` → `token_valid`), (3) if correct scopes are available.

**Alternatives considered**:
- Just checking for `~/.config/gws/credentials.enc` file (doesn't verify validity)
- Trying `gws auth export` and checking exit code (simpler but less informative)

## Decision 3: How to handle first-time setup

**Decision**: Auto-run gws commands from within the app via backend API endpoints (`execFile`, not shell). User never opens Terminal.

**Flow**:
1. Backend endpoint `GET /api/auth/gws-status` checks gws installation and auth
2. Frontend shows appropriate state via `SignInModal` state machine: checking → installing → login → polling → importing → success
3. If gws is not installed, `POST /api/auth/gws-install` runs `npm install -g @anthropic-ai/gws` server-side
4. `POST /api/auth/gws-login` runs `gws auth login -s drive,gmail,calendar,tasks` server-side, opens the browser automatically for Google consent
5. Frontend polls `POST /api/auth/gws-import` until credentials are available
6. Credentials saved to `.gws-credentials.json` in DATA_DIR

**Rationale**: Non-technical users (especially in a desktop app context) should never need to open a terminal. The app handles the entire gws lifecycle automatically.

**Alternatives considered**:
- Show terminal commands for users to copy-paste (rejected — violates spec R4 "user never opens Terminal")
- Embedding gws as a library (it's Rust, not Node.js — too heavy)

## Decision 4: Credential storage strategy

**Decision**: Store imported gws credentials in the same `.tokens.json` format FlowSpace already uses, plus persist the gws `authorized_user` JSON in `.gws-credentials.json`

**Rationale**:
- `.tokens.json` is already used throughout the codebase for OAuth tokens
- Storing the raw gws credentials separately allows re-import without re-running gws
- On token refresh failure, FlowSpace can re-read from gws (which manages its own token refresh)

**Alternatives considered**:
- Reading from gws every time (too slow — shell exec on every API call)
- Only storing in `.tokens.json` (loses client_id/secret mapping to gws)

## Decision 5: Eliminating GOOGLE_CLIENT_ID/SECRET requirement

**Decision**: When gws credentials are available, FlowSpace uses the client_id and client_secret FROM gws (which come from gws's own OAuth app). Users never need to create their own GCP project.

**Rationale**: This is the critical UX improvement. `gws auth setup` creates a GCP project and OAuth app automatically. The exported credentials include the client_id/secret from that project. FlowSpace just reuses them.

**For published app**: Users click "Sign in with Google" → FlowSpace auto-installs gws if needed, writes bundled `client_secret.json`, runs `gws auth login`, and imports credentials. Zero manual GCP console work, no terminal, no `.env` configuration needed for auth.

## Decision 6: Scope management

**Decision**: Require `gws auth login -s drive,gmail,calendar,tasks` with explicit service selection

**Rationale**:
- gws's "recommended" scope preset includes 85+ scopes and fails for unverified apps
- Selecting specific services (`-s drive,gmail,calendar,tasks`) keeps scopes under the ~25 limit for testing-mode apps
- FlowSpace also needs `openid`, `email`, `profile` — gws includes these by default with any service selection

**Note**: Users may need to re-run `gws auth login -s drive,gmail,calendar,tasks` if they initially authenticated with fewer scopes. The status endpoint should detect this.
