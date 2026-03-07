"use client"

import { useRef, useEffect, useState, forwardRef, useImperativeHandle } from "react"
import { RefreshCcw } from "lucide-react"
import { useObjectDetection } from "@/hooks/use-object-detection"
import { getBackendUrl } from "@/lib/backend-url"

export interface BackgroundCameraHandle {
    captureFrame: () => string | null;
}

interface BackgroundCameraProps {
    isNavigating: boolean
    speak: (text: string, priority?: "polite" | "assertive", pan?: number) => void
    showLiveView?: boolean
    lowPowerMode?: boolean
}

const BackgroundCameraInner = forwardRef<BackgroundCameraHandle, BackgroundCameraProps>(({ isNavigating, speak, showLiveView = false, lowPowerMode = false }, ref) => {
    const videoRef = useRef<HTMLVideoElement>(null)
    const overlayRef = useRef<HTMLCanvasElement>(null)
    const lastSpokenRef = useRef<Record<string, number>>({})
    const videoSizeRef = useRef({ width: 0, height: 0 })
    const [facingMode, setFacingMode] = useState<"environment" | "user">("environment")
    const [cameraError, setCameraError] = useState<string | null>(null)

    // Face recognition state
    const faceRecogCooldownRef = useRef(0)
    const recognizedNamesRef = useRef<string[]>([])
    const backendUrlRef = useRef(getBackendUrl())
    const captureCanvasRef = useRef<HTMLCanvasElement | null>(null)

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
        invokeIntervalMs: lowPowerMode ? 800 : 150,
        onDescribeScene: (description: string) => {
            speak(`Scene: ${description}`, "polite");
        },
        onDetect: (objects: any[]) => {
            const now = Date.now()

            // Prune stale entries older than 30 seconds to prevent memory growth
            for (const key in lastSpokenRef.current) {
                if (now - lastSpokenRef.current[key] > 30000) {
                    delete lastSpokenRef.current[key]
                }
            }

            const confidentObjects = objects.filter(obj => obj.score > 0.5)
            if (confidentObjects.length === 0) return;

            const HAZARDS = new Set(['car', 'truck', 'bus', 'motorcycle', 'bicycle', 'train', 'boat', 'fire hydrant', 'horse', 'cow', 'elephant', 'bear'])
            const TRIP_HAZARDS = new Set(['backpack', 'suitcase', 'skateboard', 'sports ball', 'frisbee', 'handbag', 'skis', 'snowboard', 'surfboard', 'bowl', 'wall'])
            const SHARP_OBJECTS = new Set(['knife', 'scissors', 'fork', 'baseball bat'])
            const HOT_SURFACES = new Set(['oven', 'toaster', 'microwave'])
            const LARGE_OBSTACLES = new Set(['bench', 'chair', 'couch', 'bed', 'dining table', 'toilet', 'refrigerator', 'sink', 'parking meter', 'wall', 'door'])
            const VEHICLES = new Set(['car', 'truck', 'bus', 'motorcycle', 'bicycle', 'train'])
            const FRIENDLY_NAMES: Record<string, string> = {
                'traffic light': 'traffic light', 'fire hydrant': 'fire hydrant',
                'stop sign': 'stop sign', 'parking meter': 'parking meter',
                'sports ball': 'ball', 'baseball bat': 'bat', 'baseball glove': 'glove',
                'tennis racket': 'racket', 'wine glass': 'glass', 'hot dog': 'hot dog',
                'potted plant': 'plant', 'dining table': 'table', 'cell phone': 'phone',
                'teddy bear': 'teddy bear', 'hair drier': 'hair dryer',
            }
            const dangerVehicle = confidentObjects.find(o =>
                VEHICLES.has(o.class) && o.approaching && (o.approachSpeed || 0) > 3
            )
            if (dangerVehicle) {
                const lastDanger = lastSpokenRef.current['__danger_vehicle'] || 0
                if (now - lastDanger > 2000) {
                    const vname = FRIENDLY_NAMES[dangerVehicle.class] || dangerVehicle.class
                    // Urgent vibration pattern for danger
                    if (typeof navigator !== 'undefined' && navigator.vibrate) {
                        navigator.vibrate([200, 100, 200, 100, 200, 100, 200])
                    }
                    const dangerPan = dangerVehicle.position === 'left' ? -0.8
                        : dangerVehicle.position === 'right' ? 0.8
                            : 0
                    speak(`DANGER! ${vname} approaching fast! Move aside now!`, "assertive", dangerPan)
                    lastSpokenRef.current['__danger_vehicle'] = now
                    return
                }
            }

            // === Immediate Wall Detection ===
            const wallObject = confidentObjects.find(o => o.class === 'wall' && (o.estimatedSteps || 99) < 6)
            if (wallObject) {
                const lastWallSpoken = lastSpokenRef.current['wall'] || 0
                // High frequency alert for walls (every 3 seconds if close)
                if (now - lastWallSpoken > 3000) {
                    if (typeof navigator !== 'undefined' && navigator.vibrate) {
                        navigator.vibrate([150, 150]) // Double pulse for wall
                    }
                    const wallPan = wallObject.position === 'left' ? -0.5
                        : wallObject.position === 'right' ? 0.5
                            : 0;
                    speak(`Wall directly ahead.`, "assertive", wallPan)
                    lastSpokenRef.current['wall'] = now
                    // Don't return here so other objects can still be processed, 
                    // but we bypass the normal cooldown queue below for walls.
                }
            }
            const personObjects = confidentObjects.filter(o => o.class === 'person')
            if (personObjects.length >= 5) {
                if (now - (lastSpokenRef.current['__crowd'] || 0) > 10000) {
                    speak(`Large crowd ahead, about ${personObjects.length} people.`, "assertive")
                    lastSpokenRef.current['__crowd'] = now
                }
            } else if (personObjects.length >= 3) {
                if (now - (lastSpokenRef.current['__crowd'] || 0) > 10000) {
                    speak(`Group of ${personObjects.length} people ahead.`, "polite")
                    lastSpokenRef.current['__crowd'] = now
                }
            }

            // === Traffic detection ===
            const vehicleObjects = confidentObjects.filter(o => VEHICLES.has(o.class))
            if (vehicleObjects.length >= 3) {
                if (now - (lastSpokenRef.current['__traffic'] || 0) > 12000) {
                    speak(`Traffic ahead, ${vehicleObjects.length} vehicles.`, "assertive")
                    lastSpokenRef.current['__traffic'] = now
                }
            }

            // === Face recognition (periodic, non-blocking — disabled in low power mode) ===
            if (!lowPowerMode && personObjects.length > 0 && now - faceRecogCooldownRef.current > 3000) {
                faceRecogCooldownRef.current = now
                // Capture frame for face recognition
                const video = videoRef.current
                if (video && video.videoWidth > 0) {
                    if (!captureCanvasRef.current) captureCanvasRef.current = document.createElement('canvas')
                    const c = captureCanvasRef.current
                    c.width = video.videoWidth
                    c.height = video.videoHeight
                    const ctx = c.getContext('2d')
                    if (ctx) {
                        ctx.drawImage(video, 0, 0)
                        const frameB64 = c.toDataURL('image/jpeg', 0.8)
                        fetch(`${backendUrlRef.current}/face/recognize`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ image: frameB64 }),
                        })
                            .then(r => r.json())
                            .then(data => {
                                if (data.faces && data.faces.length > 0) {
                                    const names = data.faces
                                        .filter((f: any) => f.name !== 'unknown')
                                        .map((f: any) => f.name)
                                    recognizedNamesRef.current = names
                                    // Announce recognized persons
                                    names.forEach((name: string) => {
                                        const lastAnnounced = lastSpokenRef.current[`__face_${name}`] || 0
                                        if (now - lastAnnounced > 10000) {
                                            speak(`${name} is here.`, "polite")
                                            lastSpokenRef.current[`__face_${name}`] = Date.now()
                                        }
                                    })
                                } else {
                                    recognizedNamesRef.current = []
                                }
                            })
                            .catch(() => { }) // Silently fail — face recognition is optional
                    }
                }
            }

            // === Person approaching / leaving detection ===
            personObjects.forEach(person => {
                if (person.approaching && (person.approachSpeed || 0) > 1 && (person.estimatedSteps || 99) < 8) {
                    const lastApproach = lastSpokenRef.current['__person_approach'] || 0
                    if (now - lastApproach > 5000) {
                        const name = recognizedNamesRef.current.length > 0
                            ? recognizedNamesRef.current[0]
                            : 'Someone'
                        const posStr = person.position === 'left' ? ' from your left' :
                            person.position === 'right' ? ' from your right' : ''
                        speak(`${name} approaching${posStr}.`, "polite")
                        lastSpokenRef.current['__person_approach'] = now
                    }
                }
            })

            // === Standard object announcements ===
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

            const parts: string[] = []
            let hasHazard = false

            sortedGroups.forEach((group) => {
                const { count, closestSteps, latestObj } = group
                const objClass = latestObj.class
                const lastSpoken = lastSpokenRef.current[objClass] || 0

                // Skip persons here if crowd/approach already announced
                if (objClass === 'person' && personObjects.length >= 3) return
                // Skip wall here since it's handled immediately above
                if (objClass === 'wall') return

                const isHazard = HAZARDS.has(objClass)
                const isTripHazard = TRIP_HAZARDS.has(objClass) && closestSteps < 8
                const isSharp = SHARP_OBJECTS.has(objClass) && closestSteps < 6
                const isHot = HOT_SURFACES.has(objClass) && closestSteps < 5
                const isLargeObstacle = LARGE_OBSTACLES.has(objClass) && closestSteps < 10
                const isDangerous = isHazard || isTripHazard || isSharp || isHot

                // Fast-approaching vehicle gets shorter cooldown
                const isApproachingFast = VEHICLES.has(objClass) && latestObj.approaching && (latestObj.approachSpeed || 0) > 1.5

                let cooldownMs = 8000
                if (isApproachingFast) {
                    cooldownMs = 2000
                } else if (isHazard) {
                    cooldownMs = closestSteps < 10 ? 3000 : 5000
                } else if (isTripHazard || isSharp || isHot) {
                    cooldownMs = 4000
                } else if (isLargeObstacle) {
                    cooldownMs = closestSteps < 5 ? 4000 : 8000
                }

                if (now - lastSpoken > cooldownMs) {
                    const displayName = FRIENDLY_NAMES[objClass] || objClass
                    const distanceStr = closestSteps < 99 ? `${closestSteps} steps` : "ahead"
                    const countStr = count > 1 ? `${count} ${displayName}s` : displayName
                    let positionStr = "ahead"
                    if (latestObj.position === "left") positionStr = "on your left"
                    if (latestObj.position === "right") positionStr = "on your right"

                    let prefix = ""
                    if (isApproachingFast) prefix = "Warning, approaching "
                    else if (isHazard) prefix = "Caution, "
                    else if (isTripHazard) prefix = "Watch your step, "
                    else if (isSharp) prefix = "Careful, sharp object, "
                    else if (isHot) prefix = "Careful, hot surface, "
                    else if (isLargeObstacle) prefix = "Obstacle, "

                    parts.push(`${prefix}${countStr} ${positionStr}, ${distanceStr}`)
                    if (isDangerous || isApproachingFast) hasHazard = true
                    lastSpokenRef.current[objClass] = now
                }
            })

            // === Vibration feedback based on proximity ===
            if (typeof navigator !== 'undefined' && navigator.vibrate) {
                const closestSteps = sortedGroups.length > 0 ? sortedGroups[0].closestSteps : 99
                if (closestSteps < 3) {
                    navigator.vibrate(300) // Continuous long vibration — very close
                } else if (closestSteps < 6) {
                    navigator.vibrate([100, 50, 100, 50, 100]) // Fast triple pulse — medium
                } else if (closestSteps < 10 && hasHazard) {
                    navigator.vibrate([100, 200, 100]) // Slow double pulse — hazard approaching
                }
            }

            if (parts.length > 0) {
                // Spatial audio: pan based on closest object position
                const closestObj = sortedGroups[0]?.latestObj
                const pan = closestObj?.position === 'left' ? -0.7
                    : closestObj?.position === 'right' ? 0.7
                        : 0
                speak(parts.join(". ") + ".", hasHazard ? "assertive" : "polite", pan)
            }
        },
    })

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
