"use client"

import { useEffect, useCallback, useRef } from "react"
import { getTurnInstruction, type BacktrackState, type Breadcrumb } from "@/hooks/use-device-sensors"

interface BacktrackGuidanceOptions {
  backtrackState: BacktrackState
  currentHeading: number
  speak: (text: string, priority?: "polite" | "assertive") => void
  setStatusMessage: (msg: string) => void
  setIsPanicActive: (active: boolean) => void
}

export function useBacktrackGuidance({
  backtrackState,
  currentHeading,
  speak,
  setStatusMessage,
  setIsPanicActive,
}: BacktrackGuidanceOptions) {

  // --- Continuous heading guidance every 8 seconds ---
  const lastGuidanceRef = useRef(0)
  useEffect(() => {
    if (!backtrackState.isBacktracking || !backtrackState.currentSegment) return

    const interval = setInterval(() => {
      if (!backtrackState.currentSegment) return
      const now = Date.now()
      if (now - lastGuidanceRef.current < 12000) return
      lastGuidanceRef.current = now

      const { instruction, aligned } = getTurnInstruction(
        currentHeading,
        backtrackState.currentSegment.targetHeading
      )
      if (aligned) {
        speak(`${instruction}. ${backtrackState.stepsRemaining} steps remaining.`, "polite")
      } else {
        speak(`${instruction}. Then walk ${backtrackState.stepsRemaining} steps.`, "assertive")
      }
    }, 8000)

    return () => clearInterval(interval)
  }, [
    backtrackState.isBacktracking, backtrackState.currentSegment,
    backtrackState.stepsRemaining, currentHeading, speak,
  ])

  // --- Announce when backtracking reaches the starting position ---
  useEffect(() => {
    if (backtrackState.reachedStart) {
      speak("You have reached the starting position. You are safe.", "assertive")
      setStatusMessage("Reached starting position!")
      setIsPanicActive(false)
    }
  }, [backtrackState.reachedStart, speak, setStatusMessage, setIsPanicActive])

  // --- Announce new directional segments ---
  const prevSegmentIndexRef = useRef(-1)
  useEffect(() => {
    if (!backtrackState.isBacktracking || !backtrackState.currentSegment) return
    if (backtrackState.currentSegmentIndex === prevSegmentIndexRef.current) return
    prevSegmentIndexRef.current = backtrackState.currentSegmentIndex

    if (backtrackState.currentSegmentIndex > 0) {
      const { instruction } = getTurnInstruction(
        currentHeading,
        backtrackState.currentSegment.targetHeading
      )
      speak(
        `Segment ${backtrackState.currentSegmentIndex + 1} of ${backtrackState.totalSegments}. ${instruction}. Walk ${backtrackState.stepsRemaining} steps.`,
        "assertive"
      )
    }
  }, [
    backtrackState.currentSegmentIndex, backtrackState.isBacktracking,
    backtrackState.currentSegment, backtrackState.stepsRemaining,
    backtrackState.totalSegments, currentHeading, speak,
  ])
}

interface PanicHandlerOptions {
  isPanicActive: boolean
  breadcrumbs: Breadcrumb[]
  speak: (text: string, priority?: "polite" | "assertive") => void
  setIsPanicActive: (active: boolean) => void
  setScreen: (screen: "home" | "navigate" | "emergency") => void
  setStatusMessage: (msg: string) => void
  startBacktracking: (breadcrumbs: Breadcrumb[]) => boolean
  stopBacktracking: () => void
}

/**
 * Creates the panic button toggle handler.
 * Activates emergency mode with backtracking, or deactivates it.
 */
export function usePanicHandler({
  isPanicActive, breadcrumbs, speak,
  setIsPanicActive, setScreen, setStatusMessage,
  startBacktracking, stopBacktracking,
}: PanicHandlerOptions) {
  return useCallback(() => {
    if (isPanicActive) {
      setIsPanicActive(false)
      stopBacktracking()
      setScreen("navigate")
      speak("Emergency mode deactivated. Resuming navigation.", "assertive")
      setStatusMessage("Navigation resumed")
    } else {
      setIsPanicActive(true)
      setScreen("emergency")
      if (breadcrumbs.length > 0) {
        startBacktracking(breadcrumbs)
        speak(
          `Emergency mode activated. Retracing ${breadcrumbs.length} steps to the starting position. Follow audio cues carefully. Stay calm.`,
          "assertive"
        )
      } else {
        speak("Emergency mode activated. No path recorded. Stay calm and call for help.", "assertive")
      }
      setStatusMessage("EMERGENCY MODE ACTIVE")
    }
  }, [isPanicActive, speak, breadcrumbs, startBacktracking, stopBacktracking, setIsPanicActive, setScreen, setStatusMessage])
}
