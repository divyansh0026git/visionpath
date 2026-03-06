const express = require("express");
const cors = require("cors");
// Load native C++ TF backend FIRST — gives 5-10x speedup over pure JS
require("@tensorflow/tfjs-node");
const tf = require("@tensorflow/tfjs");
const cocoSsd = require("@tensorflow-models/coco-ssd");
const sharp = require("sharp");
const { Buffer } = require("buffer");

const app = express();
const PORT = process.env.BACKEND_PORT || 5001;

// Allow large base64 payloads (up to 10MB)
app.use(express.json({ limit: "10mb" }));
app.use(cors({
  origin: true,
}));

let model = null;

/**
 * Load the COCO-SSD model once at startup.
 * Subsequent requests reuse the cached model instance.
 */
async function loadModel() {
  if (!model) {
    console.log("[BACKEND] Loading COCO-SSD model...");
    model = await cocoSsd.load({ base: "lite_mobilenet_v2" });
    console.log("[BACKEND] COCO-SSD model loaded. Running warmup inference...");
    // Warmup: run a dummy detection to trigger JIT graph compilation.
    // Without this, the first real detection can take 10-15+ seconds on pure CPU TF.js.
    const dummyTensor = tf.zeros([320, 320, 3], "int32");
    try {
      await model.detect(dummyTensor);
      console.log("[BACKEND] Warmup inference complete.");
    } catch (e) {
      console.warn("[BACKEND] Warmup inference failed (non-critical):", e.message);
    } finally {
      dummyTensor.dispose();
    }
  }
  return model;
}

/**
 * Decode a base64-encoded JPEG/PNG image into a 3D TensorFlow tensor.
 * Uses sharp for image decoding (works on all Node.js versions).
 * Supports both raw base64 and data-URI prefixed strings.
 */
async function decodeBase64Image(base64String) {
  // Strip data URI prefix if present (e.g. "data:image/jpeg;base64,...")
  const commaIdx = base64String.indexOf(",");
  const base64Data = commaIdx !== -1 ? base64String.substring(commaIdx + 1) : base64String;

  const imageBuffer = Buffer.from(base64Data, "base64");

  // Use sharp to decode and resize for faster inference
  // 320×320 is optimal for lite_mobilenet_v2 (designed for 300×300 input)
  const { data, info } = await sharp(imageBuffer)
    .resize({ width: 320, height: 320, fit: 'inside', withoutEnlargement: true })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  // Create a 3D tensor [height, width, 3] from raw pixel data
  return tf.tensor3d(new Uint8Array(data), [info.height, info.width, 3]);
}

/**
 * POST /detect
 * Accepts: { image: "<base64 encoded image>" }
 * Returns: { objects: [{ class, score, bbox: [x, y, width, height] }] }
 */
app.post("/detect", async (req, res) => {
  const { image } = req.body;

  if (!image) {
    return res.status(400).json({ error: "No image provided" });
  }

  let imageTensor = null;

  try {
    const detector = await loadModel();

    imageTensor = await decodeBase64Image(image);

    // Use tf.tidy for automatic tensor cleanup during inference
    // 30 max detections, 0.25 min score — wider coverage for everyday objects
    const predictions = await detector.detect(imageTensor, 30, 0.25);

    // Format predictions to match the expected client-side schema
    const objects = predictions.map((pred) => ({
      class: pred.class,
      score: parseFloat(pred.score.toFixed(3)),
      bbox: pred.bbox, // [x, y, width, height]
    }));

    return res.json({ objects });
  } catch (err) {
    console.error("[BACKEND] Detection error:", err.message || err);
    return res.status(500).json({
      error: "Detection failed",
      details: err.message || String(err),
    });
  } finally {
    // Always dispose the tensor to prevent memory leaks
    if (imageTensor) {
      imageTensor.dispose();
    }
  }
});

/**
 * GET /health
 * Simple health-check endpoint.
 */
app.get("/health", (_req, res) => {
  res.json({ status: "ok", modelLoaded: model !== null });
});

// --- Start server & pre-load model ---
app.listen(PORT, async () => {
  console.log(`[BACKEND] Server running on http://127.0.0.1:${PORT}`);
  try {
    await loadModel();
  } catch (err) {
    console.error("[BACKEND] Failed to pre-load model:", err.message || err);
    console.error("[BACKEND] Model will be loaded on first request instead.");
  }
});
