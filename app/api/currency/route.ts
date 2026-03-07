import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

const client = new OpenAI({
    baseURL: "https://models.inference.ai.github.com",
    apiKey: process.env.GITHUB_TOKEN,
});

export async function POST(req: NextRequest) {
    try {
        const { image } = await req.json();

        if (!image) {
            return NextResponse.json({ error: "No image provided" }, { status: 400 });
        }

        if (typeof image !== 'string' || image.length > 5 * 1024 * 1024) {
            return NextResponse.json({ error: "Image too large (max 5MB)" }, { status: 413 });
        }

        if (!process.env.GITHUB_TOKEN) {
            return NextResponse.json({ error: "GITHUB_TOKEN is not configured" }, { status: 500 });
        }

        const prompt = `You are an expert Indian currency identifier.
Look at the image and identify any Indian Rupee note or coin.
Respond with ONLY the denomination in plain words, e.g. "Ten Rupee Note" or "Five Rupee Coin".
Valid responses: One Rupee Coin, Two Rupee Coin, Five Rupee Coin, Ten Rupee Coin, Twenty Rupee Coin, Ten Rupee Note, Twenty Rupee Note, Fifty Rupee Note, One Hundred Rupee Note, Two Hundred Rupee Note, Five Hundred Rupee Note.
If no currency is clearly visible, respond ONLY with: No currency detected.`;

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
            max_tokens: 100,
        });

        const text = response.choices?.[0]?.message?.content ?? "No currency detected.";
        return NextResponse.json({ result: text });
    } catch (error: any) {
        const errMsg = String(error?.message || error || "");
        console.error("[/api/currency] Error:", errMsg);

        if (/rate.?limit|quota|429/i.test(errMsg) || error?.status === 429) {
            return NextResponse.json({ error: "Rate limit exceeded", details: errMsg }, { status: 429 });
        }

        return NextResponse.json({ error: "Failed to detect currency", details: errMsg }, { status: 500 });
    }
}
