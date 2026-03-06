import { useState, useEffect, useRef, useCallback } from 'react';

export interface DetectedObject {
    class: string;
    score: number;
    bbox: [number, number, number, number];
    position?: "left" | "right" | "center";
    estimatedDistanceMeters?: number;
    estimatedSteps?: number;
}

interface UseObjectDetectionProps {
    isNavigating: boolean;
    videoRef: React.RefObject<HTMLVideoElement | null>;
    invokeIntervalMs?: number;
    onDetect?: (objects: DetectedObject[]) => void;
    onDescribeScene?: (description: string) => void;
}

const AVERAGE_HEIGHTS: Record<string, number> = {
    person: 1.7, man: 1.7, woman: 1.6, boy: 1.4, girl: 1.3, human: 1.6,
    chair: 0.9, table: 0.8, desk: 0.8,
    sofa: 0.9, couch: 0.9, bed: 0.6, door: 2.0, window: 1.5,
    laptop: 0.2, computer: 0.4, monitor: 0.4, tv: 0.6, television: 0.6,
    speaker: 0.3, socket: 0.1, 'power socket': 0.1, switch: 0.1,
    phone: 0.15, 'cell phone': 0.15, mobile: 0.15, bottle: 0.25,
    cup: 0.1, glass: 0.15, mug: 0.1,
    car: 1.5, truck: 3.5, bus: 3.0, motorcycle: 1.2, bicycle: 1.0,
    tree: 3.0, plant: 0.5, bag: 0.5, backpack: 0.5, box: 0.4,
    cat: 0.3, dog: 0.6, wall: 2.5,
};

export function useObjectDetection({
    isNavigating,
    videoRef,
    invokeIntervalMs = 500,
    onDetect,
    onDescribeScene,
}: UseObjectDetectionProps) {
    const [detectedObjects, setDetectedObjects] = useState<DetectedObject[]>([]);
    const [scanError, setScanError] = useState<string | null>(null);
    const [scanAttempts, setScanAttempts] = useState(0);

    // Request gate — only one API call in-flight at a time
    const isRequestInFlightRef = useRef(false);
    // How long to wait before next call (shorter initially, increases after success)
    const nextCallDelayMs = useRef(300);
    const lastCallTimeRef = useRef(0);
    const consecutiveFailsRef = useRef(0);
    const scanAttemptsRef = useRef(0);

    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const onDetectRef = useRef(onDetect);
    const onDescribeSceneRef = useRef(onDescribeScene);
    const distanceHistoryRef = useRef<Record<string, number[]>>({});

    // Build backend URL dynamically so it works on localhost AND mobile/LAN
    const backendUrlRef = useRef(
        typeof window !== 'undefined'
            ? `http://${window.location.hostname}:5001`
            : 'http://127.0.0.1:5001'
    );

    useEffect(() => { onDetectRef.current = onDetect; }, [onDetect]);
    useEffect(() => { onDescribeSceneRef.current = onDescribeScene; }, [onDescribeScene]);

    useEffect(() => {
        if (!canvasRef.current) {
            canvasRef.current = document.createElement('canvas');
        }
    }, []);

    const captureFrameBase64 = useCallback((): string | null => {
        const video = videoRef.current;
        if (!video || video.readyState < 2 || video.videoWidth === 0) return null;

        const canvas = canvasRef.current;
        if (!canvas) return null;

        // Scale down for faster encoding and lower API payload
        // 320px is optimal — matches backend resize target and lite_mobilenet_v2 input size
        const scale = Math.min(1, 320 / Math.max(video.videoWidth, video.videoHeight));
        canvas.width = Math.floor(video.videoWidth * scale);
        canvas.height = Math.floor(video.videoHeight * scale);

        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) return null;

        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        return canvas.toDataURL('image/jpeg', 0.5);
    }, [videoRef]);

    const runDetection = useCallback(async () => {
        if (!isNavigating || isRequestInFlightRef.current) return;

        const now = Date.now();
        if (now - lastCallTimeRef.current < nextCallDelayMs.current) return;

        const base64Image = captureFrameBase64();
        if (!base64Image) {
            console.log('[SCAN] Frame not ready yet, skipping...');
            return;
        }

        isRequestInFlightRef.current = true;
        lastCallTimeRef.current = now;

        scanAttemptsRef.current += 1;
        setScanAttempts(scanAttemptsRef.current);
        console.log(`[SCAN] Sending frame to backend (attempt #${scanAttemptsRef.current})...`);

        try {
            // Call backend directly — bypass Next.js proxy for lower latency
            const res = await fetch(`${backendUrlRef.current}/detect`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ image: base64Image }),
            });

            if (!res.ok) {
                const errData = await res.json().catch(() => ({}));
                console.error('[SCAN] API error:', res.status, errData);
                consecutiveFailsRef.current += 1;
                if (consecutiveFailsRef.current >= 3) {
                    setScanError(`Detection backend error (${res.status})`);
                }
                nextCallDelayMs.current = 4000;
                return;
            }

            const data = await res.json();

            // Reset delay and error state on success
            consecutiveFailsRef.current = 0;
            setScanError(null);
            nextCallDelayMs.current = 500;

            const items: any[] = data.objects || [];
            if (items.length === 0) {
                setDetectedObjects([]);
                // Scan faster when nothing detected yet
                nextCallDelayMs.current = 300;
                return;
            }

            const video = videoRef.current;
            if (!video) return;

            // COCO-SSD returns bboxes in the capture-frame coordinate space (320px).
            // Scale them back to original video coordinates for correct position
            // detection and overlay rendering.
            const captureScale = Math.min(1, 320 / Math.max(video.videoWidth, video.videoHeight));
            const invScale = 1 / captureScale;

            // Estimate focal length from video dimensions assuming ~60° vertical FOV
            const vfovRad = (60 * Math.PI) / 180;
            const focalLength = video.videoHeight / (2 * Math.tan(vfovRad / 2));

            const enhanced: DetectedObject[] = items
                .filter((item: any) => item && item.class && Array.isArray(item.bbox) && item.bbox.length === 4)
                .map((item: any) => {
                    const label = String(item.class).toLowerCase();

                    // Skip lights/ceiling items
                    if (/light|lamp|bulb|ceiling|fixture/i.test(label)) return null;

                    // bbox from COCO-SSD in capture-frame space → scale to video space
                    const xmin = item.bbox[0] * invScale;
                    const ymin = item.bbox[1] * invScale;
                    const bboxWidth = item.bbox[2] * invScale;
                    const bboxHeight = item.bbox[3] * invScale;

                    // Estimate distance (now both focalLength and bboxHeight are in video space)
                    let realHeight = 0.4;
                    for (const key in AVERAGE_HEIGHTS) {
                        if (label.includes(key)) { realHeight = AVERAGE_HEIGHTS[key]; break; }
                    }

                    const distanceM = bboxHeight > 0 ? (realHeight * focalLength) / bboxHeight : 99;
                    const rawSteps = Math.min(30, Math.max(1, Math.round(distanceM / 0.762)));

                    if (!distanceHistoryRef.current[label]) distanceHistoryRef.current[label] = [];
                    const history = distanceHistoryRef.current[label];
                    history.push(rawSteps);
                    if (history.length > 3) history.shift();
                    const smoothedSteps = Math.round(history.reduce((a, b) => a + b, 0) / history.length);

                    // Position uses video-space coordinates — thresholds now correct
                    const centerX = xmin + bboxWidth / 2;
                    let position: "left" | "right" | "center" = "center";
                    if (centerX < video.videoWidth / 3) position = "left";
                    else if (centerX > video.videoWidth * (2 / 3)) position = "right";

                    return {
                        class: label,
                        score: item.score ?? 0.85,
                        bbox: [xmin, ymin, bboxWidth, bboxHeight] as [number, number, number, number],
                        position,
                        estimatedDistanceMeters: smoothedSteps * 0.76,
                        estimatedSteps: smoothedSteps,
                    };
                })
                .filter(Boolean) as DetectedObject[];

            console.log(`[SCAN] Detected ${enhanced.length} objects`);
            setDetectedObjects(enhanced);

            if (onDetectRef.current && enhanced.length > 0) {
                onDetectRef.current(enhanced);
            }

        } catch (err) {
            console.error('[SCAN] Fetch error:', String(err));
            consecutiveFailsRef.current += 1;
            if (consecutiveFailsRef.current >= 3) {
                setScanError('Cannot reach detection service');
            }
            nextCallDelayMs.current = 4000;
        } finally {
            isRequestInFlightRef.current = false;
        }
    }, [isNavigating, captureFrameBase64, videoRef]);

    useEffect(() => {
        if (!isNavigating) {
            setDetectedObjects([]);
            setScanError(null);
            setScanAttempts(0);
            isRequestInFlightRef.current = false;
            nextCallDelayMs.current = 300;
            lastCallTimeRef.current = 0;
            distanceHistoryRef.current = {};
            consecutiveFailsRef.current = 0;
            scanAttemptsRef.current = 0;
            return;
        }

        // Poll rapidly; the time-gating inside runDetection controls actual API call frequency
        const id = setInterval(runDetection, invokeIntervalMs);
        return () => clearInterval(id);
    }, [isNavigating, invokeIntervalMs, runDetection]);

    return { detectedObjects, scanError, scanAttempts };
}
