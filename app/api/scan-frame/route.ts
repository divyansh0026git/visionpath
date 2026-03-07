import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const BACKEND_URL = process.env.BACKEND_URL || "http://127.0.0.1:5001";  // server-side only

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();

        if (!body.image) {
            return NextResponse.json({ error: "No image provided" }, { status: 400 });
        }

        if (typeof body.image !== "string" || body.image.length > 5 * 1024 * 1024) {
            return NextResponse.json({ error: "Image too large (max 5MB)" }, { status: 413 });
        }

        const res = await fetch(`${BACKEND_URL}/detect`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ image: body.image }),
            signal: AbortSignal.timeout(15000),
        });

        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            return NextResponse.json(
                { error: "Backend detection failed", details: err },
                { status: res.status }
            );
        }

        const data = await res.json();
        return NextResponse.json(data);
    } catch (error: any) {
        console.error("[/api/detect] Error:", error?.message || error);
        return NextResponse.json(
            { error: "Detection service unavailable", details: String(error?.message || error) },
            { status: 502 }
        );
    }
}
