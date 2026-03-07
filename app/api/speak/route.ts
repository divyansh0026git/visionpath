import { NextRequest, NextResponse } from "next/server";
import { spawn, execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

const PIPER_MODEL = process.env.PIPER_MODEL_PATH || `${process.env.HOME || '/home/kali'}/.local/share/piper-voices/en_US-amy-medium.onnx`;
const PIPER_SAMPLE_RATE = 22050;  // medium model uses 22050 Hz

export async function POST(req: NextRequest) {
    try {
        const { text } = await req.json();

        if (!text || typeof text !== "string") {
            return NextResponse.json({ error: "No text provided" }, { status: 400 });
        }

        const safeText = text.slice(0, 500);

        let wavBuffer: Buffer;

        try {
            wavBuffer = await piperSpeak(safeText);
        } catch (e) {
            console.warn("[/api/speak] Piper failed, falling back to espeak-ng:", e);
            const { stdout } = await execFileAsync(
                "espeak-ng",
                ["--stdout", "-v", "en-us", "-s", "220", "-a", "100", safeText],
                { encoding: "buffer", maxBuffer: 2 * 1024 * 1024, timeout: 10000 }
            );
            wavBuffer = stdout;
        }

        return new NextResponse(new Uint8Array(wavBuffer), {
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

/** Spawn Piper, pipe text to stdin, collect raw PCM from stdout, wrap as WAV */
function piperSpeak(text: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        const proc = spawn("piper", [
            "--model", PIPER_MODEL,
            "--output-raw",
            "--length-scale", "0.8",
        ], { stdio: ["pipe", "pipe", "pipe"] });

        const chunks: Buffer[] = [];
        let stderr = "";

        proc.stdout!.on("data", (chunk: Buffer) => chunks.push(chunk));
        proc.stderr!.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });

        proc.on("close", (code) => {
            if (code !== 0) return reject(new Error(`Piper exited ${code}: ${stderr}`));
            const pcm = Buffer.concat(chunks);
            if (pcm.length === 0) return reject(new Error("Piper produced no audio"));
            resolve(wrapPCMInWav(pcm, PIPER_SAMPLE_RATE, 1, 16));
        });

        proc.on("error", reject);

        const timer = setTimeout(() => {
            proc.kill("SIGKILL");
            reject(new Error("Piper timed out"));
        }, 10000);
        proc.on("close", () => clearTimeout(timer));

        // Feed text and close stdin — piper processes and exits
        proc.stdin!.end(text);
    });
}

/** Wrap raw PCM samples in a WAV header */
function wrapPCMInWav(pcm: Buffer, sampleRate: number, channels: number, bitsPerSample: number): Buffer {
    const byteRate = sampleRate * channels * (bitsPerSample / 8);
    const blockAlign = channels * (bitsPerSample / 8);
    const header = Buffer.alloc(44);
    header.write("RIFF", 0);
    header.writeUInt32LE(36 + pcm.length, 4);
    header.write("WAVE", 8);
    header.write("fmt ", 12);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(channels, 22);
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(byteRate, 28);
    header.writeUInt16LE(blockAlign, 32);
    header.writeUInt16LE(bitsPerSample, 34);
    header.write("data", 36);
    header.writeUInt32LE(pcm.length, 40);
    return Buffer.concat([header, pcm]);
}
