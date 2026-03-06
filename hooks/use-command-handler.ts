"use client"

import { useCallback, useRef, useEffect, type RefObject } from "react"
import { getCardinalDirection } from "@/lib/navigation"
import type { BacktrackState, Breadcrumb } from "@/hooks/use-device-sensors"
import type { BackgroundCameraHandle } from "@/components/background-camera"

type AppScreen = "home" | "navigate" | "emergency"

interface CommandActions {
  setScreen: (screen: AppScreen) => void
  setIsPanicActive: (active: boolean) => void
  setStatusMessage: (msg: string) => void
  setShowLiveCamera: (show: boolean) => void
  setTriggerPermissionRequest: (trigger: boolean) => void
  startTracking: () => void
  stopTracking: () => void
  startBacktracking: (breadcrumbs: Breadcrumb[]) => boolean
  stopBacktracking: () => void
  speak: (text: string, priority?: "polite" | "assertive") => void
}

interface CommandContext {
  sensorData: { heading: number; steps: number; isMoving: boolean }
  breadcrumbs: Breadcrumb[]
  backtrackState: BacktrackState
  emergencyNumber: string
  cameraRef: RefObject<BackgroundCameraHandle | null>
}

/**
 * Creates a voice command handler that dispatches recognized voice commands
 * to the appropriate app actions.
 */
export function useCommandHandler(
  actions: CommandActions,
  context: CommandContext
) {
  // Store actions and context in refs so the useCallback never goes stale
  const actionsRef = useRef(actions)
  useEffect(() => { actionsRef.current = actions })
  const contextRef = useRef(context)
  useEffect(() => { contextRef.current = context })

  const handleCommand = useCallback(
    (command: string) => {
      const {
        setScreen, setIsPanicActive, setStatusMessage, setShowLiveCamera,
        setTriggerPermissionRequest, startTracking, stopTracking,
        startBacktracking, stopBacktracking, speak,
      } = actionsRef.current
      const { sensorData, breadcrumbs, backtrackState, emergencyNumber, cameraRef } = contextRef.current
      const cmd = command.toLowerCase().trim()

      // Word-boundary match helper — prevents substring false positives
      const hasWord = (word: string) => new RegExp(`\\b${word}\\b`).test(cmd)
      const hasPhrase = (phrase: string) => cmd.includes(phrase)

      // --- Priority-ordered command matching (most specific first) ---

      // 1. Directional query (very specific phrase)
      if (hasPhrase("which way is")) {
        const targets: Record<string, number> = { north: 0, east: 90, south: 180, west: 270 }
        const targetStr = Object.keys(targets).find(k => hasWord(k))
        if (targetStr) {
          const targetHeading = targets[targetStr]
          const relative = (targetHeading - sensorData.heading + 360) % 360
          let directionText = "straight ahead"
          if (relative > 20 && relative < 160) directionText = "to your right"
          else if (relative >= 160 && relative <= 200) directionText = "behind you"
          else if (relative > 200 && relative < 340) directionText = "to your left"
          speak(`${targetStr} is ${directionText}.`, "assertive")
        } else {
          speak("I didn't catch the direction. Ask which way is north, south, east, or west.", "polite")
        }

      // 2. Currency detection (specific phrases)
      } else if (hasPhrase("what is this") || hasPhrase("read currency") || hasPhrase("identify cash") || hasPhrase("how much rupee")) {
        if (!cameraRef.current) {
          speak("Camera is not active. Say start to begin navigation first.", "assertive")
          return
        }
        const frameBase64 = cameraRef.current.captureFrame()
        if (!frameBase64) {
          speak("Failed to capture image. Please try again.", "assertive")
          return
        }
        speak("Reading...", "polite")
        fetch("/api/currency", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ image: frameBase64 })
        })
          .then(res => res.json())
          .then(data => {
            if (data.result) {
              speak(data.result, "assertive")
            } else {
              speak("Sorry, I couldn't identify that.", "polite")
            }
          })
          .catch(err => {
            console.error(err)
            speak("Error connecting to vision service.", "assertive")
          })

      // 3. Camera feed toggle (specific phrases — before generic "show"/"hide")
      } else if (hasPhrase("show feed") || hasPhrase("show camera") || hasPhrase("live feed")) {
        setShowLiveCamera(true)
        speak("Live camera feed is now visible on screen.", "polite")
      } else if (hasPhrase("hide feed") || hasPhrase("hide camera")) {
        setShowLiveCamera(false)
        speak("Live camera feed hidden.", "polite")

      // 4. Emergency call (requires "call" + context word)
      } else if (hasWord("call") && (hasWord("help") || hasWord("emergency") || hasPhrase("911"))) {
        speak(`Calling emergency contact: ${emergencyNumber}.`, "assertive")
        window.location.href = `tel:${emergencyNumber.replace(/[^\d+\-()\s]/g, "")}`
        setIsPanicActive(true)
        setScreen("emergency")
        setStatusMessage("EMERGENCY CALL ACTIVE")

      // 5. Emergency/panic mode (specific phrases)
      } else if (hasWord("emergency") || hasWord("panic") || hasPhrase("help me")) {
        setIsPanicActive(true)
        setScreen("emergency")
        if (breadcrumbs.length > 0) {
          startBacktracking(breadcrumbs)
          speak(`Emergency mode activated. Retracing ${breadcrumbs.length} steps to the starting position. Follow audio cues carefully.`, "assertive")
        } else {
          speak("Emergency mode activated. No path recorded yet. Stay calm and call for help.", "assertive")
        }
        setStatusMessage("EMERGENCY MODE ACTIVE")

      // 6. Permission grant (specific phrases)
      } else if (
        hasPhrase("enable camera") || hasPhrase("open camera") ||
        hasPhrase("enable microphone") || hasPhrase("enable mic") ||
        hasPhrase("give access") || hasPhrase("access camera") ||
        hasPhrase("camera access") || hasPhrase("mic access") ||
        hasWord("permission") || hasWord("permit") ||
        hasWord("grant") || hasWord("allow") ||
        (hasWord("yes") && hasWord("camera"))
      ) {
        speak("Requesting camera and microphone access. Please tap Allow when prompted.", "assertive")
        setTriggerPermissionRequest(true)

      // 7. Position status (word boundary — "where" won't match "there")
      } else if (hasPhrase("where am i") || hasWord("position") || (hasWord("my") && hasWord("status"))) {
        speak(
          `You are facing ${getCardinalDirection(sensorData.heading)}, heading ${sensorData.heading} degrees. You have taken ${sensorData.steps} steps.`,
          "assertive"
        )

      // 8. Backtracking (word boundary)
      } else if (hasPhrase("go back") || hasPhrase("come back") || hasWord("retrace") || hasPhrase("return to start")) {
        if (breadcrumbs.length === 0) {
          speak("No path recorded. Start navigation first to record breadcrumbs.", "assertive")
        } else if (backtrackState.isBacktracking) {
          speak(`Already retracing. ${backtrackState.totalStepsRemaining} steps remaining.`, "polite")
        } else {
          const started = startBacktracking(breadcrumbs)
          if (started) {
            setScreen("emergency")
            speak(`Retracing ${breadcrumbs.length} steps. Turn around and follow audio cues.`, "assertive")
            setStatusMessage("Retracing path...")
          } else {
            speak("Unable to build return path.", "assertive")
          }
        }

      // 9. Navigation stop (word boundary)
      } else if (hasWord("stop") || hasPhrase("end navigation") || hasWord("finish")) {
        stopTracking()
        stopBacktracking()
        setIsPanicActive(false)
        setScreen("home")
        setStatusMessage("Navigation stopped")
        speak("Navigation stopped. You are on the home screen.", "assertive")

      // 10. Navigation start (word boundary — "start" won't false trigger on "restart")
      } else if (hasWord("start") || hasWord("navigate") || hasPhrase("start scanning") || hasWord("scan")) {
        setScreen("navigate")
        startTracking()
        speak("Navigation started. Continuous scanning is active. Follow audio guidance.", "assertive")
        setStatusMessage("Navigating and scanning environment")

      // 11. Face registration — "add name John" or "remember John"
      } else if (hasPhrase("add name") || hasPhrase("remember face") || hasPhrase("remember name")) {
        const nameMatch = cmd.match(/(?:add name|remember face|remember name)\s+(.+)/)
        if (nameMatch && nameMatch[1] && nameMatch[1].trim().length > 0) {
          const personName = nameMatch[1].trim()
          if (!cameraRef.current) {
            speak("Camera not active. Start navigation first.", "assertive")
            return
          }
          const frame = cameraRef.current.captureFrame()
          if (!frame) {
            speak("Failed to capture image. Try again.", "assertive")
            return
          }
          speak(`Looking for a face to register as ${personName}...`, "polite")
          const backendHost = typeof window !== 'undefined' ? window.location.hostname : '127.0.0.1'
          fetch(`http://${backendHost}:5001/face/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ image: frame, name: personName }),
          })
            .then(r => r.json())
            .then(data => {
              if (data.success) {
                speak(`${personName} registered successfully. I will recognize them from now on.`, "assertive")
              } else {
                speak(data.message || "No face detected. Make sure the person is facing the camera.", "assertive")
              }
            })
            .catch(() => {
              speak("Error registering face. Please try again.", "assertive")
            })
        } else {
          speak("Say add name followed by the person's name. For example, add name John.", "polite")
        }

      // 12. Help (lowest priority — catches remaining "help" not captured above)
      } else if (hasWord("help") || hasWord("commands")) {
        speak(
          "Commands: allow, start, stop, show feed, call help, emergency, go back, where am I, read currency, add name followed by a person's name.",
          "polite"
        )
      }
    },
    [] // Stable — reads from refs
  )

  return handleCommand
}
