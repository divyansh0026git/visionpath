const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
// Load native C++ TF backend FIRST — gives 5-10x speedup over pure JS
require("@tensorflow/tfjs-node");
const tf = require("@tensorflow/tfjs");
const cocoSsd = require("@tensorflow-models/coco-ssd");
const faceapi = require("@vladmandic/face-api");
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
let faceModelsLoaded = false;

// --- Face storage ---
const FACES_FILE = path.join(__dirname, "faces.json");
let knownFaces = []; // { name: string, descriptor: number[] }

function loadKnownFaces() {
  try {
    if (fs.existsSync(FACES_FILE)) {
      knownFaces = JSON.parse(fs.readFileSync(FACES_FILE, "utf-8"));
      console.log(`[BACKEND] Loaded ${knownFaces.length} known face(s).`);
    }
  } catch (e) {
    console.warn("[BACKEND] Failed to load faces:", e.message);
  }
}

function saveKnownFaces() {
  try {
    fs.writeFileSync(FACES_FILE, JSON.stringify(knownFaces, null, 2));
  } catch (e) {
    console.warn("[BACKEND] Failed to save faces:", e.message);
  }
}

/**
 * Load face-api.js models for detection + landmarks + recognition.
 */
async function loadFaceModels() {
  try {
    const modelPath = path.join(__dirname, "node_modules", "@vladmandic", "face-api", "model");
    if (!fs.existsSync(modelPath)) {
      console.warn("[BACKEND] Face-api model path not found — face recognition disabled.");
      return;
    }
    await faceapi.nets.ssdMobilenetv1.loadFromDisk(modelPath);
    await faceapi.nets.faceLandmark68Net.loadFromDisk(modelPath);
    await faceapi.nets.faceRecognitionNet.loadFromDisk(modelPath);
    faceModelsLoaded = true;
    loadKnownFaces();
    console.log("[BACKEND] Face recognition models loaded.");
  } catch (e) {
    console.error("[BACKEND] Failed to load face models:", e.message);
  }
}

/**
 * Load the COCO-SSD model once at startup.
 * Subsequent requests reuse the cached model instance.
 */
async function loadModel() {
  if (!model) {
    console.log("[BACKEND] Loading COCO-SSD model...");
    model = await cocoSsd.load({ base: "lite_mobilenet_v2" });
    console.log("[BACKEND] COCO-SSD model loaded. Running warmup inference...");
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
  res.json({ status: "ok", modelLoaded: model !== null, faceModelsLoaded });
});

/**
 * Helper: decode base64 image to a raw buffer.
 */
function decodeBase64ToBuffer(base64String) {
  const commaIdx = base64String.indexOf(",");
  const base64Data = commaIdx !== -1 ? base64String.substring(commaIdx + 1) : base64String;
  return Buffer.from(base64Data, "base64");
}

/**
 * POST /face/register
 * Register a person's face with a name.
 * Accepts: { image: "<base64>", name: "Person Name" }
 */
app.post("/face/register", async (req, res) => {
  if (!faceModelsLoaded) {
    return res.status(503).json({ success: false, message: "Face recognition not available yet" });
  }

  const { image, name } = req.body;
  if (!image || !name || typeof name !== "string") {
    return res.status(400).json({ success: false, message: "Missing image or name" });
  }

  let tensor = null;
  try {
    const imageBuffer = decodeBase64ToBuffer(image);
    const { data, info } = await sharp(imageBuffer)
      .resize({ width: 640, height: 480, fit: "inside" })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    tensor = tf.tensor3d(new Uint8Array(data), [info.height, info.width, 3]);

    const detections = await faceapi
      .detectAllFaces(tensor, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.5 }))
      .withFaceLandmarks()
      .withFaceDescriptors();

    if (detections.length === 0) {
      return res.json({ success: false, message: "No face detected. Make sure the person is facing the camera." });
    }

    // Pick the largest face (closest person)
    const best = detections.reduce((a, b) =>
      a.detection.box.area > b.detection.box.area ? a : b
    );

    const trimmedName = name.trim().substring(0, 50);

    // Remove existing entries for this name (allow re-registration)
    knownFaces = knownFaces.filter(f => f.name.toLowerCase() !== trimmedName.toLowerCase());
    knownFaces.push({ name: trimmedName, descriptor: Array.from(best.descriptor) });
    saveKnownFaces();

    console.log(`[BACKEND] Registered face: ${trimmedName}`);
    return res.json({ success: true, message: `Registered ${trimmedName}` });
  } catch (err) {
    console.error("[BACKEND] Face register error:", err.message);
    return res.status(500).json({ success: false, message: "Face registration failed" });
  } finally {
    if (tensor) tensor.dispose();
  }
});

/**
 * POST /face/recognize
 * Recognize faces in an image against stored descriptors.
 * Accepts: { image: "<base64>" }
 * Returns: { faces: [{ name, confidence, box }] }
 */
app.post("/face/recognize", async (req, res) => {
  if (!faceModelsLoaded || knownFaces.length === 0) {
    return res.json({ faces: [] });
  }

  const { image } = req.body;
  if (!image) return res.json({ faces: [] });

  let tensor = null;
  try {
    const imageBuffer = decodeBase64ToBuffer(image);
    const { data, info } = await sharp(imageBuffer)
      .resize({ width: 640, height: 480, fit: "inside" })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    tensor = tf.tensor3d(new Uint8Array(data), [info.height, info.width, 3]);

    const detections = await faceapi
      .detectAllFaces(tensor, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.5 }))
      .withFaceLandmarks()
      .withFaceDescriptors();

    if (detections.length === 0) {
      return res.json({ faces: [] });
    }

    const results = detections.map(d => {
      let bestName = "unknown";
      let bestDist = 1.0;

      for (const known of knownFaces) {
        const dist = faceapi.euclideanDistance(d.descriptor, new Float32Array(known.descriptor));
        if (dist < bestDist) {
          bestDist = dist;
          bestName = known.name;
        }
      }

      return {
        name: bestDist < 0.6 ? bestName : "unknown",
        confidence: parseFloat(Math.max(0, 1 - bestDist).toFixed(3)),
        box: {
          x: Math.round(d.detection.box.x),
          y: Math.round(d.detection.box.y),
          width: Math.round(d.detection.box.width),
          height: Math.round(d.detection.box.height),
        },
      };
    });

    return res.json({ faces: results });
  } catch (err) {
    console.error("[BACKEND] Face recognize error:", err.message);
    return res.json({ faces: [] });
  } finally {
    if (tensor) tensor.dispose();
  }
});

// --- Start server & pre-load models ---
app.listen(PORT, async () => {
  console.log(`[BACKEND] Server running on http://127.0.0.1:${PORT}`);
  try {
    await loadModel();
  } catch (err) {
    console.error("[BACKEND] Failed to pre-load COCO-SSD:", err.message || err);
  }
  // Load face models in parallel (non-blocking for object detection)
  loadFaceModels().catch(err => {
    console.error("[BACKEND] Face model loading failed:", err.message || err);
  });
});
