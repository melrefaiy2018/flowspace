// Detect production: set by sidecar entry point or environment
if (process.env.FLOWSPACE_PRODUCTION === '1') {
  process.env.NODE_ENV = 'production';
}

import express from 'express';
import { google, type tasks_v1 } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { execFileSync, execFile } from 'child_process';
import http from 'http';
import https from 'https';
import { randomUUID } from 'crypto';
import dotenv from 'dotenv';
import { handleChat, executeApprovedAction } from './src/agent/chat.js';
import type { ApprovalRequest, ChatStreamEvent, InboxActionType, RunRecord, RunStatus, RunSummary, ToolEvent } from './src/shared/chat.js';
import { upsertConversation } from './src/agent/conversation-index.js';
import type { ConversationOrigin } from './src/agent/conversation-index.js';
import { createLLMClient, isLLMConfigured, testConnection } from './src/agent/llm-client.js';
import { readLLMSettingsMasked, readLLMSettings, mergeSettings, writeLLMSettings, isMaskedKey, removeProvider, getActiveProviderConfig } from './src/agent/llm-settings.js';
import { PROVIDER_META } from './src/agent/llm-providers-meta.js';
import { loadDynamicTools, getDynamicTools, getDynamicTool, registerDynamicTool, updateDynamicTool, removeDynamicTool } from './src/agent/dynamic-tool-registry.js';
import { parseAiTriageResponse, buildListEnrichmentPrompt, GENERIC_VERBS } from './src/lib/ai-triage.js';
import { invalidateEnrichmentForThread, loadEnrichmentCache, putEnrichment, saveEnrichmentCache } from './src/lib/enrichment-cache.js';
import { computeDeterministicChips } from './src/lib/thread-brief-utils.js';
import { buildThreadBriefPrompt } from './src/agent/prompts/gmail-enrichment.js';
import type { ThreadBrief, ContextChip, FirstClassAction, ThreadBriefResponse } from './src/shared/gmail-enrichment-types.js';
import { validateDynamicTool, getAllowedActions } from './src/agent/tool-composer.js';
import { startWorkflowScheduler, restartWorkflowScheduler, executeForMessage } from './src/agent/workflow-scheduler.js';
import type { SchedulerDeps } from './src/agent/workflow-scheduler.js';
import { getProcessedCount, getFailures, getLastPollAt as getStateLastPollAt, clearFailures } from './src/agent/workflow-trigger-state.js';
import { loadSettings as loadSynthSettings, updateSettings as updateSynthSettings } from './src/agent/synthesizer/settings.js';
import { loadLog as loadSynthLog, clearLog as clearSynthLog } from './src/agent/synthesizer/invocation-log.js';
import { SYNTHESIS_SETTINGS_RANGES } from './src/agent/synthesizer/types.js';
import type { LLMProviderConfig, LLMSettings } from './src/agent/llm-types.js';
import { executeInboxAction, listInboxActionHistory, undoInboxAction } from './src/lib/inbox-actions.js';
import {
  applyPreferenceExamplesToBriefing,
  coerceStoredPreferenceExample,
  createPreferenceExample,
  hasSamePreferenceExample,
  type ImportanceFeedbackTarget,
  type PreferenceExample,
} from './src/lib/importance-feedback.js';
import type { Persona } from './src/lib/persona.js';
import { normalizeGoogleTask, type NormalizedTask } from './src/lib/tasks.js';
import { loadMemories, getMemories, createMemory, updateMemory, deleteMemory, setMemoryFileIO } from './src/agent/memory/memory-store.js';
import type { MemoryEntry, MemoryCategory } from './src/agent/memory/memory-types.js';
import { getUserHash } from './src/lib/user-hash.js';
import { getDataDir, isProductionMode } from './src/lib/data-dir.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// In production builds, __FLOWSPACE_VERSION__ is replaced by esbuild at bundle time.
// In dev mode, read from package.json.
const APP_VERSION: string = typeof __FLOWSPACE_VERSION__ !== 'undefined'
  ? __FLOWSPACE_VERSION__
  : JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf-8')).version;

const IS_PRODUCTION = isProductionMode();
const DATA_DIR = getDataDir();

// Ensure data directory exists in production
if (IS_PRODUCTION && !fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Load .env from data dir (production) or project root (dev)
dotenv.config({ path: path.join(DATA_DIR, '.env') });
if (!IS_PRODUCTION) dotenv.config(); // also try project root .env in dev

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);

app.use(express.json({ limit: '512kb' }));

// ── HTML escaping utility (for OAuth error pages rendered in the system browser) ──
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

if (process.env.FLOWSPACE_HTTP_DEBUG === '1') {
  app.use((req, res, next) => {
    const startedAt = Date.now();
    console.log(`[http] --> ${req.method} ${req.url}`);
    res.on('finish', () => {
      console.log(`[http] <-- ${req.method} ${req.url} ${res.statusCode} ${Date.now() - startedAt}ms`);
    });
    next();
  });
}

// CORS — restrict to known origins (Tauri WebView + dev server).
// Wildcard CORS would allow any webpage to call our API from the user's browser.
const ALLOWED_ORIGINS = new Set([
  'tauri://localhost',
  `http://localhost:${PORT}`,
  'http://localhost:5173', // Vite dev server
]);

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.header('Access-Control-Allow-Origin', origin);
  }
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, X-FlowSpace-Client');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ── Auth guard — require a connected Google account for all data endpoints ──
// Public endpoints that don't need auth: health, version, auth flow, codex status.
// Note: app.use('/api/') strips the /api prefix from req.path, so match on the remainder.
const PUBLIC_PATH_PREFIXES = ['/auth/', '/accounts/connect', '/health', '/version', '/codex/'];

app.use('/api/', (req, res, next) => {
  if (PUBLIC_PATH_PREFIXES.some(prefix => req.path.startsWith(prefix))) return next();
  const account = getActiveStoredAccount();
  if (!account) {
    return res.status(401).json({ error: 'Not authenticated. Sign in with Google first.' });
  }
  next();
});

function writeChatEvent(res: express.Response, event: ChatStreamEvent) {
  if (!res.writableEnded) res.write(`${JSON.stringify(event)}\n`);
}

const RUN_TTL_MS = 24 * 60 * 60 * 1000;
const runsStore = new Map<string, RunRecord>();
const runOrder: string[] = [];

// Session-scoped in-memory cache for thread briefs (cleared on server restart)
const threadBriefCache = new Map<string, { brief: ThreadBrief; cachedAt: string }>();

export function invalidateThreadBrief(threadId: string): void {
  threadBriefCache.delete(threadId);
}

function pruneRuns() {
  const now = Date.now();
  for (const [id, run] of runsStore.entries()) {
    if (now - run.startedAt > RUN_TTL_MS) {
      runsStore.delete(id);
    }
  }
  for (let i = runOrder.length - 1; i >= 0; i--) {
    if (!runsStore.has(runOrder[i])) runOrder.splice(i, 1);
  }
}

function saveRun(run: RunRecord): RunRecord {
  pruneRuns();
  runsStore.set(run.id, run);
  if (!runOrder.includes(run.id)) runOrder.unshift(run.id);
  return run;
}

function inferSourceApp(toolName: string): string | null {
  if (toolName.includes('gmail') || toolName.includes('email')) return 'Gmail';
  if (toolName.includes('calendar') || toolName.includes('meeting')) return 'Calendar';
  if (toolName.includes('drive') || toolName.includes('doc') || toolName.includes('sheet')) return 'Drive';
  if (toolName.includes('task')) return 'Tasks';
  if (toolName.includes('sheets')) return 'Sheets';
  return null;
}

function applyToolEventToRun(run: RunRecord, event: ToolEvent, seenToolIds: Set<string>): RunRecord {
  seenToolIds.add(event.id);
  const sourceApp = inferSourceApp(event.toolName);
  const nextSourceApps = sourceApp && !run.sourceApps.includes(sourceApp)
    ? [...run.sourceApps, sourceApp]
    : run.sourceApps;

  const next: RunRecord = {
    ...run,
    toolTotal: Math.max(run.toolTotal, seenToolIds.size),
    sourceApps: nextSourceApps,
  };

  if (event.status === 'completed') {
    next.toolCompleted = Math.min(next.toolTotal, run.toolCompleted + 1);
    next.status = next.approvalPendingCount > 0 ? 'awaiting_approval' : 'running';
  } else if (event.status === 'approval_required') {
    next.status = 'awaiting_approval';
    next.approvalPendingCount = Math.max(1, run.approvalPendingCount + 1);
  } else if (event.status === 'error') {
    next.status = 'failed';
    next.endedAt = Date.now();
    next.errorCode = classifyErrorCode(event.detail ?? '');
    next.errorMessage = event.detail;
  } else if (event.status === 'running') {
    next.status = run.approvalPendingCount > 0 ? 'awaiting_approval' : 'running';
  }

  return saveRun(next);
}

function classifyErrorCode(message: string): RunRecord['errorCode'] {
  const lowered = message.toLowerCase();
  if (lowered.includes('unauthorized') || lowered.includes('401') || lowered.includes('invalid_api_key') || lowered.includes('authentication failed')) return 'auth_expired';
  if (lowered.includes('n_keep') || lowered.includes('n_ctx') || lowered.includes('context length') || lowered.includes('context window')) return 'context_overflow';
  if (lowered.includes('rate') || lowered.includes('429')) return 'rate_limited';
  if (lowered.includes('timeout') || lowered.includes('timed out')) return 'tool_timeout';
  if (lowered.includes('invalid') || lowered.includes('required') || lowered.includes('validation')) return 'validation_failed';
  return 'unknown';
}

function buildRunSummary(windowMs = 24 * 60 * 60 * 1000): RunSummary {
  pruneRuns();
  const now = Date.now();
  const recent = [...runsStore.values()].filter((run) => now - run.startedAt <= windowMs);
  const active = recent.filter((run) => run.status === 'queued' || run.status === 'running');
  const awaiting = recent.filter((run) => run.status === 'awaiting_approval');
  const completed = recent.filter((run) => run.status === 'completed');
  const failed = recent.filter((run) => run.status === 'failed');
  const durations = recent
    .filter((run) => run.endedAt && run.endedAt >= run.startedAt)
    .map((run) => (run.endedAt! - run.startedAt))
    .sort((a, b) => a - b);
  const medianDurationMs = durations.length === 0
    ? 0
    : durations[Math.floor(durations.length / 2)];

  return {
    activeCount: active.length,
    awaitingApprovalCount: awaiting.length,
    completed24h: completed.length,
    failed24h: failed.length,
    medianDurationMs,
  };
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return await Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    }),
  ]);
}

// ---------------------------------------------------------------------------
// Token storage & credential loading
// ---------------------------------------------------------------------------

const TOKENS_PATH = path.join(DATA_DIR, '.tokens.json');
const LEGACY_GWS_CREDENTIALS_PATH = path.join(DATA_DIR, '.gws-credentials.json');
const ACCOUNTS_MANIFEST_PATH = path.join(DATA_DIR, '.accounts.json');
const GWS_CLIENT_SECRET_PATH = path.join(os.homedir(), '.config', 'gws', 'client_secret.json');
type AuthMethod = 'gws' | 'adc';

interface StoredGoogleCredentials {
  type: string;
  client_id: string;
  client_secret: string;
  refresh_token: string;
}

interface AccountRecord {
  id: string;
  key: string;
  email: string;
  name: string | null;
  picture: string | null;
  scopes: string[];
  credentialPath: string;
  connectedAt: number;
  lastUsedAt: number;
  authMethod: AuthMethod;
}

interface AccountsManifest {
  accounts: AccountRecord[];
  activeAccountId: string | null;
}

interface ActiveAccountContext {
  account: AccountRecord | null;
  client: OAuth2Client | null;
  authMethod: AuthMethod | null;
}

const EMPTY_ACCOUNTS_MANIFEST: AccountsManifest = {
  accounts: [],
  activeAccountId: null,
};

function sanitizeAccountKey(email: string): string {
  return email.toLowerCase().replace(/[^a-z0-9]/g, '_');
}

function accountCredentialsPath(accountKey: string): string {
  return path.join(DATA_DIR, `.gws-credentials.${accountKey}.json`);
}

function readStoredCredentials(filePath: string): StoredGoogleCredentials | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    const creds = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    if (creds.client_id && creds.client_secret && creds.refresh_token) {
      return creds as StoredGoogleCredentials;
    }
  } catch (err) {
    console.error(`Failed to load credentials from ${filePath}:`, err);
  }
  return null;
}

function createOAuthClient(creds: StoredGoogleCredentials): OAuth2Client {
  const client = new OAuth2Client(creds.client_id, creds.client_secret);
  client.setCredentials({ refresh_token: creds.refresh_token });
  return client;
}

function readAccountsManifest(): AccountsManifest {
  if (!fs.existsSync(ACCOUNTS_MANIFEST_PATH)) return { ...EMPTY_ACCOUNTS_MANIFEST };
  try {
    const parsed = JSON.parse(fs.readFileSync(ACCOUNTS_MANIFEST_PATH, 'utf-8'));
    const accounts = Array.isArray(parsed?.accounts)
      ? parsed.accounts.filter((account: any) =>
        account
        && typeof account.id === 'string'
        && typeof account.key === 'string'
        && typeof account.email === 'string'
        && typeof account.credentialPath === 'string')
      : [];
    const activeAccountId = typeof parsed?.activeAccountId === 'string' ? parsed.activeAccountId : null;
    return { accounts, activeAccountId };
  } catch (err) {
    console.error('Failed to read accounts manifest:', err);
    return { ...EMPTY_ACCOUNTS_MANIFEST };
  }
}

function writeAccountsManifest(manifest: AccountsManifest): void {
  fs.writeFileSync(ACCOUNTS_MANIFEST_PATH, JSON.stringify(manifest, null, 2), { mode: 0o600 });
}

function upsertAccountRecord(account: AccountRecord, makeActive = true): AccountsManifest {
  const manifest = readAccountsManifest();
  const existingIndex = manifest.accounts.findIndex((entry) => entry.id === account.id || entry.email.toLowerCase() === account.email.toLowerCase());
  if (existingIndex >= 0) {
    manifest.accounts[existingIndex] = {
      ...manifest.accounts[existingIndex],
      ...account,
      lastUsedAt: Date.now(),
    };
  } else {
    manifest.accounts.push(account);
  }
  if (makeActive || !manifest.activeAccountId) {
    manifest.activeAccountId = account.id;
  }
  writeAccountsManifest(manifest);
  return manifest;
}

function setActiveAccountId(accountId: string): AccountsManifest {
  const manifest = readAccountsManifest();
  const accountIndex = manifest.accounts.findIndex((entry) => entry.id === accountId);
  if (accountIndex < 0) {
    throw new Error('Account not found');
  }
  const updatedManifest: AccountsManifest = {
    ...manifest,
    activeAccountId: accountId,
    accounts: manifest.accounts.map((entry, i) =>
      i === accountIndex ? { ...entry, lastUsedAt: Date.now() } : entry
    ),
  };
  writeAccountsManifest(updatedManifest);
  return updatedManifest;
}

function removeStoredAccount(accountId: string): AccountsManifest {
  const manifest = readAccountsManifest();
  const account = manifest.accounts.find((entry) => entry.id === accountId);
  if (!account) {
    throw new Error('Account not found');
  }
  manifest.accounts = manifest.accounts.filter((entry) => entry.id !== accountId);
  if (manifest.activeAccountId === accountId) {
    manifest.activeAccountId = manifest.accounts[0]?.id ?? null;
  }
  writeAccountsManifest(manifest);
  try {
    if (fs.existsSync(account.credentialPath)) fs.unlinkSync(account.credentialPath);
  } catch (err) {
    console.error(`Failed to delete credential file for ${account.email}:`, err);
  }
  return manifest;
}

function getStoredAccount(accountId: string | null | undefined): AccountRecord | null {
  if (!accountId) return null;
  const manifest = readAccountsManifest();
  return manifest.accounts.find((entry) => entry.id === accountId) ?? null;
}

function getActiveStoredAccount(): AccountRecord | null {
  const manifest = readAccountsManifest();
  const account = manifest.accounts.find((entry) => entry.id === manifest.activeAccountId) ?? null;
  return account;
}

function initMemoryForUser(): void {
  const account = getActiveStoredAccount();
  const userEmail = account?.email;
  if (!userEmail) return;

  const memoryDir = path.join(DATA_DIR, '.memory');
  if (!fs.existsSync(memoryDir)) {
    fs.mkdirSync(memoryDir, { recursive: true });
  }

  const userHash = getUserHash(userEmail);
  const memoryPath = path.join(memoryDir, `${userHash}.json`);

  setMemoryFileIO({
    exists: (p: string) => fs.existsSync(p),
    read: (p: string) => fs.readFileSync(p, 'utf-8'),
    write: (p: string, data: string) => fs.writeFileSync(p, data, 'utf-8'),
    rename: (oldP: string, newP: string) => fs.renameSync(oldP, newP),
    getFilePath: () => memoryPath,
  }, userHash);
}

function getAdcContext(): ActiveAccountContext {
  if (IS_PRODUCTION) return { account: null, client: null, authMethod: null };
  const adcPath = path.join(os.homedir(), '.config/gcloud/application_default_credentials.json');
  const creds = readStoredCredentials(adcPath);
  if (!creds) return { account: null, client: null, authMethod: null };
  return {
    account: {
      id: 'adc',
      key: 'adc',
      email: 'adc',
      name: 'ADC',
      picture: null,
      scopes: [],
      credentialPath: adcPath,
      connectedAt: 0,
      lastUsedAt: 0,
      authMethod: 'adc',
    },
    client: createOAuthClient(creds),
    authMethod: 'adc',
  };
}

function getActiveAuthContext(): ActiveAccountContext {
  const account = getActiveStoredAccount();
  if (!account) {
    // Only fall back to ADC if the accounts manifest doesn't exist yet
    // (first-time setup). Once the user has interacted with account management,
    // ADC should not be used — they must sign in via OAuth.
    if (!fs.existsSync(ACCOUNTS_MANIFEST_PATH)) return getAdcContext();
    return { account: null, client: null, authMethod: null };
  }
  const creds = readStoredCredentials(account.credentialPath);
  if (!creds) {
    console.error(`Missing credentials for account ${account.email}`);
    return { account: null, client: null, authMethod: null };
  }
  return {
    account,
    client: createOAuthClient(creds),
    authMethod: account.authMethod,
  };
}

const SAFE_PATH_SEGMENT = /^[a-zA-Z0-9._@-]+$/;

function getScopedDataPath(kind: string, accountKey?: string | null): string {
  const key = accountKey || getActiveStoredAccount()?.key || 'default';
  if (!SAFE_PATH_SEGMENT.test(kind) || !SAFE_PATH_SEGMENT.test(key)) {
    throw new Error(`Invalid scoped data path segment: kind=${kind}, key=${key}`);
  }
  return path.join(DATA_DIR, `.${kind}.${key}.json`);
}

// ---------------------------------------------------------------------------
// Shell environment (macOS .app bundles have minimal PATH)
// ---------------------------------------------------------------------------

function discoverNodePaths(): string[] {
  const home = os.homedir();
  const paths: string[] = [
    '/opt/homebrew/bin',
    '/usr/local/bin',
    path.join(home, '.npm-global/bin'),
    path.join(home, '.local/bin'),
  ];

  // nvm: find latest installed Node version
  const nvmDir = process.env.NVM_DIR || path.join(home, '.nvm');
  const nvmVersionsDir = path.join(nvmDir, 'versions', 'node');
  try {
    if (fs.existsSync(nvmVersionsDir)) {
      const versions = fs.readdirSync(nvmVersionsDir)
        .filter(v => v.startsWith('v'))
        .sort()
        .reverse();
      if (versions.length > 0) {
        paths.push(path.join(nvmVersionsDir, versions[0], 'bin'));
      }
    }
  } catch { /* ignore */ }

  // fnm
  const fnmPaths = [
    path.join(home, '.fnm/aliases/default/bin'),
    path.join(home, 'Library/Application Support/fnm/aliases/default/bin'),
  ];
  for (const p of fnmPaths) {
    if (fs.existsSync(p)) paths.push(p);
  }

  // Volta
  const voltaBin = path.join(home, '.volta/bin');
  if (fs.existsSync(voltaBin)) paths.push(voltaBin);

  // Homebrew npm global
  paths.push('/opt/homebrew/lib/node_modules/.bin');

  return paths;
}

function getShellEnv(): Record<string, string> {
  const env = { ...process.env };
  const extraPaths = discoverNodePaths();
  const currentPath = env.PATH || '/usr/bin:/bin:/usr/sbin:/sbin';
  env.PATH = [...extraPaths, ...currentPath.split(':')].filter((v, i, a) => a.indexOf(v) === i).join(':');
  return env;
}

const shellEnv = getShellEnv();

// ---------------------------------------------------------------------------
// GWS CLI utility functions
// ---------------------------------------------------------------------------

let resolvedBundledGwsPath: string | null | undefined;

function ensureExecutable(filePath: string): string {
  try {
    fs.chmodSync(filePath, 0o755);
  } catch {
    // Best effort: if chmod fails, execFile will surface the real error.
  }
  return filePath;
}

function getBundledGwsPath(): string | null {
  if (resolvedBundledGwsPath !== undefined) return resolvedBundledGwsPath;

  const candidatePaths = IS_PRODUCTION
    ? [
        path.join(__dirname, 'gws'),
        path.join(process.cwd(), 'gws'),
        path.join(__dirname, '..', 'Resources', 'gws'),
        path.join(__dirname, '..', '..', 'Resources', 'gws'),
      ]
    : [
        path.join(__dirname, 'src-tauri', 'resources', 'gws'),
        path.join(__dirname, 'resources', 'gws'),
      ];

  const bundledPath = candidatePaths.find((candidate) => fs.existsSync(candidate));
  resolvedBundledGwsPath = bundledPath ? ensureExecutable(bundledPath) : null;
  return resolvedBundledGwsPath;
}

function getGwsCommand(): string | null {
  const bundledPath = getBundledGwsPath();
  if (bundledPath) return bundledPath;

  try {
    execFileSync('which', ['gws'], { stdio: 'ignore', env: shellEnv });
    return 'gws';
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// OAuth2 — direct Google sign-in (no gws CLI dependency for auth)
// ---------------------------------------------------------------------------

const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/drive',
  'https://mail.google.com/',
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/tasks',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
];

const OAUTH_REDIRECT_URI = `http://localhost:${PORT}/api/auth/callback`;

// CSRF protection: short-lived state tokens for OAuth flow
const pendingOAuthStates = new Map<string, number>(); // state → timestamp
const OAUTH_STATE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function createOAuthState(): string {
  const state = randomUUID();
  // Prune expired entries
  const now = Date.now();
  for (const [key, ts] of pendingOAuthStates) {
    if (now - ts > OAUTH_STATE_TTL_MS) pendingOAuthStates.delete(key);
  }
  pendingOAuthStates.set(state, now);
  return state;
}

function consumeOAuthState(state: string): boolean {
  const ts = pendingOAuthStates.get(state);
  if (!ts) return false;
  pendingOAuthStates.delete(state);
  return (Date.now() - ts) <= OAUTH_STATE_TTL_MS;
}

interface OAuthClientConfig {
  client_id: string;
  client_secret: string;
}

let cachedOAuthClientConfig: OAuthClientConfig | null = null;

function loadOAuthClientConfig(): OAuthClientConfig {
  if (cachedOAuthClientConfig) return cachedOAuthClientConfig;

  // Injected build-time credentials take priority — these are the bundled OAuth client
  // injected by the release script via esbuild --define (obfuscated in the binary)
  const injectedClientId: string = typeof __OAUTH_CLIENT_ID__ !== 'undefined' ? __OAUTH_CLIENT_ID__ : '';
  const injectedClientSecret: string = typeof __OAUTH_CLIENT_SECRET__ !== 'undefined' ? __OAUTH_CLIENT_SECRET__ : '';
  if (
    injectedClientId &&
    injectedClientSecret &&
    !injectedClientId.includes('__OAUTH') &&
    !injectedClientSecret.includes('__OAUTH')
  ) {
    cachedOAuthClientConfig = { client_id: injectedClientId, client_secret: injectedClientSecret };
    return cachedOAuthClientConfig;
  }

  // Dev mode fallback: read from file (no injected credentials when running via tsx)
  const candidatePaths = [
    // Data dir (project root in dev, ~/Library/Application Support/FlowSpace in production)
    path.join(DATA_DIR, 'client_secret.json'),
    path.join(os.homedir(), '.flowspace', 'client_secret.json'),
    path.join(os.homedir(), '.config', 'gws', 'client_secret.json'),
    // Repo-local
    path.join(__dirname, 'client_secret.json'),
    path.join(process.cwd(), 'client_secret.json'),
    // Tauri bundle locations
    path.join(__dirname, 'src-tauri', 'resources', 'client_secret.json'),
    path.join(process.cwd(), 'src-tauri', 'resources', 'client_secret.json'),
    path.join(__dirname, 'resources', 'client_secret.json'),
    path.join(process.cwd(), 'resources', 'client_secret.json'),
    path.join(__dirname, '..', 'Resources', 'client_secret.json'),
    path.join(__dirname, '..', '..', 'Resources', 'client_secret.json'),
  ].filter((value, index, values) => values.indexOf(value) === index);

  // Find the first file with valid (non-placeholder) credentials
  for (const filePath of candidatePaths) {
    if (!fs.existsSync(filePath)) continue;
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      const installed = parsed?.installed;
      const clientId = typeof installed?.client_id === 'string' ? installed.client_id : '';
      const clientSecret = typeof installed?.client_secret === 'string' ? installed.client_secret : '';
      if (!clientId || !clientSecret) continue;
      if (clientId.includes('YOUR_CLIENT_ID') || clientSecret.includes('YOUR_CLIENT_SECRET')) continue;
      cachedOAuthClientConfig = { client_id: clientId, client_secret: clientSecret };
      return cachedOAuthClientConfig;
    } catch {
      continue;
    }
  }

  const tried = candidatePaths.join('\n  - ');
  throw new Error(`No valid client_secret.json found. Searched:\n  - ${tried}\nEnsure at least one contains real Google OAuth credentials (not placeholders).`);
}

function checkGwsInstalled(): boolean {
  return getGwsCommand() !== null;
}

function gwsEnvForAccount(accountEmail?: string | null): Record<string, string> {
  if (!accountEmail) return shellEnv;
  return { ...shellEnv, GOOGLE_WORKSPACE_CLI_ACCOUNT: accountEmail };
}

async function fetchUserProfileForClient(client: OAuth2Client): Promise<{ name: string | null; email: string | null; picture: string | null }> {
  let user = { name: null as string | null, email: null as string | null, picture: null as string | null };
  try {
    const oauth2 = google.oauth2({ version: 'v2', auth: client });
    const { data } = await oauth2.userinfo.get();
    user = { name: data.name ?? null, email: data.email ?? null, picture: data.picture ?? null };
  } catch {
    try {
      const gmail = google.gmail({ version: 'v1', auth: client });
      const { data } = await gmail.users.getProfile({ userId: 'me' });
      user.email = data.emailAddress ?? null;
      user.name = data.emailAddress?.split('@')[0] ?? null;
    } catch {
      // Ignore profile lookup failures — auth can still succeed.
    }
  }
  return user;
}

async function createStoredAccountFromCredentials(
  creds: StoredGoogleCredentials,
  options: { authMethod: AuthMethod; scopes?: string[]; existingAccountId?: string | null } = { authMethod: 'gws' },
): Promise<AccountRecord> {
  const client = createOAuthClient(creds);
  const profile = await fetchUserProfileForClient(client);
  if (!profile.email) {
    throw new Error('Signed-in Google account could not be identified');
  }
  const key = sanitizeAccountKey(profile.email);
  const credentialPath = accountCredentialsPath(key);
  fs.writeFileSync(credentialPath, JSON.stringify(creds, null, 2), { mode: 0o600 });
  const now = Date.now();
  const existing = readAccountsManifest().accounts.find((account) => account.email.toLowerCase() === profile.email!.toLowerCase());
  return {
    id: options.existingAccountId ?? existing?.id ?? randomUUID(),
    key,
    email: profile.email,
    name: profile.name,
    picture: profile.picture,
    scopes: options.scopes ?? existing?.scopes ?? [],
    credentialPath,
    connectedAt: existing?.connectedAt ?? now,
    lastUsedAt: now,
    authMethod: options.authMethod,
  };
}

async function migrateLegacyGwsCredentials(): Promise<void> {
  if (!fs.existsSync(LEGACY_GWS_CREDENTIALS_PATH)) return;
  const manifest = readAccountsManifest();
  if (manifest.accounts.length > 0) return;

  const creds = readStoredCredentials(LEGACY_GWS_CREDENTIALS_PATH);
  if (!creds) return;

  try {
    const account = await createStoredAccountFromCredentials(creds, { authMethod: 'gws' });
    upsertAccountRecord(account, true);
    fs.unlinkSync(LEGACY_GWS_CREDENTIALS_PATH);
    console.log(`Migrated legacy Google credentials for ${account.email}`);
  } catch (err) {
    console.warn('Legacy Google credentials could not be migrated automatically:', err);
  }
}

function getAuthClient(): OAuth2Client {
  const { client } = getActiveAuthContext();
  if (!client) {
    throw new Error('Not authenticated. Sign in with Google via the app.');
  }
  return client;
}

// Google API clients (lazily reference authClient)
function driveClient() { return google.drive({ version: 'v3', auth: getAuthClient() }); }
function gmailClient() { return google.gmail({ version: 'v1', auth: getAuthClient() }); }
function calendarClient() { return google.calendar({ version: 'v3', auth: getAuthClient() }); }
function tasksClient() { return google.tasks({ version: 'v1', auth: getAuthClient() }); }

function buildSchedulerDeps(): SchedulerDeps {
  return {
    gmailSearch: async (query) => {
      const gmail = gmailClient();
      const list = await gmail.users.messages.list({ userId: 'me', q: query, maxResults: 25 });
      const msgs = list.data.messages ?? [];
      return msgs.map(m => ({ threadId: m.threadId!, messageId: m.id! })).filter(x => x.threadId && x.messageId);
    },
    now: () => Date.now(),
  };
}

async function listAllTaskLists() {
  const tasks = tasksClient();
  const taskLists: tasks_v1.Schema$TaskList[] = [];
  let pageToken: string | undefined;

  do {
    const { data } = await tasks.tasklists.list({
      maxResults: 100,
      pageToken,
    });
    taskLists.push(...(data.items ?? []));
    pageToken = data.nextPageToken ?? undefined;
  } while (pageToken);

  return taskLists;
}

async function listAllTasksForList(taskListId: string) {
  const tasks = tasksClient();
  const items: tasks_v1.Schema$Task[] = [];
  let pageToken: string | undefined;

  do {
    const { data } = await tasks.tasks.list({
      tasklist: taskListId,
      showCompleted: true,
      showHidden: true,
      maxResults: 100,
      pageToken,
    });
    items.push(...(data.items ?? []));
    pageToken = data.nextPageToken ?? undefined;
  } while (pageToken);

  return items;
}

async function listNormalizedTasks(): Promise<NormalizedTask[]> {
  const taskLists = await listAllTaskLists();
  const taskResults = await Promise.all(taskLists.map(async (taskList) => {
    if (!taskList.id) return [];
    const taskItems = await listAllTasksForList(taskList.id);

    return taskItems
      .filter((task) => task.id)
      .map((task) => normalizeGoogleTask(task, {
        taskListId: taskList.id!,
        taskListTitle: taskList.title ?? 'Untitled list',
      }));
  }));

  return taskResults.flat();
}

function requireTaskListId(req: express.Request, res: express.Response): string | null {
  const taskListId = typeof req.body?.taskListId === 'string' ? req.body.taskListId.trim() : '';
  if (!taskListId) {
    res.status(400).json({ error: 'taskListId is required' });
    return null;
  }
  return taskListId;
}
function oauth2Client() { return google.oauth2({ version: 'v2', auth: getAuthClient() }); }

function getInboxActionLogPath(): string {
  return getScopedDataPath('inbox-action-log');
}

function googleMailThreadUrl(threadId: string): string {
  const email = getActiveStoredAccount()?.email;
  return email
    ? `https://mail.google.com/mail/u/${encodeURIComponent(email)}/#inbox/${threadId}`
    : `https://mail.google.com/mail/u/0/#inbox/${threadId}`;
}

// ---------------------------------------------------------------------------
// Simple in-memory cache (60-second TTL)
// ---------------------------------------------------------------------------

interface CacheEntry<T> {
  data: T;
  expires: number;
}

const cache = new Map<string, CacheEntry<any>>();
const CACHE_TTL_MS = 60_000;

function scopeCacheKey(key: string): string {
  const accountId = getActiveStoredAccount()?.id ?? getAdcContext().account?.id ?? 'default';
  return `${accountId}:${key}`;
}

function getCached<T>(key: string): T | null {
  const entry = cache.get(scopeCacheKey(key));
  if (!entry) return null;
  if (Date.now() > entry.expires) {
    cache.delete(scopeCacheKey(key));
    return null;
  }
  return entry.data as T;
}

function setCache<T>(key: string, data: T): T {
  cache.set(scopeCacheKey(key), { data, expires: Date.now() + CACHE_TTL_MS });
  return data;
}

function buildAccountSummary(account: AccountRecord) {
  return {
    id: account.id,
    email: account.email,
    name: account.name,
    picture: account.picture,
    scopes: account.scopes,
    connectedAt: account.connectedAt,
    lastUsedAt: account.lastUsedAt,
    auth_method: account.authMethod,
  };
}

/** Clear all in-memory caches so no stale data leaks across accounts. */
function clearAllCaches(): void {
  cache.clear();
  personaCache.clear();
  importancePreferenceCache.clear();
  cachedFollowupListIds.clear();
}

function removeAccountLocalState(account: AccountRecord): void {
  const scopedKinds = ['inbox-action-log', 'followup-state', 'briefing-cache'];
  for (const kind of scopedKinds) {
    try {
      const filePath = getScopedDataPath(kind, account.key);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch (err) {
      console.error(`Failed to remove ${kind} state for ${account.email}:`, err);
    }
  }
  clearAllCaches();
}

app.post('/api/auth/logout', (_req, res) => {
  try {
    if (fs.existsSync(TOKENS_PATH)) {
      fs.unlinkSync(TOKENS_PATH);
    }
    const activeAccount = getActiveStoredAccount();
    if (!activeAccount) {
      clearAllCaches();
      return res.json({ success: true });
    }
    removeAccountLocalState(activeAccount);
    const manifest = removeStoredAccount(activeAccount.id);
    res.json({ success: true, activeAccountId: manifest.activeAccountId });
  } catch (err: any) {
    console.error('Logout error:', err.message);
    res.status(500).json({ error: 'Failed to logout' });
  }
});

// ---------------------------------------------------------------------------
// Direct OAuth2 Sign-in (no gws CLI dependency)
// ---------------------------------------------------------------------------

// Opens a URL in the system default browser (macOS `open`, Linux `xdg-open`)
function openInSystemBrowser(url: string): void {
  const cmd = process.platform === 'darwin' ? 'open' : 'xdg-open';
  execFile(cmd, [url], (err) => {
    if (err) console.error(`Failed to open browser: ${err.message}`);
  });
}

const SUCCESS_HTML = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>FlowSpace</title>
  <style>body{font-family:-apple-system,system-ui,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#111;color:#fff}
  .card{text-align:center;padding:2rem}.check{font-size:3rem;margin-bottom:1rem}h1{font-size:1.25rem;font-weight:600}p{color:#888;font-size:.875rem;margin-top:.5rem}</style></head>
  <body><div class="card"><div class="check">\u2705</div><h1>Signed in to FlowSpace</h1><p>You can close this tab and return to the app.</p></div>
  <script>try{window.close()}catch(e){}</script></body></html>`;

function errorHtml(msg: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>FlowSpace</title>
  <style>body{font-family:-apple-system,system-ui,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#111;color:#fff}
  .card{text-align:center;padding:2rem}h1{font-size:1.25rem;font-weight:600;color:#f87171}p{color:#888;font-size:.875rem;margin-top:.5rem}</style></head>
  <body><div class="card"><h1>Authentication Failed</h1><p>${escapeHtml(msg.slice(0, 200))}</p><p>Close this tab and try again.</p></div></body></html>`;
}

/**
 * Loopback OAuth flow for installed/desktop app clients.
 *
 * Spins up a temporary HTTP server on a random port, generates an auth URL
 * with redirect_uri=http://localhost:<port>, opens it in the system browser,
 * waits for Google to redirect back with the auth code, exchanges it for tokens,
 * then stores the credentials and shuts down the temp server.
 *
 * This is the correct flow for OAuth clients of type "Desktop app" (installed),
 * which do not support custom redirect URIs like http://localhost:3000/api/...
 */
async function startLoopbackOAuthFlow(opts: {
  prompt: string;
}): Promise<{ url: string }> {
  const config = loadOAuthClientConfig();

  return new Promise((resolve, reject) => {
    // Spin up a temporary server on an OS-assigned port
    const tempServer = http.createServer(async (req, httpRes) => {
      try {
        const parsed = new URL(req.url ?? '/', 'http://localhost');
        const code = parsed.searchParams.get('code');
        const error = parsed.searchParams.get('error');

        if (error) {
          httpRes.writeHead(200, { 'Content-Type': 'text/html' });
          httpRes.end(errorHtml(error));
          tempServer.close();
          reject(new Error(error));
          return;
        }

        if (!code) {
          httpRes.writeHead(200, { 'Content-Type': 'text/html' });
          httpRes.end(errorHtml('No authorization code received'));
          tempServer.close();
          reject(new Error('No authorization code received'));
          return;
        }

        const redirectUri = `http://localhost:${(tempServer.address() as any).port}`;
        const oauth2Client = new OAuth2Client(config.client_id, config.client_secret, redirectUri);
        const { tokens } = await oauth2Client.getToken(code);

        if (!tokens.refresh_token) {
          httpRes.writeHead(200, { 'Content-Type': 'text/html' });
          httpRes.end(errorHtml('No refresh token received. Please try signing in again.'));
          tempServer.close();
          reject(new Error('No refresh token received'));
          return;
        }

        const creds: StoredGoogleCredentials = {
          type: 'authorized_user',
          client_id: config.client_id,
          client_secret: config.client_secret,
          refresh_token: tokens.refresh_token,
        };

        const account = await createStoredAccountFromCredentials(creds, {
          authMethod: 'gws',
          scopes: GOOGLE_SCOPES.map(s => s.split('/').pop() ?? s),
        });
        upsertAccountRecord(account, true);
        clearAllCaches();

        httpRes.writeHead(200, { 'Content-Type': 'text/html' });
        httpRes.end(SUCCESS_HTML);
        tempServer.close();
      } catch (err: any) {
        console.error('Loopback OAuth callback error:', err.message);
        httpRes.writeHead(200, { 'Content-Type': 'text/html' });
        httpRes.end(errorHtml(err.message ?? 'Unknown error'));
        tempServer.close();
        reject(err);
      }
    });

    tempServer.listen(0, '127.0.0.1', () => {
      try {
        const port = (tempServer.address() as any).port;
        const redirectUri = `http://localhost:${port}`;
        const oauth2Client = new OAuth2Client(config.client_id, config.client_secret, redirectUri);
        const authUrl = oauth2Client.generateAuthUrl({
          access_type: 'offline',
          prompt: opts.prompt,
          scope: GOOGLE_SCOPES,
        });

        openInSystemBrowser(authUrl);
        // Resolve immediately — the caller returns the URL to the frontend for window.open fallback
        resolve({ url: authUrl });

        // Auto-close temp server after 5 minutes if no callback received
        setTimeout(() => tempServer.close(), 5 * 60 * 1000);
      } catch (err: any) {
        tempServer.close();
        reject(err);
      }
    });

    tempServer.on('error', (err) => {
      reject(err);
    });
  });
}

app.get('/api/auth/login', async (_req, res) => {
  try {
    const { url } = await startLoopbackOAuthFlow({ prompt: 'consent' });
    res.json({ url, opened: true });
  } catch (err: any) {
    console.error('OAuth login error:', err.message);
    res.status(500).json({ error: 'Failed to start Google sign-in. Check server logs.' });
  }
});

app.get('/api/accounts/connect', async (_req, res) => {
  try {
    const { url } = await startLoopbackOAuthFlow({ prompt: 'select_account consent' });
    res.json({ url, opened: true });
  } catch (err: any) {
    console.error('OAuth connect error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Legacy callback endpoint — only used when redirect_uri points to this server (web app client).
// With the loopback flow (installed/desktop client), this endpoint is not invoked.
app.get('/api/auth/callback', async (req, res) => {
  try {
    const state = typeof req.query.state === 'string' ? req.query.state : '';
    if (!consumeOAuthState(state)) {
      return res.redirect(`/?auth_error=${encodeURIComponent('Invalid or expired OAuth state. Please try signing in again.')}`);
    }

    const code = typeof req.query.code === 'string' ? req.query.code : '';
    if (!code) {
      const rawError = typeof req.query.error === 'string' ? req.query.error.slice(0, 200) : 'No authorization code received';
      return res.redirect(`/?auth_error=${encodeURIComponent(rawError)}`);
    }

    const config = loadOAuthClientConfig();
    const oauth2Client = new OAuth2Client(config.client_id, config.client_secret, OAUTH_REDIRECT_URI);
    const { tokens } = await oauth2Client.getToken(code);

    if (!tokens.refresh_token) {
      return res.redirect(`/?auth_error=${encodeURIComponent('No refresh token received. Please try signing in again.')}`);
    }

    const creds: StoredGoogleCredentials = {
      type: 'authorized_user',
      client_id: config.client_id,
      client_secret: config.client_secret,
      refresh_token: tokens.refresh_token,
    };

    const account = await createStoredAccountFromCredentials(creds, {
      authMethod: 'gws',
      scopes: GOOGLE_SCOPES.map(s => s.split('/').pop() ?? s),
    });
    upsertAccountRecord(account, true);
    clearAllCaches();

    res.send(SUCCESS_HTML);
  } catch (err: any) {
    console.error('OAuth callback error:', err.message);
    res.status(500).send(errorHtml(err.message ?? 'Unknown error'));
  }
});

// ---------------------------------------------------------------------------
// 1. GET /api/auth/status
// ---------------------------------------------------------------------------

app.get('/api/auth/status', async (_req, res) => {
  try {
    const { account, client, authMethod } = getActiveAuthContext();
    if (!client) throw new Error('Not authenticated');
    const user = await fetchUserProfileForClient(client);
    const manifest = readAccountsManifest();

    res.json({
      authenticated: true,
      auth_method: authMethod,
      user,
      accounts: manifest.accounts.map(buildAccountSummary),
      activeAccountId: manifest.activeAccountId,
    });
  } catch (err: any) {
    const manifest = readAccountsManifest();
    res.json({
      authenticated: false,
      auth_method: null,
      accounts: manifest.accounts.map(buildAccountSummary),
      activeAccountId: manifest.activeAccountId,
      error: err.message || 'Not authenticated',
    });
  }
});

app.get('/api/accounts', (_req, res) => {
  const manifest = readAccountsManifest();
  const active = manifest.accounts.find((account) => account.id === manifest.activeAccountId) ?? null;
  res.json({
    accounts: manifest.accounts.map(buildAccountSummary),
    activeAccountId: manifest.activeAccountId,
    activeAccount: active ? buildAccountSummary(active) : null,
  });
});

app.post('/api/accounts/switch', (req, res) => {
  try {
    const accountId = typeof req.body?.accountId === 'string' ? req.body.accountId : '';
    if (!accountId) {
      return res.status(400).json({ error: 'accountId is required' });
    }
    const manifest = setActiveAccountId(accountId);
    clearAllCaches();
    res.json({
      success: true,
      accounts: manifest.accounts.map(buildAccountSummary),
      activeAccountId: manifest.activeAccountId,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/accounts/:accountId', (req, res) => {
  try {
    const account = getStoredAccount(req.params.accountId);
    if (!account) {
      return res.status(404).json({ error: 'Account not found' });
    }
    removeAccountLocalState(account);
    const manifest = removeStoredAccount(account.id);
    res.json({
      success: true,
      accounts: manifest.accounts.map(buildAccountSummary),
      activeAccountId: manifest.activeAccountId,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Codex CLI — install check + device-auth login flow
// ---------------------------------------------------------------------------

const CODEX_CANDIDATES = [
  'codex',
  '/usr/local/bin/codex',
  '/opt/homebrew/bin/codex',
  `${os.homedir()}/.npm-global/bin/codex`,
  `${os.homedir()}/.local/bin/codex`,
];

let cachedCodexBin: string | null | undefined; // undefined = not yet checked

function findCodexBin(): string | null {
  if (cachedCodexBin !== undefined) return cachedCodexBin;
  for (const candidate of CODEX_CANDIDATES) {
    try {
      execFileSync(candidate, ['--version'], { stdio: 'ignore', env: shellEnv });
      cachedCodexBin = candidate;
      return cachedCodexBin;
    } catch {
      // try next
    }
  }
  cachedCodexBin = null;
  return null;
}

function checkCodexAuth(): { authenticated: boolean; reason: string } {
  // codex login status writes directly to the terminal device — cannot be captured via pipe.
  // Instead, check ~/.codex/auth.json which codex writes after a successful login.
  try {
    const authPath = path.join(os.homedir(), '.codex', 'auth.json');
    if (!fs.existsSync(authPath)) {
      return { authenticated: false, reason: 'auth.json not found' };
    }
    const raw = fs.readFileSync(authPath, 'utf-8');
    const auth = JSON.parse(raw);
    // Any of these indicate a successful login
    const hasTokens = auth.tokens && (
      typeof auth.tokens === 'string' ||
      (typeof auth.tokens === 'object' && Object.keys(auth.tokens).length > 0)
    );
    const hasApiKey = typeof auth.OPENAI_API_KEY === 'string' && auth.OPENAI_API_KEY.length > 0;
    const hasAuthMode = typeof auth.auth_mode === 'string' && auth.auth_mode.length > 0;
    if (hasTokens || hasApiKey || hasAuthMode) {
      return { authenticated: true, reason: `auth_mode=${auth.auth_mode}` };
    }
    return { authenticated: false, reason: 'auth.json exists but contains no valid credentials' };
  } catch (err: any) {
    return { authenticated: false, reason: 'Failed to read auth.json' };
  }
}

app.get('/api/codex/status', (_req, res) => {
  const bin = findCodexBin();
  if (!bin) {
    return res.json({ installed: false, authenticated: false, reason: 'codex binary not found' });
  }
  const { authenticated, reason } = checkCodexAuth();
  res.json({ installed: true, authenticated, reason });
});

app.get('/api/codex/login/poll', (_req, res) => {
  const bin = findCodexBin();
  if (!bin) return res.json({ authenticated: false, reason: 'codex binary not found' });
  const { authenticated, reason } = checkCodexAuth();
  res.json({ authenticated, reason });
});

// ---------------------------------------------------------------------------
// GET /api/health — lightweight liveness probe for Docker/k8s healthchecks
// ---------------------------------------------------------------------------

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// GET /api/version — current version + update check (1-hour cache)
// ---------------------------------------------------------------------------

const VERSION_CACHE_TTL = 3_600_000; // 1 hour

function fetchLatestRelease(): Promise<{ tag: string; url: string } | null> {
  return new Promise((resolve) => {
    const req = https.get(
      'https://api.github.com/repos/mohamedelrefaiy/flowspace/releases/latest',
      { headers: { 'User-Agent': 'FlowSpace', Accept: 'application/vnd.github.v3+json' }, timeout: 5000 },
      (res) => {
        if (res.statusCode !== 200) { resolve(null); res.resume(); return; }
        let data = '';
        res.on('data', (chunk: Buffer) => (data += chunk));
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            resolve({ tag: json.tag_name, url: json.html_url });
          } catch { resolve(null); }
        });
      },
    );
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

function stripV(v: string): string { return v.replace(/^v/, ''); }

function isNewerVersion(latest: string, current: string): boolean {
  const parse = (v: string): number[] | null => {
    const parts = stripV(v).split('.').map(Number);
    return parts.length >= 3 && parts.every(n => !isNaN(n)) ? parts : null;
  };
  const l = parse(latest);
  const c = parse(current);
  if (!l || !c) return false;
  for (let i = 0; i < 3; i++) {
    if (l[i] > c[i]) return true;
    if (l[i] < c[i]) return false;
  }
  return false;
}

app.get('/api/version', async (_req, res) => {
  const cacheKey = 'version_check';
  const cached = getCached(cacheKey);
  if (cached) return res.json(cached);

  const release = await fetchLatestRelease();
  const latest = release ? stripV(release.tag) : null;
  const result = {
    current: APP_VERSION,
    latest,
    updateAvailable: latest ? isNewerVersion(latest, APP_VERSION) : false,
    releaseUrl: release?.url ?? null,
  };

  // Cache with 1-hour TTL
  cache.set(cacheKey, { data: result, expires: Date.now() + VERSION_CACHE_TTL });
  res.json(result);
});

// ---------------------------------------------------------------------------
// 2. GET /api/stats
// ---------------------------------------------------------------------------

app.get('/api/stats', async (_req, res) => {
  const cacheKey = 'stats';
  const cached = getCached(cacheKey);
  if (cached) return res.json(cached);

  try {
    const client = getAuthClient();
    const drive = google.drive({ version: 'v3', auth: client });
    const gmail = google.gmail({ version: 'v1', auth: client });
    const calendar = google.calendar({ version: 'v3', auth: client });
    const tasks = google.tasks({ version: 'v1', auth: client });

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const now = new Date().toISOString();
    const sevenDaysFromNow = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    const [driveRes, gmailRes, calRes, taskListsRes] = await Promise.all([
      drive.files.list({
        q: `modifiedTime > '${sevenDaysAgo}'`,
        pageSize: 1000,
        fields: 'files(id)',
      }),
      gmail.users.messages.list({
        userId: 'me',
        q: 'is:unread',
        maxResults: 1,
      }),
      calendar.events.list({
        calendarId: 'primary',
        timeMin: now,
        timeMax: sevenDaysFromNow,
        singleEvents: true,
        fields: 'items(id)',
        maxResults: 2500,
      }),
      tasks.tasklists.list({ maxResults: 100 }),
    ]);

    // Count incomplete tasks across all task lists
    let openTasks = 0;
    const taskLists = taskListsRes.data.items ?? [];
    if (taskLists.length > 0) {
      const taskPromises = taskLists.map((tl) =>
        tasks.tasks.list({
          tasklist: tl.id!,
          showCompleted: false,
          maxResults: 100,
        })
      );
      const taskResults = await Promise.all(taskPromises);
      for (const tr of taskResults) {
        openTasks += (tr.data.items ?? []).length;
      }
    }

    const stats = {
      driveFilesRecent: (driveRes.data.files ?? []).length,
      unreadEmails: gmailRes.data.resultSizeEstimate ?? 0,
      upcomingEvents: (calRes.data.items ?? []).length,
      openTasks,
    };

    res.json(setCache(cacheKey, stats));
  } catch (err: any) {
    console.error('Error fetching stats:', err.message);
    res.status(500).json({ error: 'Failed to fetch workspace stats' });
  }
});

// ---------------------------------------------------------------------------
// 3. GET /api/drive/recent?limit=20
// ---------------------------------------------------------------------------

app.get('/api/drive/recent', async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 20, 100);
  const cacheKey = `drive_recent_${limit}`;
  const cached = getCached(cacheKey);
  if (cached) return res.json(cached);

  try {
    const drive = driveClient();
    const { data } = await drive.files.list({
      orderBy: 'modifiedTime desc',
      pageSize: limit,
      fields: 'files(id,name,mimeType,modifiedTime,owners,webViewLink,iconLink,shared,size)',
    });

    const result = { files: data.files ?? [] };
    res.json(setCache(cacheKey, result));
  } catch (err: any) {
    console.error('Error fetching Drive files:', err.message);
    res.status(500).json({ error: 'Failed to fetch Drive files' });
  }
});

// ---------------------------------------------------------------------------
// 4. GET /api/gmail/recent?limit=10
// ---------------------------------------------------------------------------

app.get('/api/gmail/recent', async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 10, 50);
  const cacheKey = `gmail_recent_${limit}`;
  const cached = getCached(cacheKey);
  if (cached) return res.json(cached);

  try {
    const gmail = gmailClient();
    const listRes = await gmail.users.messages.list({
      userId: 'me',
      maxResults: limit,
    });

    const messageIds = (listRes.data.messages ?? []).map((m) => m.id!);

    const messages = await Promise.all(
      messageIds.map(async (id) => {
        const { data } = await gmail.users.messages.get({
          userId: 'me',
          id,
          format: 'metadata',
          metadataHeaders: ['From', 'Subject', 'Date'],
        });

        const headers = data.payload?.headers ?? [];
        const getHeader = (name: string) =>
          headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? '';

        return {
          id: data.id,
          threadId: data.threadId,
          snippet: data.snippet,
          from: getHeader('From'),
          subject: getHeader('Subject'),
          date: getHeader('Date'),
          labelIds: data.labelIds ?? [],
          unread: (data.labelIds ?? []).includes('UNREAD'),
        };
      })
    );

    const result = { messages };
    res.json(setCache(cacheKey, result));
  } catch (err: any) {
    console.error('Error fetching Gmail messages:', err.message);
    res.status(500).json({ error: 'Failed to fetch Gmail messages' });
  }
});

// ---------------------------------------------------------------------------
// 4b. Gmail Page endpoints (threads, labels, actions)
// ---------------------------------------------------------------------------

app.get('/api/gmail/labels', async (_req, res) => {
  try {
    const gmail = gmailClient();
    const labelsRes = await gmail.users.labels.list({ userId: 'me' });
    const labels = (labelsRes.data.labels ?? []).map((l) => ({
      id: l.id!,
      name: l.name!,
      type: l.type === 'system' ? 'system' : 'user',
      messagesUnread: l.messagesUnread ?? 0,
    }));
    res.json({ labels });
  } catch (err: any) {
    console.error('Error fetching Gmail labels:', err.message);
    res.status(500).json({ error: 'Failed to fetch Gmail labels' });
  }
});

app.get('/api/gmail/threads', async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 25, 50);
  const pageToken = (req.query.pageToken as string) || undefined;
  const label = (req.query.label as string) || undefined;
  const q = (req.query.q as string) || undefined;

  try {
    const gmail = gmailClient();
    const listRes = await gmail.users.threads.list({
      userId: 'me',
      maxResults: limit,
      pageToken,
      labelIds: label ? [label] : undefined,
      q,
    });

    const threadIds = (listRes.data.threads ?? []).map((t) => t.id!);

    // Fetch metadata for each thread in parallel
    const threads = await Promise.all(
      threadIds.map(async (id) => {
        const { data } = await gmail.users.threads.get({
          userId: 'me',
          id,
          format: 'metadata',
          metadataHeaders: ['From', 'Subject', 'Date'],
        });

        const msgs = data.messages ?? [];
        const lastMsg = msgs[msgs.length - 1];
        const headers = lastMsg?.payload?.headers ?? [];
        const getHeader = (name: string) =>
          headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? '';

        // Check first message for subject (thread subject)
        const firstHeaders = msgs[0]?.payload?.headers ?? [];
        const subject = firstHeaders.find((h) => h.name?.toLowerCase() === 'subject')?.value ?? getHeader('Subject');

        const hasAttachments = msgs.some((m) =>
          (m.payload?.parts ?? []).some((p) => p.filename && p.filename.length > 0)
        );

        return {
          id: data.id!,
          subject,
          snippet: lastMsg?.snippet ?? '',
          from: getHeader('From'),
          date: getHeader('Date'),
          unread: msgs.some((m) => (m.labelIds ?? []).includes('UNREAD')),
          messageCount: msgs.length,
          hasAttachments,
          labelIds: [...new Set(msgs.flatMap((m) => m.labelIds ?? []))],
        };
      })
    );

    res.json({
      threads,
      nextPageToken: listRes.data.nextPageToken ?? null,
      resultSizeEstimate: listRes.data.resultSizeEstimate ?? 0,
    });
  } catch (err: any) {
    console.error('Error fetching Gmail threads:', err.message);
    res.status(500).json({ error: 'Failed to fetch Gmail threads' });
  }
});

app.get('/api/gmail/thread/:threadId', async (req, res) => {
  const { threadId } = req.params;

  try {
    // Try active account first; fall back to other connected accounts if thread not found there
    async function fetchThread(authClient: OAuth2Client) {
      const g = google.gmail({ version: 'v1', auth: authClient });
      const { data } = await g.users.threads.get({ userId: 'me', id: threadId, format: 'full' });
      return data;
    }

    let data: Awaited<ReturnType<typeof fetchThread>> | undefined;
    try {
      data = await fetchThread(getAuthClient());
    } catch (primaryErr: any) {
      // 404 means the thread belongs to a different account — try others
      const isNotFound = primaryErr?.code === 404 || primaryErr?.status === 404 || String(primaryErr?.message).includes('404');
      if (!isNotFound) throw primaryErr;
      const { accounts } = readAccountsManifest();
      const activeId = getActiveStoredAccount()?.id;
      for (const acct of accounts) {
        if (acct.id === activeId) continue;
        const creds = readStoredCredentials(acct.credentialPath);
        if (!creds) continue;
        try {
          data = await fetchThread(createOAuthClient(creds));
          break;
        } catch {
          // try next account
        }
      }
      if (!data) throw primaryErr;
    }
    if (!data) throw new Error('Thread not found');

    const msgs = data.messages ?? [];
    const firstHeaders = msgs[0]?.payload?.headers ?? [];
    const subject = firstHeaders.find((h) => h.name?.toLowerCase() === 'subject')?.value ?? '';

    function decodeBody(payload: any): { body: string; bodyType: 'html' | 'text' } {
      // Direct body
      if (payload.body?.data) {
        const decoded = Buffer.from(payload.body.data, 'base64url').toString('utf-8');
        const isHtml = (payload.mimeType ?? '').includes('html');
        return { body: decoded, bodyType: isHtml ? 'html' : 'text' };
      }

      // Multipart: prefer HTML, fallback to text
      const parts = payload.parts ?? [];
      let html = '';
      let text = '';

      for (const part of parts) {
        if (part.mimeType === 'text/html' && part.body?.data) {
          html = Buffer.from(part.body.data, 'base64url').toString('utf-8');
        } else if (part.mimeType === 'text/plain' && part.body?.data) {
          text = Buffer.from(part.body.data, 'base64url').toString('utf-8');
        } else if (part.parts) {
          // Nested multipart (e.g., multipart/alternative inside multipart/mixed)
          const nested = decodeBody(part);
          if (nested.bodyType === 'html' && nested.body) html = nested.body;
          else if (!text && nested.body) text = nested.body;
        }
      }

      if (html) return { body: html, bodyType: 'html' };
      if (text) return { body: text, bodyType: 'text' };
      return { body: '', bodyType: 'text' };
    }

    function extractAttachments(payload: any): Array<{ filename: string; mimeType: string; size: number; attachmentId: string }> {
      const attachments: Array<{ filename: string; mimeType: string; size: number; attachmentId: string }> = [];
      const parts = payload.parts ?? [];
      for (const part of parts) {
        if (part.filename && part.filename.length > 0 && part.body?.attachmentId) {
          attachments.push({
            filename: part.filename,
            mimeType: part.mimeType ?? 'application/octet-stream',
            size: part.body.size ?? 0,
            attachmentId: part.body.attachmentId,
          });
        }
        if (part.parts) {
          attachments.push(...extractAttachments(part));
        }
      }
      return attachments;
    }

    const messages = msgs.map((m) => {
      const headers = m.payload?.headers ?? [];
      const getH = (name: string) =>
        headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? '';

      const { body, bodyType } = decodeBody(m.payload ?? {});
      const attachments = extractAttachments(m.payload ?? {});

      return {
        id: m.id!,
        from: getH('From'),
        to: getH('To'),
        cc: getH('Cc'),
        date: getH('Date'),
        body,
        bodyType,
        attachments,
      };
    });

    res.json({
      id: data.id!,
      subject,
      messages,
      labelIds: [...new Set(msgs.flatMap((m) => m.labelIds ?? []))],
    });
  } catch (err: any) {
    console.error('Error fetching Gmail thread:', err.message);
    res.status(500).json({ error: 'Failed to fetch Gmail thread' });
  }
});

app.post('/api/gmail/thread/:threadId/read', async (req, res) => {
  try {
    const gmail = gmailClient();
    await gmail.users.threads.modify({
      userId: 'me',
      id: req.params.threadId,
      requestBody: { removeLabelIds: ['UNREAD'] },
    });
    res.json({ success: true });
  } catch (err: any) {
    console.error('Error marking thread as read:', err.message);
    res.status(500).json({ error: 'Failed to mark thread as read' });
  }
});

app.post('/api/gmail/thread/:threadId/archive', async (req, res) => {
  try {
    const gmail = gmailClient();
    await gmail.users.threads.modify({
      userId: 'me',
      id: req.params.threadId,
      requestBody: { removeLabelIds: ['INBOX'] },
    });
    res.json({ success: true });
  } catch (err: any) {
    console.error('Error archiving thread:', err.message);
    res.status(500).json({ error: 'Failed to archive thread' });
  }
});

app.post('/api/gmail/thread/:threadId/trash', async (req, res) => {
  try {
    const gmail = gmailClient();
    await gmail.users.threads.trash({
      userId: 'me',
      id: req.params.threadId,
    });
    res.json({ success: true });
  } catch (err: any) {
    console.error('Error trashing thread:', err.message);
    res.status(500).json({ error: 'Failed to trash thread' });
  }
});

app.get('/api/inbox-actions/recent', (_req, res) => {
  try {
    // Ensure the user is authenticated before returning potentially sensitive history.
    try {
      gmailClient();
    } catch (authErr: any) {
      console.error('Unauthorized access to inbox action history:', authErr.message);
      return res.status(401).json({ error: 'Not signed in' });
    }

    const actions = listInboxActionHistory(getInboxActionLogPath());
    res.json({ actions });
  } catch (err: any) {
    console.error('Error fetching inbox action history:', err.message);
    res.status(500).json({ error: 'Failed to fetch inbox action history' });
  }
});

app.post('/api/inbox-actions', async (req, res) => {
  const {
    actionType,
    threadIds,
    labelName,
    sender,
    subject,
    archive,
    markRead,
    skipInbox,
    conversationId,
    messageId,
    approvalSnapshot,
  } = req.body as {
    actionType?: InboxActionType;
    threadIds?: string[];
    labelName?: string;
    sender?: string;
    subject?: string;
    archive?: boolean;
    markRead?: boolean;
    skipInbox?: boolean;
    conversationId?: string;
    messageId?: string;
    approvalSnapshot?: string;
  };

  if (!actionType) {
    return res.status(400).json({ error: 'actionType is required' });
  }

  const validThreadIds = Array.isArray(threadIds)
    ? threadIds.map((value) => String(value).trim()).filter(Boolean)
    : undefined;
  const needsThreads = actionType !== 'create_filter';
  if (needsThreads && (!validThreadIds || validThreadIds.length === 0)) {
    return res.status(400).json({ error: 'threadIds is required for this inbox action' });
  }

  try {
    const result = await executeInboxAction(gmailClient(), getInboxActionLogPath(), {
      actionType,
      threadIds: validThreadIds,
      labelName,
      sender,
      subject,
      archive: Boolean(archive),
      markRead: Boolean(markRead),
      skipInbox: Boolean(skipInbox),
      conversationId,
      messageId,
      approvalSnapshot,
    });
    if (validThreadIds) {
      const acctKey = getActiveStoredAccount()?.key || 'default';
      for (const tid of validThreadIds) {
        try { invalidateEnrichmentForThread(acctKey, tid, getScopedDataPath); } catch {}
        try { invalidateThreadBrief(tid); } catch {}
      }
    }
    res.json(result);
  } catch (err: any) {
    console.error('Error executing inbox action:', err && err.message);
    const message = (err && err.message) || 'Failed to execute inbox action';
    const isNotAuthenticated =
      typeof (err && err.message) === 'string' &&
      err.message.toLowerCase().includes('not authenticated');
    const statusCode = isNotAuthenticated ? 401 : 500;
    res.status(statusCode).json({ error: message });
  }
});

app.post('/api/inbox-actions/:auditId/undo', async (req, res) => {
  try {
    const result = await undoInboxAction(gmailClient(), getInboxActionLogPath(), req.params.auditId);
    res.json(result);
  } catch (err: any) {
    console.error('Error undoing inbox action:', err && err.message);
    const message = (err && err.message) || 'Failed to undo inbox action';
    const isNotAuthenticated =
      typeof (err && err.message) === 'string' &&
      err.message.toLowerCase().includes('not authenticated');
    const statusCode = isNotAuthenticated ? 401 : 500;
    res.status(statusCode).json({ error: message });
  }
});

// ---------------------------------------------------------------------------
// 5. GET /api/calendar/upcoming?days=7
// ---------------------------------------------------------------------------

app.get('/api/calendar/upcoming', async (req, res) => {
  const days = Math.min(Number(req.query.days) || 7, 30);
  const cacheKey = `calendar_upcoming_${days}`;
  const cached = getCached(cacheKey);
  if (cached) return res.json(cached);

  try {
    const calendar = calendarClient();
    const now = new Date();
    // Start from beginning of today so earlier events still appear
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const timeMax = new Date(startOfToday.getTime() + days * 24 * 60 * 60 * 1000);
    const timeMin = startOfToday.toISOString();
    const timeMaxStr = timeMax.toISOString();

    // Fetch all visible calendars, then query events from each
    const calListRes = await calendar.calendarList.list({ showHidden: false });
    const calendars = (calListRes.data.items ?? []).filter(
      (c) => c.selected !== false && c.id
    );

    const allEventArrays = await Promise.all(
      calendars.map(async (cal) => {
        try {
          const { data } = await calendar.events.list({
            calendarId: cal.id!,
            timeMin,
            timeMax: timeMaxStr,
            singleEvents: true,
            orderBy: 'startTime',
            maxResults: 100,
          });
          return data.items ?? [];
        } catch {
          // Some calendars may deny access — skip silently
          return [];
        }
      })
    );

    const events = allEventArrays
      .flat()
      .map((ev) => ({
        id: ev.id,
        summary: ev.summary ?? '(No title)',
        start: ev.start?.dateTime ?? ev.start?.date ?? null,
        end: ev.end?.dateTime ?? ev.end?.date ?? null,
        attendeeCount: (ev.attendees ?? []).length,
        hangoutLink: ev.hangoutLink ?? null,
        status: ev.status ?? null,
      }))
      .filter((ev) => ev.start !== null)
      .sort((a, b) => new Date(a.start!).getTime() - new Date(b.start!).getTime())
      .slice(0, 250);

    const result = { events };
    res.json(setCache(cacheKey, result));
  } catch (err: any) {
    console.error('Error fetching Calendar events:', err.message);
    res.status(500).json({ error: 'Failed to fetch Calendar events' });
  }
});

// ---------------------------------------------------------------------------
// 5b. GET /api/calendar/range?start=ISO&end=ISO
// ---------------------------------------------------------------------------

app.get('/api/calendar/range', async (req, res) => {
  const rawStart = String(req.query.start ?? '');
  const rawEnd = String(req.query.end ?? '');
  if (!rawStart || !rawEnd) {
    return res.status(400).json({ error: 'start and end query params required' });
  }
  const parsedStart = new Date(rawStart);
  const parsedEnd = new Date(rawEnd);
  if (isNaN(parsedStart.getTime()) || isNaN(parsedEnd.getTime())) {
    return res.status(400).json({ error: 'Invalid date format for start/end' });
  }
  const startParam = parsedStart.toISOString();
  const endParam = parsedEnd.toISOString();
  const cacheKey = `calendar_range_${startParam}_${endParam}`;
  const cached = getCached(cacheKey);
  if (cached) return res.json(cached);

  try {
    const calendar = calendarClient();
    const calListRes = await calendar.calendarList.list({ showHidden: false });
    const calendars = (calListRes.data.items ?? []).filter(
      (c) => c.selected !== false && c.id
    );

    const allEventArrays = await Promise.all(
      calendars.map(async (cal) => {
        try {
          const { data } = await calendar.events.list({
            calendarId: cal.id!,
            timeMin: startParam,
            timeMax: endParam,
            singleEvents: true,
            orderBy: 'startTime',
            maxResults: 250,
          });
          return (data.items ?? []).map((ev) => ({
            id: ev.id ?? '',
            summary: ev.summary ?? '(No title)',
            start: ev.start?.dateTime ?? ev.start?.date ?? '',
            end: ev.end?.dateTime ?? ev.end?.date ?? '',
            allDay: !ev.start?.dateTime,
            attendees: (ev.attendees ?? []).map((a) => ({
              email: a.email ?? '',
              name: a.displayName ?? undefined,
              responseStatus: a.responseStatus ?? 'needsAction',
            })),
            hangoutLink: ev.hangoutLink ?? undefined,
            location: ev.location ?? undefined,
            description: ev.description ?? undefined,
            calendarId: cal.id!,
            calendarName: cal.summary ?? cal.id!,
            colorId: ev.colorId ?? undefined,
            organizer: ev.organizer ? {
              email: ev.organizer.email ?? '',
              name: ev.organizer.displayName ?? undefined,
              self: ev.organizer.self ?? false,
            } : undefined,
            status: ev.status ?? 'confirmed',
            recurring: !!ev.recurringEventId,
            recurringEventId: ev.recurringEventId ?? undefined,
          }));
        } catch {
          return [];
        }
      })
    );

    const events = allEventArrays
      .flat()
      .filter((ev) => ev.start !== '')
      .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());

    const result = { events };
    res.json(setCache(cacheKey, result));
  } catch (err: any) {
    console.error('Error fetching Calendar range:', err.message);
    res.status(500).json({ error: 'Failed to fetch Calendar events' });
  }
});

// ---------------------------------------------------------------------------
// 6. GET /api/activity/recent?limit=15
// ---------------------------------------------------------------------------

app.get('/api/activity/recent', async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 15, 50);
  const cacheKey = `activity_recent_${limit}`;
  const cached = getCached(cacheKey);
  if (cached) return res.json(cached);

  try {
    const drive = driveClient();
    const gmail = gmailClient();
    const calendar = calendarClient();

    const now = new Date();
    const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const [driveRes, gmailListRes, calRes] = await Promise.all([
      drive.files.list({
        orderBy: 'modifiedTime desc',
        pageSize: 5,
        fields: 'files(id,name,mimeType,modifiedTime)',
      }),
      gmail.users.messages.list({ userId: 'me', maxResults: 5 }),
      calendar.events.list({
        calendarId: 'primary',
        timeMin: now.toISOString(),
        timeMax: sevenDaysFromNow.toISOString(),
        singleEvents: true,
        orderBy: 'startTime',
        maxResults: 5,
      }),
    ]);

    // Build activity items from Drive
    const driveItems = (driveRes.data.files ?? []).map((f) => ({
      type: 'drive' as const,
      title: f.name ?? 'Untitled',
      subtitle: f.mimeType ?? '',
      time: f.modifiedTime ?? '',
      icon: 'file',
      url: f.webViewLink ?? `https://drive.google.com/file/d/${f.id}/view`,
    }));

    // Build activity items from Gmail (fetch metadata for each)
    const gmailIds = (gmailListRes.data.messages ?? []).map((m) => m.id!);
    const gmailItems = await Promise.all(
      gmailIds.map(async (id) => {
        const { data } = await gmail.users.messages.get({
          userId: 'me',
          id,
          format: 'metadata',
          metadataHeaders: ['From', 'Subject', 'Date'],
        });
        const headers = data.payload?.headers ?? [];
        const getHeader = (name: string) =>
          headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? '';

        const dateStr = getHeader('Date');
        let isoTime: string;
        try {
          isoTime = new Date(dateStr).toISOString();
        } catch {
          isoTime = new Date().toISOString();
        }

        return {
          type: 'gmail' as const,
          title: getHeader('Subject') || '(No subject)',
          subtitle: getHeader('From'),
          time: isoTime,
          icon: 'mail',
          url: googleMailThreadUrl(id),
        };
      })
    );

    // Build activity items from Calendar
    const calItems = (calRes.data.items ?? []).map((ev) => ({
      type: 'calendar' as const,
      title: ev.summary ?? '(No title)',
      subtitle: `${(ev.attendees ?? []).length} attendees`,
      time: ev.start?.dateTime ?? ev.start?.date ?? '',
      icon: 'calendar',
      url: ev.htmlLink ?? `https://calendar.google.com/calendar/event?eid=${ev.id}`,
    }));

    // Merge and sort by time descending
    const allItems = [...driveItems, ...gmailItems, ...calItems]
      .sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())
      .slice(0, limit);

    const result = { activities: allItems };
    res.json(setCache(cacheKey, result));
  } catch (err: any) {
    console.error('Error fetching activity feed:', err.message);
    res.status(500).json({ error: 'Failed to fetch activity feed' });
  }
});

// ---------------------------------------------------------------------------
// 6b. GET/PUT /api/persona — User persona preferences
// ---------------------------------------------------------------------------

// In-memory persona cache per user (keyed by sanitized email)
const personaCache = new Map<string, Record<string, unknown>>();
const importancePreferenceCache = new Map<string, PreferenceExample[]>();

/** Get a stable key for current-user persisted preference files and caches. */
function getCurrentUserPreferenceKey(): string {
  const account = getActiveStoredAccount();
  if (account?.email) return sanitizeAccountKey(account.email);
  return 'default';
}

async function loadPersonaForCurrentUser(): Promise<Record<string, unknown> | undefined> {
  const userKey = getCurrentUserPreferenceKey();
  const cached = personaCache.get(userKey);
  if (cached) return cached;

  const fs = await import('fs');
  const path = await import('path');
  const personaPath = path.join(DATA_DIR, `.persona.${userKey}.json`);
  const legacyPath = path.join(DATA_DIR, '.persona.json');
  const filePath = fs.existsSync(personaPath) ? personaPath : fs.existsSync(legacyPath) ? legacyPath : null;

  if (!filePath) return undefined;
  const persona = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  personaCache.set(userKey, persona);
  return persona;
}

async function loadImportancePreferencesForCurrentUser(): Promise<PreferenceExample[]> {
  const userKey = getCurrentUserPreferenceKey();
  const cached = importancePreferenceCache.get(userKey);
  if (cached) return cached;

  const preferencesPath = path.join(DATA_DIR, `.importance-preferences.${userKey}.json`);
  if (!fs.existsSync(preferencesPath)) return [];

  try {
    const raw = JSON.parse(fs.readFileSync(preferencesPath, 'utf-8'));
    const preferences = Array.isArray(raw?.preferences)
      ? raw.preferences.map(coerceStoredPreferenceExample).filter(Boolean) as PreferenceExample[]
      : [];
    importancePreferenceCache.set(userKey, preferences);
    return preferences;
  } catch (err: any) {
    console.error('Error reading importance preferences:', err.message);
    return [];
  }
}

function saveImportancePreferencesForCurrentUser(preferences: PreferenceExample[]): void {
  const userKey = getCurrentUserPreferenceKey();
  const preferencesPath = path.join(DATA_DIR, `.importance-preferences.${userKey}.json`);
  fs.writeFileSync(preferencesPath, JSON.stringify({ preferences }, null, 2));
  importancePreferenceCache.set(userKey, preferences);
}

app.get('/api/persona', async (_req, res) => {
  try {
    const persona = await loadPersonaForCurrentUser();
    res.json({ persona: persona ?? null });
  } catch (err: any) {
    console.error('Error reading persona:', err.message);
    res.json({ persona: null });
  }
});

app.put('/api/persona', async (req, res) => {
  try {
    const { persona } = req.body;
    if (!persona || typeof persona !== 'object') {
      return res.status(400).json({ error: 'persona object is required' });
    }
    const serialized = JSON.stringify(persona);
    if (serialized.length > 10_000) {
      return res.status(400).json({ error: 'Persona data too large (max 10KB)' });
    }

    const userKey = getCurrentUserPreferenceKey();
    const fs = await import('fs');
    const path = await import('path');
    const personaPath = path.join(DATA_DIR, `.persona.${userKey}.json`);
    fs.writeFileSync(personaPath, serialized, { mode: 0o600 });
    personaCache.set(userKey, persona);

    res.json({ success: true, persona });
  } catch (err: any) {
    console.error('Error saving persona:', err.message);
    res.status(500).json({ error: 'Failed to save persona' });
  }
});

// 6c. GET/PUT /api/quick-actions — User-configured quick action buttons

const quickActionsCache = new Map<string, { label: string; prompt: string }[]>();

app.get('/api/quick-actions', (_req, res) => {
  const userKey = getCurrentUserPreferenceKey();
  const cached = quickActionsCache.get(userKey);
  if (cached) return res.json({ actions: cached });

  const filePath = path.join(DATA_DIR, `.quick-actions.${userKey}.json`);
  if (fs.existsSync(filePath)) {
    try {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      if (Array.isArray(data)) {
        quickActionsCache.set(userKey, data);
        return res.json({ actions: data });
      }
    } catch { /* fall through to null */ }
  }
  res.json({ actions: null }); // null = use defaults
});

app.put('/api/quick-actions', express.json(), (req, res) => {
  const { actions } = req.body;
  if (!Array.isArray(actions)) {
    return res.status(400).json({ error: 'actions must be an array' });
  }
  if (actions.length > 20) {
    return res.status(400).json({ error: 'Too many actions (max 20)' });
  }
  for (const action of actions) {
    if (typeof action?.label !== 'string' || action.label.length > 100 ||
        typeof action?.prompt !== 'string' || action.prompt.length > 1000) {
      return res.status(400).json({ error: 'Each action must have label (max 100 chars) and prompt (max 1000 chars)' });
    }
  }
  const userKey = getCurrentUserPreferenceKey();
  const filePath = path.join(DATA_DIR, `.quick-actions.${userKey}.json`);
  fs.writeFileSync(filePath, JSON.stringify(actions, null, 2), { mode: 0o600 });
  quickActionsCache.set(userKey, actions);
  res.json({ success: true, actions });
});

app.get('/api/importance-preferences', async (_req, res) => {
  try {
    const preferences = await loadImportancePreferencesForCurrentUser();
    res.json({ preferences });
  } catch (err: any) {
    console.error('Error loading importance preferences:', err.message);
    res.status(500).json({ error: 'Failed to load importance preferences' });
  }
});

app.post('/api/importance-preferences', async (req, res) => {
  try {
    const target = req.body?.target as ImportanceFeedbackTarget | undefined;
    const label = req.body?.label;
    if (!target || typeof target !== 'object') {
      return res.status(400).json({ error: 'target is required' });
    }
    if (label !== 'important' && label !== 'not_important') {
      return res.status(400).json({ error: 'label must be important or not_important' });
    }

    const example = createPreferenceExample(target, label, () => randomUUID());
    if (!example) {
      return res.status(400).json({ error: 'target is not specific enough to persist' });
    }

    const existing = await loadImportancePreferencesForCurrentUser();
    const duplicate = existing.find((item) => hasSamePreferenceExample(item, example));
    if (duplicate) {
      return res.json({ success: true, example: duplicate });
    }

    const next = [example, ...existing].slice(0, 400);
    saveImportancePreferencesForCurrentUser(next);
    res.json({ success: true, example });
  } catch (err: any) {
    console.error('Error saving importance preference:', err.message);
    res.status(500).json({ error: 'Failed to save importance preference' });
  }
});

// ---------------------------------------------------------------------------
// Saved emails — derived from important preferences
// ---------------------------------------------------------------------------

app.get('/api/saved-emails', async (_req, res) => {
  try {
    const preferences = await loadImportancePreferencesForCurrentUser();
    const savedEmails = preferences
      .filter((p) => {
        // Only include actual email threads (not drive files, deadlines, etc.)
        const isEmailItem = p.target?.item_type === 'email' || p.scope === 'triage_item';
        const hasThreadId = Boolean(p.target?.entity_id);
        const hasSubject = Boolean(p.target?.subject?.trim());
        return isEmailItem && hasThreadId && hasSubject;
      })
      .map((p) => ({
        id: p.id,
        thread_id: p.target.entity_id as string,
        subject: p.target.subject || '(no subject)',
        sender: (p.target.sender_name?.trim() || p.target.sender?.trim()) || 'Unknown',
        saved_at: p.created_at,
        label: p.label,
      }));
    res.json({ savedEmails });
  } catch (err: any) {
    console.error('Error loading saved emails:', err.message);
    res.status(500).json({ error: 'Failed to load saved emails' });
  }
});

app.delete('/api/saved-emails/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const preferences = await loadImportancePreferencesForCurrentUser();
    const next = preferences.filter((p) => p.id !== id);
    saveImportancePreferencesForCurrentUser(next);
    res.json({ success: true });
  } catch (err: any) {
    console.error('Error deleting saved email:', err.message);
    res.status(500).json({ error: 'Failed to delete saved email' });
  }
});

// ---------------------------------------------------------------------------
// 7. POST /api/chat
// ---------------------------------------------------------------------------

app.post('/api/chat', async (req, res) => {
  const { messages, threadBrief } = req.body;

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'messages array is required' });
  }
  if (messages.length > 100) {
    return res.status(400).json({ error: 'Too many messages (max 100)' });
  }

  if (!isLLMConfigured()) {
    return res.status(500).json({
      error: 'No LLM provider configured. Open Settings to add an API key.',
    });
  }

  try {
    const persona = await loadPersonaForCurrentUser() as unknown as Persona | undefined;
    const response = await handleChat(messages, {
      persona,
      threadBrief: typeof threadBrief === 'string' ? threadBrief : undefined,
    });
    res.json(response);
  } catch (err: any) {
    console.error('Chat error:', err.message || err);
    res.status(500).json({ error: 'Chat failed' });
  }
});

function deriveOrigin(eventId: string | undefined, threadBrief: string | undefined): ConversationOrigin {
  if (eventId) return 'meeting_prep';
  if (typeof threadBrief === 'string' && threadBrief.toLowerCase().includes('meeting')) return 'meeting_prep';
  return 'chat';
}

app.post('/api/chat/stream', async (req, res) => {
  const { messages, tz, conversationId, sourceMessageId, threadBrief, title, eventId } = req.body;

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'messages array is required' });
  }
  if (messages.length > 100) {
    return res.status(400).json({ error: 'Too many messages (max 100)' });
  }

  if (!isLLMConfigured()) {
    return res.status(500).json({
      error: 'No LLM provider configured. Open Settings to add an API key.',
    });
  }

  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  let closed = false;
  const controller = new AbortController();
  const seenToolIds = new Set<string>();
  const objective = [...messages].reverse().find((m: any) => m?.role === 'user')?.content ?? 'Run delegated task';
  const runId = randomUUID();
  let run: RunRecord = saveRun({
    id: runId,
    conversationId: typeof conversationId === 'string' ? conversationId : undefined,
    objective: String(objective).slice(0, 200),
    status: 'running',
    startedAt: Date.now(),
    toolTotal: 0,
    toolCompleted: 0,
    approvalPendingCount: 0,
    sourceApps: [],
    messageId: typeof sourceMessageId === 'string' ? sourceMessageId : undefined,
  });

  writeChatEvent(res, { type: 'run_started', run });
  req.on('aborted', () => controller.abort());
  res.on('close', () => {
    if (!res.writableEnded) controller.abort();
  });

  try {
    const chatPersona = await loadPersonaForCurrentUser() as unknown as Persona | undefined;
    const userEmail = getActiveStoredAccount()?.email;

    // Update conversation index (best-effort; never blocks the chat request)
    if (typeof conversationId === 'string' && conversationId && userEmail) {
      try {
        const { getUserHash } = await import('./src/lib/user-hash.js');
        const userHash = getUserHash(userEmail);
        upsertConversation(userHash, {
          id: conversationId,
          title: typeof title === 'string' ? title : undefined,
          eventId: typeof eventId === 'string' ? eventId : undefined,
          threadBrief: typeof threadBrief === 'string' ? threadBrief : undefined,
          origin: deriveOrigin(
            typeof eventId === 'string' ? eventId : undefined,
            typeof threadBrief === 'string' ? threadBrief : undefined,
          ),
        });
      } catch (idxErr) {
        console.warn('[conversation-index] upsert failed (non-fatal):', idxErr);
      }
    }

    await handleChat(messages, {
      userTz: tz,
      signal: controller.signal,
      runId,
      conversationId: typeof conversationId === 'string' ? conversationId : undefined,
      sourceMessageId: typeof sourceMessageId === 'string' ? sourceMessageId : undefined,
      threadBrief: typeof threadBrief === 'string' ? threadBrief : undefined,
      persona: chatPersona,
      userEmail,
      onEvent: (event) => {
        if (event.type === 'tool_event') {
          run = applyToolEventToRun(run, event.event, seenToolIds);
          writeChatEvent(res, { type: 'run_progress', run });
          if (run.status === 'awaiting_approval') {
            writeChatEvent(res, { type: 'run_status_changed', run });
          }
        } else if (event.type === 'assistant_complete') {
          if (run.status === 'running' || run.status === 'queued') {
            run = saveRun({ ...run, status: 'completed', endedAt: Date.now() });
            writeChatEvent(res, { type: 'run_completed', run });
          }
        } else if (event.type === 'assistant_error') {
          run = saveRun({
            ...run,
            status: 'failed',
            endedAt: Date.now(),
            errorCode: classifyErrorCode(event.error),
            errorMessage: event.error,
          });
          writeChatEvent(res, { type: 'run_failed', run });
        } else if (event.type === 'assistant_aborted') {
          run = saveRun({ ...run, status: 'canceled', endedAt: Date.now() });
          writeChatEvent(res, { type: 'run_status_changed', run });
        }
        writeChatEvent(res, event);
      },
    });
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      run = saveRun({ ...run, status: 'canceled', endedAt: Date.now() });
      writeChatEvent(res, { type: 'run_status_changed', run });
      writeChatEvent(res, { type: 'assistant_aborted' });
      closed = true;
      return res.end();
    }
    console.error('Chat stream error:', err.message || err);
    run = saveRun({
      ...run,
      status: 'failed',
      endedAt: Date.now(),
      errorCode: classifyErrorCode(err.message || 'Chat failed'),
      errorMessage: err.message || 'Chat failed',
    });
    writeChatEvent(res, { type: 'run_failed', run });
    writeChatEvent(res, { type: 'assistant_error', error: err.message || 'Chat failed' });
  } finally {
    if (!closed) res.end();
  }
});

app.post('/api/chat/approve', async (req, res) => {
  const { approval } = req.body as { approval?: ApprovalRequest };

  if (!approval || !approval.toolName || !Array.isArray(approval.fields)) {
    return res.status(400).json({ error: 'approval payload is required' });
  }

  if (!isLLMConfigured()) {
    return res.status(500).json({
      error: 'No LLM provider configured. Open Settings to add an API key.',
    });
  }

  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  let closed = false;
  const controller = new AbortController();
  const seenToolIds = new Set<string>();
  const runId = approval.runId || randomUUID();
  let run = runsStore.get(runId) || saveRun({
    id: runId,
    objective: `Approved action: ${approval.toolName}`,
    status: 'running',
    startedAt: Date.now(),
    toolTotal: 0,
    toolCompleted: 0,
    approvalPendingCount: 0,
    sourceApps: [],
  });
  run = saveRun({ ...run, status: 'running', approvalPendingCount: Math.max(0, run.approvalPendingCount - 1) });
  writeChatEvent(res, { type: 'run_status_changed', run });

  req.on('aborted', () => controller.abort());
  res.on('close', () => {
    if (!res.writableEnded) controller.abort();
  });

  const userEmail = getActiveStoredAccount()?.email;

  // Update conversation index for the approved run (best-effort)
  const approvedConvId = run.conversationId;
  if (approvedConvId && userEmail) {
    try {
      const { getUserHash } = await import('./src/lib/user-hash.js');
      const userHash = getUserHash(userEmail);
      upsertConversation(userHash, { id: approvedConvId });
    } catch (idxErr) {
      console.warn('[conversation-index] approve upsert failed (non-fatal):', idxErr);
    }
  }

  try {
    await executeApprovedAction(approval, {
      userEmail,
      conversationId: run.conversationId,
      onEvent: (event) => {
        if (event.type === 'tool_event') {
          run = applyToolEventToRun(run, event.event, seenToolIds);
          writeChatEvent(res, { type: 'run_progress', run });
        } else if (event.type === 'assistant_complete') {
          if (run.status === 'running' || run.status === 'queued') {
            run = saveRun({ ...run, status: 'completed', endedAt: Date.now(), approvalPendingCount: 0 });
            writeChatEvent(res, { type: 'run_completed', run });
          }
        } else if (event.type === 'assistant_error') {
          run = saveRun({
            ...run,
            status: 'failed',
            endedAt: Date.now(),
            errorCode: classifyErrorCode(event.error),
            errorMessage: event.error,
          });
          writeChatEvent(res, { type: 'run_failed', run });
        }
        writeChatEvent(res, event);
      },
      signal: controller.signal,
    });
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      run = saveRun({ ...run, status: 'canceled', endedAt: Date.now() });
      writeChatEvent(res, { type: 'run_status_changed', run });
      writeChatEvent(res, { type: 'assistant_aborted' });
      closed = true;
      return res.end();
    }
    console.error('Approval stream error:', err.message || err);
    run = saveRun({
      ...run,
      status: 'failed',
      endedAt: Date.now(),
      errorCode: classifyErrorCode(err.message || 'Approval failed'),
      errorMessage: err.message || 'Approval failed',
    });
    writeChatEvent(res, { type: 'run_failed', run });
    writeChatEvent(res, { type: 'assistant_error', error: err.message || 'Approval failed' });
  } finally {
    if (!closed) res.end();
  }
});

// ---------------------------------------------------------------------------
// Memory API — persistent storage for agent context across conversations
// ---------------------------------------------------------------------------

app.get('/api/memory', (_req, res) => {
  try {
    initMemoryForUser();
    loadMemories();
    const memories = [...getMemories()];
    res.json({ memories });
  } catch (err: any) {
    console.error('Error loading memories:', err);
    res.status(500).json({ error: 'Failed to load memories' });
  }
});

app.post('/api/memory', express.json(), (req, res) => {
  try {
    initMemoryForUser();
    loadMemories();

    const { category, content, tags, metadata, resourceIds } = req.body as {
      category: MemoryCategory;
      content: string;
      tags?: string[];
      metadata?: Record<string, unknown>;
      resourceIds?: string[];
    };

    if (!content || !category) {
      return res.status(400).json({ error: 'content and category are required' });
    }

    if (typeof content !== 'string' || content.length > 5000) {
      return res.status(400).json({ error: 'content must be a string (max 5000 chars)' });
    }

    if (!['resource', 'workflow', 'preference', 'fact'].includes(category)) {
      return res.status(400).json({ error: 'Invalid category. Must be: resource, workflow, preference, or fact' });
    }

    if (tags && (!Array.isArray(tags) || tags.length > 20 || tags.some((t: any) => typeof t !== 'string' || t.length > 50))) {
      return res.status(400).json({ error: 'tags must be an array of strings (max 20 tags, 50 chars each)' });
    }

    const memory = createMemory({
      category,
      content,
      tags: tags ?? [],
      metadata: metadata ?? {},
      resourceIds,
      source: { type: 'explicit_user' },
    });

    res.json({ memory });
  } catch (err: any) {
    console.error('Error creating memory:', err);
    res.status(500).json({ error: 'Failed to create memory' });
  }
});

app.put('/api/memory/:id', express.json(), (req, res) => {
  try {
    initMemoryForUser();
    loadMemories();

    const { id } = req.params;
    const updates = req.body as Partial<Omit<MemoryEntry, 'id' | 'createdAt'>>;

    const memory = updateMemory(id, updates);
    if (!memory) {
      return res.status(404).json({ error: 'Memory not found' });
    }

    res.json({ memory });
  } catch (err: any) {
    console.error('Error updating memory:', err);
    res.status(500).json({ error: 'Failed to update memory' });
  }
});

app.delete('/api/memory/:id', (req, res) => {
  try {
    initMemoryForUser();
    loadMemories();

    const { id } = req.params;
    const deleted = deleteMemory(id);

    if (!deleted) {
      return res.status(404).json({ error: 'Memory not found' });
    }

    res.json({ deleted: true });
  } catch (err: any) {
    console.error('Error deleting memory:', err);
    res.status(500).json({ error: 'Failed to delete memory' });
  }
});

app.post('/api/memory/search', express.json(), (req, res) => {
  try {
    initMemoryForUser();
    loadMemories();

    const { query } = req.body as { query: string };

    if (!query) {
      return res.json({ results: [] });
    }

    const { retrieveMemories } = require('./src/agent/memory/memory-retriever.js');
    const memories = [...getMemories()];
    const results = retrieveMemories(query, memories, { maxResults: 10 });

    res.json({ results });
  } catch (err: any) {
    console.error('Error searching memories:', err);
    res.status(500).json({ error: 'Failed to search memories' });
  }
});

// ---------------------------------------------------------------------------
// Runs API
// ---------------------------------------------------------------------------

app.get('/api/runs', (req, res) => {
  pruneRuns();
  const status = typeof req.query.status === 'string' ? req.query.status as RunStatus : null;
  const limit = Math.min(Number(req.query.limit) || 30, 200);
  let items = runOrder
    .map((id) => runsStore.get(id))
    .filter((run): run is RunRecord => Boolean(run));
  if (status) items = items.filter((run) => run.status === status);
  res.json({ runs: items.slice(0, limit) });
});

app.get('/api/runs/summary', (req, res) => {
  const window = req.query.window === '24h' ? 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
  res.json({ summary: buildRunSummary(window) });
});

app.get('/api/runs/:id', (req, res) => {
  pruneRuns();
  const run = runsStore.get(req.params.id);
  if (!run) return res.status(404).json({ error: 'Run not found' });
  res.json({ run });
});

// ---------------------------------------------------------------------------
// Follow-up Tracker — scan sent emails for commitments, store as Google Tasks
// ---------------------------------------------------------------------------

const FOLLOWUP_LIST_NAME = 'FlowSpace Follow-ups';
const cachedFollowupListIds = new Map<string, string>();

interface FollowupState {
  lastScanTimestamp: number;
  scannedMessageIds: string[];
}

function readFollowupState(): FollowupState {
  const followupStatePath = getScopedDataPath('followup-state');
  try {
    if (fs.existsSync(followupStatePath)) {
      return JSON.parse(fs.readFileSync(followupStatePath, 'utf-8'));
    }
  } catch {}
  return { lastScanTimestamp: Date.now() - 24 * 60 * 60 * 1000, scannedMessageIds: [] };
}

function writeFollowupState(state: FollowupState) {
  const followupStatePath = getScopedDataPath('followup-state');
  // Keep rolling window of last 100 message IDs
  state.scannedMessageIds = state.scannedMessageIds.slice(-100);
  fs.writeFileSync(followupStatePath, JSON.stringify(state, null, 2));
}

async function getOrCreateFollowupTaskList(): Promise<string> {
  const accountKey = getActiveStoredAccount()?.key ?? 'default';
  const cachedFollowupListId = cachedFollowupListIds.get(accountKey);
  if (cachedFollowupListId) return cachedFollowupListId;

  const tasks = tasksClient();
  const { data } = await tasks.tasklists.list({ maxResults: 100 });
  const existing = (data.items ?? []).find((l) => l.title === FOLLOWUP_LIST_NAME);
  if (existing?.id) {
    cachedFollowupListIds.set(accountKey, existing.id);
    return existing.id;
  }

  const { data: created } = await tasks.tasklists.insert({
      requestBody: { title: FOLLOWUP_LIST_NAME },
  });
  cachedFollowupListIds.set(accountKey, created.id!);
  return created.id!;
}

function resolveDueDate(hint: string | null): string {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  if (!hint) {
    // Default: 3 days from now
    return new Date(startOfToday.getTime() + 3 * 24 * 60 * 60 * 1000).toISOString();
  }

  const lower = hint.toLowerCase().trim();

  if (lower === 'today' || lower === 'eod') {
    return new Date(startOfToday.getTime() + 24 * 60 * 60 * 1000 - 1).toISOString();
  }
  if (lower === 'tomorrow') {
    return new Date(startOfToday.getTime() + 1 * 24 * 60 * 60 * 1000).toISOString();
  }
  if (lower === 'next week') {
    const daysUntilMonday = (8 - now.getDay()) % 7 || 7;
    return new Date(startOfToday.getTime() + daysUntilMonday * 24 * 60 * 60 * 1000).toISOString();
  }
  if (lower === 'next month') {
    const next = new Date(now.getFullYear(), now.getMonth() + 1, now.getDate());
    return next.toISOString();
  }

  // Try day names (Monday, Tuesday, ..., Friday, etc.)
  const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const dayIndex = dayNames.indexOf(lower);
  if (dayIndex !== -1) {
    const currentDay = now.getDay();
    let daysAhead = dayIndex - currentDay;
    if (daysAhead <= 0) daysAhead += 7;
    return new Date(startOfToday.getTime() + daysAhead * 24 * 60 * 60 * 1000).toISOString();
  }

  // Fallback: 3 days
  return new Date(startOfToday.getTime() + 3 * 24 * 60 * 60 * 1000).toISOString();
}

interface DetectedCommitment {
  email_index: number;
  commitment: string;
  due_hint: string | null;
  recipient: string;
  confidence: 'high' | 'medium';
}

interface EmailMeta {
  message_id: string;
  thread_id: string;
  to: string;
  subject: string;
  body: string;
}

const COMMITMENT_EXTRACTION_PROMPT = `Analyze sent emails for commitments the sender made. A commitment is a promise to do something in the future ("I'll send...", "Let me check...", "Will follow up...", "I can get that to you by...").

NOT commitments: pleasantries ("happy to help"), requests TO the recipient, past tense actions already done, questions, sign-offs.

Return JSON: { "commitments": [{ "email_index": 0, "commitment": "Send Q4 report", "due_hint": "Friday" | null, "recipient": "Jane Smith", "confidence": "high" | "medium" }] }

Only include high/medium confidence. Return {"commitments": []} if none found.`;

async function createFollowupTask(
  commitment: DetectedCommitment,
  emailMeta: EmailMeta
): Promise<void> {
  const listId = await getOrCreateFollowupTaskList();
  const tasks = tasksClient();

  const title = `${commitment.commitment} → ${commitment.recipient}`;
  const notes = JSON.stringify({
    source: 'flowspace-followup',
    thread_id: emailMeta.thread_id,
    message_id: emailMeta.message_id,
    recipient: commitment.recipient,
    subject: emailMeta.subject,
    detected_at: new Date().toISOString(),
    confidence: commitment.confidence,
  });

  await tasks.tasks.insert({
    tasklist: listId,
    requestBody: {
      title,
      notes,
      due: resolveDueDate(commitment.due_hint),
    },
  });
}

function extractEmailBody(payload: any): string {
  if (payload.mimeType === 'text/plain' && payload.body?.data) {
    return Buffer.from(payload.body.data, 'base64').toString('utf-8');
  }
  if (payload.parts) {
    return payload.parts.map((p: any) => extractEmailBody(p)).join('');
  }
  return '';
}

const lastScanTimeByAccount = new Map<string, number>();
const SCAN_COOLDOWN_MS = 10 * 60 * 1000; // 10 minutes

async function scanSentEmailsForCommitments(): Promise<void> {
  // Throttle: don't scan more than once every 10 minutes per account
  const accountKey = getActiveStoredAccount()?.id ?? 'default';
  const lastScanTime = lastScanTimeByAccount.get(accountKey) ?? 0;
  if (Date.now() - lastScanTime < SCAN_COOLDOWN_MS) return;
  lastScanTimeByAccount.set(accountKey, Date.now());

  const state = readFollowupState();
  const gmail = gmailClient();

  const afterTs = Math.floor(state.lastScanTimestamp / 1000);
  const listRes = await gmail.users.messages.list({
    userId: 'me',
    q: `in:sent after:${afterTs}`,
    maxResults: 20,
  });

  const messageIds = (listRes.data.messages ?? []).map((m) => m.id!);
  const newIds = messageIds.filter((id) => !state.scannedMessageIds.includes(id));

  if (newIds.length === 0) {
    state.lastScanTimestamp = Date.now();
    writeFollowupState(state);
    return;
  }

  // Fetch full messages — collect results first, then build arrays in deterministic order
  const fetched = await Promise.all(
    newIds.slice(0, 20).map(async (id) => {
      const { data } = await gmail.users.messages.get({
        userId: 'me',
        id,
        format: 'full',
      });
      const headers = data.payload?.headers ?? [];
      const getHeader = (name: string) =>
        headers.find((h: any) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? '';
      const body = extractEmailBody(data.payload).slice(0, 1500);
      return {
        message_id: data.id!,
        thread_id: data.threadId!,
        to: getHeader('To'),
        subject: getHeader('Subject'),
        body,
      } as EmailMeta;
    })
  );

  const emails: EmailMeta[] = fetched.filter((m): m is EmailMeta => m.message_id !== undefined);
  const emailBodies: string[] = emails.map((meta, i) =>
    `[Email ${i}] To: ${meta.to} | Subject: ${meta.subject}\n${meta.body}`
  );

  if (emails.length === 0) {
    state.lastScanTimestamp = Date.now();
    state.scannedMessageIds.push(...newIds);
    writeFollowupState(state);
    return;
  }

  // Send to LLM for commitment extraction
  try {
    const llmClient = createLLMClient();
    const completion = await llmClient.complete([
      { role: 'system', content: COMMITMENT_EXTRACTION_PROMPT },
      { role: 'user', content: emailBodies.join('\n\n---\n\n') },
    ], { temperature: 0.1 });

    const raw = completion.choices[0]?.message?.content ?? '';
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const result = JSON.parse(jsonMatch[0]);
      const commitments: DetectedCommitment[] = result.commitments ?? [];

      for (const c of commitments) {
        if (c.email_index >= 0 && c.email_index < emails.length) {
          await createFollowupTask(c, emails[c.email_index]);
        }
      }
    }
  } catch (err: any) {
    console.error('Commitment extraction failed:', err.message);
  }

  state.lastScanTimestamp = Date.now();
  state.scannedMessageIds.push(...newIds);
  writeFollowupState(state);
}

interface FollowupItem {
  task_id: string;
  title: string;
  commitment: string;
  recipient: string;
  thread_id: string;
  subject: string;
  due: string;
  status: 'overdue' | 'due_today' | 'upcoming' | 'completed';
  days_overdue?: number;
}

async function fetchFollowups(): Promise<FollowupItem[]> {
  const listId = await getOrCreateFollowupTaskList();
  const tasks = tasksClient();

  const { data } = await tasks.tasks.list({
    tasklist: listId,
    showCompleted: true,
    showHidden: true,
    maxResults: 100,
  });

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  return (data.items ?? [])
    .filter((t) => {
      // Only include tasks created by FlowSpace
      try {
        const notes = JSON.parse(t.notes ?? '{}');
        return notes.source === 'flowspace-followup';
      } catch {
        return false;
      }
    })
    .map((t) => {
      const notes = JSON.parse(t.notes ?? '{}');
      const due = t.due ? new Date(t.due) : new Date();
      const isCompleted = t.status === 'completed';
      const dueStart = new Date(due.getFullYear(), due.getMonth(), due.getDate());

      let status: FollowupItem['status'];
      let days_overdue: number | undefined;
      if (isCompleted) {
        status = 'completed';
      } else if (dueStart < startOfToday) {
        status = 'overdue';
        days_overdue = Math.ceil((startOfToday.getTime() - dueStart.getTime()) / (24 * 60 * 60 * 1000));
      } else if (dueStart.getTime() === startOfToday.getTime()) {
        status = 'due_today';
      } else {
        status = 'upcoming';
      }

      // Parse title: "commitment → recipient"
      const titleParts = (t.title ?? '').split(' → ');
      const commitment = titleParts[0] ?? t.title ?? '';
      const recipient = titleParts[1] ?? notes.recipient ?? '';

      return {
        task_id: t.id!,
        title: t.title ?? '',
        commitment,
        recipient,
        thread_id: notes.thread_id ?? '',
        subject: notes.subject ?? '',
        due: t.due ?? '',
        status,
        days_overdue,
      };
    });
}

// 12. GET /api/followups
app.get('/api/followups', async (_req, res) => {
  try {
    const followups = await fetchFollowups();
    res.json({ followups });
  } catch (err: any) {
    console.error('Followups error:', err.message);
    res.status(500).json({ error: 'Failed to fetch follow-ups' });
  }
});

// 13. POST /api/followups/:taskId/complete
app.post('/api/followups/:taskId/complete', async (req, res) => {
  try {
    const listId = await getOrCreateFollowupTaskList();
    const tasks = tasksClient();
    await tasks.tasks.patch({
      tasklist: listId,
      task: req.params.taskId,
      requestBody: { status: 'completed' },
    });
    res.json({ success: true });
  } catch (err: any) {
    console.error('Complete followup error:', err.message);
    res.status(500).json({ error: 'Failed to complete follow-up' });
  }
});

// 14. POST /api/followups/:taskId/snooze
app.post('/api/followups/:taskId/snooze', async (req, res) => {
  const { due } = req.body;
  if (!due) return res.status(400).json({ error: 'due date is required' });
  const parsedDue = new Date(due);
  if (isNaN(parsedDue.getTime())) return res.status(400).json({ error: 'Invalid due date format' });

  try {
    const listId = await getOrCreateFollowupTaskList();
    const tasks = tasksClient();
    await tasks.tasks.patch({
      tasklist: listId,
      task: req.params.taskId,
      requestBody: { due: parsedDue.toISOString() },
    });
    res.json({ success: true });
  } catch (err: any) {
    console.error('Snooze followup error:', err.message);
    res.status(500).json({ error: 'Failed to snooze follow-up' });
  }
});

// 15. DELETE /api/followups/:taskId
app.delete('/api/followups/:taskId', async (req, res) => {
  try {
    const listId = await getOrCreateFollowupTaskList();
    const tasks = tasksClient();
    await tasks.tasks.delete({
      tasklist: listId,
      task: req.params.taskId,
    });
    res.json({ success: true });
  } catch (err: any) {
    console.error('Delete followup error:', err.message);
    res.status(500).json({ error: 'Failed to delete follow-up' });
  }
});

app.get('/api/tasks', async (_req, res) => {
  try {
    const tasks = await listNormalizedTasks();
    res.json({ tasks });
  } catch (err: any) {
    console.error('Tasks error:', err.message);
    res.status(500).json({ error: 'Failed to fetch tasks' });
  }
});

app.post('/api/tasks/:taskId/complete', async (req, res) => {
  const taskListId = requireTaskListId(req, res);
  if (!taskListId) return;

  try {
    const tasks = tasksClient();
    await tasks.tasks.patch({
      tasklist: taskListId,
      task: req.params.taskId,
      requestBody: { status: 'completed', completed: new Date().toISOString() },
    });
    res.json({ success: true });
  } catch (err: any) {
    console.error('Complete task error:', err.message);
    res.status(500).json({ error: 'Failed to complete task' });
  }
});

app.post('/api/tasks/:taskId/reopen', async (req, res) => {
  const taskListId = requireTaskListId(req, res);
  if (!taskListId) return;

  try {
    const tasks = tasksClient();
    await tasks.tasks.patch({
      tasklist: taskListId,
      task: req.params.taskId,
      requestBody: { status: 'needsAction', completed: null },
    });
    res.json({ success: true });
  } catch (err: any) {
    console.error('Reopen task error:', err.message);
    res.status(500).json({ error: 'Failed to reopen task' });
  }
});

app.post('/api/tasks/:taskId/snooze', async (req, res) => {
  const taskListId = requireTaskListId(req, res);
  if (!taskListId) return;

  const due = typeof req.body?.due === 'string' ? req.body.due : '';
  if (!due) return res.status(400).json({ error: 'due date is required' });

  const parsedDue = new Date(due);
  if (isNaN(parsedDue.getTime())) return res.status(400).json({ error: 'invalid due date' });

  try {
    const tasks = tasksClient();
    await tasks.tasks.patch({
      tasklist: taskListId,
      task: req.params.taskId,
      requestBody: { due: parsedDue.toISOString(), status: 'needsAction' },
    });
    res.json({ success: true });
  } catch (err: any) {
    console.error('Snooze task error:', err.message);
    res.status(500).json({ error: 'Failed to snooze task' });
  }
});

// ---------------------------------------------------------------------------
// ── Retry helper ─────────────────────────────────────────────────────────────
async function callWithRetry<T>(fn: () => Promise<T>, retries = 1, delayMs = 2000): Promise<T> {
  try {
    return await fn();
  } catch (err: any) {
    const status = err?.status ?? err?.response?.status ?? 0;
    // Don't retry on 4xx (client errors / auth issues)
    if (status >= 400 && status < 500) throw err;
    if (retries <= 0) throw err;
    await new Promise((r) => setTimeout(r, delayMs));
    return callWithRetry(fn, retries - 1, delayMs);
  }
}

// 8. GET /api/briefing — AI morning briefing
// ---------------------------------------------------------------------------

const BRIEFING_SYSTEM_PROMPT = `You are a proactive executive assistant for Google Workspace.
Given the user's current Gmail, Calendar, and Drive state, generate a concise morning briefing.

Return ONLY a valid JSON object. No markdown, no explanation, no preamble. Exactly this structure:

{
  "greeting": "one sentence, time-aware (Good morning / Good afternoon), warm and personal using the user's first name",
  "summary": "2-3 sentences. What actually matters today. Be direct — skip anything routine or low-priority.",
  "attention_items": [
    {
      "type": "email_reply" | "meeting_prep" | "drive_file" | "deadline",
      "priority": "high" | "medium",
      "title": "short label, max 6 words",
      "description": "one sentence — why this needs attention today specifically",
      "action_label": "Draft reply" | "Create notes doc" | "Open file" | "Review",
      "action_context": "the Gmail thread ID, Calendar event ID, or Drive file ID"
    }
  ],
  "inbox_triage": {
    "needs_reply": [{
      "subject": "...", "sender": "...", "thread_id": "...", "summary": "one sentence summary",
      "urgency": "urgent_action" | "needs_input" | "review" | "fyi",
      "actions": [{
        "type": "draft_reply" | "accept_meeting" | "reject_meeting" | "suggest_time" | "create_task" | "approve_request" | "open_form" | "add_to_calendar",
        "label": "human-readable button label",
        "detail": "optional extra context",
        "context": { "thread_id": "...", "event_start": "...", "form_url": "...", "deadline": "..." },
        "needs_input": "optional: what the AI needs from the user before proceeding",
        "conflict": "optional: calendar conflict description"
      }]
    }],
    "needs_input": [{ "subject": "...", "sender": "...", "thread_id": "...", "summary": "...", "urgency": "needs_input", "actions": [...], "needs_input_reason": "what the AI needs from the user" }],
    "fyi_only": [{ "subject": "...", "sender": "...", "thread_id": "...", "summary": "one sentence summary", "urgency": "fyi", "actions": [] }],
    "can_ignore": [{ "subject": "...", "sender": "...", "thread_id": "...", "summary": "one sentence summary", "urgency": "fyi", "actions": [] }]
  },
  "day_at_a_glance": [
    {
      "time": "HH:MM",
      "title": "event title",
      "event_id": "...",
      "attendees": ["First Last", "First Last"],
      "has_notes_doc": true | false,
      "prep_note": "one line of useful context, or null",
      "priority_group": "needs_prep" | "show_up" | "fyi",
      "linked_docs": [{ "name": "Doc title", "url": "https://...", "type": "notes" | "agenda" | "shared_file" }]
    }
  ]
}

Rules:
- Prioritize ruthlessly. If nothing needs attention, say so clearly.
- For EVERY inbox_triage item, you MUST include a concise, one-sentence "summary" that captures the essence of the email content. Never leave this field empty.
- For EVERY inbox_triage item, you MUST include the "thread_id" exactly as provided in the context.
- needs_reply should have at most 5 items — only real humans, no newsletters or notifications.
- can_ignore should catch newsletters, automated emails, and notifications.

Per-email action rules (max 3 actions per email):
- EVERY needs_reply item MUST have at least one action. Default: { "type": "draft_reply", "label": "Draft reply", "context": { "thread_id": "..." } }.
- Meeting invites: If email contains calendar invite language ("You're invited", "RSVP", "meeting request", "join us"), compare proposed time against day_at_a_glance events. If conflict → add "reject_meeting" action with "conflict" field describing the overlap + "suggest_time" action. If no conflict → add "accept_meeting" action with "label": "Accept & add to calendar".
- Approvals/sign-offs: If email asks for approval, review, or sign-off → add "approve_request" action with "label": "Approve".
- Deadlines: If email mentions a deadline ("by Friday", "due March 15", "EOD") → add "create_task" action with extracted date in context.deadline.
- Forms/surveys: If email contains form/survey links → add "open_form" action with URL in context.form_url.
- Needs input: If the AI cannot determine the right action without user input (e.g., "which time slot?", "what's your budget?") → place in "needs_input" bucket with urgency "needs_input" and set "needs_input" field on the action explaining what's needed.
- Set urgency: "urgent_action" for time-sensitive items needing immediate response, "needs_input" for items where AI needs user guidance, "review" for standard items, "fyi" for informational.
- prep_note should only be non-null if there is something genuinely useful to say about the meeting.
- If FOLLOW-UP COMMITMENTS are provided, include a "followups" section in the summary mentioning overdue or due-today items. Example: "You promised to send the report to Jane — that's overdue by 2 days."
- Do NOT add a followups array to the JSON — the backend handles that separately. Just weave overdue/due-today follow-ups into the "summary" text naturally.

Calendar priority_group rules:
- "needs_prep": Events with external attendees, >3 attendees without a notes doc, 1-on-1s, events with "review", "presentation", "pitch", or "demo" in the title.
- "show_up": Recurring standups/syncs, <3 internal-only attendees, events that already have a notes doc linked.
- "fyi": All-hands, company meetings, optional events, informational calendar invites.
- Return a MAXIMUM of 8 events in day_at_a_glance: up to 3 needs_prep, up to 3 show_up, remainder fyi (max 2). If more than 8 events exist, drop fyi first, then show_up.
- Every event MUST have a valid priority_group field.

linked_docs rules:
- Only populate linked_docs when a Drive file from the RECENTLY SHARED list is directly relevant to the event (e.g., shared by an attendee, file name matches the meeting topic, or a Google Docs URL appears in the event description).
- linked_docs is an array. Each entry has: "name" (file name), "url" (Google Drive URL), "type" ("notes" | "agenda" | "shared_file").
- If no files are relevant, set linked_docs to an empty array [].

Drive attention_items rules:
- Only include drive_file attention items when the file is directly relevant to today's events or requires action. Do NOT list all recently shared files.`;

app.get('/api/briefing', async (req, res) => {
  if (!isLLMConfigured()) {
    return res.status(500).json({ error: 'briefing_unavailable', reason: 'No LLM provider configured' });
  }

  const shouldRefresh = req.query.refresh === 'true';
  const cacheKey = 'briefing';

  if (!shouldRefresh) {
    const cached = getCached(cacheKey);
    if (cached) return res.json(cached);
  } else {
    cache.delete(scopeCacheKey(cacheKey));
  }

  try {
    const client = getAuthClient();
    const gmail = google.gmail({ version: 'v1', auth: client });
    const calendar = google.calendar({ version: 'v3', auth: client });
    const drive = google.drive({ version: 'v3', auth: client });
    const oauth2 = google.oauth2({ version: 'v2', auth: client });
    const importancePreferences = await loadImportancePreferencesForCurrentUser();

    // Fetch user info + workspace data in parallel
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endOfToday = new Date(startOfToday.getTime() + 24 * 60 * 60 * 1000);

    // userinfo.get() requires userinfo scope which gws CLI doesn't include — fetch separately with fallback
    let userName = 'there';
    try {
      const { data } = await oauth2.userinfo.get();
      userName = data.name ?? 'there';
    } catch {
      try {
        const { data } = await gmail.users.getProfile({ userId: 'me' });
        userName = data.emailAddress?.split('@')[0] ?? 'there';
      } catch {
        // Fall back to default
      }
    }

    const [gmailListRes, calRes, driveRes] = await Promise.all([
      gmail.users.messages.list({
        userId: 'me',
        q: `is:unread after:${Math.floor(new Date(oneDayAgo).getTime() / 1000)}`,
        maxResults: 20,
      }),
      calendar.events.list({
        calendarId: 'primary',
        timeMin: startOfToday.toISOString(),
        timeMax: endOfToday.toISOString(),
        singleEvents: true,
        orderBy: 'startTime',
        maxResults: 20,
        fields: 'items(id,summary,start,end,attendees,description,hangoutLink)',
      }),
      drive.files.list({
        q: `sharedWithMe = true and modifiedTime > '${twoDaysAgo}'`,
        pageSize: 10,
        fields: 'files(id,name,mimeType,modifiedTime,webViewLink,sharingUser)',
        orderBy: 'modifiedTime desc',
      }),
    ]);

    // userName already set above from userinfo/gmail fallback

    // Fetch email details in parallel
    const messageIds = (gmailListRes.data.messages ?? []).map((m) => m.id!);
    const emailDetails = await Promise.all(
      messageIds.slice(0, 15).map(async (id) => {
        const { data } = await gmail.users.messages.get({
          userId: 'me',
          id,
          format: 'metadata',
          metadataHeaders: ['From', 'Subject', 'Date'],
        });
        const headers = data.payload?.headers ?? [];
        const getHeader = (name: string) =>
          headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? '';
        return {
          id: data.id,
          threadId: data.threadId,
          subject: getHeader('Subject'),
          from: getHeader('From'),
          snippet: data.snippet ?? '',
          labelIds: data.labelIds ?? [],
        };
      })
    );

    // Build context for AI
    const calendarEvents = (calRes.data.items ?? []).map((ev) => ({
      id: ev.id,
      title: ev.summary ?? '(No title)',
      start: ev.start?.dateTime ?? ev.start?.date ?? '',
      end: ev.end?.dateTime ?? ev.end?.date ?? '',
      attendees: (ev.attendees ?? []).map((a) => a.displayName || a.email || 'Unknown'),
      description: ev.description ?? '',
      hangoutLink: ev.hangoutLink ?? null,
    }));

    const driveFiles = (driveRes.data.files ?? []).map((f) => ({
      id: f.id,
      name: f.name,
      mimeType: f.mimeType,
      modifiedTime: f.modifiedTime,
      sharedBy: (f as any).sharingUser?.displayName ?? 'Unknown',
    }));

    // Scan sent emails for commitments + fetch existing follow-ups
    let followups: FollowupItem[] = [];
    try {
      if (isLLMConfigured()) await scanSentEmailsForCommitments();
      followups = await fetchFollowups();
    } catch (err: any) {
      console.warn('Follow-up scan/fetch failed:', err.message);
    }

    const activeFollowups = followups.filter((f) => f.status !== 'completed');
    const followupContext = activeFollowups.length === 0 ? 'None' : activeFollowups.map((f) =>
      `- "${f.commitment}" to ${f.recipient} | Due: ${f.due} | Status: ${f.status}${f.days_overdue ? ` (${f.days_overdue} days overdue)` : ''} | Thread: ${f.subject}`
    ).join('\n');

    let userTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (typeof req.query.tz === 'string' && req.query.tz) {
      try {
        // Validate by attempting to use it — throws RangeError if invalid
        Intl.DateTimeFormat('en-US', { timeZone: req.query.tz });
        userTz = req.query.tz;
      } catch {
        // Invalid timezone — fall back to server default
      }
    }
    const localTimeStr = new Date().toLocaleString('en-US', { timeZone: userTz, weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });

    const contextMessage = `User: ${userName}
Current local time: ${localTimeStr} (${userTz})

UNREAD EMAILS (last 24h):
${emailDetails.length === 0 ? 'None' : emailDetails.map((e) =>
  `- From: ${e.from} | Subject: ${e.subject} | Thread ID: ${e.threadId} | Snippet: ${e.snippet}`
).join('\n')}

TODAY'S CALENDAR:
${calendarEvents.length === 0 ? 'No events today' : calendarEvents.map((e) => {
  const hasLink = e.description.includes('docs.google.com') || e.description.includes('drive.google.com') || e.title.includes('docs.google.com');
  return `- ${e.start} | ${e.title} | Event ID: ${e.id} | Attendees: ${e.attendees.join(', ')} | Has doc link: ${hasLink}`;
}).join('\n')}

RECENTLY SHARED DRIVE FILES (last 48h):
${driveFiles.length === 0 ? 'None' : driveFiles.map((f) =>
  `- ${f.name} (${f.mimeType}) shared by ${f.sharedBy} | File ID: ${f.id}`
).join('\n')}

FOLLOW-UP COMMITMENTS (promises you made in sent emails):
${followupContext}`;

    // Call LLM for briefing generation
    const llmClient = createLLMClient();

    const completion = await callWithRetry(() =>
      llmClient.complete([
        { role: 'system', content: BRIEFING_SYSTEM_PROMPT },
        { role: 'user', content: contextMessage },
      ], { temperature: 0.3 }),
      1, // 1 retry
      2000, // 2s delay
    );

    const raw = completion.choices[0]?.message?.content ?? '';
    // Extract JSON from response — try regex first, then direct parse as fallback
    let briefing: any;
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        briefing = JSON.parse(jsonMatch[0]);
      } catch {
        console.warn('Briefing: regex-extracted JSON failed to parse, trying raw');
      }
    }
    if (!briefing) {
      try {
        briefing = JSON.parse(raw.trim());
      } catch {
        console.error('Briefing: failed to extract JSON from response:', raw.slice(0, 500));
        return res.json({ error: 'briefing_unavailable' });
      }
    }
    // Enforce 8-event cap and valid priority_group on day_at_a_glance
    if (Array.isArray(briefing.day_at_a_glance)) {
      for (const ev of briefing.day_at_a_glance) {
        if (!ev.priority_group || !['needs_prep', 'show_up', 'fyi'].includes(ev.priority_group)) {
          ev.priority_group = 'show_up';
        }
        if (!Array.isArray(ev.linked_docs)) ev.linked_docs = [];
      }
      const needsPrep = briefing.day_at_a_glance.filter((e: any) => e.priority_group === 'needs_prep').slice(0, 3);
      const showUp = briefing.day_at_a_glance.filter((e: any) => e.priority_group === 'show_up').slice(0, 3);
      const remaining = 8 - needsPrep.length - showUp.length;
      const fyi = briefing.day_at_a_glance.filter((e: any) => e.priority_group === 'fyi').slice(0, Math.max(0, remaining));
      briefing.day_at_a_glance = [...needsPrep, ...showUp, ...fyi];
    }

    // Validate and normalize inbox_triage actions
    const validActionTypes = new Set(['draft_reply', 'accept_meeting', 'reject_meeting', 'suggest_time', 'create_task', 'approve_request', 'open_form', 'add_to_calendar']);
    const validUrgency = new Set(['urgent_action', 'needs_input', 'review', 'fyi']);
    if (briefing.inbox_triage) {
      if (!Array.isArray(briefing.inbox_triage.needs_input)) {
        briefing.inbox_triage.needs_input = [];
      }
      for (const bucket of ['needs_reply', 'needs_input', 'fyi_only', 'can_ignore']) {
        const items = briefing.inbox_triage[bucket];
        if (!Array.isArray(items)) { briefing.inbox_triage[bucket] = []; continue; }
        for (const item of items) {
          // Validate urgency
          if (!item.urgency || !validUrgency.has(item.urgency)) {
            item.urgency = bucket === 'needs_reply' ? 'review' : bucket === 'needs_input' ? 'needs_input' : 'fyi';
          }
          // Validate and cap actions
          if (Array.isArray(item.actions)) {
            item.actions = item.actions.filter((a: any) => a && validActionTypes.has(a.type)).slice(0, 3);
          } else {
            item.actions = [];
          }
          // Ensure needs_reply items have at least a draft_reply action
          if (bucket === 'needs_reply' && item.actions.length === 0) {
            item.actions = [{ type: 'draft_reply', label: 'Draft reply', context: { thread_id: item.thread_id || '' } }];
          }
        }
      }
    }

    if (!Array.isArray(briefing.attention_items)) {
      briefing.attention_items = [];
    }

    // Attach follow-ups to briefing response (managed by backend, not AI)
    briefing.followups = followups;
    // Inject overdue follow-ups as attention items
    for (const f of activeFollowups.filter((f) => f.status === 'overdue')) {
      briefing.attention_items.push({
        type: 'followup',
        priority: 'high',
        title: `Overdue: ${f.commitment}`,
        description: `You promised this to ${f.recipient} — ${f.days_overdue} day${f.days_overdue !== 1 ? 's' : ''} overdue`,
        action_label: 'View thread',
        action_context: f.thread_id,
      });
    }

    briefing = applyPreferenceExamplesToBriefing(briefing, importancePreferences);

    // Cache briefing for 10 minutes
    cache.set(cacheKey, { data: briefing, expires: Date.now() + 10 * 60 * 1000 });
    res.json(briefing);
  } catch (err: any) {
    console.error('Briefing error:', err.message);
    res.json({ error: 'briefing_unavailable', reason: 'Failed to generate briefing. Check server logs.' });
  }
});

// ---------------------------------------------------------------------------
// 8b. POST /api/ai-triage — AI-powered email categorization
// ---------------------------------------------------------------------------

app.post('/api/ai-triage', async (req, res) => {
  if (!isLLMConfigured()) {
    return res.status(500).json({ error: 'No LLM provider configured. Open Settings to add an API key.' });
  }

  const { threads, legacy, requestId } = req.body;
  if (!Array.isArray(threads) || threads.length === 0) {
    return res.status(400).json({ error: 'threads array is required' });
  }

  const capped = threads.slice(0, 25);
  const startTime = Date.now();
  const accountKey = getActiveStoredAccount()?.key || 'default';
  const validIds = new Set(capped.map((t: { id: string }) => t.id));

  try {
    const cache = loadEnrichmentCache(accountKey, getScopedDataPath);
    const enrichments: any[] = [];
    const cachedHits: string[] = [];
    const misses: any[] = [];

    for (const t of capped) {
      const lastMsgId = t.lastMessageId || t.id;
      const key = `${t.id}:${lastMsgId}`;
      const entry = cache.entries[key];
      if (entry && !entry.invalidatedAt && Date.now() < new Date(entry.expiresAt).getTime()) {
        enrichments.push(entry.enrichment);
        cachedHits.push(t.id);
      } else {
        misses.push(t);
      }
    }

    if (misses.length > 0) {
      const llmClient = createLLMClient();
      const { system, user } = buildListEnrichmentPrompt(misses);

      // Cold-cache full batch can take ~2 min on slow providers (e.g. glm-5.1).
      // After the first run the cache is warm and this path is rarely hit,
      // so a generous wall-clock budget is fine. Revisit if we add streaming.
      const ENRICHMENT_TIMEOUT_MS = 90_000;
      const completion = await Promise.race([
        callWithRetry(() =>
          llmClient.complete([
            { role: 'system', content: system },
            { role: 'user', content: user },
          ], { temperature: 0.2 }),
          0,
          0,
        ),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('enrichment_timeout')), ENRICHMENT_TIMEOUT_MS),
        ),
      ]);

      const raw = (completion as any).choices?.[0]?.message?.content ?? '';
      const missIds = new Set(misses.map((t: { id: string }) => t.id));
      const parsed = parseAiTriageResponse(raw, missIds);

      for (const e of parsed.enrichments) {
        enrichments.push(e);
        const lastMsgId = (misses.find((t: any) => t.id === e.threadId) as any)?.lastMessageId || e.threadId;
        putEnrichment(accountKey, e.threadId, lastMsgId, e, getScopedDataPath);
      }
    }

    const failed: string[] = [];
    for (const id of validIds) {
      if (!enrichments.find((e: any) => e.threadId === id)) {
        failed.push(id);
      }
    }

    const bucketCounts: Record<string, number> = { needs_reply: 0, waiting: 0, quick_wins: 0, reference_fyi: 0 };
    for (const e of enrichments) {
      const b = (e as any).bucket;
      if (b && b in bucketCounts) bucketCounts[b]++;
    }

    // Derive legacy categories from enrichments (cheap — no second LLM call).
    // Per contract §6: include when legacy === true, or as a safety-net when
    // legacy is omitted (undefined) so existing dashboard callers keep working.
    let categories: any[] | undefined;
    if (legacy !== false) {
      const bucketMap = new Map<string, string[]>();
      for (const e of enrichments) {
        const label = (e as any).bucket?.replace(/_/g, ' ') ?? 'other';
        if (!bucketMap.has(label)) bucketMap.set(label, []);
        bucketMap.get(label)!.push((e as any).threadId);
      }
      if (bucketMap.size > 0) {
        categories = Array.from(bucketMap.entries()).map(([label, threadIds]) => ({ label, threadIds }));
      }
    }

    const durationMs = Date.now() - startTime;

    console.log(JSON.stringify({
      event: 'gmail_enrichment_batch',
      batchSize: capped.length,
      successCount: enrichments.length,
      successRate: enrichments.length / capped.length,
      cacheHits: cachedHits.length,
      cacheHitRate: cachedHits.length / capped.length,
      durationMs,
      requestId: requestId || '',
      accountKey,
      timestamp: new Date().toISOString(),
    }));

    res.json({
      enrichments,
      failed,
      cacheStats: {
        hits: cachedHits.length,
        misses: misses.length,
        totalRequested: capped.length,
      },
      bucketCounts,
      durationMs,
      ...(categories ? { categories } : {}),
    });
  } catch (err: any) {
    console.error('[ai-triage] Error:', err.message);
    const durationMs = Date.now() - startTime;
    console.log(JSON.stringify({
      event: 'gmail_enrichment_batch',
      batchSize: capped.length,
      successCount: 0,
      successRate: 0,
      cacheHits: 0,
      cacheHitRate: 0,
      durationMs,
      requestId: requestId || '',
      accountKey,
      timestamp: new Date().toISOString(),
    }));
    res.status(500).json({ error: 'enrichment_timeout', failed: [...validIds] });
  }
});

// ---------------------------------------------------------------------------
// 8c. GET /api/thread-brief/:threadId — AI decision header for thread reader
// ---------------------------------------------------------------------------

app.get('/api/thread-brief/:threadId', async (req, res) => {
  const { threadId } = req.params;

  // Step 1: Validate threadId
  if (!/^[A-Za-z0-9_-]+$/.test(threadId)) {
    console.error('[thread-brief] Invalid threadId format:', threadId);
    return res.status(400).json({ error: 'Invalid threadId format' });
  }

  const startTime = Date.now();
  const accountKey = getActiveStoredAccount()?.key || 'default';

  // Step 2: Cache lookup
  const cached = threadBriefCache.get(threadId);
  if (cached) {
    const durationMs = Date.now() - startTime;
    console.log(JSON.stringify({
      event: 'thread_brief_complete',
      threadId,
      success: true,
      isFallback: cached.brief.isFallback,
      cacheHit: true,
      durationMs,
      accountKey,
      timestamp: new Date().toISOString(),
    }));
    return res.json({ brief: cached.brief, cacheHit: true, durationMs });
  }

  // Step 3: Fetch thread detail (reuse the same Gmail client + auth as /api/gmail/thread/:threadId)
  let threadDetail: { id: string; subject: string; messages: Array<{ id: string; from: string; to: string; cc: string; date: string; body: string; bodyType: 'html' | 'text'; attachments: any[] }>; labelIds: string[] } | undefined;
  try {
    const gmail = gmailClient();
    const { data } = await gmail.users.threads.get({ userId: 'me', id: threadId, format: 'full' });
    if (!data) {
      return res.status(404).json({ error: 'Thread not found' });
    }

    const msgs = data.messages ?? [];
    const firstHeaders = msgs[0]?.payload?.headers ?? [];
    const subject = firstHeaders.find((h) => h.name?.toLowerCase() === 'subject')?.value ?? '';

    function decodeBodyText(payload: any): string {
      if (payload.body?.data) {
        return Buffer.from(payload.body.data, 'base64url').toString('utf-8');
      }
      const parts = payload.parts ?? [];
      let html = '';
      let text = '';
      for (const part of parts) {
        if (part.mimeType === 'text/html' && part.body?.data) {
          html = Buffer.from(part.body.data, 'base64url').toString('utf-8');
        } else if (part.mimeType === 'text/plain' && part.body?.data) {
          text = Buffer.from(part.body.data, 'base64url').toString('utf-8');
        } else if (part.parts) {
          const nested = decodeBodyText(part);
          if (!html && nested) html = nested;
          else if (!text && nested) text = nested;
        }
      }
      return html || text || '';
    }

    const messages = msgs.map((m) => {
      const headers = m.payload?.headers ?? [];
      const getH = (name: string) =>
        headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? '';
      return {
        id: m.id!,
        from: getH('From'),
        to: getH('To'),
        cc: getH('Cc'),
        date: getH('Date'),
        body: decodeBodyText(m.payload ?? {}),
        bodyType: 'text' as const,
        attachments: [],
      };
    });

    threadDetail = {
      id: data.id!,
      subject,
      messages,
      labelIds: [...new Set(msgs.flatMap((m) => m.labelIds ?? []))],
    };
  } catch (fetchErr: any) {
    const isNotFound =
      fetchErr?.code === 404 ||
      fetchErr?.status === 404 ||
      String(fetchErr?.message).includes('404');
    if (isNotFound) {
      return res.status(404).json({ error: 'Thread not found' });
    }
    console.error('[thread-brief] Error fetching thread:', fetchErr.message);
    const durationMs = Date.now() - startTime;
    console.log(JSON.stringify({
      event: 'thread_brief_complete',
      threadId,
      success: false,
      isFallback: true,
      cacheHit: false,
      durationMs,
      accountKey,
      timestamp: new Date().toISOString(),
    }));
    return res.status(500).json({ error: 'Failed to fetch thread' });
  }

  // Helper: build fallback brief
  function buildFallbackBrief(): ThreadBrief {
    return {
      threadId,
      summary: '',
      recommendedAction: '',
      contextChips: computeDeterministicChips(threadDetail!),
      firstClassActions: [{ kind: 'draft_reply' }],
      isFallback: true,
      cachedAt: new Date().toISOString(),
    };
  }

  // Step 4: Truncate messages (already done in buildThreadBriefPrompt, but we also limit here)
  const truncatedMessages = threadDetail.messages.slice(0, 5).map((m) => ({
    ...m,
    body: m.body.length > 2000 ? m.body.slice(0, 2000) : m.body,
  }));
  const truncatedDetail = { ...threadDetail, messages: truncatedMessages };

  // Step 5: Build prompt
  const { system, user } = buildThreadBriefPrompt(truncatedDetail);

  // Step 6: LLM call with 5000ms timeout, 0 retries
  const BRIEF_TIMEOUT_MS = 5000;
  let rawResponse: string;
  try {
    const llmClient = createLLMClient();
    const completion = await Promise.race([
      llmClient.complete([
        { role: 'system', content: system },
        { role: 'user', content: user },
      ], { temperature: 0.3 }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('thread_brief_timeout')), BRIEF_TIMEOUT_MS),
      ),
    ]);
    rawResponse = (completion as any).choices?.[0]?.message?.content ?? '';
  } catch (llmErr: any) {
    // Timeout or LLM error → fallback (NOT a 500)
    const fallback = buildFallbackBrief();
    const durationMs = Date.now() - startTime;
    console.log(JSON.stringify({
      event: 'thread_brief_complete',
      threadId,
      success: false,
      isFallback: true,
      cacheHit: false,
      durationMs,
      accountKey,
      timestamp: new Date().toISOString(),
    }));
    return res.json({ brief: fallback, cacheHit: false, durationMs });
  }

  // Step 7: Parse JSON
  let parsed: { summary?: string; recommendedAction?: string; contextChips?: ContextChip[]; firstClassActions?: FirstClassAction[] } = {};
  try {
    const jsonMatch = rawResponse.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON in response');
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    const fallback = buildFallbackBrief();
    const durationMs = Date.now() - startTime;
    console.log(JSON.stringify({
      event: 'thread_brief_complete',
      threadId,
      success: false,
      isFallback: true,
      cacheHit: false,
      durationMs,
      accountKey,
      timestamp: new Date().toISOString(),
    }));
    return res.json({ brief: fallback, cacheHit: false, durationMs });
  }

  // Step 8: Cap summary at 140 chars
  let summary = parsed.summary ?? '';
  if (summary.length > 140) {
    summary = summary.slice(0, 137) + '...';
  }

  // Step 9: Specificity rule — if recommendedAction matches GENERIC_VERBS → fallback
  const recommendedAction = parsed.recommendedAction ?? '';
  if (GENERIC_VERBS.test(recommendedAction.trim())) {
    const fallback = buildFallbackBrief();
    const durationMs = Date.now() - startTime;
    console.log(JSON.stringify({
      event: 'thread_brief_complete',
      threadId,
      success: false,
      isFallback: true,
      cacheHit: false,
      durationMs,
      accountKey,
      timestamp: new Date().toISOString(),
    }));
    return res.json({ brief: fallback, cacheHit: false, durationMs });
  }

  // Step 10: Merge contextChips — deterministic wins on label ties, cap at 4
  const deterministicChips = computeDeterministicChips(truncatedDetail);
  const llmChips: ContextChip[] = Array.isArray(parsed.contextChips) ? parsed.contextChips : [];
  const mergedChips = new Map<string, ContextChip>();
  for (const chip of llmChips) mergedChips.set(chip.label, chip);
  for (const chip of deterministicChips) mergedChips.set(chip.label, chip); // deterministic wins
  const contextChips = Array.from(mergedChips.values()).slice(0, 4);

  // Step 11: Ensure firstClassActions starts with draft_reply
  let firstClassActions: FirstClassAction[] = Array.isArray(parsed.firstClassActions)
    ? parsed.firstClassActions
    : [];
  if (!firstClassActions.find((a) => a.kind === 'draft_reply')) {
    firstClassActions = [{ kind: 'draft_reply' }, ...firstClassActions];
  }

  // Step 12: Store in cache
  const nowIso = new Date().toISOString();
  const brief: ThreadBrief = {
    threadId,
    summary,
    recommendedAction,
    contextChips,
    firstClassActions,
    isFallback: false,
    cachedAt: nowIso,
  };
  threadBriefCache.set(threadId, { brief, cachedAt: nowIso });

  // Step 13: Emit telemetry
  const durationMs = Date.now() - startTime;
  console.log(JSON.stringify({
    event: 'thread_brief_complete',
    threadId,
    success: true,
    isFallback: false,
    cacheHit: false,
    durationMs,
    accountKey,
    timestamp: new Date().toISOString(),
  }));

  // Step 14: Return 200
  return res.json({ brief, cacheHit: false, durationMs } satisfies ThreadBriefResponse);
});

// ---------------------------------------------------------------------------
// 9. POST /api/draft-reply — AI-generated email reply draft
// ---------------------------------------------------------------------------

app.post('/api/draft-reply', async (req, res) => {
  const { thread_id } = req.body;
  if (!thread_id) {
    return res.status(400).json({ error: 'thread_id is required' });
  }

  if (!isLLMConfigured()) {
    return res.status(500).json({ error: 'No LLM provider configured. Open Settings to add an API key.' });
  }

  try {
    const gmail = gmailClient();

    // Fetch the full thread
    const { data: thread } = await gmail.users.threads.get({
      userId: 'me',
      id: thread_id,
      format: 'full',
    });

    const threadMessages = (thread.messages ?? []).map((msg) => {
      const headers = msg.payload?.headers ?? [];
      const getHeader = (name: string) =>
        headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? '';

      // Extract body text
      let body = '';
      const extractText = (part: any): string => {
        if (part.mimeType === 'text/plain' && part.body?.data) {
          return Buffer.from(part.body.data, 'base64').toString('utf-8');
        }
        if (part.parts) {
          return part.parts.map(extractText).join('');
        }
        return '';
      };
      body = extractText(msg.payload);

      return {
        from: getHeader('From'),
        to: getHeader('To'),
        subject: getHeader('Subject'),
        date: getHeader('Date'),
        body: body.slice(0, 2000), // Limit body length
      };
    });

    // Generate draft reply via LLM
    const llmClient = createLLMClient();

    const completion = await llmClient.complete([
      {
        role: 'system',
        content: 'Write a concise, professional reply to this email thread. Match the tone of the conversation. Return only the reply body, no subject line.',
      },
      {
        role: 'user',
        content: `Email thread:\n\n${threadMessages.map((m) =>
          `From: ${m.from}\nTo: ${m.to}\nDate: ${m.date}\nSubject: ${m.subject}\n\n${m.body}`
        ).join('\n\n---\n\n')}`,
      },
    ], { temperature: 0.4 });

    const draft = completion.choices[0]?.message?.content ?? '';
    const lastMessage = threadMessages[threadMessages.length - 1];

    res.json({
      draft,
      subject: lastMessage?.subject?.startsWith('Re:') ? lastMessage.subject : `Re: ${lastMessage?.subject ?? ''}`,
      to: lastMessage?.from ?? '',
      thread_id,
      original_messages: threadMessages.map((m) => ({
        from: m.from,
        date: m.date,
        body: m.body,
      })),
    });
  } catch (err: any) {
    console.error('Draft reply error:', err.message);
    res.status(500).json({ error: 'Failed to generate draft reply' });
  }
});

// ---------------------------------------------------------------------------
// 10. POST /api/send-reply — Send a reply via Gmail
// ---------------------------------------------------------------------------

app.post('/api/send-reply', async (req, res) => {
  const { thread_id, to, subject, body } = req.body;
  if (!thread_id || !to || !body) {
    return res.status(400).json({ error: 'thread_id, to, and body are required' });
  }

  try {
    const gmail = gmailClient();
    // Sanitize headers to prevent CRLF injection
    const safeTo = to.replace(/[\r\n]/g, '');
    const safeSubject = (subject || '').replace(/[\r\n]/g, '');
    const message = [
      `To: ${safeTo}`,
      `Subject: ${safeSubject}`,
      'Content-Type: text/plain; charset=utf-8',
      '',
      body,
    ].join('\r\n');
    const raw = Buffer.from(message).toString('base64url');

    const { data } = await gmail.users.messages.send({
      userId: 'me',
      requestBody: { raw, threadId: thread_id },
    });

    const acctKey = getActiveStoredAccount()?.key || 'default';
    try { invalidateEnrichmentForThread(acctKey, thread_id, getScopedDataPath); } catch {}
    try { invalidateThreadBrief(thread_id); } catch {}

    // Scan the just-sent message for commitments (fire-and-forget)
    if (isLLMConfigured() && data.id) {
      (async () => {
        try {
          const llmClient = createLLMClient();
          const emailMeta: EmailMeta = { message_id: data.id!, thread_id, to, subject: subject || '', body };
          const prompt = `[Email 0] To: ${to} | Subject: ${subject || ''}\n${body}`;
          const completion = await llmClient.complete([
            { role: 'system', content: COMMITMENT_EXTRACTION_PROMPT },
            { role: 'user', content: prompt },
          ], { temperature: 0.1 });
          const rawResp = completion.choices[0]?.message?.content ?? '';
          const match = rawResp.match(/\{[\s\S]*\}/);
          if (match) {
            const result = JSON.parse(match[0]);
            for (const c of (result.commitments ?? [])) {
              if (c.email_index === 0) await createFollowupTask(c, emailMeta);
            }
          }
          // Mark this message as scanned
          const state = readFollowupState();
          state.scannedMessageIds.push(data.id!);
          writeFollowupState(state);
        } catch (err: any) {
          console.warn('Post-send commitment scan failed:', err.message);
        }
      })();
    }

    res.json({ success: true, messageId: data.id });
  } catch (err: any) {
    console.error('Send reply error:', err.message);
    res.status(500).json({ error: 'Failed to send reply' });
  }
});

// ---------------------------------------------------------------------------
// 10b. POST /api/send-email — Send a new email (not a thread reply)
// ---------------------------------------------------------------------------

app.post('/api/send-email', async (req, res) => {
  const { to, subject, body } = req.body;
  if (!to || !body) {
    return res.status(400).json({ error: 'to and body are required' });
  }

  try {
    const gmail = gmailClient();
    const safeTo = to.replace(/[\r\n]/g, '');
    const safeSubject = (subject || '').replace(/[\r\n]/g, '');
    const message = [
      `To: ${safeTo}`,
      `Subject: ${safeSubject}`,
      'Content-Type: text/plain; charset=utf-8',
      '',
      body,
    ].join('\r\n');
    const raw = Buffer.from(message).toString('base64url');

    const { data } = await gmail.users.messages.send({
      userId: 'me',
      requestBody: { raw },
    });

    res.json({ success: true, messageId: data.id });
  } catch (err: any) {
    console.error('Send email error:', err.message);
    res.status(500).json({ error: 'Failed to send email' });
  }
});

// ---------------------------------------------------------------------------
// 11. POST /api/create-doc — Create meeting notes Google Doc
// ---------------------------------------------------------------------------

app.post('/api/create-doc', async (req, res) => {
  const { title, date, attendees, event_id, runId, sourceMessageId } = req.body;
  if (!title) {
    return res.status(400).json({ error: 'title is required' });
  }

  // Create a run record for tracking
  const rid = runId || randomUUID();
  let run: RunRecord = saveRun({
    id: rid,
    objective: `Create notes for ${title}`,
    status: 'running',
    startedAt: Date.now(),
    toolTotal: 1,
    toolCompleted: 0,
    approvalPendingCount: 0,
    sourceApps: ['Drive'],
    messageId: sourceMessageId,
  });

  try {
    const drive = driveClient();
    const calendar = calendarClient();

    const dateStr = date || new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    const attendeeList = (attendees || []).join(', ') || 'TBD';

    const docContent = `${title} — ${dateStr}\nAttendees: ${attendeeList}\n\nAgenda\n\n\nNotes\n\n\nAction Items\n\n`;

    // Create a Google Doc
    const { data: file } = await drive.files.create({
      requestBody: {
        name: `${title} — Notes`,
        mimeType: 'application/vnd.google-apps.document',
      },
      media: {
        mimeType: 'text/plain',
        body: docContent,
      },
      fields: 'id,webViewLink',
    });

    const docUrl = file.webViewLink ?? `https://docs.google.com/document/d/${file.id}/edit`;

    // If event_id provided, update the calendar event description to include the doc link
    if (event_id) {
      run = saveRun({ ...run, toolTotal: 2, sourceApps: ['Drive', 'Calendar'] });
      try {
        const { data: event } = await calendar.events.get({
          calendarId: 'primary',
          eventId: event_id,
        });
        const existingDesc = event.description ?? '';
        await calendar.events.patch({
          calendarId: 'primary',
          eventId: event_id,
          requestBody: {
            description: `${existingDesc}\n\nMeeting Notes: ${docUrl}`.trim(),
          },
        });
        run = saveRun({ ...run, toolCompleted: 2 });
      } catch (calErr: any) {
        console.warn('Could not update calendar event with doc link:', calErr.message);
        run = saveRun({ ...run, toolCompleted: 1 });
      }
    } else {
      run = saveRun({ ...run, toolCompleted: 1 });
    }

    run = saveRun({ ...run, status: 'completed', endedAt: Date.now() });
    res.json({ success: true, docUrl, docId: file.id });
  } catch (err: any) {
    console.error('Create doc error:', err.message);
    saveRun({ ...run, status: 'failed', endedAt: Date.now(), errorMessage: err.message });
    res.status(500).json({ error: 'Failed to create document' });
  }
});

// ---------------------------------------------------------------------------
// 12. LLM Settings API
// ---------------------------------------------------------------------------

app.get('/api/settings/llm', (_req, res) => {
  const settings = readLLMSettingsMasked();
  res.json({ settings, configured: settings !== null });
});

app.put('/api/settings/llm', (req, res) => {
  const incoming = req.body as LLMSettings;
  if (!incoming || !incoming.activeProvider || !incoming.providers) {
    return res.status(400).json({ error: 'Invalid settings shape' });
  }
  try {
    const merged = mergeSettings(incoming);
    writeLLMSettings(merged);
    const masked = readLLMSettingsMasked();
    res.json({ success: true, settings: masked });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to save settings' });
  }
});

app.post('/api/settings/llm/test', async (req, res) => {
  const config = req.body as LLMProviderConfig;
  if (!config || !config.provider || !config.model) {
    return res.status(400).json({ error: 'provider and model are required' });
  }
  const providerMeta = PROVIDER_META.find(p => p.id === config.provider);
  // For custom providers (no meta), assume key is required unless baseURL is localhost
  const isLocalProvider = config.baseURL && (config.baseURL.includes('localhost') || config.baseURL.includes('127.0.0.1'));
  const requiresKey = providerMeta ? providerMeta.requiresKey : !isLocalProvider;
  const testConfig = { ...config };
  if (testConfig.apiKey && isMaskedKey(testConfig.apiKey)) {
    if (requiresKey) {
      return res.status(400).json({ error: 'API key is masked — re-enter the full key to test.' });
    }
    // Clear the masked key so it doesn't get sent to the provider
    testConfig.apiKey = '';
  }
  const result = await testConnection(testConfig);
  res.json(result);
});

app.post('/api/settings/llm/test/saved/:providerId', async (req, res) => {
  const { providerId } = req.params;
  const settings = readLLMSettings();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const config = (settings?.providers as Record<string, LLMProviderConfig> | undefined)?.[providerId];
  if (!config) {
    return res.status(404).json({ error: `Provider '${providerId}' is not configured.` });
  }
  const start = Date.now();
  try {
    const result = await testConnection(config);
    res.json({
      success: result.success,
      error: result.error,
      latencyMs: Date.now() - start,
      testedAt: new Date().toISOString(),
      configSource: 'saved',
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unexpected error';
    res.status(500).json({
      success: false,
      error: message,
      latencyMs: Date.now() - start,
      testedAt: new Date().toISOString(),
      configSource: 'saved',
    });
  }
});

app.get('/api/settings/llm/providers', (_req, res) => {
  // Merge built-in presets with any custom providers from saved settings
  const builtinIds = new Set(PROVIDER_META.map(p => p.id));
  const settings = readLLMSettingsMasked();
  const customProviders = settings
    ? Object.values(settings.providers)
        .filter((c): c is NonNullable<typeof c> => c != null && !builtinIds.has(c.provider))
        .map(c => ({
          id: c.provider,
          name: c.name || c.provider,
          requiresKey: true,
          defaultBaseURL: c.baseURL || '',
          models: [] as { id: string; label: string }[],
          keyPlaceholder: 'API key',
          isCustom: true as const,
        }))
    : [];
  res.json({ providers: [...PROVIDER_META, ...customProviders] });
});

app.delete('/api/settings/llm/providers/:id', (req, res) => {
  const providerId = req.params.id;
  // Prevent deleting built-in presets
  const builtinIds = new Set(PROVIDER_META.map(p => p.id));
  if (builtinIds.has(providerId)) {
    return res.status(400).json({ error: 'Cannot delete a built-in provider preset' });
  }
  try {
    const updated = removeProvider(providerId);
    const masked = readLLMSettingsMasked();
    res.json({ success: true, settings: masked });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Failed to remove provider' });
  }
});

// ---------------------------------------------------------------------------
// Dynamic tools (skills)
// ---------------------------------------------------------------------------

app.get('/api/dynamic-tools/triggers/all', async (_req, res) => {
  try {
    const tools = getDynamicTools().filter((t) => t.trigger !== undefined);
    const result = await Promise.all(tools.map(async (t) => {
      const lastPollAt = await getStateLastPollAt(t.name);
      const processedCount = await getProcessedCount(t.name);
      const failures = await getFailures(t.name);
      const intervalMs = (t.trigger!.intervalMinutes ?? 2) * 60_000;
      const nextPollIn = t.trigger!.enabled && lastPollAt ? Math.max(0, lastPollAt + intervalMs - Date.now()) : null;
      return {
        workflowName: t.name,
        workflowLabel: t.label ?? t.name,
        trigger: t.trigger,
        status: { enabled: t.trigger!.enabled, lastPollAt, processedCount, nextPollIn, failures },
      };
    }));
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? 'Internal error' });
  }
});

app.get('/api/dynamic-tools', (_req, res) => {
  const tools = getDynamicTools().map((t) => ({
    name: t.name,
    description: t.description,
    parameters: t.parameters,
    steps: t.steps,
    isWriteTool: t.isWriteTool ?? false,
    createdAt: t.createdAt ?? new Date().toISOString(),
    label: t.label,
  }));
  res.json({ tools });
});

app.get('/api/dynamic-tools/actions', (_req, res) => {
  res.json({ actions: getAllowedActions() });
});

// Plan generation — lightweight LLM call, no tools, no agent loop
// Must be registered BEFORE /api/dynamic-tools/:name to avoid wildcard capture
app.post('/api/dynamic-tools/plan', express.json(), async (req: any, res: any) => {
  const { description, availableActions } = req.body;
  if (!description || typeof description !== 'string') {
    return res.status(400).json({ error: 'description is required' });
  }
  if (!isLLMConfigured()) {
    return res.status(500).json({ error: 'No LLM provider configured.' });
  }

  const prompt = `You are a workflow planning assistant for FlowSpace, a Google Workspace productivity app.

The user wants a reusable workflow:
"${description}"

Available actions: ${Array.isArray(availableActions) ? availableActions.join(', ') : String(availableActions ?? '')}

Respond with ONLY a JSON object — no markdown fences, no explanation. Use this exact schema:
{
  "name": "short_snake_case_name",
  "label": "Human Readable Name",
  "description": "One-line description of what this workflow does",
  "steps": [
    { "action": "action_name", "args": { "key": "value or {{input.paramName}}" }, "outputKey": "optional_name" }
  ]
}

Rules:
- Only use actions from the available list
- Keep steps minimal and practical (2–6 steps)
- Use outputKey when a step's result is referenced by a later step
- Template syntax: {{input.X}} for workflow inputs, {{steps.N.field}} for step outputs`;

  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  try {
    const llmClient = createLLMClient();
    const response = await llmClient.complete(
      [{ role: 'user', content: prompt }],
      { temperature: 0 },
    );
    const text = response.choices[0]?.message?.content ?? '';
    res.write(JSON.stringify({ type: 'assistant_chunk', chunk: text }) + '\n');
    res.write(JSON.stringify({ type: 'done', accumulated: text }) + '\n');
    res.end();
  } catch (err: any) {
    res.write(JSON.stringify({ type: 'error', error: err?.message || 'Plan generation failed' }) + '\n');
    res.end();
  }
});

// Workflow refinement — apply a conversational edit to an existing plan
// Must be registered BEFORE /api/dynamic-tools/:name to avoid wildcard capture
app.post('/api/dynamic-tools/refine', express.json(), async (req: any, res: any) => {
  const { currentPlan, revision, availableActions, history } = req.body;
  if (!currentPlan || typeof currentPlan !== 'object') {
    return res.status(400).json({ error: 'currentPlan is required' });
  }
  if (!revision || typeof revision !== 'string') {
    return res.status(400).json({ error: 'revision is required' });
  }
  if (!isLLMConfigured()) {
    return res.status(500).json({ error: 'No LLM provider configured.' });
  }

  const safeName = JSON.stringify(typeof currentPlan.name === 'string' ? currentPlan.name : '');

  const systemContext = `You are a workflow editing assistant for FlowSpace, a Google Workspace productivity app.

Current workflow plan:
${JSON.stringify(currentPlan, null, 2)}

Available actions: ${Array.isArray(availableActions) ? availableActions.join(', ') : ''}

The user wants to refine this workflow. Apply their requested change and return the COMPLETE updated plan JSON.
Respond with ONLY the JSON object — no markdown fences, no explanation. Use this exact schema:
{
  "name": ${safeName},
  "label": "Human Readable Name",
  "description": "One-line description of what this workflow does",
  "steps": [
    { "action": "action_name", "args": { "key": "value" }, "outputKey": "optional_name" }
  ]
}

Rules:
- Keep the "name" field exactly as ${safeName} — do not rename it
- Only use actions from the available list
- Keep steps minimal and practical (2–6 steps)
- Use outputKey when a step's result is referenced by a later step`;

  const messages: { role: string; content: string }[] = [
    { role: 'user', content: systemContext },
  ];

  if (Array.isArray(history)) {
    for (const turn of history) {
      if (turn.role === 'user' || turn.role === 'assistant') {
        messages.push({ role: turn.role, content: String(turn.content) });
      }
    }
  }

  messages.push({ role: 'user', content: revision });

  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  try {
    const llmClient = createLLMClient();
    const response = await llmClient.complete(
      messages as any,
      { temperature: 0 },
    );
    const text = response.choices[0]?.message?.content ?? '';
    res.write(JSON.stringify({ type: 'assistant_chunk', chunk: text }) + '\n');
    res.write(JSON.stringify({ type: 'done', accumulated: text }) + '\n');
    res.end();
  } catch (err: any) {
    res.write(JSON.stringify({ type: 'error', error: err?.message || 'Refinement failed' }) + '\n');
    res.end();
  }
});

app.post('/api/dynamic-tools', express.json(), (req, res) => {
  const tool = req.body;
  if (!tool || typeof tool.name !== 'string' || typeof tool.description !== 'string') {
    return res.status(400).json({ error: 'name and description are required' });
  }
  const validationError = validateDynamicTool(tool);
  if (validationError) {
    return res.status(400).json({ error: validationError });
  }
  const created = registerDynamicTool(tool);
  if (!created) {
    return res.status(409).json({ error: `Tool "${tool.name}" already exists` });
  }
  res.status(201).json({ tool: created });
});

app.put('/api/dynamic-tools/:name', express.json(), async (req, res) => {
  const { name } = req.params;
  const updates = req.body;
  const existing = getDynamicTool(name);
  if (!existing) {
    return res.status(404).json({ error: `Tool "${name}" not found` });
  }
  const merged = { ...existing, ...updates, name: existing.name, createdAt: existing.createdAt };
  const validationError = validateDynamicTool(merged);
  if (validationError) {
    return res.status(400).json({ error: validationError });
  }
  const updated = updateDynamicTool(name, updates);
  // Restart the scheduler if the trigger config changed; otherwise the old
  // setInterval keeps firing at the stale interval / on the stale filter.
  if ('trigger' in updates) {
    await restartWorkflowScheduler().catch((e) =>
      console.error('[scheduler] restart after PUT failed', e),
    );
  }
  res.json({ tool: updated });
});

app.delete('/api/dynamic-tools/:name', async (req, res) => {
  const { name } = req.params;
  const removed = removeDynamicTool(name);
  // Without a restart the deleted workflow's setInterval handle leaks and
  // continues firing as a no-op every cycle.
  if (removed) {
    await restartWorkflowScheduler().catch((e) =>
      console.error('[scheduler] restart after DELETE failed', e),
    );
  }
  res.json({ removed, name });
});

app.patch('/api/dynamic-tools/:name/trigger', express.json(), async (req, res) => {
  try {
    const { name } = req.params;
    const tool = getDynamicTool(name);
    if (!tool) return res.status(404).json({ error: 'Workflow not found' });

    const { enabled, filter, intervalMinutes } = req.body ?? {};
    if (typeof enabled !== 'boolean') return res.status(400).json({ error: 'enabled must be boolean' });
    if (enabled && (typeof filter !== 'string' || filter.trim().length === 0)) {
      return res.status(400).json({ error: 'filter is required when enabled is true' });
    }
    if (typeof filter === 'string' && filter.length > 500) {
      return res.status(400).json({ error: 'filter must be 500 characters or fewer' });
    }
    const interval = typeof intervalMinutes === 'number' && intervalMinutes >= 1 && intervalMinutes <= 60 ? intervalMinutes : 2;

    const trigger = { type: 'email_received' as const, enabled, filter: filter ?? '', intervalMinutes: interval };
    await updateDynamicTool(name, { trigger });
    await restartWorkflowScheduler();
    res.json({ ok: true, trigger });
  } catch (err: any) {
    console.error('[trigger] PATCH error', err);
    res.status(500).json({ error: err?.message ?? 'Internal error' });
  }
});

app.get('/api/dynamic-tools/:name/trigger/status', async (req, res) => {
  try {
    const { name } = req.params;
    const tool = getDynamicTool(name);
    if (!tool) return res.status(404).json({ error: 'Workflow not found' });

    const trigger = tool.trigger;
    const lastPollAt = await getStateLastPollAt(name);
    const processedCount = await getProcessedCount(name);
    const failures = await getFailures(name);
    const intervalMs = (trigger?.intervalMinutes ?? 2) * 60_000;
    const nextPollIn = trigger?.enabled && lastPollAt ? Math.max(0, lastPollAt + intervalMs - Date.now()) : null;

    res.json({
      enabled: trigger?.enabled === true,
      filter: trigger?.filter ?? null,
      intervalMinutes: trigger?.intervalMinutes ?? null,
      lastPollAt,
      processedCount,
      nextPollIn,
      failures,
    });
  } catch (err: any) {
    console.error('[trigger] GET status error', err);
    res.status(500).json({ error: err?.message ?? 'Internal error' });
  }
});

app.post('/api/dynamic-tools/:name/trigger/retrigger', express.json(), async (req, res) => {
  try {
    const { name } = req.params;
    const { messageId } = req.body ?? {};
    if (typeof messageId !== 'string' || !messageId) return res.status(400).json({ error: 'messageId required' });
    const gmail = gmailClient();
    const msg = await gmail.users.messages.get({ userId: 'me', id: messageId, format: 'minimal' });
    const threadId = msg.data.threadId;
    if (!threadId) return res.status(404).json({ error: 'Message not found' });
    const result = await executeForMessage(name, messageId, threadId, { clearFailureOnSuccess: true });
    res.json({ ok: true, ...result });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? 'Internal error' });
  }
});

app.delete('/api/dynamic-tools/:name/trigger/failures', async (req, res) => {
  try {
    await clearFailures(req.params.name);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? 'Internal error' });
  }
});

// ---------------------------------------------------------------------------
// Workflow Synthesizer (007) — opt-in observation log + settings
// ---------------------------------------------------------------------------

app.get('/api/synthesizer/settings', async (_req, res) => {
  try {
    res.json(await loadSynthSettings());
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? 'Internal error' });
  }
});

app.patch('/api/synthesizer/settings', express.json(), async (req, res) => {
  try {
    const body = req.body ?? {};
    const allowedKeys = new Set([
      'enabled',
      'minOccurrences',
      'lookBackDays',
      'maxSequenceLength',
      'dismissCooldownDays',
      'logCapEntries',
      'logRetentionDays',
    ]);
    const patch: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(body)) {
      if (!allowedKeys.has(k)) continue;
      if (k === 'enabled') {
        if (typeof v !== 'boolean') {
          return res.status(400).json({ error: '"enabled" must be a boolean' });
        }
        patch[k] = v;
        continue;
      }
      if (typeof v !== 'number' || !Number.isFinite(v)) {
        return res.status(400).json({ error: `"${k}" must be a finite number` });
      }
      const range = SYNTHESIS_SETTINGS_RANGES[k as keyof typeof SYNTHESIS_SETTINGS_RANGES];
      if (range && (v < range[0] || v > range[1])) {
        return res.status(400).json({ error: `"${k}" must be in [${range[0]}, ${range[1]}]` });
      }
      patch[k] = v;
    }
    const updated = await updateSynthSettings(patch);
    res.json(updated);
  } catch (err: any) {
    res.status(400).json({ error: err?.message ?? 'Invalid settings' });
  }
});

app.get('/api/synthesizer/log', async (req, res) => {
  try {
    const limitRaw = Number(req.query.limit ?? 200);
    const limit = Math.min(Math.max(Number.isFinite(limitRaw) ? limitRaw : 200, 1), 1000);
    const entries = await loadSynthLog();
    const newestFirst = [...entries].reverse().slice(0, limit);
    res.json({ totalEntries: entries.length, entries: newestFirst });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? 'Internal error' });
  }
});

app.delete('/api/synthesizer/log', async (_req, res) => {
  try {
    const deletedCount = await clearSynthLog();
    res.json({ cleared: true, deletedCount });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? 'Internal error' });
  }
});

// ---------------------------------------------------------------------------
// Draft Queue — Proactive Meeting Prep (Phase 1)
// ---------------------------------------------------------------------------

import {
  loadDrafts,
  loadLastScan,
  upsertByMeetingId,
  purgeDrafts,
  findById,
  updateStatus,
  updateUseful,
  markSeen,
} from './src/agent/draft-store.js';
import { runHorizonScan } from './src/agent/horizon-scanner.js';

// In-memory flag to prevent concurrent scans
let scanInProgress = false;

app.post('/api/drafts/scan', async (req, res) => {
  if (scanInProgress) {
    return res.status(409).json({ error: 'Scan already in progress' });
  }

  const account = getActiveStoredAccount();
  if (!account) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  // Derive selfDomain from account email
  const selfDomain = account.email.split('@')[1] ?? '';

  scanInProgress = true;
  try {
    const result = await runHorizonScan({
      selfDomain,
      userEmail: account.email,
      // Inject direct Google Calendar fetcher so attendees are available
      fetchCalendarEvents: async (timeMin: string, timeMax: string) => {
        const calendar = calendarClient();
        const calListRes = await calendar.calendarList.list({ showHidden: false });
        const calendars = (calListRes.data.items ?? []).filter(
          (c) => c.selected !== false && c.id,
        );
        const allEvents = await Promise.all(
          calendars.map(async (cal) => {
            try {
              const { data } = await calendar.events.list({
                calendarId: cal.id!,
                timeMin,
                timeMax,
                singleEvents: true,
                orderBy: 'startTime',
                maxResults: 50,
              });
              return (data.items ?? []).map((ev) => ({
                id: ev.id ?? undefined,
                summary: ev.summary ?? undefined,
                start: ev.start?.dateTime ? { dateTime: ev.start.dateTime } : ev.start?.date,
                end: ev.end?.dateTime ? { dateTime: ev.end.dateTime } : ev.end?.date,
                attendees: (ev.attendees ?? []).map((a) => ({
                  email: a.email ?? undefined,
                  self: a.self ?? false,
                })),
              }));
            } catch {
              return [];
            }
          }),
        );
        return allEvents.flat();
      },
    });
    upsertByMeetingId(DATA_DIR, result.drafts, result.meta);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? 'Scan failed' });
  } finally {
    scanInProgress = false;
  }
});

app.get('/api/drafts', (req, res) => {
  purgeDrafts(DATA_DIR);
  const drafts = loadDrafts(DATA_DIR);
  const lastScan = loadLastScan(DATA_DIR);

  // Mark all pending drafts as seen
  const pendingIds = drafts.filter((d) => d.status === 'pending' && !d.seenAt).map((d) => d.id);
  if (pendingIds.length > 0) markSeen(DATA_DIR, pendingIds);

  // Re-read after markSeen so seenAt is populated in the response
  const updatedDrafts = loadDrafts(DATA_DIR);
  const sorted = [...updatedDrafts].sort(
    (a, b) => new Date(a.meetingTime).getTime() - new Date(b.meetingTime).getTime(),
  );

  res.json({ drafts: sorted, lastScan: lastScan ?? null });
});

app.post('/api/drafts/:id/approve', (req, res) => {
  const { id } = req.params;
  const draft = findById(DATA_DIR, id);
  if (!draft) return res.status(404).json({ error: 'Draft not found' });
  if (draft.status === 'approved') return res.status(409).json({ error: 'Draft already approved' });

  const updated = updateStatus(DATA_DIR, id, 'approved');
  if (!updated) return res.status(404).json({ error: 'Draft not found' });

  const meetingDate = new Date(updated.meetingTime);
  const dateStr = meetingDate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  const timeStr = meetingDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

  const sourcesSection: string[] = [];
  if (updated.relatedEmails.length > 0) {
    sourcesSection.push('Sources used to generate this brief:');
    for (const email of updated.relatedEmails.slice(0, 5)) {
      sourcesSection.push(`- Email from ${email.from}: "${email.subject}"`);
    }
  }
  if (updated.linkedDocs.length > 0) {
    if (sourcesSection.length === 0) sourcesSection.push('Sources used to generate this brief:');
    for (const doc of updated.linkedDocs.slice(0, 5)) {
      sourcesSection.push(`- Drive file: "${doc.title}"`);
    }
  }
  if (sourcesSection.length > 0) {
    sourcesSection.push('');
    sourcesSection.push('The user may ask about any of these sources. Use search_emails and search_drive to look up full content if needed.');
  }

  const threadBrief = [
    `## Meeting Prep: ${updated.meetingTitle}`,
    `**When:** ${dateStr} at ${timeStr}`,
    `**Attendees:** ${updated.attendees.slice(0, 5).join(', ')}`,
    '',
    updated.summary,
    ...(sourcesSection.length > 0 ? ['', ...sourcesSection] : []),
  ].join('\n');

  const sources = {
    emails: updated.relatedEmails,
    docs: updated.linkedDocs,
    attendees: updated.attendees,
    meetingTitle: updated.meetingTitle,
    meetingTime: updated.meetingTime,
  };

  res.json({ draft: updated, threadBrief, sources });
});

app.post('/api/drafts/:id/dismiss', (req, res) => {
  const { id } = req.params;
  const draft = findById(DATA_DIR, id);
  if (!draft) return res.status(404).json({ error: 'Draft not found' });

  updateStatus(DATA_DIR, id, 'dismissed');
  res.json({ success: true });
});

app.patch('/api/drafts/:id/useful', (req, res) => {
  const { id } = req.params;
  const { useful } = req.body as { useful?: boolean };
  if (typeof useful !== 'boolean') {
    return res.status(400).json({ error: 'useful must be a boolean' });
  }

  const draft = findById(DATA_DIR, id);
  if (!draft) return res.status(404).json({ error: 'Draft not found' });

  updateUseful(DATA_DIR, id, useful);
  res.json({ success: true, useful });
});

// ---------------------------------------------------------------------------
// Telemetry endpoints
// ---------------------------------------------------------------------------

app.post('/api/telemetry/fallback', (req, res) => {
  const { reason } = req.body as { reason?: string };
  if (!reason || !['upstream_error', 'timeout', 'rate_limited'].includes(reason)) {
    return res.status(400).json({ error: 'Invalid reason' });
  }
  const accountKey = getActiveStoredAccount()?.key || 'default';
  console.log(JSON.stringify({ event: 'gmail_tab_fallback', reason, accountKey, timestamp: new Date().toISOString() }));
  res.json({ ok: true });
});

app.post('/api/telemetry/gmail-interactive', (req, res) => {
  const { msFromOpen, threadCount } = req.body as { msFromOpen?: number; threadCount?: number };
  if (typeof msFromOpen !== 'number' || typeof threadCount !== 'number') {
    return res.status(400).json({ error: 'msFromOpen and threadCount must be numbers' });
  }
  const accountKey = getActiveStoredAccount()?.key || 'default';
  console.log(JSON.stringify({ event: 'gmail_tab_interactive', msFromOpen, threadCount, accountKey, timestamp: new Date().toISOString() }));
  res.json({ ok: true });
});

app.post('/api/telemetry/gmail-workspace-open', express.json(), (req, res) => {
  const { threadType, paneKind, durationMs, threadId } = (req.body ?? {}) as {
    threadType?: unknown;
    paneKind?: unknown;
    durationMs?: unknown;
    threadId?: unknown;
  };
  if (typeof threadType !== 'string' || !threadType) {
    return res.status(400).json({ error: 'threadType must be a non-empty string' });
  }
  if (typeof paneKind !== 'string' || !paneKind) {
    return res.status(400).json({ error: 'paneKind must be a non-empty string' });
  }
  if (typeof durationMs !== 'number') {
    return res.status(400).json({ error: 'durationMs must be a number' });
  }
  if (typeof threadId !== 'string' || !threadId) {
    return res.status(400).json({ error: 'threadId must be a non-empty string' });
  }
  const accountKey = getActiveStoredAccount()?.key || 'default';
  console.log(JSON.stringify({
    event: 'gmail_workspace_open',
    threadType,
    paneKind,
    durationMs,
    threadId,
    accountKey,
    timestamp: new Date().toISOString(),
  }));
  res.json({});
});

// ---------------------------------------------------------------------------
// Vite middleware + server start
// ---------------------------------------------------------------------------

async function startServer() {
  await migrateLegacyGwsCredentials();
  loadDynamicTools();
  try {
    startWorkflowScheduler(buildSchedulerDeps());
  } catch (err) {
    console.error('[scheduler] failed to start at boot', err);
  }
  const nodeMajor = Number(process.versions.node.split('.')[0] || '0');
  if (IS_PRODUCTION) {
    // In production, serve static frontend files
    // __dirname = directory of server.mjs:
    //   Tauri:      Contents/Resources/ (dist is sibling)
    //   npm CLI:    <pkg>/dist-server/  (dist is at <pkg>/dist/, one level up)
    const distSibling = path.join(__dirname, 'dist');
    const distParent = path.join(__dirname, '..', 'dist');
    const distDir = fs.existsSync(path.join(distSibling, 'index.html')) ? distSibling : distParent;
    console.log(`Serving static files from: ${distDir}`);
    app.use(express.static(distDir));
    // SPA fallback — serve index.html for all non-API routes
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  } else {
    // Node 25+ currently causes Vite dev middleware requests to hang in this app.
    // Fallback to a built frontend so local dev still works.
    if (nodeMajor >= 25) {
      const distDir = path.join(__dirname, 'dist');
      if (!fs.existsSync(path.join(distDir, 'index.html'))) {
        console.warn(`Node ${process.versions.node} detected. Building frontend once for static dev fallback...`);
        execFileSync('npx', ['vite', 'build'], { stdio: 'inherit', env: shellEnv });
      } else {
        console.warn(`Node ${process.versions.node} detected. Using static dev fallback from dist/.`);
      }
      app.use(express.static(distDir));
      app.get('*', (_req, res) => {
        res.sendFile(path.join(distDir, 'index.html'));
      });
    } else {
      // In dev mode, mount Vite dev server as middleware
      // Uses Function constructor to prevent bundlers from statically analyzing the import
      const loadVite = new Function('return import("vite")') as () => Promise<typeof import('vite')>;
      const { createServer: createViteServer } = await loadVite();
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: 'spa',
      });
      app.use(vite.middlewares);
    }
  }

  // Bind to localhost only — prevents LAN access. Docker forwards ports externally.
  const BIND_HOST = process.env.FLOWSPACE_BIND_HOST || '127.0.0.1';
  app.listen(PORT, BIND_HOST, () => {
    console.log(`FlowSpace server running on http://localhost:${PORT}`);
    if (getActiveStoredAccount()) {
      console.log('Google account registry loaded successfully');
    } else {
      console.warn('WARNING: No Google accounts connected. Sign in with Google via the app.');
    }
    const activeProvider = getActiveProviderConfig();
    if (activeProvider) {
      console.log(`[FlowSpace] LLM provider: ${activeProvider.provider} (model: ${activeProvider.model})`);
    } else {
      console.warn('[FlowSpace] No LLM provider configured. Open Settings > LLM Providers to add one.');
    }
  });
}

startServer();

export { app };
