import { NextResponse } from "next/server";
import {
  fetchLatestRelease,
  findDmgAsset,
  getAssetRedirectUrl,
} from "@/lib/github";

export async function GET() {
  const token = process.env.GITHUB_TOKEN;

  if (!token) {
    return NextResponse.json(
      { error: "Server configuration error: missing GITHUB_TOKEN" },
      { status: 500 }
    );
  }

  try {
    const release = await fetchLatestRelease(token);
    const dmgAsset = findDmgAsset(release);

    if (!dmgAsset) {
      return NextResponse.json(
        { error: "No .dmg asset found in the latest release" },
        { status: 404 }
      );
    }

    // Get the signed S3 URL from GitHub and redirect the client to it.
    // This avoids streaming the ~80MB DMG through Vercel's serverless function.
    const signedUrl = await getAssetRedirectUrl(dmgAsset, token);

    return NextResponse.redirect(signedUrl, 302);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
