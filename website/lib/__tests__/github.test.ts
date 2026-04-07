import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  findDmgAsset,
  buildReleaseMetadata,
  fetchLatestRelease,
  getAssetRedirectUrl,
  type ReleaseInfo,
  type ReleaseAsset,
} from "../github";

const mockRelease: ReleaseInfo = {
  tag_name: "v1.1.0",
  name: "FlowSpace v1.1.0",
  assets: [
    {
      name: "FlowSpace-1.1.0-arm64.dmg",
      size: 6464463,
      url: "https://api.github.com/repos/melrefaiy2018/FlowSpace/releases/assets/123",
      browser_download_url:
        "https://github.com/melrefaiy2018/FlowSpace/releases/download/v1.1.0/FlowSpace-1.1.0-arm64.dmg",
    },
    {
      name: "FlowSpace_1.1.0_aarch64.dmg",
      size: 6464340,
      url: "https://api.github.com/repos/melrefaiy2018/FlowSpace/releases/assets/456",
      browser_download_url:
        "https://github.com/melrefaiy2018/FlowSpace/releases/download/v1.1.0/FlowSpace_1.1.0_aarch64.dmg",
    },
  ],
};

describe("findDmgAsset", () => {
  it("prefers the current main-branch DMG naming scheme", () => {
    const asset = findDmgAsset(mockRelease);
    expect(asset).toBeDefined();
    expect(asset!.name).toBe("FlowSpace_1.1.0_aarch64.dmg");
  });

  it("prefers a version-matching current-format asset over newer-looking legacy names", () => {
    const release: ReleaseInfo = {
      tag_name: "v1.2.0",
      name: "FlowSpace v1.2.0",
      assets: [
        {
          name: "FlowSpace-1.3.0-arm64.dmg",
          size: 10,
          url: "https://example.com/legacy",
          browser_download_url: "https://example.com/legacy",
        },
        {
          name: "FlowSpace_1.2.0_arm64.dmg",
          size: 20,
          url: "https://example.com/current",
          browser_download_url: "https://example.com/current",
        },
      ],
    };

    expect(findDmgAsset(release)?.name).toBe("FlowSpace_1.2.0_arm64.dmg");
  });

  it("returns undefined when no .dmg asset exists", () => {
    const release: ReleaseInfo = {
      tag_name: "v1.0.0",
      name: "Test",
      assets: [
        {
          name: "source.tar.gz",
          size: 1000,
          url: "https://example.com",
          browser_download_url: "https://example.com",
        },
      ],
    };
    expect(findDmgAsset(release)).toBeUndefined();
  });

  it("returns undefined when assets array is empty", () => {
    const release: ReleaseInfo = {
      tag_name: "v1.0.0",
      name: "Test",
      assets: [],
    };
    expect(findDmgAsset(release)).toBeUndefined();
  });
});

describe("buildReleaseMetadata", () => {
  it("builds metadata with version stripped of v prefix", () => {
    const asset = mockRelease.assets[1];
    const metadata = buildReleaseMetadata(mockRelease, asset);

    expect(metadata).toEqual({
      tag_name: "v1.1.0",
      version: "1.1.0",
      asset_name: "FlowSpace_1.1.0_aarch64.dmg",
      asset_size: 6464340,
      download_url: "/api/download",
    });
  });

  it("handles tag_name without v prefix", () => {
    const release: ReleaseInfo = {
      ...mockRelease,
      tag_name: "1.2.0",
    };
    const asset = release.assets[0];
    const metadata = buildReleaseMetadata(release, asset);

    expect(metadata.version).toBe("1.2.0");
    expect(metadata.tag_name).toBe("1.2.0");
  });
});

describe("fetchLatestRelease", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("calls GitHub API with correct auth header", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockRelease),
    });
    vi.stubGlobal("fetch", mockFetch);

    await fetchLatestRelease("test-token");

    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.github.com/repos/melrefaiy2018/FlowSpace/releases/latest",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer test-token",
        }),
      })
    );
  });

  it("throws on non-ok response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        statusText: "Not Found",
      })
    );

    await expect(fetchLatestRelease("bad-token")).rejects.toThrow(
      "GitHub API error: 404 Not Found"
    );
  });
});

describe("getAssetRedirectUrl", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the Location header on 302 redirect", async () => {
    const signedUrl = "https://objects.githubusercontent.com/signed-url";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        status: 302,
        headers: new Map([["Location", signedUrl]]) as unknown as Headers,
      })
    );

    const asset: ReleaseAsset = mockRelease.assets[0];
    // Need to mock headers.get properly
    const mockHeaders = { get: vi.fn().mockReturnValue(signedUrl) };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        status: 302,
        headers: mockHeaders,
      })
    );

    const url = await getAssetRedirectUrl(asset, "test-token");
    expect(url).toBe(signedUrl);
  });

  it("uses redirect: manual to capture the 302", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      status: 302,
      headers: { get: () => "https://signed-url.com" },
    });
    vi.stubGlobal("fetch", mockFetch);

    const asset: ReleaseAsset = mockRelease.assets[0];
    await getAssetRedirectUrl(asset, "test-token");

    expect(mockFetch).toHaveBeenCalledWith(
      asset.url,
      expect.objectContaining({
        redirect: "manual",
        headers: expect.objectContaining({
          Accept: "application/octet-stream",
        }),
      })
    );
  });

  it("throws when no redirect is returned", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        status: 200,
        headers: { get: () => null },
      })
    );

    const asset: ReleaseAsset = mockRelease.assets[0];
    await expect(getAssetRedirectUrl(asset, "test-token")).rejects.toThrow(
      "Expected 302 redirect"
    );
  });
});
