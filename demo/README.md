# FlowSpace Demo

A self-contained mock server for taking screenshots and recordings without connecting a real Google account.

## Usage

```bash
# From the repo root — build the frontend first (only needed once)
npm run build

# Start the demo server
npm run demo
```

Then open **http://localhost:4000** in your browser.

## What it does

- Serves the real compiled frontend from `dist/`
- Intercepts all `/api/*` calls and returns realistic fake data
- Pre-populated with a believable workspace: emails, calendar events, Drive files, AI briefing
- The AI chat responds intelligently to questions about email, meetings, files, and tasks

## Mock data

Edit `demo/mock-server/data.json` to change the demo content — the persona, emails, calendar events, files, and briefing text.

The mock user is **Alex Rivera** at `acmecorp.com`.
