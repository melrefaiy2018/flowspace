# FlowSpace Website

This package is intentionally separate from the main FlowSpace app.

It is a standalone Next.js landing site that:

- renders the marketing website
- resolves the latest macOS `.dmg` from GitHub releases
- never runs the Tauri app itself

## Package boundary

Use the website package from inside `website/` only.

```bash
cd website
npm ci
npm run dev
```

Do not install website dependencies from the repository root. The root
`package.json` is for the desktop app, and `website/package.json` is for the
landing site only.

## Environment

Create `website/.env.local` with:

```bash
GITHUB_TOKEN=your_github_token_here
```

The token needs `contents:read` access so the website can find the latest
release and redirect downloads to the correct `.dmg`.
