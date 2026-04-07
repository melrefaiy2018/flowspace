#!/usr/bin/env node

import { execSync } from "child_process";
import { createWriteStream, existsSync, mkdirSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { get } from "https";

// Download proxy hosted on Vercel — authenticates with GitHub on the server side.
const DOWNLOAD_BASES = [
  "https://flowspace.vercel.app",
  "https://flowspace-ai.vercel.app",
];

const APP_NAME = "FlowSpace.app";
const INSTALL_DIR = "/Applications";
const INSTALLED_PATH = join(INSTALL_DIR, APP_NAME);

async function main() {
  const args = process.argv.slice(2);

  if (args.includes("--uninstall") || args.includes("uninstall")) {
    return uninstall();
  }

  if (args.includes("--help") || args.includes("-h")) {
    console.log(`
  flowspace — Install FlowSpace macOS app

  Usage:
    npx flowspace            Install or update FlowSpace
    npx flowspace uninstall  Remove FlowSpace from /Applications

  Options:
    --version, -v   Show version
    --help, -h      Show this help
`);
    return;
  }

  if (args.includes("--version") || args.includes("-v")) {
    console.log("flowspace-ai v1.2.0");
    return;
  }

  await install();
}

async function install() {
  if (process.platform !== "darwin") {
    console.error("✗ FlowSpace is only available for macOS.");
    process.exit(1);
  }

  console.log("\n  FlowSpace Installer\n");

  // 1. Get latest release info from Vercel proxy
  console.log("  → Finding latest release...");
  const release = await getReleaseInfo();

  console.log(`  → Version: ${release.tag_name}`);
  console.log(`  → Asset: ${release.asset_name}`);

  // 2. Download DMG via the Vercel proxy (redirects to signed S3 URL)
  const tmpDir = join(tmpdir(), `flowspace-install-${Date.now()}`);
  mkdirSync(tmpDir, { recursive: true });
  const dmgPath = join(tmpDir, release.asset_name);

  console.log("  → Downloading...");
  await download(`${release._base}/api/download`, dmgPath);

  // 3. Mount DMG
  console.log("  → Mounting disk image...");
  const mountOutput = execSync(
    `hdiutil attach "${dmgPath}" -nobrowse -plist`,
    { encoding: "utf8" }
  );
  const mountPointMatch = mountOutput.match(
    /<key>mount-point<\/key>\s*<string>([^<]+)<\/string>/
  );
  if (!mountPointMatch) {
    console.error("  ✗ Failed to mount disk image.");
    process.exit(1);
  }
  const mountPoint = mountPointMatch[1];

  try {
    // 4. Copy .app to /Applications
    const appSource = join(mountPoint, APP_NAME);

    if (!existsSync(appSource)) {
      console.error(`  ✗ ${APP_NAME} not found in disk image.`);
      process.exit(1);
    }

    if (existsSync(INSTALLED_PATH)) {
      console.log("  → Removing previous version...");
      rmSync(INSTALLED_PATH, { recursive: true, force: true });
    }

    console.log(`  → Installing to ${INSTALL_DIR}...`);
    execSync(`cp -R "${appSource}" "${INSTALL_DIR}/"`);

    // 5. Remove quarantine attribute so it opens without Gatekeeper warning
    try {
      execSync(
        `xattr -rd com.apple.quarantine "${INSTALLED_PATH}" 2>/dev/null`
      );
    } catch {
      // ok if xattr fails
    }

    // 6. Pre-install gws CLI if not present
    try {
      execSync("which gws", { stdio: "ignore" });
      console.log("  → gws CLI already installed");
    } catch {
      console.log("  → Installing Google Workspace CLI...");
      try {
        execSync("npm install -g @googleworkspace/cli", {
          stdio: "inherit",
          timeout: 120000,
        });
        console.log("  → gws CLI installed");
      } catch {
        console.log(
          "  ! Could not install gws CLI automatically."
        );
        console.log(
          "    Run manually: npm install -g @googleworkspace/cli\n"
        );
      }
    }

    console.log("  → Installed successfully!\n");

    // 7. Open the app
    console.log(`  Open FlowSpace from Spotlight or run:`);
    console.log(`    open -a FlowSpace\n`);
  } finally {
    // 7. Cleanup
    try {
      execSync(`hdiutil detach "${mountPoint}" -quiet`);
    } catch {
      // ok
    }
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ok
    }
  }
}

function uninstall() {
  if (!existsSync(INSTALLED_PATH)) {
    console.log("  FlowSpace is not installed.");
    return;
  }

  console.log("  → Removing FlowSpace...");
  rmSync(INSTALLED_PATH, { recursive: true, force: true });
  console.log("  → FlowSpace has been removed from /Applications.\n");
}

async function getReleaseInfo() {
  for (const base of DOWNLOAD_BASES) {
    try {
      const data = await fetchJSON(`${base}/api/release`);
      return { ...data, _base: base };
    } catch {
      // try next base URL
    }
  }
  console.error("  ✗ Could not reach FlowSpace download server.");
  console.error("    Check your internet connection and try again.");
  process.exit(1);
}

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    const doGet = (u) => {
      get(u, { headers: { "User-Agent": "flowspace-installer" } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return doGet(res.headers.location);
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode} from ${u}`));
          return;
        }
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            resolve(JSON.parse(data));
          } catch {
            reject(new Error("Invalid JSON response"));
          }
        });
        res.on("error", reject);
      }).on("error", reject);
    };
    doGet(url);
  });
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const doGet = (u) => {
      get(
        u,
        { headers: { "User-Agent": "flowspace-installer" } },
        (res) => {
          if (
            res.statusCode >= 300 &&
            res.statusCode < 400 &&
            res.headers.location
          ) {
            return doGet(res.headers.location);
          }
          if (res.statusCode !== 200) {
            reject(new Error(`Download failed: HTTP ${res.statusCode}`));
            return;
          }
          const total = parseInt(res.headers["content-length"] || "0", 10);
          let downloaded = 0;
          const file = createWriteStream(dest);
          res.on("data", (chunk) => {
            downloaded += chunk.length;
            if (total > 0) {
              const pct = Math.round((downloaded / total) * 100);
              process.stdout.write(`\r  → Downloading... ${pct}%`);
            }
          });
          res.pipe(file);
          file.on("finish", () => {
            process.stdout.write("\n");
            file.close(resolve);
          });
          file.on("error", reject);
        }
      ).on("error", reject);
    };
    doGet(url);
  });
}

main().catch((err) => {
  console.error(`\n  ✗ Installation failed: ${err.message}\n`);
  process.exit(1);
});
