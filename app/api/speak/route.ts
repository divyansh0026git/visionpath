import { NextRequest, NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

/**
 * POST /api/speak
 * Server-side TTS fallback using espeak-ng.
 * Returns audio/wav that the browser can play directly.
 * Used when browser's speechSynthesis has no voices loaded.
 */
export async function POST(req: NextRequest) {
    try {
        const { text, rate } = await req.json();

        if (!text || typeof text !== "string") {
            return NextResponse.json({ error: "No text provided" }, { status: 400 });
        }

        // Limit text length to prevent abuse
        const safeText = text.slice(0, 500);

        // espeak-ng speed: default 175 wpm, range 80-450
        const speed = rate && rate > 1 ? 190 : 170;

        // Generate WAV audio using espeak-ng
        const { stdout } = await execFileAsync(
            "espeak-ng",
            [
                "--stdout",       // Output WAV to stdout
                "-v", "en",       // English voice
                "-s", String(speed),
                "-a", "100",      // Volume (0-200)
                safeText,
            ],
            { encoding: "buffer", maxBuffer: 2 * 1024 * 1024, timeout: 10000 }
        );

        return new NextResponse(stdout, {
            headers: {
                "Content-Type": "audio/wav",
                "Cache-Control": "no-store",
            },
        });
    } catch (error: any) {
        console.error("[/api/speak] Error:", error?.message || error);
        return NextResponse.json(
            { error: "TTS generation failed", details: String(error?.message || error) },
            { status: 500 }
        );
    }
}
