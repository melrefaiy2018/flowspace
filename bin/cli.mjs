#!/usr/bin/env node

// bin/cli.ts
import * as p from "@clack/prompts";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execSync, spawn, execFileSync } from "node:child_process";
import net from "node:net";
import { fileURLToPath } from "node:url";
var __dirname = path.dirname(fileURLToPath(import.meta.url));
var FLOWSPACE_DIR = path.join(os.homedir(), "Library", "Application Support", "FlowSpace");
var LEGACY_FLOWSPACE_DIR = path.join(os.homedir(), ".flowspace");
var CONFIG_PATH = path.join(FLOWSPACE_DIR, "config.json");
var CLIENT_SECRET_PATH = path.join(FLOWSPACE_DIR, "client_secret.json");
var DEFAULT_PORT = 3e3;
var REQUIRED_NODE_MAJOR = 20;
function getVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf-8"));
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}
function checkNodeVersion() {
  const major = parseInt(process.versions.node.split(".")[0], 10);
  return major >= REQUIRED_NODE_MAJOR;
}
function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, "0.0.0.0");
  });
}
function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 448 });
  }
}
function readConfig() {
  if (!fs.existsSync(CONFIG_PATH)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
    if (raw && typeof raw === "object" && raw.version === 1) {
      return raw;
    }
  } catch {
  }
  return null;
}
function writeConfig(config) {
  ensureDir(FLOWSPACE_DIR);
  const tmp = CONFIG_PATH + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(config, null, 2), { mode: 384 });
  fs.renameSync(tmp, CONFIG_PATH);
}
function hasValidClientSecret(filePath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    const installed = parsed?.installed;
    const clientId = typeof installed?.client_id === "string" ? installed.client_id : "";
    const clientSecret = typeof installed?.client_secret === "string" ? installed.client_secret : "";
    const projectId = typeof installed?.project_id === "string" ? installed.project_id : "";
    const redirectUris = Array.isArray(installed?.redirect_uris) ? installed.redirect_uris : [];
    if (!clientId || !clientSecret || !projectId || redirectUris.length === 0) return false;
    if (clientId.includes("YOUR_CLIENT_ID") || clientSecret.includes("YOUR_CLIENT_SECRET")) return false;
    return true;
  } catch {
    return false;
  }
}
function findGwsCommand() {
  const candidates = [
    path.join(FLOWSPACE_DIR, "node_modules", ".bin", "gws")
    // Global install locations
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  try {
    const shellEnv = getShellEnv();
    execFileSync("which", ["gws"], { stdio: "ignore", env: shellEnv });
    return "gws";
  } catch {
    return null;
  }
}
function getShellEnv() {
  const env = { ...process.env };
  const extraPaths = ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"];
  const currentPath = env.PATH ?? "";
  const missing = extraPaths.filter((p2) => !currentPath.includes(p2));
  if (missing.length > 0) {
    env.PATH = [...missing, currentPath].join(":");
  }
  return env;
}
async function runSetupWizard() {
  p.intro("Welcome to FlowSpace");
  p.note(
    "FlowSpace is a personal Google Workspace dashboard with an AI assistant.\nThis setup will configure your Google connection and (optionally) an AI provider.",
    "About"
  );
  const googleSection = await setupGoogle();
  const aiSection = await setupAI();
  const port = DEFAULT_PORT;
  const config = {
    version: 1,
    google: googleSection,
    ai: aiSection,
    port
  };
  writeConfig(config);
  p.outro("Setup complete! Starting FlowSpace...");
  return config;
}
async function setupGoogle() {
  p.log.step("Step 1: Google Workspace Connection");
  p.log.message(
    `FlowSpace needs a Google Cloud OAuth client to access your Drive, Gmail, Calendar, and Tasks.

If you don't have one yet, follow these steps:
  1. Go to https://console.cloud.google.com
  2. Create a new project (e.g., "FlowSpace")
  3. Enable these APIs: Drive, Gmail, Calendar, Tasks
  4. Go to APIs & Services > OAuth consent screen
     - Choose "External", fill in app name
     - Add yourself as a test user
  5. Go to Credentials > Create Credentials > OAuth client ID
     - Application type: "Desktop app"
  6. Download the JSON file (client_secret_*.json)`
  );
  if (fs.existsSync(CLIENT_SECRET_PATH) && hasValidClientSecret(CLIENT_SECRET_PATH)) {
    const reuse = await p.confirm({
      message: `Found existing client_secret.json in FlowSpace data dir. Use it?`
    });
    if (p.isCancel(reuse)) {
      p.cancel("Setup cancelled.");
      process.exit(0);
    }
    if (reuse) {
      p.log.success("Using existing Google OAuth credentials.");
      return { clientSecretPath: CLIENT_SECRET_PATH, configured: true };
    }
  }
  let secretPath = null;
  while (!secretPath) {
    const input = await p.text({
      message: "Path to your client_secret.json file:",
      placeholder: "~/Downloads/client_secret_123.json",
      validate: (value) => {
        if (!value.trim()) return "Please enter a file path.";
        const resolved = value.trim().replace(/^~/, os.homedir());
        if (!fs.existsSync(resolved)) return `File not found: ${resolved}`;
        if (!hasValidClientSecret(resolved)) {
          return "This doesn't look like a valid Google OAuth client_secret.json file.";
        }
        return void 0;
      }
    });
    if (p.isCancel(input)) {
      p.cancel("Setup cancelled.");
      process.exit(0);
    }
    secretPath = input.trim().replace(/^~/, os.homedir());
  }
  ensureDir(FLOWSPACE_DIR);
  fs.copyFileSync(secretPath, CLIENT_SECRET_PATH);
  fs.chmodSync(CLIENT_SECRET_PATH, 384);
  p.log.success("Copied client_secret.json to FlowSpace data dir.");
  const gwsSpinner = p.spinner();
  let gwsCommand = findGwsCommand();
  if (!gwsCommand) {
    gwsSpinner.start("Installing Google Workspace CLI...");
    try {
      execSync("npm install -g @googleworkspace/cli", {
        stdio: "pipe",
        timeout: 12e4,
        env: getShellEnv()
      });
      gwsCommand = findGwsCommand();
      if (gwsCommand) {
        gwsSpinner.stop("Google Workspace CLI installed.");
      } else {
        gwsSpinner.stop("gws CLI installed but not found on PATH.");
        p.log.warn("Try running: npm install -g @googleworkspace/cli");
      }
    } catch (err) {
      gwsSpinner.stop("Could not install gws CLI automatically.");
      p.log.warn(
        "Install it manually: npm install -g @googleworkspace/cli\nThen re-run: npx flowspace"
      );
    }
  }
  if (gwsCommand) {
    const gwsConfigDir = path.join(os.homedir(), ".config", "gws");
    ensureDir(gwsConfigDir);
    const gwsSecretPath = path.join(gwsConfigDir, "client_secret.json");
    fs.copyFileSync(CLIENT_SECRET_PATH, gwsSecretPath);
    const doLogin = await p.confirm({
      message: "Sign in with Google now? (opens your browser)"
    });
    if (p.isCancel(doLogin)) {
      p.cancel("Setup cancelled.");
      process.exit(0);
    }
    if (doLogin && gwsCommand) {
      p.log.message("Opening browser for Google sign-in...");
      try {
        execFileSync(
          gwsCommand,
          ["auth", "login", "-s", "drive,gmail,calendar,tasks,userinfo.email,userinfo.profile"],
          {
            stdio: "inherit",
            timeout: 3e5,
            env: getShellEnv()
          }
        );
        p.log.success("Google sign-in complete!");
      } catch {
        p.log.warn(
          "Google sign-in did not complete. You can sign in later from the FlowSpace UI."
        );
      }
    }
  }
  return { clientSecretPath: CLIENT_SECRET_PATH, configured: true };
}
async function setupAI() {
  p.log.step("Step 2: AI Assistant (optional)");
  const aiChoice = await p.select({
    message: "Choose an AI provider for the chat assistant:",
    options: [
      { value: "openai", label: "OpenAI", hint: "GPT-4o, GPT-4" },
      { value: "anthropic", label: "Anthropic", hint: "Claude" },
      { value: "openrouter", label: "OpenRouter", hint: "Multiple models" },
      { value: "lmstudio", label: "LM Studio", hint: "Local models, no API key needed" },
      { value: "custom", label: "Custom (OpenAI-compatible)", hint: "Any OpenAI-compatible API" },
      { value: "skip", label: "Skip for now", hint: "Dashboard works without AI" }
    ]
  });
  if (p.isCancel(aiChoice)) {
    p.cancel("Setup cancelled.");
    process.exit(0);
  }
  if (aiChoice === "skip") {
    p.log.info("AI skipped. You can configure it later in Settings.");
    return { configured: false };
  }
  if (aiChoice === "lmstudio") {
    p.log.info("LM Studio detected. Make sure it's running on http://localhost:1234");
    const llmSettings2 = {
      activeProvider: "lmstudio",
      providers: {
        lmstudio: {
          provider: "lmstudio",
          apiKey: "lm-studio",
          model: "default",
          baseUrl: "http://localhost:1234/v1"
        }
      }
    };
    const settingsPath2 = path.join(FLOWSPACE_DIR, ".llm-settings.json");
    fs.writeFileSync(settingsPath2, JSON.stringify(llmSettings2, null, 2), { mode: 384 });
    return { configured: true, provider: "lmstudio" };
  }
  if (aiChoice === "custom") {
    const customName = await p.text({
      message: "Provider name (display name):",
      placeholder: "My Provider",
      validate: (value) => {
        if (!value.trim()) return "Provider name is required.";
        return void 0;
      }
    });
    if (p.isCancel(customName)) {
      p.cancel("Setup cancelled.");
      process.exit(0);
    }
    const customBaseUrl = await p.text({
      message: "Base URL (OpenAI-compatible endpoint):",
      placeholder: "https://api.example.com/v1",
      validate: (value) => {
        if (!value.trim()) return "Base URL is required.";
        try {
          new URL(value.trim());
        } catch {
          return "Please enter a valid URL.";
        }
        return void 0;
      }
    });
    if (p.isCancel(customBaseUrl)) {
      p.cancel("Setup cancelled.");
      process.exit(0);
    }
    const customApiKey = await p.text({
      message: "API key (leave empty if not required):",
      placeholder: "sk-..."
    });
    if (p.isCancel(customApiKey)) {
      p.cancel("Setup cancelled.");
      process.exit(0);
    }
    const customModel = await p.text({
      message: "Model name:",
      placeholder: "gpt-4o",
      validate: (value) => {
        if (!value.trim()) return "Model name is required.";
        return void 0;
      }
    });
    if (p.isCancel(customModel)) {
      p.cancel("Setup cancelled.");
      process.exit(0);
    }
    const providerId = customName.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const llmSettings2 = {
      activeProvider: providerId,
      providers: {
        [providerId]: {
          provider: providerId,
          name: customName.trim(),
          apiKey: customApiKey.trim() || "none",
          model: customModel.trim(),
          baseUrl: customBaseUrl.trim()
        }
      }
    };
    const settingsPath2 = path.join(FLOWSPACE_DIR, ".llm-settings.json");
    fs.writeFileSync(settingsPath2, JSON.stringify(llmSettings2, null, 2), { mode: 384 });
    p.log.success(`${customName.trim()} configured!`);
    return { configured: true, provider: providerId };
  }
  const apiKey = await p.text({
    message: `Enter your ${aiChoice === "openai" ? "OpenAI" : aiChoice === "anthropic" ? "Anthropic" : "OpenRouter"} API key:`,
    placeholder: "sk-...",
    validate: (value) => {
      if (!value.trim()) return "API key is required.";
      if (value.trim().length < 10) return "That doesn't look like a valid API key.";
      return void 0;
    }
  });
  if (p.isCancel(apiKey)) {
    p.cancel("Setup cancelled.");
    process.exit(0);
  }
  const providerModels = {
    openai: "gpt-4o",
    anthropic: "claude-sonnet-4-20250514",
    openrouter: "anthropic/claude-sonnet-4"
  };
  const llmSettings = {
    activeProvider: aiChoice,
    providers: {
      [aiChoice]: {
        provider: aiChoice,
        apiKey: apiKey.trim(),
        model: providerModels[aiChoice] ?? "default"
      }
    }
  };
  const settingsPath = path.join(FLOWSPACE_DIR, ".llm-settings.json");
  fs.writeFileSync(settingsPath, JSON.stringify(llmSettings, null, 2), { mode: 384 });
  p.log.success(`${aiChoice} configured!`);
  return { configured: true, provider: aiChoice };
}
async function startServer(port) {
  const candidates = [
    path.join(__dirname, "..", "dist-server", "server.mjs"),
    // Pre-bundled (npm package)
    path.join(__dirname, "..", "server.ts")
    // Dev mode (git clone)
  ];
  const serverPath = candidates.find((p2) => fs.existsSync(p2));
  if (!serverPath) {
    p.log.error("Could not find server entry point.");
    p.log.message(`Searched:
${candidates.map((c) => `  - ${c}`).join("\n")}`);
    process.exit(1);
  }
  const isBundled = serverPath.endsWith(".mjs");
  console.log("");
  console.log(`  FlowSpace v${getVersion()}`);
  console.log(`  http://localhost:${port}`);
  console.log("");
  console.log("  Press Ctrl+C to stop.");
  console.log("");
  const env = {
    ...getShellEnv(),
    FLOWSPACE_DATA_DIR: FLOWSPACE_DIR,
    PORT: String(port),
    NODE_ENV: isBundled ? "production" : process.env.NODE_ENV ?? "development"
  };
  if (fs.existsSync(CLIENT_SECRET_PATH)) {
    const gwsConfigDir = path.join(os.homedir(), ".config", "gws");
    ensureDir(gwsConfigDir);
    const gwsSecretDest = path.join(gwsConfigDir, "client_secret.json");
    if (!fs.existsSync(gwsSecretDest) || !hasValidClientSecret(gwsSecretDest)) {
      fs.copyFileSync(CLIENT_SECRET_PATH, gwsSecretDest);
    }
  }
  const child = spawn(
    isBundled ? "node" : "npx",
    isBundled ? [serverPath] : ["tsx", serverPath],
    {
      env,
      stdio: "inherit",
      cwd: path.dirname(serverPath)
    }
  );
  child.on("error", (err) => {
    console.error(`
  Failed to start server: ${err.message}
`);
    process.exit(1);
  });
  child.on("exit", (code) => {
    process.exit(code ?? 0);
  });
  const signals = ["SIGINT", "SIGTERM"];
  for (const sig of signals) {
    process.on(sig, () => {
      child.kill(sig);
    });
  }
}
function migrateLegacyData() {
  if (!fs.existsSync(LEGACY_FLOWSPACE_DIR)) return;
  ensureDir(FLOWSPACE_DIR);
  const filesToMigrate = ["config.json", "client_secret.json", ".llm-settings.json", ".env"];
  for (const file of filesToMigrate) {
    const src = path.join(LEGACY_FLOWSPACE_DIR, file);
    const dest = path.join(FLOWSPACE_DIR, file);
    if (fs.existsSync(src) && !fs.existsSync(dest)) {
      try {
        fs.copyFileSync(src, dest);
        fs.chmodSync(dest, 384);
      } catch {
      }
    }
  }
}
async function main() {
  const args = process.argv.slice(2);
  migrateLegacyData();
  if (args.includes("--version") || args.includes("-v")) {
    console.log(`flowspace v${getVersion()}`);
    return;
  }
  if (args.includes("--help") || args.includes("-h")) {
    console.log(`
  flowspace \u2014 Personal Google Workspace dashboard with AI assistant

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
  const subcommand = args.find((a) => !a.startsWith("-"));
  if (subcommand === "setup") {
    if (!checkNodeVersion()) {
      console.error(`  FlowSpace requires Node.js ${REQUIRED_NODE_MAJOR}+. You have ${process.versions.node}.`);
      process.exit(1);
    }
    await runSetupWizard();
    return;
  }
  if (subcommand === "doctor") {
    await runDoctor();
    return;
  }
  if (!checkNodeVersion()) {
    console.error(`
  FlowSpace requires Node.js ${REQUIRED_NODE_MAJOR}+. You have ${process.versions.node}.
`);
    process.exit(1);
  }
  const portIdx = args.indexOf("--port");
  const port = portIdx >= 0 ? parseInt(args[portIdx + 1], 10) || DEFAULT_PORT : DEFAULT_PORT;
  let config = readConfig();
  if (!config) {
    config = await runSetupWizard();
  }
  const portFree = await isPortAvailable(port);
  if (!portFree) {
    if (!process.stdin.isTTY) {
      let altPort = port + 1;
      while (altPort < port + 100) {
        if (await isPortAvailable(altPort)) break;
        altPort++;
      }
      if (altPort >= port + 100) {
        console.error(`
  No available port found in range ${port}\u2013${port + 99}.
`);
        process.exit(1);
      }
      console.log(`  Port ${port} in use, using ${altPort} instead.`);
      return startServer(altPort);
    }
    const action = await p.select({
      message: `Port ${port} is already in use.`,
      options: [
        { value: "kill", label: `Kill the process on port ${port}` },
        { value: "alt", label: "Use a different port" },
        { value: "exit", label: "Exit" }
      ]
    });
    if (p.isCancel(action) || action === "exit") {
      process.exit(0);
    }
    if (action === "kill") {
      try {
        const pids = execFileSync("lsof", ["-ti", `:${port}`], { stdio: "pipe" }).toString().trim().split("\n").filter(Boolean);
        for (const pid of pids) {
          try {
            process.kill(Number(pid), "SIGKILL");
          } catch {
          }
        }
        p.log.success(`Killed process on port ${port}.`);
      } catch {
        p.log.error(`Could not kill process on port ${port}.`);
        process.exit(1);
      }
    }
    if (action === "alt") {
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
async function runDoctor() {
  console.log(`
  FlowSpace Doctor v${getVersion()}
`);
  const checks = [];
  const nodeMajor = parseInt(process.versions.node.split(".")[0], 10);
  checks.push({
    name: "Node.js",
    ok: nodeMajor >= REQUIRED_NODE_MAJOR,
    detail: `v${process.versions.node}${nodeMajor >= REQUIRED_NODE_MAJOR ? "" : ` (need ${REQUIRED_NODE_MAJOR}+)`}`
  });
  const config = readConfig();
  checks.push({
    name: "Config",
    ok: config !== null,
    detail: config ? CONFIG_PATH : "Not found \u2014 run: npx flowspace setup"
  });
  const hasSecret = fs.existsSync(CLIENT_SECRET_PATH) && hasValidClientSecret(CLIENT_SECRET_PATH);
  checks.push({
    name: "Google OAuth",
    ok: hasSecret,
    detail: hasSecret ? "client_secret.json found" : "Missing \u2014 run: npx flowspace setup"
  });
  const gwsCmd = findGwsCommand();
  checks.push({
    name: "gws CLI",
    ok: gwsCmd !== null,
    detail: gwsCmd ?? "Not installed \u2014 run: npm install -g @googleworkspace/cli"
  });
  if (gwsCmd) {
    try {
      const output = execFileSync(gwsCmd, ["auth", "status", "--json"], {
        encoding: "utf-8",
        timeout: 1e4,
        env: getShellEnv()
      });
      const status = JSON.parse(output);
      const isAuth = status.has_refresh_token === true || status.token_valid === true;
      checks.push({
        name: "Google Auth",
        ok: isAuth,
        detail: isAuth ? `Signed in as ${status.email ?? "unknown"}` : "Not signed in"
      });
    } catch {
      checks.push({
        name: "Google Auth",
        ok: false,
        detail: "Could not check auth status"
      });
    }
  }
  const llmSettingsPath = path.join(FLOWSPACE_DIR, ".llm-settings.json");
  const hasLLM = fs.existsSync(llmSettingsPath);
  checks.push({
    name: "AI Provider",
    ok: hasLLM,
    detail: hasLLM ? "Configured" : "Not configured (optional)"
  });
  const portFree = await isPortAvailable(DEFAULT_PORT);
  checks.push({
    name: `Port ${DEFAULT_PORT}`,
    ok: portFree,
    detail: portFree ? "Available" : "In use"
  });
  for (const check of checks) {
    const icon = check.ok ? "\x1B[32m\u2713\x1B[0m" : "\x1B[31m\u2717\x1B[0m";
    console.log(`  ${icon} ${check.name.padEnd(14)} ${check.detail}`);
  }
  const allOk = checks.every((c) => c.ok);
  console.log("");
  if (allOk) {
    console.log("  All checks passed!\n");
  } else {
    const critical = checks.filter((c) => !c.ok && !["AI Provider", `Port ${DEFAULT_PORT}`].includes(c.name));
    if (critical.length > 0) {
      console.log("  Some checks failed. Run: npx flowspace setup\n");
    } else {
      console.log("  Non-critical issues found. FlowSpace should still work.\n");
    }
  }
}
main().catch((err) => {
  console.error(`
  Error: ${err.message}
`);
  process.exit(1);
});
