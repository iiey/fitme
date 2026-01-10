/** @type {import('next').NextConfig} */
const backendUrl = process.env.BACKEND_URL || "http://localhost:8000";

const nextConfig = {
  reactStrictMode: true,
  // Emit a self-contained server build for the Docker runtime image.
  output: "standalone",
  async rewrites() {
    // Proxy API calls to the FastAPI backend during development and in the
    // single-container deployment, so the browser only ever talks to one origin.
    return [
      {
        source: "/api/:path*",
        destination: `${backendUrl}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
