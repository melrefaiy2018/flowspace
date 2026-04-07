# API Contract: GWS Auth Endpoints

## GET /api/auth/gws-status

Check if gws CLI is installed and authenticated.

**Response** `200 OK`:
```json
{
  "installed": true,
  "authenticated": true,
  "has_required_scopes": true,
  "current_scopes": ["https://www.googleapis.com/auth/drive", "..."],
  "project_id": "knights-path",
  "user_email": "user@gmail.com"
}
```

**Response** (gws not installed) `200 OK`:
```json
{
  "installed": false,
  "authenticated": false,
  "has_required_scopes": false,
  "current_scopes": [],
  "project_id": null,
  "user_email": null
}
```

## POST /api/auth/gws-import

Import credentials from gws CLI into FlowSpace.

**Request**: No body needed.

**Response** `200 OK`:
```json
{
  "success": true,
  "user": {
    "name": "FlowSpace User",
    "email": "user@example.com",
    "picture": "https://..."
  }
}
```

**Response** `500`:
```json
{
  "error": "gws not authenticated. Run: gws auth login -s drive,gmail,calendar,tasks"
}
```

## GET /api/auth/status (modified)

Existing endpoint, extended with `auth_method` and `gws_available`.

**Response** `200 OK` (authenticated):
```json
{
  "authenticated": true,
  "auth_method": "gws",
  "gws_available": true,
  "user": {
    "name": "FlowSpace User",
    "email": "user@example.com",
    "picture": "https://..."
  }
}
```

**Response** `200 OK` (not authenticated):
```json
{
  "authenticated": false,
  "auth_method": null,
  "gws_available": true,
  "error": "Not authenticated"
}
```

## Credential Loading Priority (server startup)

1. `.gws-credentials.json` in DATA_DIR (gws-imported credentials)
2. ADC fallback (dev-only)
