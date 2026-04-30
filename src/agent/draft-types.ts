/**
 * Types for the OpenClaw Memory Agent — Proactive Meeting Prep (Phase 1)
 */

export type DraftStatus = 'pending' | 'approved' | 'dismissed' | 'error';

export interface LinkedDoc {
  title: string;
  url: string;
}

export interface RelatedEmail {
  subject: string;
  from: string;
  snippet: string;
}

export interface StagedDraft {
  id: string;               // uuid
  meetingId: string;        // Google Calendar event ID (dedup key)
  meetingTitle: string;
  meetingTime: string;      // ISO 8601
  attendees: string[];      // email addresses
  summary: string;          // LLM-generated brief (markdown, max 500 words)
  linkedDocs: LinkedDoc[];
  relatedEmails: RelatedEmail[];
  suggestedActions: string[];
  confidence: number;       // Phase 1: always 1.0. Phase 2: 0.0–1.0
  confidenceReason: string; // Phase 1: "". Phase 2: e.g. "2 prior approvals"
  useful?: boolean;         // Phase 1 toggle. Phase 2: replaced by signals.
  createdAt: string;        // ISO 8601
  seenAt?: string;          // Set when GET /api/drafts is called
  status: DraftStatus;
}

export interface ScanError {
  meetingId: string;
  meetingTitle: string;
  error: string;
}

export interface ScanMeta {
  scannedAt: string;        // ISO 8601
  meetingsFound: number;
  meetingsPrepped: number;
  errors: ScanError[];
}

export interface ScanResult {
  drafts: StagedDraft[];
  meta: ScanMeta;
}

/** On-disk format for staged-drafts.json */
export interface StagedDraftsFile {
  version: 1;
  drafts: StagedDraft[];
  lastScan?: ScanMeta;
}
