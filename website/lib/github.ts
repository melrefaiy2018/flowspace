const REPO = "melrefaiy2018/FlowSpace";
const GITHUB_API = "https://api.github.com";

export interface ReleaseAsset {
  readonly name: string;
  readonly size: number;
  readonly url: string;
  readonly browser_download_url: string;
}

export interface ReleaseInfo {
  readonly tag_name: string;
  readonly name: string;
  readonly assets: readonly ReleaseAsset[];
}

export interface ReleaseMetadata {
  readonly tag_name: string;
  readonly version: string;
  readonly asset_name: string;
  readonly asset_size: number;
  readonly download_url: string;
}

const DMG_EXTENSION = ".dmg";
const CURRENT_DMG_PREFIX = "FlowSpace_";
const ARCH_PRIORITY = ["universal", "aarch64", "arm64", "x86_64", "x64"];

export async function fetchLatestRelease(
  token: string
): Promise<ReleaseInfo> {
  const res = await fetch(`${GITHUB_API}/repos/${REPO}/releases/latest`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "User-Agent": "flowspace-website",
      Accept: "application/vnd.github+json",
    },
  });

  if (!res.ok) {
    throw new Error(`GitHub API error: ${res.status} ${res.statusText}`);
  }

  return res.json();
}

export function findDmgAsset(
  release: ReleaseInfo
): ReleaseAsset | undefined {
  const version = release.tag_name.replace(/^v/, "");
  const dmgAssets = release.assets.filter((asset) =>
    asset.name.endsWith(DMG_EXTENSION)
  );

  if (dmgAssets.length === 0) {
    return undefined;
  }

  return [...dmgAssets].sort((left, right) => {
    const scoreDelta = scoreDmgAsset(right.name, version) - scoreDmgAsset(left.name, version);
    if (scoreDelta !== 0) {
      return scoreDelta;
    }

    return left.name.localeCompare(right.name);
  })[0];
}

export function buildReleaseMetadata(
  release: ReleaseInfo,
  asset: ReleaseAsset
): ReleaseMetadata {
  const version = release.tag_name.replace(/^v/, "");
  return {
    tag_name: release.tag_name,
    version,
    asset_name: asset.name,
    asset_size: asset.size,
    download_url: "/api/download",
  };
}

export async function getAssetRedirectUrl(
  asset: ReleaseAsset,
  token: string
): Promise<string> {
  // GitHub returns a 302 redirect to a signed S3 URL when requesting
  // an asset with Accept: application/octet-stream
  const res = await fetch(asset.url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "User-Agent": "flowspace-website",
      Accept: "application/octet-stream",
    },
    redirect: "manual",
  });

  // GitHub returns 302 with the signed URL in Location header
  if (res.status === 302) {
    const location = res.headers.get("Location");
    if (location) return location;
  }

  // If no redirect, the response itself contains the binary (fallback)
  // This shouldn't happen with the GitHub API, but handle it
  throw new Error(
    `Expected 302 redirect from GitHub, got ${res.status}`
  );
}

function scoreDmgAsset(name: string, version: string): number {
  let score = 0;

  if (name.startsWith(`${CURRENT_DMG_PREFIX}${version}_`)) {
    score += 100;
  } else if (name.startsWith(CURRENT_DMG_PREFIX)) {
    score += 50;
  }

  const arch = getArchFromAssetName(name);
  if (arch) {
    const priorityIndex = ARCH_PRIORITY.indexOf(arch);
    score += priorityIndex === -1 ? 0 : ARCH_PRIORITY.length - priorityIndex;
  }

  return score;
}

function getArchFromAssetName(name: string): string | undefined {
  if (!name.endsWith(DMG_EXTENSION)) {
    return undefined;
  }

  const baseName = name.slice(0, -DMG_EXTENSION.length);
  const separatorIndex = Math.max(baseName.lastIndexOf("_"), baseName.lastIndexOf("-"));
  if (separatorIndex === -1) {
    return undefined;
  }

  return baseName.slice(separatorIndex + 1).toLowerCase();
}
