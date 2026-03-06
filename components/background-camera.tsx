"use client"

import { useRef, useEffect, useState, forwardRef, useImperativeHandle } from "react"
import { RefreshCcw } from "lucide-react"
import { useObjectDetection } from "@/hooks/use-object-detection"

export interface BackgroundCameraHandle {
    captureFrame: () => string | null;
}

interface BackgroundCameraProps {
    isNavigating: boolean
    speak: (text: string, priority?: "polite" | "assertive") => void
    showLiveView?: boolean
}

const BackgroundCameraInner = forwardRef<BackgroundCameraHandle, BackgroundCameraProps>(({ isNavigating, speak, showLiveView = false }, ref) => {
    const videoRef = useRef<HTMLVideoElement>(null)
    const overlayRef = useRef<HTMLCanvasElement>(null)
    const lastSpokenRef = useRef<Record<string, number>>({})
    const videoSizeRef = useRef({ width: 0, height: 0 })
    const [facingMode, setFacingMode] = useState<"environment" | "user">("environment")
    const [cameraError, setCameraError] = useState<string | null>(null)

    // Initialize camera with abort signal to prevent race conditions
    useEffect(() => {
        if (!isNavigating) return

        // AbortController lets us cancel the async camera startup if the component unmounts
        const abortController = new AbortController()
        const signal = abortController.signal
        let stream: MediaStream | null = null

        async function startCamera(retryCount = 0) {
            if (signal.aborted) return

            try {
                if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                    throw new Error("getUserMedia not supported (requires HTTPS or localhost).")
                }

                setCameraError(null)

                let requestedStream: MediaStream | null = null
                try {
                    requestedStream = await navigator.mediaDevices.getUserMedia({
                        video: { facingMode: { ideal: facingMode }, width: { ideal: 640 }, height: { ideal: 480 } },
                    })
                } catch (initialErr: any) {
                    if (signal.aborted) return
                    console.warn("Camera initial request failed:", initialErr)

                    // Hard failures — don't retry
                    if (initialErr.name === 'NotAllowedError') {
                        setCameraError("Camera permission denied. Please grant access.")
                        return
                    }

                    // Soft failure — retry once with a basic constraint
                    if (retryCount === 0) {
                        console.log("Retrying camera with basic constraints...")
                        await new Promise(r => setTimeout(r, 300))
                        return startCamera(1)
                    }

                    requestedStream = await navigator.mediaDevices.getUserMedia({ video: true })
                }

                if (signal.aborted) {
                    requestedStream?.getTracks().forEach(t => t.stop())
                    return
                }

                stream = requestedStream

                if (videoRef.current && stream) {
                    videoRef.current.srcObject = stream

                    // Wait for video to have data before calling play
                    await new Promise<void>((resolve) => {
                        if (!videoRef.current) return resolve()
                        const onReady = () => {
                            videoRef.current?.removeEventListener('loadedmetadata', onReady)
                            resolve()
                        }
                        videoRef.current.addEventListener('loadedmetadata', onReady)
                        // If already ready
                        if (videoRef.current.readyState >= 1) resolve()
                    })

                    if (signal.aborted) return

                    try {
                        await videoRef.current?.play()
                    } catch (playErr: any) {
                        if (playErr.name === 'NotAllowedError') {
                            setCameraError("Autoplay blocked. Tap the screen to allow camera playback.")
                        } else if (playErr.name !== 'AbortError') {
                            console.warn("Camera play error (ignored):", playErr)
                        }
                    }
                }
            } catch (err: any) {
                if (signal.aborted || err.name === 'AbortError') return
                console.error("Background camera error:", err)
                setCameraError("Camera failed to start. Please try again.")
            }
        }

        startCamera()

        return () => {
            // Signal abortion immediately so any pending async operations bail out
            abortController.abort()
            if (stream) {
                stream.getTracks().forEach(t => t.stop())
            }
            // Clear video src to prevent memory leaks
            if (videoRef.current) {
                videoRef.current.srcObject = null
            }
        }
    }, [isNavigating, facingMode])

    const { detectedObjects, scanError, scanAttempts } = useObjectDetection({
        isNavigating,
        videoRef,
        invokeIntervalMs: 250,
        onDescribeScene: (description: string) => {
            speak(`Scene: ${description}`, "polite");
        },
        onDetect: (objects: any[]) => {
            const now = Date.now()

            // Prune stale entries older than 60 seconds to prevent memory growth
            for (const key in lastSpokenRef.current) {
                if (now - lastSpokenRef.current[key] > 60000) {
                    delete lastSpokenRef.current[key]
                }
            }

            const confidentObjects = objects.filter(obj => obj.score > 0.5)
            if (confidentObjects.length === 0) return;

            const groups: Record<string, { count: number, closestSteps: number, latestObj: any }> = {}

            confidentObjects.forEach((obj) => {
                const steps = obj.estimatedSteps || 99
                if (!groups[obj.class]) {
                    groups[obj.class] = { count: 1, closestSteps: steps, latestObj: obj }
                } else {
                    groups[obj.class].count += 1
                    groups[obj.class].closestSteps = Math.min(groups[obj.class].closestSteps, steps)
                }
            })

            const sortedGroups = Object.values(groups).sort((a, b) => a.closestSteps - b.closestSteps)
            const hazards = ['car', 'truck', 'bus', 'motorcycle', 'wall']

            // Collect messages — speak ONCE with all objects batched together
            const parts: string[] = []
            let hasHazard = false

            sortedGroups.forEach((group) => {
                const { count, closestSteps, latestObj } = group
                const objClass = latestObj.class
                const isHazard = hazards.includes(objClass)
                const lastSpoken = lastSpokenRef.current[objClass] || 0

                // Cooldowns: balanced for responsive guidance without spam
                let cooldownMs = 15000;
                if (isHazard) {
                    if (objClass === 'wall') {
                        cooldownMs = closestSteps < 5 ? 6000 : 12000;
                    } else {
                        cooldownMs = closestSteps < 10 ? 5000 : 10000;
                    }
                }

                if (now - lastSpoken > cooldownMs) {
                    const distanceStr = closestSteps < 99 ? `${closestSteps} steps` : "ahead"
                    const countStr = count > 1 && objClass !== 'wall' ? `${count} ${objClass}s` : objClass
                    const hazardPrefix = isHazard ? "Caution, " : ""
                    let positionStr = "ahead";
                    if (latestObj.position === "left") positionStr = "on your left";
                    if (latestObj.position === "right") positionStr = "on your right";

                    parts.push(`${hazardPrefix}${countStr} ${positionStr}, ${distanceStr}`)
                    if (isHazard) hasHazard = true
                    lastSpokenRef.current[objClass] = now
                }
            })

            // Single speak call with all detected objects
            if (parts.length > 0) {
                speak(parts.join(". ") + ".", hasHazard ? "assertive" : "polite")
            }
        },
    })

    const captureCanvasRef = useRef<HTMLCanvasElement | null>(null)

    useImperativeHandle(ref, () => ({
        captureFrame: () => {
            if (!videoRef.current) return null;
            const video = videoRef.current;
            if (video.videoWidth === 0 || video.videoHeight === 0) return null;
            if (!captureCanvasRef.current) captureCanvasRef.current = document.createElement("canvas");
            const canvas = captureCanvasRef.current;
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            const ctx = canvas.getContext("2d");
            if (!ctx) return null;
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            return canvas.toDataURL("image/jpeg", 0.9);
        }
    }));

    // Handle overlay drawing when detected objects change
    useEffect(() => {
        if (!showLiveView || !videoRef.current || !overlayRef.current) return

        const video = videoRef.current
        const canvas = overlayRef.current
        const ctx = canvas.getContext("2d")
        if (!ctx) return

        if (video.videoWidth === 0 || video.videoHeight === 0) {
            const handleLoadedMetadata = () => {
                videoSizeRef.current = { width: video.videoWidth, height: video.videoHeight }
            }
            video.addEventListener('loadedmetadata', handleLoadedMetadata)
            return () => video.removeEventListener('loadedmetadata', handleLoadedMetadata)
        }

        videoSizeRef.current = { width: video.videoWidth, height: video.videoHeight }

        // Match canvas resolution to container display size so bounding boxes align
        const container = canvas.parentElement
        if (!container) return
        const displayW = container.clientWidth
        const displayH = container.clientHeight
        canvas.width = displayW
        canvas.height = displayH
        ctx.clearRect(0, 0, displayW, displayH)

        // Compute the same object-cover scaling the <video> uses
        const videoAR = video.videoWidth / video.videoHeight
        const containerAR = displayW / displayH
        let scaleX: number, scaleY: number, offsetX: number, offsetY: number
        if (videoAR > containerAR) {
            // Video wider than container — cropped left/right
            scaleY = displayH / video.videoHeight
            scaleX = scaleY
            offsetX = (displayW - video.videoWidth * scaleX) / 2
            offsetY = 0
        } else {
            // Video taller — cropped top/bottom
            scaleX = displayW / video.videoWidth
            scaleY = scaleX
            offsetX = 0
            offsetY = (displayH - video.videoHeight * scaleY) / 2
        }

        detectedObjects.forEach((obj) => {
            if (obj.score > 0.4) {
                const [x, y, width, height] = obj.bbox
                const dx = x * scaleX + offsetX
                const dy = y * scaleY + offsetY
                const dw = width * scaleX
                const dh = height * scaleY
                ctx.strokeStyle = "#0ea5e9"
                ctx.lineWidth = 3
                ctx.strokeRect(dx, dy, dw, dh)
                ctx.fillStyle = "#0ea5e9"
                ctx.font = "14px sans-serif"
                const label = `${obj.class} ${Math.round(obj.score * 100)}%`
                const textWidth = ctx.measureText(label).width
                ctx.fillRect(dx, dy - 22, textWidth + 8, 22)
                ctx.fillStyle = "#ffffff"
                ctx.fillText(label, dx + 4, dy - 5)
            }
        })
    }, [detectedObjects, showLiveView])

    return (
        <div className={`relative ${showLiveView ? 'w-full max-w-lg aspect-[3/4] overflow-hidden rounded-2xl bg-black/10' : 'fixed -z-50 opacity-0 w-[1px] h-[1px] overflow-hidden pointer-events-none'}`}>
            <video
                ref={videoRef}
                className="absolute inset-0 h-full w-full object-cover"
                playsInline
                muted
                autoPlay
                aria-hidden="true"
            />
            {showLiveView && (
                <canvas
                    ref={overlayRef}
                    className="absolute inset-0 h-full w-full z-10"
                    aria-hidden="true"
                />
            )}
            {showLiveView && detectedObjects.length === 0 && !cameraError && !scanError && (
                <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/20 pointer-events-none">
                    <p className="text-white bg-black/50 px-3 py-1 rounded-full text-sm">
                        {scanAttempts === 0 ? "Starting camera..." : scanAttempts < 5 ? `Scanning... (${scanAttempts})` : "No objects detected \u2014 keep scanning"}
                    </p>
                </div>
            )}
            {showLiveView && scanError && (
                <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/30 pointer-events-none">
                    <p className="text-white bg-orange-600/80 px-4 py-2 rounded-full text-sm text-center">{scanError}</p>
                </div>
            )}
            {showLiveView && cameraError && (
                <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/40 pointer-events-none">
                    <p className="text-white bg-red-600/80 px-4 py-2 rounded-full text-sm text-center">{cameraError}</p>
                </div>
            )}
            {showLiveView && (
                <button
                    onClick={() => setFacingMode(prev => prev === "environment" ? "user" : "environment")}
                    className="absolute top-4 right-4 z-30 p-3 bg-black/50 text-white rounded-full hover:bg-black/70 transition-colors pointer-events-auto"
                    aria-label="Flip camera"
                >
                    <RefreshCcw className="w-6 h-6" />
                </button>
            )}
        </div>
    )
})

BackgroundCameraInner.displayName = "BackgroundCamera"

export const BackgroundCamera = BackgroundCameraInner
