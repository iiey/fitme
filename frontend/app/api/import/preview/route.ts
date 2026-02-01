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

  const data = await backendRes.json()
  return NextResponse.json(data, { status: backendRes.status })
}
