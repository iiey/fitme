import path from "node:path"
import { fileURLToPath } from "node:url"

/** @type {import('next').NextConfig} */
const backendUrl = process.env.BACKEND_URL || "http://localhost:8000"

const projectRoot = path.dirname(fileURLToPath(import.meta.url))

// The Next.js dev tools indicator sits in a screen corner and overlaps the
// chat panel's send button, so hide it by default. Set SHOW_DEV_INDICATOR=1 to
// bring it back, rendered top-right where it stays clear of the chat UI.
// (Dev-only; note that hiding it also hides the dev error overlay.)
const showDevIndicator = process.env.SHOW_DEV_INDICATOR === "1"

const nextConfig = {
  reactStrictMode: true,
  devIndicators: showDevIndicator ? { position: "top-right" } : false,
  // Emit a self-contained server build for the Docker runtime image.
  output: "standalone",
  // Pin file tracing to this directory. Without it, Next.js infers the
  // workspace root from the nearest lockfile and warns when it finds the
  // empty root-level package-lock.json alongside this app's lockfile.
  outputFileTracingRoot: projectRoot,
  async rewrites() {
    // Proxy API calls to the FastAPI backend during development and in the
    // single-container deployment, so the browser only ever talks to one origin.
    return [
      {
        source: "/api/:path*",
        destination: `${backendUrl}/api/:path*`,
      },
    ]
  },
}

export default nextConfig
