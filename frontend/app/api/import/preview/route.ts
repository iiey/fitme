import { type NextRequest, NextResponse } from "next/server"

export const runtime = "nodejs"
export const maxDuration = 300

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000"

// Streams the multipart body (uploaded .zip, or just a source path) to the
// backend preview endpoint, which inspects the export without importing it.
export async function POST(req: NextRequest) {
  const body = req.body
  if (!body) {
    return NextResponse.json({ detail: "No body" }, { status: 400 })
  }

  const backendRes = await fetch(`${BACKEND_URL}/api/import/preview`, {
    method: "POST",
    headers: { "content-type": req.headers.get("content-type") || "" },
    body: body,
    // @ts-expect-error -- Node fetch supports duplex streaming
    duplex: "half",
  })

  // Forward the backend response, tolerating a non-JSON body (e.g. an upstream
  // proxy error page) instead of throwing and masking it as an opaque 500.
  const text = await backendRes.text()
  try {
    return NextResponse.json(text ? JSON.parse(text) : null, { status: backendRes.status })
  } catch {
    return new NextResponse(text, {
      status: backendRes.status,
      headers: { "content-type": backendRes.headers.get("content-type") || "text/plain" },
    })
  }
}
