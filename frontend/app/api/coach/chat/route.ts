import type { NextRequest } from "next/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 300

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000"

// Proxy the chat SSE stream straight through to the backend. A dedicated route
// handler is required because Next's rewrites() proxy buffers streaming
// responses, which made the reply arrive all-at-once instead of token-by-token.
// Route handlers take precedence over afterFiles rewrites, so this intercepts
// /api/coach/chat while every other /api/* path still falls through to rewrites.
export async function POST(req: NextRequest) {
  const body = await req.text()

  const backendRes = await fetch(`${BACKEND_URL}/api/coach/chat${req.nextUrl.search}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  })

  // Stream the upstream body through unbuffered. Status is forwarded so the
  // client's non-2xx error path still works (it reads the body as text), and
  // no-transform keeps any proxy/compression layer from re-buffering the stream.
  return new Response(backendRes.body, {
    status: backendRes.status,
    headers: {
      "Content-Type": backendRes.headers.get("content-type") || "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  })
}
