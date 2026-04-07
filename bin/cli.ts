#!/usr/bin/env node

/**
 * FlowSpace CLI — entry point for `npx flowspace`.
 *
 * Orchestrates first-run setup and server startup:
 *
 *   ┌─────────┐  config    ┌──────────┐
 *   │  START  │──found?──▶ │  SERVER  │
 *   └────┬────┘   yes      └──────────┘
 *        │ no                    ▲
 *        ▼                      │
 *   ┌──────────┐  ┌──────────┐  │
 *   │  SETUP   │─▶│  GOOGLE  │──┘
 *   │  WIZARD  │  │  OAUTH   │
 *   └────┬─────┘  └──────────┘
 *        ▼
 *   ┌──────────┐
 *   │ AI SETUP │──(skip?)──▶ SERVER
 *   │(optional)│
 *   └──────────┘
 */

import * as p from '@clack/prompts';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync, spawn, execFileSync } from 'node:child_process';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

// ── Constants ────────────────────────────────────────────────────────

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Data dir — matches the server's production path so settings saved in the UI
// persist across CLI restarts. Migrates from legacy ~/.flowspace on first run.
const FLOWSPACE_DIR = path.join(os.homedir(), 'Library', 'Application Support', 'FlowSpace');
const LEGACY_FLOWSPACE_DIR = path.join(os.homedir(), '.flowspace');
const CONFIG_PATH = path.join(FLOWSPACE_DIR, 'config.json');
const CLIENT_SECRET_PATH = path.join(FLOWSPACE_DIR, 'client_secret.json');
const DEFAULT_PORT = 3000;

const REQUIRED_NODE_MAJOR = 20;

interface FlowSpaceConfig {
  version: number;
  appVersion?: string;
  google: {
    clientSecretPath: string;
    configured: boolean;
  };
  ai: {
    configured: boolean;
    provider?: string;
  };
  port: number;
}

// ── Helpers ──────────────────────────────────────────────────────────

function getVersion(): string {
  // __CLI_VERSION__ is injected at build time via esbuild --define
  if (typeof __CLI_VERSION__ !== 'undefined' && __CLI_VERSION__ && !__CLI_VERSION__.includes('__CLI')) {
    return __CLI_VERSION__;
  }
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf-8'));
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

function checkNodeVersion(): boolean {
  const major = parseInt(process.versions.node.split('.')[0], 10);
  return major >= REQUIRED_NODE_MAJOR;
}

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen(port, '0.0.0.0');
  });
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
}

function readConfig(): FlowSpaceConfig | null {
  if (!fs.existsSync(CONFIG_PATH)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    if (raw && typeof raw === 'object' && raw.version === 1) {
      return raw as FlowSpaceConfig;
    }
  } catch {
    // Corrupt config — treat as missing
  }
  return null;
}

function writeConfig(config: FlowSpaceConfig): void {
  ensureDir(FLOWSPACE_DIR);
  const tmp = CONFIG_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(config, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, CONFIG_PATH);
}

function hasValidClientSecret(filePath: string): boolean {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    const installed = parsed?.installed;
    const clientId = typeof installed?.client_id === 'string' ? installed.client_id : '';
    const clientSecret = typeof installed?.client_secret === 'string' ? installed.client_secret : '';
    const projectId = typeof installed?.project_id === 'string' ? installed.project_id : '';
    const redirectUris = Array.isArray(installed?.redirect_uris) ? installed.redirect_uris : [];

    if (!clientId || !clientSecret || !projectId || redirectUris.length === 0) return false;
    if (clientId.includes('YOUR_CLIENT_ID') || clientSecret.includes('YOUR_CLIENT_SECRET')) return false;
    return true;
  } catch {
    return false;
  }
}

function findGwsCommand(): string | null {
  const candidates = [
    path.join(FLOWSPACE_DIR, 'node_modules', '.bin', 'gws'),
    // Global install locations
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  // Check PATH
  try {
    const shellEnv = getShellEnv();
    execFileSync('which', ['gws'], { stdio: 'ignore', env: shellEnv });
    return 'gws';
  } catch {
    return null;
  }
}

function getShellEnv(): Record<string, string> {
  const env = { ...process.env } as Record<string, string>;
  // Augment PATH for macOS
  const extraPaths = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin'];
  const currentPath = env.PATH ?? '';
  const missing = extraPaths.filter(p => !currentPath.includes(p));
  if (missing.length > 0) {
    env.PATH = [...missing, currentPath].join(':');
  }
  return env;
}

// ── Setup Wizard ─────────────────────────────────────────────────────

async function runSetupWizard(): Promise<FlowSpaceConfig> {
  p.intro('Welcome to FlowSpace');

  p.note(
    'FlowSpace is a personal Google Workspace dashboard with an AI assistant.\n' +
    'This setup will configure your Google connection and (optionally) an AI provider.',
    'About'
  );

  // ── Step 1: Google OAuth ──────────────────────────────────────────

  const googleSection = await setupGoogle();

  // ── Step 2: AI Provider (optional) ────────────────────────────────

  const aiSection = await setupAI();

  // ── Step 3: Port ──────────────────────────────────────────────────

  const port = DEFAULT_PORT;

  const config: FlowSpaceConfig = {
    version: 1,
    appVersion: getVersion(),
    google: googleSection,
    ai: aiSection,
    port,
  };

  writeConfig(config);

  p.outro('Setup complete! Starting FlowSpace...');

  return config;
}

async function setupGoogle(): Promise<FlowSpaceConfig['google']> {
  p.log.step('Step 1: Google Sign-in');

  p.log.message(
    'FlowSpace will open your browser to sign in with Google.\n' +
    'You\'ll need to grant access to Drive, Gmail, Calendar, and Tasks.\n\n' +
    'Sign-in happens in the app after setup — just click "Sign in with Google".'
  );

  return { clientSecretPath: '', configured: true };
}

async function setupAI(): Promise<FlowSpaceConfig['ai']> {
  p.log.step('Step 2: AI Assistant (optional)');

  const aiChoice = await p.select({
    message: 'Choose an AI provider for the chat assistant:',
    options: [
      { value: 'openai', label: 'OpenAI', hint: 'GPT-4o, GPT-4' },
      { value: 'anthropic', label: 'Anthropic', hint: 'Claude' },
      { value: 'openrouter', label: 'OpenRouter', hint: 'Multiple models' },
      { value: 'codex', label: 'Codex (ChatGPT Plus/Pro)', hint: 'Sign in with ChatGPT — no API key needed' },
      { value: 'lmstudio', label: 'LM Studio', hint: 'Local models, no API key needed' },
      { value: 'custom', label: 'Custom (OpenAI-compatible)', hint: 'Any OpenAI-compatible API' },
      { value: 'skip', label: 'Skip for now', hint: 'Dashboard works without AI' },
    ],
  });

  if (p.isCancel(aiChoice)) {
    p.cancel('Setup cancelled.');
    process.exit(0);
  }

  if (aiChoice === 'skip') {
    p.log.info('AI skipped. You can configure it later in Settings.');
    return { configured: false };
  }

  if (aiChoice === 'codex') {
    // Install @openai/codex globally if not already installed
    const { execSync } = await import('child_process');
    let codexFound = false;
    try {
      execSync('codex --version', { stdio: 'ignore' });
      codexFound = true;
    } catch {
      // not installed
    }

    if (!codexFound) {
      const s = p.spinner();
      s.start('Installing @openai/codex globally...');
      try {
        execSync('npm install -g @openai/codex', { stdio: 'ignore' });
        s.stop('@openai/codex installed');
      } catch {
        s.stop('');
        p.log.warn('Could not install @openai/codex automatically.');
        p.log.info('Run manually: npm install -g @openai/codex');
        p.log.info('Then run: codex login');
        return { configured: false };
      }
    }

    p.log.info('Opening browser for ChatGPT sign-in...');
    try {
      execSync('codex login', { stdio: 'inherit' });
    } catch {
      p.log.warn('codex login failed or was cancelled.');
      p.log.info('Run "codex login" manually, then restart flowspace.');
      return { configured: false };
    }

    const llmSettings = {
      activeProvider: 'codex',
      providers: {
        codex: {
          provider: 'codex',
          apiKey: '',
          model: 'o4-mini',
        },
      },
    };
    const settingsPath = path.join(FLOWSPACE_DIR, '.llm-settings.json');
    fs.writeFileSync(settingsPath, JSON.stringify(llmSettings, null, 2), { mode: 0o600 });

    p.log.success('Codex (ChatGPT) configured!');
    return { configured: true, provider: 'codex' };
  }

  if (aiChoice === 'lmstudio') {
    p.log.info('LM Studio detected. Make sure it\'s running on http://localhost:1234');

    // Write LLM settings for LM Studio
    const llmSettings = {
      activeProvider: 'lmstudio',
      providers: {
        lmstudio: {
          provider: 'lmstudio',
          apiKey: 'lm-studio',
          model: 'default',
          baseUrl: 'http://localhost:1234/v1',
        },
      },
    };
    const settingsPath = path.join(FLOWSPACE_DIR, '.llm-settings.json');
    fs.writeFileSync(settingsPath, JSON.stringify(llmSettings, null, 2), { mode: 0o600 });

    return { configured: true, provider: 'lmstudio' };
  }

  if (aiChoice === 'custom') {
    const customName = await p.text({
      message: 'Provider name (display name):',
      placeholder: 'My Provider',
      validate: (value) => {
        if (!value || !value.trim()) return 'Provider name is required.';
        return undefined;
      },
    });

    if (p.isCancel(customName)) {
      p.cancel('Setup cancelled.');
      process.exit(0);
    }

    const customBaseUrl = await p.text({
      message: 'Base URL (OpenAI-compatible endpoint):',
      placeholder: 'https://api.example.com/v1',
      validate: (value) => {
        if (!value || !value.trim()) return 'Base URL is required.';
        try {
          new URL(value.trim());
        } catch {
          return 'Please enter a valid URL.';
        }
        return undefined;
      },
    });

    if (p.isCancel(customBaseUrl)) {
      p.cancel('Setup cancelled.');
      process.exit(0);
    }

    const customApiKey = await p.text({
      message: 'API key (leave empty if not required):',
      placeholder: 'sk-...',
    });

    if (p.isCancel(customApiKey)) {
      p.cancel('Setup cancelled.');
      process.exit(0);
    }

    const customModel = await p.text({
      message: 'Model name:',
      placeholder: 'gpt-4o',
      validate: (value) => {
        if (!value || !value.trim()) return 'Model name is required.';
        return undefined;
      },
    });

    if (p.isCancel(customModel)) {
      p.cancel('Setup cancelled.');
      process.exit(0);
    }

    const providerId = (customName as string).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

    const llmSettings = {
      activeProvider: providerId,
      providers: {
        [providerId]: {
          provider: providerId,
          name: (customName as string).trim(),
          apiKey: (customApiKey as string).trim() || 'none',
          model: (customModel as string).trim(),
          baseUrl: (customBaseUrl as string).trim(),
        },
      },
    };

    const settingsPath = path.join(FLOWSPACE_DIR, '.llm-settings.json');
    fs.writeFileSync(settingsPath, JSON.stringify(llmSettings, null, 2), { mode: 0o600 });

    p.log.success(`${(customName as string).trim()} configured!`);

    return { configured: true, provider: providerId };
  }

  // For API-key providers
  const apiKey = await p.text({
    message: `Enter your ${aiChoice === 'openai' ? 'OpenAI' : aiChoice === 'anthropic' ? 'Anthropic' : 'OpenRouter'} API key:`,
    placeholder: 'sk-...',
    validate: (value) => {
      if (!value || !value.trim()) return 'API key is required.';
      if (value.trim().length < 10) return 'That doesn\'t look like a valid API key.';
      return undefined;
    },
  });

  if (p.isCancel(apiKey)) {
    p.cancel('Setup cancelled.');
    process.exit(0);
  }

  const providerModels: Record<string, string> = {
    openai: 'gpt-4o',
    anthropic: 'claude-sonnet-4-20250514',
    openrouter: 'anthropic/claude-sonnet-4',
  };

  const llmSettings = {
    activeProvider: aiChoice,
    providers: {
      [aiChoice as string]: {
        provider: aiChoice,
        apiKey: (apiKey as string).trim(),
        model: providerModels[aiChoice as string] ?? 'default',
      },
    },
  };

  const settingsPath = path.join(FLOWSPACE_DIR, '.llm-settings.json');
  fs.writeFileSync(settingsPath, JSON.stringify(llmSettings, null, 2), { mode: 0o600 });

  p.log.success(`${aiChoice} configured!`);

  return { configured: true, provider: aiChoice as string };
}

// ── Server Launcher ──────────────────────────────────────────────────

async function startServer(port: number): Promise<void> {
  // Find the server entry point
  const candidates = [
    path.join(__dirname, '..', 'dist-server', 'server.mjs'),  // Pre-bundled (release)
    path.join(__dirname, '..', 'server.ts'),                    // Dev mode (git clone)
  ];

  const serverPath = candidates.find(p => fs.existsSync(p));

  if (!serverPath) {
    p.log.error('Could not find server entry point.');
    p.log.message(`Searched:\n${candidates.map(c => `  - ${c}`).join('\n')}`);
    process.exit(1);
  }

  const isBundled = serverPath.endsWith('.mjs');

  console.log('');
  console.log(`  FlowSpace v${getVersion()}`);
  console.log(`  http://localhost:${port}`);
  console.log('');
  console.log('  Press Ctrl+C to stop.');
  console.log('');

  const env: Record<string, string> = {
    ...getShellEnv(),
    FLOWSPACE_DATA_DIR: FLOWSPACE_DIR,
    PORT: String(port),
    NODE_ENV: isBundled ? 'production' : (process.env.NODE_ENV ?? 'development'),
  };

  // Copy client_secret.json to gws config if it exists
  if (fs.existsSync(CLIENT_SECRET_PATH)) {
    const gwsConfigDir = path.join(os.homedir(), '.config', 'gws');
    ensureDir(gwsConfigDir);
    const gwsSecretDest = path.join(gwsConfigDir, 'client_secret.json');
    if (!fs.existsSync(gwsSecretDest) || !hasValidClientSecret(gwsSecretDest)) {
      fs.copyFileSync(CLIENT_SECRET_PATH, gwsSecretDest);
    }
  }

  const child = spawn(
    isBundled ? 'node' : 'npx',
    isBundled ? [serverPath] : ['tsx', serverPath],
    {
      env,
      stdio: 'inherit',
      cwd: path.dirname(serverPath),
    }
  );

  child.on('error', (err) => {
    console.error(`\n  Failed to start server: ${err.message}\n`);
    process.exit(1);
  });

  child.on('exit', (code) => {
    process.exit(code ?? 0);
  });

  // Forward signals
  const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];
  for (const sig of signals) {
    process.on(sig, () => {
      child.kill(sig);
    });
  }
}

// ── Main ─────────────────────────────────────────────────────────────

/**
 * Migrate data from legacy ~/.flowspace to ~/Library/Application Support/FlowSpace.
 * Copies config.json, client_secret.json, and .llm-settings.json if the new dir
 * doesn't have them yet. Silent — never overwrites existing files in the new dir.
 */
function migrateLegacyData(): void {
  if (!fs.existsSync(LEGACY_FLOWSPACE_DIR)) return;
  ensureDir(FLOWSPACE_DIR);

  const filesToMigrate = ['config.json', 'client_secret.json', '.llm-settings.json', '.env'];
  for (const file of filesToMigrate) {
    const src = path.join(LEGACY_FLOWSPACE_DIR, file);
    const dest = path.join(FLOWSPACE_DIR, file);
    if (fs.existsSync(src) && !fs.existsSync(dest)) {
      try {
        fs.copyFileSync(src, dest);
        fs.chmodSync(dest, 0o600);
      } catch {
        // Non-fatal — continue startup
      }
    }
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  // Migrate legacy ~/.flowspace data to new location on first run
  migrateLegacyData();

  // Handle flags
  if (args.includes('--version') || args.includes('-v')) {
    console.log(`flowspace v${getVersion()}`);
    return;
  }

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
  flowspace — Personal Google Workspace dashboard with AI assistant

  Usage:
    flowspace            Start FlowSpace (runs setup on first use)
    flowspace setup      Re-run the setup wizard
    flowspace doctor     Check system health
    flowspace reset      Delete all settings for a clean start

  Options:
    --port <number>   Use a specific port (default: 3000)
    --version, -v     Show version
    --help, -h        Show this help
`);
    return;
  }

  // Subcommands
  const subcommand = args.find(a => !a.startsWith('-'));

  if (subcommand === 'setup') {
    if (!checkNodeVersion()) {
      console.error(`  FlowSpace requires Node.js ${REQUIRED_NODE_MAJOR}+. You have ${process.versions.node}.`);
      process.exit(1);
    }
    await runSetupWizard();
    return;
  }

  if (subcommand === 'doctor') {
    await runDoctor();
    return;
  }

  if (subcommand === 'reset') {
    p.intro('FlowSpace Reset');
    const confirm = await p.confirm({
      message: `Delete all FlowSpace settings in ${FLOWSPACE_DIR}? This cannot be undone.`,
    });
    if (p.isCancel(confirm) || !confirm) { p.cancel('Cancelled.'); process.exit(0); }
    if (fs.existsSync(FLOWSPACE_DIR)) {
      fs.readdirSync(FLOWSPACE_DIR).forEach(f => {
        try { fs.rmSync(path.join(FLOWSPACE_DIR, f), { recursive: true }); } catch { /* ignore */ }
      });
    }
    p.outro('All settings cleared. Run "flowspace" to set up again.');
    return;
  }

  // ── Default: start server ─────────────────────────────────────────

  if (!checkNodeVersion()) {
    console.error(`\n  FlowSpace requires Node.js ${REQUIRED_NODE_MAJOR}+. You have ${process.versions.node}.\n`);
    process.exit(1);
  }

  // Parse --port
  const portIdx = args.indexOf('--port');
  const port = portIdx >= 0 ? parseInt(args[portIdx + 1], 10) || DEFAULT_PORT : DEFAULT_PORT;

  // Check config — run setup if first time, or prompt on version change
  let config = readConfig();
  if (!config) {
    // Check for an existing install with no config (e.g. migrated from old version)
    const hasExistingData = fs.existsSync(FLOWSPACE_DIR) &&
      fs.readdirSync(FLOWSPACE_DIR).some(f => ['.llm-settings.json', '.tokens.json', '.accounts.json'].includes(f));

    if (hasExistingData) {
      p.intro('Welcome back to FlowSpace');
      p.note(
        'An existing FlowSpace installation was found, but setup has not been completed.\n' +
        'Your existing Google sign-in and settings will be preserved.',
        'Existing installation detected'
      );
      const action = await p.select({
        message: 'What would you like to do?',
        options: [
          { value: 'keep', label: 'Keep existing settings and start', hint: 'Recommended — your Google account stays connected' },
          { value: 'setup', label: 'Re-run setup wizard', hint: 'Configure a new AI provider or change settings' },
          { value: 'fresh', label: 'Start fresh (delete all settings)', hint: 'Removes all saved accounts and settings' },
        ],
      });

      if (p.isCancel(action)) { p.cancel('Cancelled.'); process.exit(0); }

      if (action === 'fresh') {
        const confirm = await p.confirm({ message: 'Delete all FlowSpace settings? This cannot be undone.' });
        if (p.isCancel(confirm) || !confirm) { p.cancel('Cancelled.'); process.exit(0); }
        fs.readdirSync(FLOWSPACE_DIR).forEach(f => {
          try { fs.rmSync(path.join(FLOWSPACE_DIR, f), { recursive: true }); } catch { /* ignore */ }
        });
        p.log.success('Settings cleared.');
        config = await runSetupWizard();
      } else if (action === 'setup') {
        config = await runSetupWizard();
      } else {
        // Keep existing — write a minimal config so we don't ask again
        config = { version: 1, appVersion: getVersion(), google: { clientSecretPath: '', configured: true }, ai: { configured: false }, port: DEFAULT_PORT };
        writeConfig(config);
      }
    } else {
      config = await runSetupWizard();
    }
  } else if (!config.appVersion || config.appVersion !== getVersion()) {
    // appVersion missing (old install) or version changed — ask if they want to re-run setup
    p.intro(`FlowSpace v${getVersion()}`);
    const action = await p.select({
      message: 'Your settings from the previous version are intact. What would you like to do?',
      options: [
        { value: 'keep', label: 'Keep existing settings and start', hint: 'Recommended' },
        { value: 'setup', label: 'Re-run setup wizard', hint: 'Reconfigure AI provider or other settings' },
      ],
    });

    if (p.isCancel(action)) { p.cancel('Cancelled.'); process.exit(0); }

    if (action === 'setup') {
      config = await runSetupWizard();
    } else {
      // Update stored version
      config = { ...config, appVersion: getVersion() };
      writeConfig(config);
    }
  }

  // Check port availability
  const portFree = await isPortAvailable(port);
  if (!portFree) {
    // Non-interactive (piped, background): auto-find next free port
    if (!process.stdin.isTTY) {
      let altPort = port + 1;
      while (altPort < port + 100) {
        if (await isPortAvailable(altPort)) break;
        altPort++;
      }
      if (altPort >= port + 100) {
        console.error(`\n  No available port found in range ${port}–${port + 99}.\n`);
        process.exit(1);
      }
      console.log(`  Port ${port} in use, using ${altPort} instead.`);
      return startServer(altPort);
    }

    // Interactive: prompt user
    const action = await p.select({
      message: `Port ${port} is already in use.`,
      options: [
        { value: 'kill', label: `Kill the process on port ${port}` },
        { value: 'alt', label: 'Use a different port' },
        { value: 'exit', label: 'Exit' },
      ],
    });

    if (p.isCancel(action) || action === 'exit') {
      process.exit(0);
    }

    if (action === 'kill') {
      try {
        const pids = execFileSync('lsof', ['-ti', `:${port}`], { stdio: 'pipe' })
          .toString()
          .trim()
          .split('\n')
          .filter(Boolean);
        for (const pid of pids) {
          try { process.kill(Number(pid), 'SIGKILL'); } catch { /* already dead */ }
        }
        p.log.success(`Killed process on port ${port}.`);
      } catch {
        p.log.error(`Could not kill process on port ${port}.`);
        process.exit(1);
      }
    }

    if (action === 'alt') {
      let altPort = port + 1;
      while (altPort < port + 100) {
        if (await isPortAvailable(altPort)) break;
        altPort++;
      }
      p.log.info(`Using port ${altPort} instead.`);
      return startServer(altPort);
    }
  }

  await startServer(port);
}

// ── Doctor ───────────────────────────────────────────────────────────

async function runDoctor(): Promise<void> {
  console.log(`\n  FlowSpace Doctor v${getVersion()}\n`);

  const checks: Array<{ name: string; ok: boolean; detail: string }> = [];

  // Node version
  const nodeMajor = parseInt(process.versions.node.split('.')[0], 10);
  checks.push({
    name: 'Node.js',
    ok: nodeMajor >= REQUIRED_NODE_MAJOR,
    detail: `v${process.versions.node}${nodeMajor >= REQUIRED_NODE_MAJOR ? '' : ` (need ${REQUIRED_NODE_MAJOR}+)`}`,
  });

  // Config
  const config = readConfig();
  checks.push({
    name: 'Config',
    ok: config !== null,
    detail: config ? CONFIG_PATH : 'Not found — run: flowspace setup',
  });

  // OAuth credentials are injected into the server binary at release time — no file needed
  checks.push({
    name: 'Google OAuth',
    ok: true,
    detail: 'Bundled (no setup required)',
  });

  // gws CLI
  const gwsCmd = findGwsCommand();
  checks.push({
    name: 'gws CLI',
    ok: gwsCmd !== null,
    detail: gwsCmd ?? 'Not installed — run: npm install -g @googleworkspace/cli',
  });

  // Google auth status
  if (gwsCmd) {
    try {
      const output = execFileSync(gwsCmd, ['auth', 'status', '--json'], {
        encoding: 'utf-8',
        timeout: 10_000,
        env: getShellEnv(),
      });
      const status = JSON.parse(output);
      const isAuth = status.has_refresh_token === true || status.token_valid === true;
      checks.push({
        name: 'Google Auth',
        ok: isAuth,
        detail: isAuth ? `Signed in as ${status.email ?? 'unknown'}` : 'Not signed in',
      });
    } catch {
      checks.push({
        name: 'Google Auth',
        ok: false,
        detail: 'Could not check auth status',
      });
    }
  }

  // LLM settings
  const llmSettingsPath = path.join(FLOWSPACE_DIR, '.llm-settings.json');
  const hasLLM = fs.existsSync(llmSettingsPath);
  checks.push({
    name: 'AI Provider',
    ok: hasLLM,
    detail: hasLLM ? 'Configured' : 'Not configured (optional)',
  });

  // Port
  const portFree = await isPortAvailable(DEFAULT_PORT);
  checks.push({
    name: `Port ${DEFAULT_PORT}`,
    ok: portFree,
    detail: portFree ? 'Available' : 'In use',
  });

  // Print results
  for (const check of checks) {
    const icon = check.ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m';
    console.log(`  ${icon} ${check.name.padEnd(14)} ${check.detail}`);
  }

  const allOk = checks.every(c => c.ok);
  console.log('');
  if (allOk) {
    console.log('  All checks passed!\n');
  } else {
    const critical = checks.filter(c => !c.ok && !['AI Provider', `Port ${DEFAULT_PORT}`].includes(c.name));
    if (critical.length > 0) {
      console.log('  Some checks failed. Run: flowspace setup\n');
    } else {
      console.log('  Non-critical issues found. FlowSpace should still work.\n');
    }
  }
}

// ── Entry point ──────────────────────────────────────────────────────

main().catch((err) => {
  console.error(`\n  Error: ${err.message}\n`);
  process.exit(1);
});
