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
import http from 'node:http';
import { fileURLToPath } from 'node:url';

// ── Constants ────────────────────────────────────────────────────────

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Matches server.ts production DATA_DIR so settings saved in the UI persist across restarts.
// Falls back to ~/.flowspace for non-macOS systems.
const FLOWSPACE_DIR = process.platform === 'darwin'
  ? path.join(os.homedir(), 'Library', 'Application Support', 'FlowSpace')
  : path.join(os.homedir(), '.flowspace');
const CONFIG_PATH = path.join(FLOWSPACE_DIR, 'config.json');
const CLIENT_SECRET_PATH = path.join(FLOWSPACE_DIR, 'client_secret.json');
const DEFAULT_PORT = 3000;

const REQUIRED_NODE_MAJOR = 20;

interface FlowSpaceConfig {
  version: number;
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
    server.listen(port, '127.0.0.1');
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
      { value: 'lmstudio', label: 'LM Studio', hint: 'Local models, no API key needed' },
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
    ensureDir(FLOWSPACE_DIR);
    const settingsPath = path.join(FLOWSPACE_DIR, '.llm-settings.json');
    fs.writeFileSync(settingsPath, JSON.stringify(llmSettings, null, 2), { mode: 0o600 });

    return { configured: true, provider: 'lmstudio' };
  }

  // For API-key providers
  const apiKey = await p.text({
    message: `Enter your ${aiChoice === 'openai' ? 'OpenAI' : aiChoice === 'anthropic' ? 'Anthropic' : 'OpenRouter'} API key:`,
    placeholder: 'sk-...',
    validate: (value) => {
      if (!value.trim()) return 'API key is required.';
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

  ensureDir(FLOWSPACE_DIR);
  const settingsPath = path.join(FLOWSPACE_DIR, '.llm-settings.json');
  fs.writeFileSync(settingsPath, JSON.stringify(llmSettings, null, 2), { mode: 0o600 });

  p.log.success(`${aiChoice} configured!`);

  return { configured: true, provider: aiChoice as string };
}

// ── Browser Opener ───────────────────────────────────────────────────

function openBrowser(url: string): void {
  const platform = process.platform;
  try {
    if (platform === 'darwin') {
      execSync(`open "${url}"`, { stdio: 'ignore' });
    } else if (platform === 'win32') {
      execSync(`start "" "${url}"`, { stdio: 'ignore', shell: true });
    } else {
      execSync(`xdg-open "${url}"`, { stdio: 'ignore' });
    }
  } catch {
    // Silently ignore — browser open is best-effort
  }
}

function waitForServer(port: number, maxWaitMs = 15_000): Promise<boolean> {
  return new Promise((resolve) => {
    const start = Date.now();
    function poll() {
      const req = http.get(`http://localhost:${port}`, (res) => {
        res.destroy();
        resolve(true);
      });
      req.on('error', () => {
        if (Date.now() - start >= maxWaitMs) {
          resolve(false);
        } else {
          setTimeout(poll, 300);
        }
      });
      req.setTimeout(500, () => {
        req.destroy();
        if (Date.now() - start >= maxWaitMs) {
          resolve(false);
        } else {
          setTimeout(poll, 300);
        }
      });
    }
    poll();
  });
}

// ── Server Launcher ───────────────────────────────────────────────────

async function startServer(port: number): Promise<void> {
  // Find the server entry point
  const candidates = [
    path.join(__dirname, '..', 'dist-server', 'server.mjs'),  // Pre-bundled (npm package)
    path.join(__dirname, '..', 'server.ts'),                    // Dev mode (git clone)
  ];

  const serverPath = candidates.find(p => fs.existsSync(p));

  if (!serverPath) {
    p.log.error('Could not find server entry point.');
    p.log.message(`Searched:\n${candidates.map(c => `  - ${c}`).join('\n')}`);
    process.exit(1);
  }

  const isBundled = serverPath.endsWith('.mjs');
  const repoRoot = path.join(__dirname, '..');
  const distDir = path.join(repoRoot, 'dist');

  // Ensure the frontend is built — required for production mode serving
  if (!fs.existsSync(path.join(distDir, 'index.html'))) {
    const buildSpinner = p.spinner();
    buildSpinner.start('Building frontend (first run)...');
    try {
      execSync('npm run build', {
        stdio: 'pipe',
        cwd: repoRoot,
        timeout: 120_000,
        env: getShellEnv(),
      });
      buildSpinner.stop('Frontend built.');
    } catch (err) {
      buildSpinner.stop('Frontend build failed.');
      p.log.error('Could not build the frontend. Run `npm run build` manually and try again.');
      process.exit(1);
    }
  }

  console.log('');
  console.log(`  FlowSpace v${getVersion()}`);
  console.log(`  http://localhost:${port}`);
  console.log('');
  console.log('  Press Ctrl+C to stop.');
  console.log('');

  const env: Record<string, string> = {
    ...getShellEnv(),
    FLOWSPACE_DATA_DIR: FLOWSPACE_DIR,
    NODE_ENV: 'production',
    PORT: String(port),
  };

  // Ensure client_secret.json is in FLOWSPACE_DIR so the server can load OAuth config.
  // In a proper release, credentials are injected into server.mjs at build time.
  // For source installs / dev testing, bootstrap from known locations.
  if (!fs.existsSync(CLIENT_SECRET_PATH) || !hasValidClientSecret(CLIENT_SECRET_PATH)) {
    const fallbackLocations = [
      path.join(os.homedir(), '.config', 'gws', 'client_secret.json'),
      path.join(repoRoot, 'client_secret.json'),
      path.join(repoRoot, 'src-tauri', 'resources', 'client_secret.json'),
    ];
    for (const loc of fallbackLocations) {
      if (fs.existsSync(loc) && hasValidClientSecret(loc)) {
        ensureDir(FLOWSPACE_DIR);
        fs.copyFileSync(loc, CLIENT_SECRET_PATH);
        fs.chmodSync(CLIENT_SECRET_PATH, 0o600);
        break;
      }
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

  // Open browser once the server is accepting connections
  const url = `http://localhost:${port}`;
  waitForServer(port).then((ready) => {
    if (ready) openBrowser(url);
  });
}

// ── Main ─────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  // Handle flags
  if (args.includes('--version') || args.includes('-v')) {
    console.log(`flowspace v${getVersion()}`);
    return;
  }

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
  flowspace — Personal Google Workspace dashboard with AI assistant

  Usage:
    npx flowspace            Start FlowSpace (runs setup on first use)
    npx flowspace setup      Re-run the setup wizard
    npx flowspace doctor     Check system health

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

  // ── Default: start server ─────────────────────────────────────────

  if (!checkNodeVersion()) {
    console.error(`\n  FlowSpace requires Node.js ${REQUIRED_NODE_MAJOR}+. You have ${process.versions.node}.\n`);
    process.exit(1);
  }

  // Parse --port
  const portIdx = args.indexOf('--port');
  const port = portIdx >= 0 ? parseInt(args[portIdx + 1], 10) || DEFAULT_PORT : DEFAULT_PORT;

  // Check config — skip setup if user already has an existing installation
  let config = readConfig();
  if (!config) {
    const hasExistingData = fs.existsSync(FLOWSPACE_DIR) &&
      fs.readdirSync(FLOWSPACE_DIR).some(f =>
        ['.llm-settings.json', '.tokens.json', '.accounts.json', 'client_secret.json'].includes(f)
      );

    if (hasExistingData) {
      // Existing install with no config — preserve data, just write a minimal config
      config = { version: 1, google: { clientSecretPath: '', configured: true }, ai: { configured: false }, port: DEFAULT_PORT };
      writeConfig(config);
    } else {
      config = await runSetupWizard();
    }
  }

  // Check port
  const portFree = await isPortAvailable(port);
  if (!portFree) {
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
        execSync(`lsof -ti :${port} | xargs kill -9`, { stdio: 'pipe' });
        p.log.success(`Killed process on port ${port}.`);
      } catch {
        p.log.error(`Could not kill process on port ${port}.`);
        process.exit(1);
      }
    }

    if (action === 'alt') {
      // Find next available port
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
    detail: config ? CONFIG_PATH : 'Not found — run: npx flowspace setup',
  });

  // client_secret.json
  const hasSecret = fs.existsSync(CLIENT_SECRET_PATH) && hasValidClientSecret(CLIENT_SECRET_PATH);
  checks.push({
    name: 'Google OAuth',
    ok: hasSecret,
    detail: hasSecret ? 'client_secret.json found' : 'Missing — run: npx flowspace setup',
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
      console.log('  Some checks failed. Run: npx flowspace setup\n');
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
