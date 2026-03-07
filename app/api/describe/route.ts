import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

const client = new OpenAI({
    baseURL: "https://models.inference.ai.github.com",
    apiKey: process.env.GITHUB_TOKEN,
});

export async function POST(req: NextRequest) {
    try {
        const { image, mode = "describe" } = await req.json();

        if (!image) {
            return NextResponse.json({ error: "No image provided" }, { status: 400 });
        }

        // Reject oversized payloads (5MB base64 ≈ ~3.75MB raw image)
        if (typeof image !== 'string' || image.length > 5 * 1024 * 1024) {
            return NextResponse.json({ error: "Image too large (max 5MB)" }, { status: 413 });
        }

        if (!process.env.GITHUB_TOKEN) {
            return NextResponse.json({ error: "GITHUB_TOKEN is not configured" }, { status: 500 });
        }

        const prompt =
            mode === "detect"
                ? `You are an object detection system for a visually impaired user. Look at this image and return a JSON array of up to 6 objects visible in the scene. Only include solid, real objects (e.g. person, chair, table, door, wall, laptop, bottle). Do NOT include lights, lamps, or ceiling fixtures. For each object include: "class" (a short lowercase label like "person"), "score" (confidence 0.0-1.0), and "bbox" ([ymin, xmin, ymax, xmax] normalized 0-1000). Return ONLY a raw JSON array, no markdown, no code blocks.`
                : mode === "text"
                    ? `You are an accessibility assistant for a visually impaired user. Please read and extract any visible text in this image clearly and concisely. If there is no text, reply: "No text detected."`
                    : `You are an accessibility assistant for a visually impaired user navigating indoors. In one concise comma-separated list (under 15 words), name the main objects, furniture, or obstacles visible. Do not include lights or ceiling fixtures. If nothing is clear, reply: Nothing clear detected.`;

        // Ensure the image has a proper data URI prefix
        const imageUrl = image.includes(",") ? image : `data:image/jpeg;base64,${image}`;

        const response = await client.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                {
                    role: "user",
                    content: [
                        { type: "text", text: prompt },
                        { type: "image_url", image_url: { url: imageUrl, detail: "low" } },
                    ],
                },
            ],
            max_tokens: 512,
        });

        const text = response.choices?.[0]?.message?.content ?? "Nothing clear detected.";
        return NextResponse.json({ result: text });
    } catch (error: any) {
        const errMsg = String(error?.message || error?.statusText || error || "");
        console.error("[/api/describe] Error:", errMsg);

        if (/rate.?limit|quota|429/i.test(errMsg) || error?.status === 429 || error?.code === 429) {
            return NextResponse.json({ error: "Rate limit exceeded", details: errMsg }, { status: 429 });
        }

        return NextResponse.json(
            { error: "Failed to process image", details: errMsg },
            { status: 500 }
        );
    }
}
