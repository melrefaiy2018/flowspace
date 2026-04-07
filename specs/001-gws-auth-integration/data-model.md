# Data Model: GWS Auth Integration

## Entities

### GwsStatus

Returned by `GET /api/auth/gws-status`. Represents the current state of gws CLI auth.

| Field | Type | Description |
|-------|------|-------------|
| installed | boolean | Whether `gws` binary is on PATH |
| authenticated | boolean | Whether gws has valid credentials |
| has_required_scopes | boolean | Whether drive, gmail, calendar, tasks scopes are authorized |
| current_scopes | string[] | List of currently authorized scopes |
| project_id | string \| null | GCP project ID from gws |
| user_email | string \| null | Authenticated user email |

### GwsCredentials

The raw output of `gws auth export --unmasked`. Stored in `DATA_DIR/.gws-credentials.json`.

| Field | Type | Description |
|-------|------|-------------|
| type | "authorized_user" | Credential type identifier |
| client_id | string | OAuth client ID from gws's GCP project |
| client_secret | string | OAuth client secret |
| refresh_token | string | Long-lived refresh token |

### AuthStatus (existing, extended)

Extended response from `GET /api/auth/status`.

| Field | Type | Description |
|-------|------|-------------|
| authenticated | boolean | Whether FlowSpace can make Google API calls |
| auth_method | "gws" \| "adc" \| null | How credentials were obtained |
| user | UserProfile \| null | User name, email, picture |
| gws_available | boolean | Whether gws CLI is installed |

## State Transitions

```
[No Auth] → app auto-installs gws → [GWS Installed, Not Authenticated]
         → app runs gws auth login → [GWS Authenticated]
         → app imports creds       → [FlowSpace Authenticated]
         → token expires   → [Auto-refresh via OAuth2Client]
         → refresh fails   → [Re-import from gws or re-login]
```

## File Storage

| File | Location | Purpose |
|------|----------|---------|
| `.gws-credentials.json` | DATA_DIR | Raw gws export (client_id + client_secret + refresh_token) |
| `.tokens.json` | DATA_DIR | OAuth tokens for google-auth-library (existing) |
| `.env` | DATA_DIR | Only needs GLM_API_KEY now (no more GOOGLE_CLIENT_ID/SECRET) |
