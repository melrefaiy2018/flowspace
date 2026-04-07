# Implementation Plan: Connect FlowSpace to Real Google Workspace Data via `gws` CLI

**Date**: 2026-03-05 | **Project**: FlowSpace
**Input**: Replace all mock/hardcoded data with live Google Workspace data using the `gws` CLI

## Summary

FlowSpace is a Google Workspace automation dashboard (React 19 + Express + Vite) that currently renders entirely hardcoded mock data. The goal is to connect it to real Google Workspace data by using the `gws` CLI as the data layer, executing `gws` commands from the Express backend and serving real data to the React frontend.

**Key insight**: Instead of the complex `googleapis` npm SDK + OAuth-in-browser flow, we use `gws` CLI which handles its own auth via OS keyring. The Express backend shells out to `gws` commands and returns structured JSON to the frontend.

## Technical Context

**Language/Version**: TypeScript 5.8 (Node 25, React 19)
**Primary Dependencies**: Express 4, Vite 6, React 19, Tailwind v4, `motion`, `lucide-react`
**External Tool**: `gws` CLI v0.4.4 (Google Workspace CLI - Rust binary, auth via OS keyring)
**Storage**: None (stateless - all data fetched live from Google APIs via `gws`)
**Testing**: Manual (no test framework currently configured)
**Target Platform**: localhost:3000 (dev)
**Constraints**: `gws` CLI must be authenticated (`gws auth login` completed)

## Architecture Decision: `gws` CLI vs `googleapis` npm

| Approach | Pros | Cons |
|----------|------|------|
| **`gws` CLI (chosen)** | No OAuth credentials needed in app, auth handled by OS keyring, simple JSON output, built-in pagination | Subprocess overhead per request, depends on external binary |
| `googleapis` npm SDK | In-process, no subprocess overhead | Requires OAuth client ID/secret, complex token refresh, heavy dependency |

**Decision**: Use `gws` CLI. The subprocess overhead is negligible for a personal dashboard, and it eliminates the entire OAuth configuration burden.

## Project Structure

```text
flowspace/
├── server.ts                    # Express backend (MODIFY: add gws API routes)
├── src/
│   ├── App.tsx                  # Main layout (MODIFY: fetch real data)
│   ├── main.tsx                 # Entry point (no change)
│   ├── index.css                # Styles (no change)
│   ├── services/
│   │   └── api.ts               # NEW: API client for frontend
│   ├── hooks/
│   │   └── useWorkspaceData.ts  # NEW: React hooks for data fetching
│   └── components/
│       ├── Sidebar.tsx          # MODIFY: real user profile from gws
│       ├── Topbar.tsx           # No change (static UI)
│       ├── StatStrip.tsx        # MODIFY: computed from real data
│       ├── AutomationGrid.tsx   # MODIFY: real Drive/Gmail/Calendar data
│       ├── ActivityFeed.tsx     # MODIFY: real recent activity
│       └── CalloutStrip.tsx     # REMOVE: design annotations, not for production
├── specs/
│   └── plan.md                  # This file
├── .env                         # Minimal config (no OAuth secrets needed)
└── package.json
```

## Phase 0: Research

### R1: What data can `gws` CLI provide?

**Finding**: `gws` supports 25+ Google Workspace services. Relevant ones for FlowSpace:

| Service | Command | Data Available |
|---------|---------|----------------|
| **Drive** | `gws drive files list` | Files, folders, recent activity, sharing |
| **Gmail** | `gws gmail users messages list` | Messages, labels, threads |
| **Calendar** | `gws calendar events list` | Events, attendees, schedules |
| **Sheets** | `gws sheets spreadsheets get` | Spreadsheet data |
| **Tasks** | `gws tasks tasklists list` | Task lists and items |
| **People** | `gws people people get` | User profile, contacts |
| **Workflow** | `gws workflow +standup-report` | Cross-service summaries |

**Output format**: All commands return JSON by default. Use `--format json` explicitly.

### R2: How to execute `gws` from Node.js?

**Decision**: Use `child_process.execFile` (not `exec`) for security - avoids shell injection.

```typescript
import { execFile } from 'child_process';
import { promisify } from 'util';
const execFileAsync = promisify(execFile);

async function gws(...args: string[]): Promise<any> {
  const { stdout } = await execFileAsync('gws', args, { timeout: 30000 });
  return JSON.parse(stdout);
}
```

**Rationale**: `execFile` doesn't spawn a shell, so user-supplied parameters can't inject commands. Timeout prevents hanging on network issues.

### R3: Auth prerequisite

**Finding**: `gws auth login` must be completed once interactively (opens browser). After that, tokens are encrypted in OS keyring and auto-refresh. The Express backend inherits the same credentials since it runs as the same OS user.

**Required scopes** (set during `gws auth login --scopes`):
- `drive` - file listings, recent activity
- `gmail` - message counts, recent messages
- `calendar` - upcoming events
- `sheets` - spreadsheet data (if needed)
- `tasks` - task lists

### R4: What replaces "Automations"?

**Decision**: The current "Automations" concept (mock workflow cards) maps to **real Google Workspace activity patterns**. Rather than fake automations, we show:

1. **Workspace Overview Cards** - real summaries of Drive, Gmail, Calendar, Tasks
2. **Recent Activity Feed** - actual recent files modified, emails received, events
3. **Stats Strip** - real counts (unread emails, upcoming events, recent files, tasks due)

This is more honest and useful than pretending to have automation workflows that don't exist.

## Phase 1: Design & Contracts

### Data Model

#### WorkspaceStats
```typescript
interface WorkspaceStats {
  driveFilesRecent: number;    // files modified in last 7 days
  unreadEmails: number;        // Gmail unread count
  upcomingEvents: number;      // Calendar events in next 7 days
  openTasks: number;           // Incomplete tasks
  storageUsedGB: number;       // Drive storage used
}
```

#### DriveFile
```typescript
interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
  owners: { displayName: string; photoLink?: string }[];
  webViewLink: string;
  iconLink: string;
  shared: boolean;
}
```

#### GmailThread
```typescript
interface GmailThread {
  id: string;
  snippet: string;
  from: string;
  subject: string;
  date: string;
  labelIds: string[];
  unread: boolean;
}
```

#### CalendarEvent
```typescript
interface CalendarEvent {
  id: string;
  summary: string;
  start: string;   // ISO datetime
  end: string;
  attendees: number;
  hangoutLink?: string;
  status: 'confirmed' | 'tentative' | 'cancelled';
}
```

#### UserProfile
```typescript
interface UserProfile {
  name: string;
  email: string;
  picture?: string;
}
```

### API Contracts

#### `GET /api/auth/status`
Returns auth state. Replaces the OAuth flow.
```json
// 200 OK (authenticated)
{ "authenticated": true, "user": { "name": "...", "email": "...", "picture": "..." } }
// 200 OK (not authenticated)
{ "authenticated": false, "error": "gws CLI not authenticated. Run: gws auth login" }
```

**Implementation**: Run `gws people people get --params '{"resourceName":"people/me","personFields":"names,emailAddresses,photos"}'`

#### `GET /api/stats`
Returns workspace statistics for the stat strip.
```json
{
  "driveFilesRecent": 23,
  "unreadEmails": 14,
  "upcomingEvents": 8,
  "openTasks": 5,
  "storageUsedGB": 4.2
}
```

**Implementation**: Parallel `gws` calls to drive, gmail, calendar, tasks.

#### `GET /api/drive/recent?limit=20`
Returns recent Drive files.
```json
{
  "files": [
    { "id": "...", "name": "Q1 Report.docx", "mimeType": "...", "modifiedTime": "...", "shared": true }
  ]
}
```

**Implementation**: `gws drive files list --params '{"pageSize":20,"orderBy":"modifiedTime desc","fields":"files(id,name,mimeType,modifiedTime,owners,webViewLink,iconLink,shared)"}'`

#### `GET /api/gmail/recent?limit=10`
Returns recent Gmail threads.
```json
{
  "threads": [
    { "id": "...", "snippet": "...", "from": "...", "subject": "...", "date": "...", "unread": true }
  ]
}
```

**Implementation**: `gws gmail users messages list --params '{"userId":"me","maxResults":10}'` then fetch details per message.

#### `GET /api/calendar/upcoming?days=7`
Returns upcoming calendar events.
```json
{
  "events": [
    { "id": "...", "summary": "Team Standup", "start": "...", "end": "...", "attendees": 5 }
  ]
}
```

**Implementation**: `gws calendar events list --params '{"calendarId":"primary","timeMin":"NOW","timeMax":"NOW+7d","orderBy":"startTime","singleEvents":true}'`

#### `GET /api/activity/recent?limit=20`
Returns unified recent activity across all services (merged + sorted by time).
```json
{
  "activities": [
    { "type": "drive", "action": "modified", "title": "Q1 Report", "time": "2m ago", "icon": "file" },
    { "type": "gmail", "action": "received", "title": "Re: Project Update", "time": "15m ago", "icon": "mail" },
    { "type": "calendar", "action": "upcoming", "title": "Team Standup", "time": "in 30m", "icon": "calendar" }
  ]
}
```

**Implementation**: Parallel fetch from drive/gmail/calendar, merge, sort by timestamp, take top N.

### Quickstart

After implementation:
```bash
# 1. Authenticate gws (one-time, opens browser)
gws auth login --scopes drive,gmail,calendar,tasks

# 2. Start FlowSpace
cd flowspace && npm run dev

# 3. Open http://localhost:3000
```

No OAuth client IDs, no Google Cloud Console configuration needed.

## Implementation Phases

### Phase A: Backend - `gws` executor utility (server.ts)
1. Create a `gws()` helper function using `execFile` (secure, no shell)
2. Add error handling for: gws not installed, not authenticated, API errors
3. Add simple in-memory cache (60s TTL) to avoid hammering APIs on every page load

### Phase B: Backend - API endpoints
4. `GET /api/auth/status` - check gws auth + fetch user profile
5. `GET /api/stats` - parallel gws calls for stat strip data
6. `GET /api/drive/recent` - recent Drive files
7. `GET /api/gmail/recent` - recent Gmail messages
8. `GET /api/calendar/upcoming` - upcoming events
9. `GET /api/activity/recent` - unified activity feed

### Phase C: Frontend - Data layer
10. Create `src/services/api.ts` - typed fetch wrapper for all endpoints
11. Create `src/hooks/useWorkspaceData.ts` - React hooks with loading/error states

### Phase D: Frontend - Component rewiring
12. `Sidebar.tsx` - real user profile from `/api/auth/status`
13. `StatStrip.tsx` - real stats from `/api/stats`
14. `AutomationGrid.tsx` - replace mock cards with real workspace service cards (Drive, Gmail, Calendar, Tasks)
15. `ActivityFeed.tsx` - real activity from `/api/activity/recent`
16. Remove `CalloutStrip.tsx` (design annotations)
17. Update `App.tsx` - remove CalloutStrip import, wire up data loading

### Phase E: Polish
18. Loading skeletons for async data
19. Error states (gws not authenticated, API failures)
20. Remove unused OAuth code from server.ts (googleapis, google-auth-library deps)
