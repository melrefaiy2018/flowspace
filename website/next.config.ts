import type { NextConfig } from "next";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  outputFileTracingRoot: __dirname,
  typescript: {
    // Type checking is done separately via `tsc --noEmit`
    ignoreBuildErrors: true,
  },
};

export default nextConfig;
