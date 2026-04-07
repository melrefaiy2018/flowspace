import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';
import https from 'https';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const resourcesDir = path.join(rootDir, 'src-tauri', 'resources');
const cacheDir = path.join(rootDir, 'build-artifacts', 'node-runtime');

function ensureExecutable(filePath) {
  fs.chmodSync(filePath, 0o755);
}

function clearMacMetadata(targetPath) {
  try {
    spawnSync('xattr', ['-cr', targetPath], { stdio: 'ignore' });
  } catch {
    // Best effort only; non-macOS environments may not have xattr.
  }
}

function copyExecutable(sourcePath, targetName) {
  if (!fs.existsSync(sourcePath)) {
    console.error(`Required executable not found at ${sourcePath}`);
    process.exit(1);
  }

  const targetPath = path.join(resourcesDir, targetName);
  fs.mkdirSync(resourcesDir, { recursive: true });
  fs.copyFileSync(sourcePath, targetPath);
  ensureExecutable(targetPath);
  clearMacMetadata(targetPath);
  console.log(`Bundled ${targetName}: ${targetPath}`);
}

function platformTriple() {
  if (process.platform !== 'darwin') {
    console.error(`Unsupported platform for desktop sidecar bundling: ${process.platform}`);
    process.exit(1);
  }

  if (process.arch === 'arm64') return 'darwin-arm64';
  if (process.arch === 'x64') return 'darwin-x64';

  console.error(`Unsupported architecture for desktop sidecar bundling: ${process.arch}`);
  process.exit(1);
}

function download(url, destinationPath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destinationPath);
    https.get(url, (response) => {
      if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        file.close();
        fs.rmSync(destinationPath, { force: true });
        download(response.headers.location, destinationPath).then(resolve, reject);
        return;
      }

      if (response.statusCode !== 200) {
        file.close();
        fs.rmSync(destinationPath, { force: true });
        reject(new Error(`Failed to download ${url}: HTTP ${response.statusCode}`));
        return;
      }

      response.pipe(file);
      file.on('finish', () => {
        file.close();
        resolve();
      });
      file.on('error', (error) => {
        file.close();
        fs.rmSync(destinationPath, { force: true });
        reject(error);
      });
    }).on('error', (error) => {
      file.close();
      fs.rmSync(destinationPath, { force: true });
      reject(error);
    });
  });
}

async function preparePortableNodeBinary() {
  const version = process.version;
  const triple = platformTriple();
  const archiveName = `node-${version}-${triple}.tar.xz`;
  const archivePath = path.join(cacheDir, archiveName);
  const extractedDir = path.join(cacheDir, `node-${version}-${triple}`);
  const nodeBinaryPath = path.join(extractedDir, 'bin', 'node');

  fs.mkdirSync(cacheDir, { recursive: true });

  if (!fs.existsSync(nodeBinaryPath)) {
    if (!fs.existsSync(archivePath)) {
      const url = `https://nodejs.org/dist/${version}/${archiveName}`;
      console.log(`Downloading portable Node runtime: ${url}`);
      await download(url, archivePath);
    }

    fs.rmSync(extractedDir, { recursive: true, force: true });
    const extractResult = spawnSync('tar', ['-xf', archivePath, '-C', cacheDir], { stdio: 'inherit' });
    if (extractResult.status !== 0) {
      console.error(`Failed to extract ${archivePath}`);
      process.exit(extractResult.status ?? 1);
    }
  }

  return nodeBinaryPath;
}

function resolveGwsPath() {
  const gwsBinLink = path.join(rootDir, 'node_modules', '.bin', 'gws');

  try {
    return fs.realpathSync(gwsBinLink);
  } catch (error) {
    console.error(`Failed to resolve gws executable at ${gwsBinLink}:`, error);
    process.exit(1);
  }
}

const gwsPath = resolveGwsPath();
const nodePath = await preparePortableNodeBinary();
copyExecutable(nodePath, 'node');
copyExecutable(gwsPath, 'gws');
