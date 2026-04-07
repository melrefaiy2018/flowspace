import { NextResponse } from "next/server";
import {
  fetchLatestRelease,
  findDmgAsset,
  buildReleaseMetadata,
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

    const metadata = buildReleaseMetadata(release, dmgAsset);

    return NextResponse.json(metadata, {
      headers: {
        "Cache-Control": "public, s-maxage=300, stale-while-revalidate=60",
      },
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
