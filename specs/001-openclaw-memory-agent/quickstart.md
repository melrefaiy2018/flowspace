# Quickstart: OpenClaw Memory Agent

## Prerequisites

- Node.js 20+
- FlowSpace running (`make dev` or `npm run dev`)
- Google account connected (sign in via the app)
- LLM provider configured (Settings → LLM Provider)
- At least one calendar event in the next 48 hours with >= 2 external attendees

## Usage

1. Open FlowSpace dashboard
2. The **Meeting Prep** panel appears above Attention items
3. Click **"Scan next 48h"**
4. Wait ~30-70 seconds while the scanner:
   - Reads your calendar (next 48 hours)
   - Filters meetings (>= 30 min, >= 2 external attendees, max 10)
   - Searches your emails for attendee context (last 7 days)
   - Searches your Drive for related files
   - Generates a brief for each qualifying meeting
5. Meeting prep cards appear, sorted by meeting time
6. For each card:
   - **Approve** → Opens AI chat with the brief pre-loaded as context. Ask follow-up questions.
   - **Dismiss** → Removes the card
   - **Useful?** toggle → Records whether the brief was helpful (used for future improvements)

## States

| State | What you see |
|-------|-------------|
| First run | "Scan your calendar to prep for upcoming meetings" + Scan button |
| Scanning | Skeleton cards + "Prepping meeting 3 of 8..." |
| Populated | Meeting prep cards sorted by time |
| Empty | "All caught up — no meetings need prep" |
| Partial | Cards + amber banner "3 of 8 couldn't be prepped" |
| Error | Red banner + error message + "Try again" |
| All actioned | "You've reviewed all meeting preps. Nice." |

## Development

```bash
# Run tests
npm test -- --grep "horizon-scanner\|drafts-api\|draft-queue"

# Run with coverage
npm run test:coverage

# Type check
make typecheck
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/drafts/scan` | Trigger horizon scan |
| GET | `/api/drafts` | List staged drafts |
| POST | `/api/drafts/:id/approve` | Approve draft (returns threadBrief for chat) |
| POST | `/api/drafts/:id/dismiss` | Dismiss draft |
| PATCH | `/api/drafts/:id/useful` | Toggle useful boolean |

See `specs/001-openclaw-memory-agent/contracts/drafts-api.md` for full API contract.
