"use client"

import { useState, useEffect, useCallback, useRef } from "react"

interface SensorData {
  heading: number
  steps: number
  isMoving: boolean
  isAbsoluteHeading: boolean // true if heading is relative to true north
}

export interface Breadcrumb {
  heading: number
  totalSteps: number // Cumulative step count at the time this breadcrumb was recorded
  timestamp: number
}

export interface BacktrackSegment {
  targetHeading: number   
  stepsRequired: number  
}

export interface BacktrackState {
  isBacktracking: boolean
  currentSegment: BacktrackSegment | null
  currentSegmentIndex: number
  totalSegments: number
  stepsRemaining: number
  totalStepsRemaining: number
  reachedStart: boolean
}

const HEADING_GROUP_TOLERANCE = 30 
function buildReturnSegments(breadcrumbs: Breadcrumb[]): BacktrackSegment[] {
  if (breadcrumbs.length === 0) return []

  // Reverse the breadcrumbs — we walk from last position back to first
  const reversed = [...breadcrumbs].reverse()

  const segments: BacktrackSegment[] = []
  let currentGroupHeading = (reversed[0].heading + 180) % 360
  let currentGroupSteps = 1

  for (let i = 1; i < reversed.length; i++) {
    const returnHeading = (reversed[i].heading + 180) % 360
    const diff = angleDifference(returnHeading, currentGroupHeading)

    if (Math.abs(diff) <= HEADING_GROUP_TOLERANCE) {
      // Same direction — extend the current segment
      currentGroupSteps += 1
    } else {
      // Direction changed — save current segment, start new one
      segments.push({
        targetHeading: currentGroupHeading,
        stepsRequired: currentGroupSteps,
      })
      currentGroupHeading = returnHeading
      currentGroupSteps = 1
    }
  }

  // Push the last segment
  segments.push({
    targetHeading: currentGroupHeading,
    stepsRequired: currentGroupSteps,
  })

  return segments
}

function angleDifference(a: number, b: number): number {
  let diff = a - b
  while (diff > 180) diff -= 360
  while (diff < -180) diff += 360
  return diff
}

export function getTurnInstruction(currentHeading: number, targetHeading: number): {
  instruction: string
  angleDelta: number
  aligned: boolean
} {
  const diff = angleDifference(targetHeading, currentHeading)
  const absDiff = Math.abs(diff)

  if (absDiff <= 15) {
    return { instruction: "Go straight ahead", angleDelta: diff, aligned: true }
  } else if (absDiff <= 45) {
    return {
      instruction: diff > 0 ? "Turn slightly right" : "Turn slightly left",
      angleDelta: diff,
      aligned: false,
    }
  } else if (absDiff <= 135) {
    return {
      instruction: diff > 0 ? `Turn right ${Math.round(absDiff)} degrees` : `Turn left ${Math.round(absDiff)} degrees`,
      angleDelta: diff,
      aligned: false,
    }
  } else {
    return {
      instruction: "Turn around",
      angleDelta: diff,
      aligned: false,
    }
  }
}

export function useDeviceSensors() {
  const [sensorData, setSensorData] = useState<SensorData>({
    heading: 0,
    steps: 0,
    isMoving: false,
    isAbsoluteHeading: false,
  })
  const [breadcrumbs, setBreadcrumbs] = useState<Breadcrumb[]>([])
  const [isTracking, setIsTracking] = useState(false)
  const lastAccelRef = useRef<number>(0)
  const lastStepTimeRef = useRef<number>(0)
  const stepThreshold = 1.2
  const stepCooldownMs = 350 // Minimum time between steps to prevent double-counting
  const stepsRef = useRef(0)
  const headingRef = useRef(0)

  // --- Fall detection state ---
  const [fallDetected, setFallDetected] = useState(false)
  const [fallCountdown, setFallCountdown] = useState(0)
  const fallImpactTimeRef = useRef(0)
  const fallStillSinceRef = useRef(0)
  const fallCountdownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const fallDetectedRef = useRef(false)

  // --- Backtracking state ---
  const [backtrackState, setBacktrackState] = useState<BacktrackState>({
    isBacktracking: false,
    currentSegment: null,
    currentSegmentIndex: 0,
    totalSegments: 0,
    stepsRemaining: 0,
    totalStepsRemaining: 0,
    reachedStart: false,
  })
  const segmentsRef = useRef<BacktrackSegment[]>([])
  const segmentIndexRef = useRef(0)
  const segmentStepsRemainingRef = useRef(0)
  const totalStepsRemainingRef = useRef(0)
  const isBacktrackingRef = useRef(false)

  // --- Sensor event listeners ---
  useEffect(() => {
    if (!isTracking) return

    let accelHandler: ((event: DeviceMotionEvent) => void) | null = null
    let orientHandler: ((event: DeviceOrientationEvent) => void) | null = null

    accelHandler = (event: DeviceMotionEvent) => {
      const acc = event.accelerationIncludingGravity
      if (!acc || acc.z === null || acc.y === null || acc.x === null) return

      const magnitude = Math.sqrt(acc.x ** 2 + acc.y ** 2 + acc.z ** 2)
      const delta = Math.abs(magnitude - lastAccelRef.current)
      const now = Date.now()

      // --- Fall detection: high impact (>3g ≈ ~30 m/s²) followed by stillness ---
      if (!fallDetectedRef.current) {
        if (magnitude > 30) {
          // Possible fall impact
          fallImpactTimeRef.current = now
          fallStillSinceRef.current = now
        } else if (fallImpactTimeRef.current > 0) {
          // After impact, check for stillness (low movement delta < 0.3)
          if (delta < 0.3) {
            if (fallStillSinceRef.current === 0) fallStillSinceRef.current = now
            // Still for 5 seconds after impact → fall detected
            if (now - fallStillSinceRef.current > 5000 && now - fallImpactTimeRef.current < 15000) {
              fallDetectedRef.current = true
              setFallDetected(true)
              // Start 10-second countdown
              let countdown = 10
              setFallCountdown(countdown)
              fallCountdownTimerRef.current = setInterval(() => {
                countdown -= 1
                setFallCountdown(countdown)
                if (countdown <= 0) {
                  if (fallCountdownTimerRef.current) clearInterval(fallCountdownTimerRef.current)
                  fallCountdownTimerRef.current = null
                }
              }, 1000)
              fallImpactTimeRef.current = 0
              fallStillSinceRef.current = 0
            }
          } else {
            // Movement resumed — reset fall detection
            fallStillSinceRef.current = 0
            if (now - fallImpactTimeRef.current > 15000) {
              fallImpactTimeRef.current = 0 // Impact too old, ignore
            }
          }
        }
      }

      if (delta > stepThreshold && (now - lastStepTimeRef.current) > stepCooldownMs) {
        lastStepTimeRef.current = now
        stepsRef.current += 1
        setSensorData((prev) => ({
          ...prev,
          steps: stepsRef.current,
          isMoving: true,
        }))

        if (isBacktrackingRef.current) {
          // --- BACKTRACKING MODE: consume steps from return path ---
          if (segmentStepsRemainingRef.current > 0) {
            segmentStepsRemainingRef.current -= 1
            totalStepsRemainingRef.current -= 1

            if (segmentStepsRemainingRef.current <= 0) {
              // Segment completed — advance to next
              segmentIndexRef.current += 1

              if (segmentIndexRef.current < segmentsRef.current.length) {
                const nextSeg = segmentsRef.current[segmentIndexRef.current]
                segmentStepsRemainingRef.current = nextSeg.stepsRequired

                setBacktrackState({
                  isBacktracking: true,
                  currentSegment: nextSeg,
                  currentSegmentIndex: segmentIndexRef.current,
                  totalSegments: segmentsRef.current.length,
                  stepsRemaining: nextSeg.stepsRequired,
                  totalStepsRemaining: totalStepsRemainingRef.current,
                  reachedStart: false,
                })
              } else {
                // All segments completed — reached start!
                setBacktrackState({
                  isBacktracking: false,
                  currentSegment: null,
                  currentSegmentIndex: 0,
                  totalSegments: 0,
                  stepsRemaining: 0,
                  totalStepsRemaining: 0,
                  reachedStart: true,
                })
                isBacktrackingRef.current = false
              }
            } else {
              // Update remaining steps in state
              setBacktrackState((prev) => ({
                ...prev,
                stepsRemaining: segmentStepsRemainingRef.current,
                totalStepsRemaining: totalStepsRemainingRef.current,
              }))
            }
          }
        } else {
          setBreadcrumbs((prev) => {
            const newCrumb: Breadcrumb = {
              heading: headingRef.current,
              totalSteps: stepsRef.current,
              timestamp: Date.now(),
            }
            const updated = [...prev, newCrumb]
            return updated.length > 1000 ? updated.slice(-1000) : updated
          })
        }
      } else {
        setSensorData((prev) => ({ ...prev, isMoving: false }))
      }

      lastAccelRef.current = magnitude
    }

    orientHandler = (event: any) => {
      if (typeof event.webkitCompassHeading !== "undefined") {
        headingRef.current = Math.round(event.webkitCompassHeading)
        setSensorData((prev) => ({ ...prev, heading: headingRef.current, isAbsoluteHeading: true }))
        return
      }

      if (event.absolute === true || event.type === "deviceorientationabsolute") {
        if (event.alpha !== null) {
          const heading = Math.round(360 - event.alpha) % 360
          headingRef.current = heading
          setSensorData((prev) => ({ ...prev, heading, isAbsoluteHeading: true }))
        }
      } else if (event.alpha !== null) {
        const heading = Math.round(360 - event.alpha) % 360
        headingRef.current = heading
        setSensorData((prev) => ({ ...prev, heading, isAbsoluteHeading: false }))
      }
    }

    if (typeof window !== "undefined") {
      window.addEventListener("devicemotion", accelHandler)

      if (typeof (window as any).ondeviceorientationabsolute !== "undefined") {
        window.addEventListener("deviceorientationabsolute", orientHandler)
      } else {
        window.addEventListener("deviceorientation", orientHandler)
      }
    }

    return () => {
      if (accelHandler) window.removeEventListener("devicemotion", accelHandler)
      if (orientHandler) {
        window.removeEventListener("deviceorientationabsolute", orientHandler)
        window.removeEventListener("deviceorientation", orientHandler)
      }
    }
  }, [isTracking])

  const startTracking = useCallback(() => {
    stepsRef.current = 0
    setBreadcrumbs([])
    setIsTracking(true)
    // Reset any backtracking state
    isBacktrackingRef.current = false
    setBacktrackState({
      isBacktracking: false,
      currentSegment: null,
      currentSegmentIndex: 0,
      totalSegments: 0,
      stepsRemaining: 0,
      totalStepsRemaining: 0,
      reachedStart: false,
    })
  }, [])

  const stopTracking = useCallback(() => {
    setIsTracking(false)
    isBacktrackingRef.current = false
  }, [])

  const startBacktracking = useCallback((currentBreadcrumbs: Breadcrumb[]) => {
    const segments = buildReturnSegments(currentBreadcrumbs)
    if (segments.length === 0) return false

    segmentsRef.current = segments
    segmentIndexRef.current = 0
    segmentStepsRemainingRef.current = segments[0].stepsRequired
    totalStepsRemainingRef.current = segments.reduce((sum, s) => sum + s.stepsRequired, 0)
    isBacktrackingRef.current = true

    setBacktrackState({
      isBacktracking: true,
      currentSegment: segments[0],
      currentSegmentIndex: 0,
      totalSegments: segments.length,
      stepsRemaining: segments[0].stepsRequired,
      totalStepsRemaining: totalStepsRemainingRef.current,
      reachedStart: false,
    })

    return true
  }, [])

  const stopBacktracking = useCallback(() => {
    isBacktrackingRef.current = false
    segmentsRef.current = []
    setBacktrackState({
      isBacktracking: false,
      currentSegment: null,
      currentSegmentIndex: 0,
      totalSegments: 0,
      stepsRemaining: 0,
      totalStepsRemaining: 0,
      reachedStart: false,
    })
  }, [])

  const dismissFall = useCallback(() => {
    fallDetectedRef.current = false
    setFallDetected(false)
    setFallCountdown(0)
    fallImpactTimeRef.current = 0
    fallStillSinceRef.current = 0
    if (fallCountdownTimerRef.current) {
      clearInterval(fallCountdownTimerRef.current)
      fallCountdownTimerRef.current = null
    }
  }, [])

  return {
    sensorData,
    breadcrumbs,
    isTracking,
    backtrackState,
    fallDetected,
    fallCountdown,
    startTracking,
    stopTracking,
    startBacktracking,
    stopBacktracking,
    dismissFall,
  }
}
