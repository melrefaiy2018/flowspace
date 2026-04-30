#!/usr/bin/env node
/**
 * FlowSpace Demo Mock Server
 *
 * Serves the real built frontend from ../../dist/ but intercepts all /api/*
 * calls and returns realistic fake data from data.json.
 *
 * Usage:
 *   node demo/mock-server/server.mjs
 *
 * Then open http://localhost:4000 in your browser.
 * No Google account or API keys required — perfect for screenshots.
 */

import express from 'express';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const PORT = 4000;

// Load mock data
const DATA = JSON.parse(fs.readFileSync(path.join(__dirname, 'data.json'), 'utf-8'));

// ── Mock API routes ───────────────────────────────────────────────────

app.get('/api/auth/status', (_req, res) => {
  res.json(DATA.auth_status);
});

app.get('/api/auth/gws-status', (_req, res) => {
  res.json({ installed: true, authenticated: true, account: DATA.auth_status.user.email });
});

app.get('/api/stats', (_req, res) => {
  res.json(DATA.stats);
});

app.get('/api/drive/recent', (_req, res) => {
  res.json(DATA.drive_recent);
});

app.get('/api/gmail/recent', (_req, res) => {
  res.json(DATA.gmail_recent);
});

app.get('/api/calendar/upcoming', (_req, res) => {
  res.json(DATA.calendar_upcoming);
});

app.get('/api/activity/recent', (_req, res) => {
  res.json(DATA.activity_recent);
});

app.get('/api/briefing', (_req, res) => {
  // Simulate a slight delay like a real AI call
  setTimeout(() => res.json(DATA.briefing), 400);
});

app.get('/api/followups', (_req, res) => {
  res.json({ followups: DATA.briefing.followups });
});

app.get('/api/tasks', (_req, res) => {
  res.json(DATA.tasks);
});

// ── Google Sheets mock ────────────────────────────────────────────────

app.get('/api/sheets/:id', (req, res) => {
  const sheet = DATA.sheets_data[req.params.id];
  if (sheet) {
    res.json({ values: sheet.values, headers: sheet.headers, metadata: sheet.metadata });
  } else {
    // Return the first sheet as fallback
    const first = Object.values(DATA.sheets_data)[0];
    res.json(first ? { values: first.values, headers: first.headers, metadata: first.metadata } : { values: [], headers: [] });
  }
});

// ── Google Docs mock ──────────────────────────────────────────────────

app.get('/api/docs/:id', (req, res) => {
  const doc = DATA.docs_data[req.params.id];
  if (doc) {
    res.json(doc);
  } else {
    const first = Object.values(DATA.docs_data)[0];
    res.json(first ?? { title: 'Not found', content: '' });
  }
});

// ── Horizon / Draft Queue endpoints ──────────────────────────────────

const MOCK_DRAFTS = [
  {
    id: 'draft-001',
    meetingId: 'evt-proactive-001',
    meetingTitle: '⚡ Handled while you slept — Board Meeting infra doc',
    meetingTime: '2026-04-10T09:00:00-07:00',
    attendees: ['s.chen@linearsync.io', 'jamie.chen@linearsync.io'],
    summary: `## What happened at 3:04 AM

Sarah Chen (VP Eng) emailed urgently: the board meeting moved to **9 AM** and she needed an infrastructure cost breakdown doc before standup.

## What I did while you slept

1. **Read Sarah's email** — detected high urgency (manager, board meeting, doc creation needed)
2. **Searched Drive** — found the Q1 Infrastructure Cost Tracking sheet
3. **Read cost data** — identified the March spike: **$21,200 (+31% MoM)**, root cause: bulk export egress from Acme Corp onboarding
4. **Cross-referenced the AWS billing email** — confirmed $18,420 March bill, +34% from February
5. **Created the doc** — *"Infra Cost Breakdown — Board Meeting Apr 10"* with full analysis, cost tables, per-segment margins, and recommendations
6. **Drafted a reply to Sarah** — links to the doc, explains the spike, offers to make edits

## Draft reply (ready to send)

> Hi Sarah,
>
> Got it — I've prepared the infra cost breakdown doc for the board. The March spike (+34%) is driven by data transfer costs from Acme Corp's nightly bulk exports (200K+ rows). S3 egress alone tripled. With the export fix in Sprint 23, costs return to ~$16K/month.
>
> Full doc with cost tables and recommendations is ready in Drive.
>
> Jamie

## Key findings in the doc

| Month | Total | Change |
|---|---|---|
| January | $14,440 | — |
| February | $16,200 | +12% |
| **March** | **$21,200** | **+31%** |

- Root cause: Acme Corp onboarding → nightly 200K-row exports → S3 egress 3×
- Fix: bulk export streaming (Sprint 23) → projected back to ~$16K/month
- Recommendation: add export quotas for trial accounts (22% of egress costs)`,
    linkedDocs: [
      { title: 'Infra Cost Breakdown — Board Meeting Apr 10 [DRAFT]', url: 'https://docs.google.com/document/d/drive-009/edit' },
      { title: 'Q1 Infrastructure Cost Tracking', url: 'https://docs.google.com/spreadsheets/d/drive-001/edit' }
    ],
    relatedEmails: [
      {
        subject: 'URGENT: Board meeting moved to 9 AM — need infra cost doc before standup',
        from: 'Sarah Chen <s.chen@linearsync.io>',
        snippet: "Hey Jamie — really sorry to ping at this hour. Board meeting just got moved to 9 AM tomorrow. I need the infra cost breakdown doc ready before standup..."
      },
      {
        subject: 'AWS March Bill — $18,420 (↑34% from Feb)',
        from: 'AWS Billing <billing@aws.amazon.com>',
        snippet: 'Your AWS bill for March was $18,420 — up 34% from February. The spike is in data transfer costs. Full cost breakdown attached.'
      }
    ],
    suggestedActions: [
      'Send the draft reply to Sarah',
      'Review the cost breakdown doc before the board meeting',
      'Add export quota task to Sprint 23 backlog'
    ],
    confidence: 1.0,
    confidenceReason: 'Triggered by urgent manager email at 3:04 AM',
    createdAt: '2026-04-10T03:07:00Z',
    status: 'pending'
  },
  {
    id: 'draft-002',
    meetingId: 'evt-002',
    meetingTitle: 'Acme Corp — Renewal Check-in',
    meetingTime: '2026-04-10T11:00:00-07:00',
    attendees: ['priya.nair@linearsync.io', 'marcus.webb@acmecorp.com', 'sandra.park@acmecorp.com'],
    summary: `## Meeting context

$142K renewal at risk. Acme Corp's CTO (Sandra Park) has a board meeting May 3 and needs to show the bulk export issue is resolved. You committed to having an engineering timeline by **today**.

## What I found across your workspace

**From Apr 8 call notes (Drive):**
- Bulk export times out on datasets >50k rows
- Their data team runs nightly exports of 200k+ rows — core to their workflow
- Action item: get eng timeline to Marcus by Apr 11

**From the Account Health Sheet:**
- Health score: 62 (down from 71 last month)
- 3 open support tickets
- Acme NPS: 28 (company average: 41)

**Cross-signal — March NPS report:**
- 18 of 23 detractor responses cite slow export performance
- Acme's issue is part of a broader pattern affecting multiple accounts

**From the feature backlog:**
- Bulk export fix: 18 votes, $180K ARR impact, Sprint 23 planned

## Recommended approach

Lead with the Sprint 23 commitment and a specific date. Bring the account health numbers. Don't let the call end without a written timeline you can share with Marcus before EOD.`,
    linkedDocs: [
      { title: 'Acme Corp — Renewal Call Notes (Apr 8)', url: 'https://docs.google.com/document/d/drive-003/edit' },
      { title: 'Enterprise Customers — Account Health Tracker', url: 'https://docs.google.com/spreadsheets/d/drive-001/edit' }
    ],
    relatedEmails: [
      {
        subject: 'URGENT: Acme Corp renewal at risk — bulk export bug',
        from: 'Priya Nair <priya.nair@linearsync.io>',
        snippet: "Hi Jamie — we just got off a call with the Acme Corp team. They're flagging a critical issue with bulk data exports timing out on datasets over 50k rows..."
      }
    ],
    suggestedActions: [
      'Get engineering timeline for bulk export fix before the call',
      'Reply to Priya with a status update',
      'Prepare Sprint 23 commitment to share with Marcus'
    ],
    confidence: 1.0,
    confidenceReason: 'High-value renewal meeting with cross-service risk signals',
    createdAt: '2026-04-10T07:30:00Z',
    status: 'pending'
  }
];

const MOCK_LAST_SCAN = {
  scannedAt: '2026-04-10T07:30:00Z',
  meetingsFound: 2,
  meetingsPrepped: 2,
  errors: []
};

// On load, only surface the proactive overnight draft in the home strip.
// The meeting prep brief (draft-002) is discovered via Scan inside Horizon.
app.get('/api/drafts', (_req, res) => {
  res.json({ drafts: MOCK_DRAFTS.slice(0, 1), lastScan: null });
});

app.post('/api/drafts/scan', (_req, res) => {
  setTimeout(() => res.json({ drafts: MOCK_DRAFTS, meta: MOCK_LAST_SCAN }), 1200);
});

app.post('/api/drafts/:id/approve', (req, res) => {
  const draft = MOCK_DRAFTS.find(d => d.id === req.params.id);
  if (!draft) return res.status(404).json({ error: 'Draft not found' });
  const approved = { ...draft, status: 'approved' };
  const threadBrief = draft.summary.slice(0, 300);
  res.json({
    draft: approved,
    threadBrief,
    sources: {
      emails: draft.relatedEmails,
      docs: draft.linkedDocs,
      attendees: draft.attendees,
      meetingTitle: draft.meetingTitle,
      meetingTime: draft.meetingTime
    }
  });
});

app.post('/api/drafts/:id/dismiss', (req, res) => {
  res.json({ success: true });
});

app.patch('/api/drafts/:id/useful', express.json(), (req, res) => {
  res.json({ success: true, useful: req.body?.useful ?? true });
});

// ── Proactive draft endpoint ──────────────────────────────────────────

app.get('/api/proactive-draft', (_req, res) => {
  res.json(DATA.proactive_draft);
});

app.post('/api/proactive-draft/send', express.json(), (_req, res) => {
  setTimeout(() => res.json({ success: true, message: 'Reply sent to Sarah Chen.' }), 600);
});

// ── Write stub endpoints ──────────────────────────────────────────────

app.post('/api/draft-reply', express.json(), (req, res) => {
  const threadId = req.body?.threadId ?? '';
  // Return the pre-drafted reply for the proactive scenario
  if (threadId === 'thread-010') {
    setTimeout(() => res.json({ draft: DATA.proactive_draft.draft_reply.body }), 500);
    return;
  }
  setTimeout(() => res.json({
    draft: `Hi,\n\nThanks for reaching out. I've reviewed the details and want to make sure we address this urgently.\n\nLet's connect tomorrow at 10 AM to align on next steps — I'll send a calendar invite.\n\nBest,\nJamie`
  }), 800);
});

app.post('/api/send-reply', express.json(), (_req, res) => {
  res.json({ success: true });
});

// ── Shared chat reply picker ──────────────────────────────────────────

function pickReply(message) {
  const m = message.toLowerCase();
  const r = DATA.chat_responses;

  if (m.includes('sleep') || m.includes('overnight') || m.includes('3 am') || m.includes('while i') || m.includes('sarah') || m.includes('board meeting') || m.includes('handled') || m.includes('proactive')) return r.proactive_draft;
  if (m.includes('infra') || m.includes('cost') || m.includes('aws') || m.includes('infrastructure') || m.includes('budget') || m.includes('billing')) return r.infra_cost;
  if (m.includes('acme') || m.includes('renewal') || m.includes('tom briggs')) return r.acme_prep;
  if (m.includes('nps') || m.includes('detract') || m.includes('sentiment')) return r.nps_summary;
  if (m.includes('sprint') || m.includes('backlog') || m.includes('priorit')) return r.sprint_planning;
  if (m.includes('standup') || m.includes('yesterday') || m.includes('blocker')) return r.standup;
  if (m.includes('account') || m.includes('health') || m.includes('churn') || m.includes('at-risk')) return r.account_health;

  if (m.includes('email') || m.includes('inbox') || m.includes('unread') || m.includes('mail')) {
    return `You have **${DATA.stats.unreadEmails} unread emails**. Most urgent:\n\n` +
      `• **Priya Nair** — "Acme Corp renewal at risk" (needs response today)\n` +
      `• **Tom Briggs** — following up for the 6th time on the bulk export bug (6 weeks overdue)\n` +
      `• **Marcus Webb** — NPS dropped from 52→41, bulk export cited in 18/23 detractor responses\n\n` +
      `Want me to draft a reply to Priya or Tom?`;
  }
  if (m.includes('calendar') || m.includes('meeting') || m.includes('schedule') || m.includes('today')) {
    return `You have **${DATA.stats.upcomingEvents} events** coming up. Key meetings today:\n\n` +
      `• **9:00 AM** — Eng Standup (15 min) — bulk export bug likely on the agenda\n` +
      `• **11:00 AM** — Acme Corp Renewal Check-in with Tom Briggs (45 min) — $142K renewal, HIGH risk\n` +
      `• **2:00 PM** — Sprint 23 Planning (2 hr) — Q2 Roadmap deck linked\n\n` +
      `The 11 AM is your highest-stakes meeting. Renewal call notes from Apr 8 are in Drive if you want to prep.`;
  }
  if (m.includes('drive') || m.includes('file') || m.includes('doc') || m.includes('sheet')) {
    return `Recent files in Drive:\n\n` +
      `• **Enterprise Customers — Account Health Tracker** (Sheets, updated this morning) — Acme Corp flagged HIGH risk\n` +
      `• **Acme Corp — Renewal Call Notes Apr 8** (Doc) — action items from last week's call\n` +
      `• **Q2 2026 — Product Roadmap** (Slides, updated yesterday)\n` +
      `• **Sprint 22 Retrospective Notes** (Doc) — bulk export flagged as P0\n\n` +
      `Want me to read any of these?`;
  }
  if (m.includes('task') || m.includes('todo') || m.includes('action item')) {
    const tasks = DATA.tasks.tasks;
    return `You have **${tasks.length} open tasks**:\n\n` +
      tasks.map(t => `• **${t.title}**${t.due ? ` — due ${t.due}` : ''}`).join('\n') + '\n\n' +
      `Most urgent: respond to Acme renewal risk (overdue) and file the bulk export bug report (due today).`;
  }
  return r.default;
}

// ── Streaming chat (newline-delimited JSON) ───────────────────────────

app.post('/api/chat/stream', express.json(), (req, res) => {
  const messages = req.body?.messages ?? [];
  const lastUser = [...messages].reverse().find(m => m.role === 'user');
  const text = lastUser?.content ?? '';
  const reply = pickReply(typeof text === 'string' ? text : text?.[0]?.text ?? '');

  res.setHeader('Content-Type', 'application/x-ndjson');
  res.setHeader('Transfer-Encoding', 'chunked');
  res.flushHeaders();

  // Stream the reply word-by-word to simulate typing
  const words = reply.split(' ');
  let i = 0;

  function sendNext() {
    if (i === 0) {
      res.write(JSON.stringify({ type: 'assistant_begin' }) + '\n');
    }
    if (i < words.length) {
      const chunk = (i === 0 ? '' : ' ') + words[i];
      res.write(JSON.stringify({ type: 'assistant_chunk', chunk }) + '\n');
      i++;
      setTimeout(sendNext, 30 + Math.random() * 20);
    } else {
      res.write(JSON.stringify({
        type: 'assistant_complete',
        payload: { content: reply, blocks: [], toolEvents: [], suggestions: [] }
      }) + '\n');
      res.end();
    }
  }

  setTimeout(sendNext, 200);
});

// ── Approval endpoint ─────────────────────────────────────────────────

app.post('/api/chat/approve', express.json(), (req, res) => {
  res.setHeader('Content-Type', 'application/x-ndjson');
  res.setHeader('Transfer-Encoding', 'chunked');
  res.flushHeaders();

  const reply = 'Done! The action has been completed successfully.';
  res.write(JSON.stringify({ type: 'assistant_begin' }) + '\n');
  setTimeout(() => {
    res.write(JSON.stringify({ type: 'assistant_chunk', chunk: reply }) + '\n');
    res.write(JSON.stringify({
      type: 'assistant_complete',
      payload: { content: reply, blocks: [], toolEvents: [], suggestions: [] }
    }) + '\n');
    res.end();
  }, 400);
});

// ── Legacy non-streaming chat (fallback) ─────────────────────────────

app.post('/api/chat', express.json(), (req, res) => {
  const messages = req.body?.messages ?? [];
  const lastUser = [...messages].reverse().find(m => m.role === 'user');
  const text = lastUser?.content ?? req.body?.message ?? '';
  const reply = pickReply(typeof text === 'string' ? text : text?.[0]?.text ?? '');
  setTimeout(() => res.json({ content: reply, blocks: [], toolEvents: [], suggestions: [] }), 600);
});

// ── Serve built frontend ──────────────────────────────────────────────

const distDir = path.join(__dirname, '..', '..', 'dist');

if (!fs.existsSync(path.join(distDir, 'index.html'))) {
  console.error('\n  ✗ Frontend not built. Run: npm run build\n');
  process.exit(1);
}

app.use(express.static(distDir));
app.get('*', (_req, res) => res.sendFile(path.join(distDir, 'index.html')));

// ── Start ──────────────────────────────────────────────────────────────

app.listen(PORT, '127.0.0.1', () => {
  console.log('');
  console.log('  FlowSpace Demo Server');
  console.log(`  http://localhost:${PORT}`);
  console.log('');
  console.log('  Persona: Jamie Chen — PM at LinearSync.io');
  console.log('  Story:   Acme Corp $142K renewal at risk due to bulk export bug');
  console.log('');
  console.log('  All API calls return realistic mock data.');
  console.log('  No Google account or API keys required.');
  console.log('');
  console.log('  Press Ctrl+C to stop.');
  console.log('');
});
