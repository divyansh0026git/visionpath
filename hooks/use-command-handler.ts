"use client"

import { useCallback, useRef, useEffect, type RefObject } from "react"
import { getCardinalDirection } from "@/lib/navigation"
import { getBackendUrl } from "@/lib/backend-url"
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
  dismissFall: () => void
  saveEmergencyNumber: (num: string) => void
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
        startBacktracking, stopBacktracking, speak, dismissFall, saveEmergencyNumber
      } = actionsRef.current
      const { sensorData, breadcrumbs, backtrackState, emergencyNumber, cameraRef } = contextRef.current
      const cmd = command.toLowerCase().trim()

      // Word-boundary match helper — prevents substring false positives
      const hasWord = (word: string) => new RegExp(`\\b${word}\\b`).test(cmd)
      const hasPhrase = (phrase: string) => cmd.includes(phrase)

      // --- Priority-ordered command matching (most specific first) ---

      // 0. Cancel fall detection countdown
      if (hasWord("cancel") || hasPhrase("i'm okay") || hasPhrase("i am okay") || hasPhrase("i'm fine") || hasPhrase("i am fine") || hasPhrase("false alarm")) {
        dismissFall()
        speak("Fall alert cancelled.", "assertive")
        return
      }

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

        // 2. Scene description ("describe scene" / "what do you see" / "describe" / "look around")
      } else if (hasPhrase("describe scene") || hasPhrase("what do you see") || hasPhrase("look around") || hasPhrase("describe surroundings") || (hasWord("describe") && !hasPhrase("describe to"))) {
        if (!cameraRef.current) {
          speak("Camera is not active. Say start to begin navigation first.", "assertive")
          return
        }
        const frameBase64 = cameraRef.current.captureFrame()
        if (!frameBase64) {
          speak("Failed to capture image. Please try again.", "assertive")
          return
        }
        speak("Analyzing your surroundings...", "polite")
        fetch("/api/describe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ image: frameBase64, mode: "describe" })
        })
          .then(res => res.json())
          .then(data => {
            if (data.result) {
              speak(`I see: ${data.result}`, "assertive")
            } else if (data.error) {
              speak(data.error === "Rate limit exceeded" ? "Scene description is rate limited. Try again shortly." : "Sorry, I couldn't describe the scene.", "assertive")
            } else {
              speak("Nothing clear detected.", "polite")
            }
          })
          .catch(err => {
            console.error("[DESCRIBE]", err)
            speak("Error connecting to scene description service.", "assertive")
          })

        // 2b. Read text ("read text" / "what does this say" / "read this")
      } else if (hasPhrase("read text") || hasPhrase("what does this say") || hasPhrase("read this")) {
        if (!cameraRef.current) {
          speak("Camera is not active. Say start to begin navigation first.", "assertive")
          return
        }
        const frameBase64 = cameraRef.current.captureFrame()
        if (!frameBase64) {
          speak("Failed to capture image. Please try again.", "assertive")
          return
        }
        speak("Reading text...", "polite")
        fetch("/api/describe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ image: frameBase64, mode: "text" })
        })
          .then(res => res.json())
          .then(data => {
            if (data.result) {
              speak(`I read: ${data.result}`, "assertive")
            } else if (data.error) {
              speak(data.error === "Rate limit exceeded" ? "Service is rate limited. Try again shortly." : "Sorry, I couldn't read the text.", "assertive")
            } else {
              speak("No text detected.", "polite")
            }
          })
          .catch(err => {
            console.error("[READ TEXT]", err)
            speak("Error connecting to OCR service.", "assertive")
          })

        // 3. Currency detection (specific phrases)
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

        // 4b. Set emergency number
      } else if (hasPhrase("set emergency number") || hasPhrase("change emergency number") || hasPhrase("update emergency number")) {
        const numMatch = cmd.match(/(?:set|change|update)\s+emergency\s+number\s+(?:to\s+)?(.+)/)
        if (numMatch && numMatch[1] && numMatch[1].trim().length > 0) {
          const rawNum = numMatch[1].trim()
          // Filter characters to numbers or standard phone digits
          const cleanNum = rawNum.replace(/[a-zA-Z\s]/g, '')
          if (cleanNum.length >= 3) {
            saveEmergencyNumber(cleanNum)
            speak(`Emergency number updated to ${cleanNum.split('').join(' ')}.`, "assertive")
          } else {
            speak("I didn't catch the number. Please say it clearly.", "polite")
          }
        } else {
          speak("Say set emergency number followed by the number.", "polite")
        }

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

        // 11. Face registration — "add name John" / "remember John" / "register John"
        // Speech recognition often produces "add names", "and name", "at name" etc.
      } else if (/\b(add\s*a?\s*names?|remember\s*(face|name)|register\s*(face|name)?)\b/.test(cmd)) {
        const nameMatch = cmd.match(/(?:add\s*a?\s*names?|remember\s*(?:face|name)|register\s*(?:face|name)?)\s+(.+)/i)
        // Also try: just grab everything after the trigger word if first regex fails
        const fallbackMatch = !nameMatch ? cmd.match(/(?:add|register|remember)\s+(?:a\s+)?(?:names?|face)?\s*(.+)/i) : null
        const match = nameMatch || fallbackMatch
        if (match && match[1] && match[1].trim().length > 0) {
          // Clean extracted name — remove trailing filler words
          const personName = match[1].trim().replace(/\b(please|now|for me)\b/gi, '').trim()
          if (!personName) {
            speak("Say add name followed by the person's name. For example, add name John.", "polite")
            return
          }
          if (!cameraRef.current) {
            speak("Camera not active. Say start first, then try add name again.", "assertive")
            return
          }
          const frame = cameraRef.current.captureFrame()
          if (!frame) {
            speak("Failed to capture image. Try again.", "assertive")
            return
          }
          speak(`Registering face as ${personName}...`, "polite")
          fetch(`${getBackendUrl()}/face/register`, {
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
              speak("Error registering face. Check that the backend is running.", "assertive")
            })
        } else {
          speak("Say add name followed by the person's name. For example, add name John.", "polite")
        }

        // 12. Save route — "save route kitchen" / "save path bedroom"
      } else if (hasPhrase("save route") || hasPhrase("save path") || hasPhrase("remember route") || hasPhrase("remember path")) {
        const routeMatch = cmd.match(/(?:save route|save path|remember route|remember path)\s+(.+)/)
        if (routeMatch && routeMatch[1] && routeMatch[1].trim().length > 0) {
          const routeName = routeMatch[1].trim().replace(/[^a-zA-Z0-9 ]/g, '').substring(0, 50)
          if (breadcrumbs.length < 3) {
            speak("Not enough steps recorded. Walk a path first before saving.", "assertive")
          } else {
            try {
              const savedRoutes = JSON.parse(localStorage.getItem('visionPathRoutes') || '{}')
              savedRoutes[routeName] = breadcrumbs
              localStorage.setItem('visionPathRoutes', JSON.stringify(savedRoutes))
              speak(`Route ${routeName} saved with ${breadcrumbs.length} breadcrumbs.`, "assertive")
            } catch {
              speak("Failed to save route. Storage may be full.", "assertive")
            }
          }
        } else {
          speak("Say save route followed by a name. For example, save route kitchen.", "polite")
        }

        // 13. Navigate to saved route — "navigate to kitchen" / "go to kitchen"
      } else if (hasPhrase("navigate to") || hasPhrase("go to") || hasPhrase("take me to")) {
        const routeMatch = cmd.match(/(?:navigate to|go to|take me to)\s+(.+)/)
        if (routeMatch && routeMatch[1] && routeMatch[1].trim().length > 0) {
          const routeName = routeMatch[1].trim()
          try {
            const savedRoutes = JSON.parse(localStorage.getItem('visionPathRoutes') || '{}')
            // Case-insensitive route lookup
            const matchedKey = Object.keys(savedRoutes).find(
              k => k.toLowerCase() === routeName.toLowerCase()
            )
            if (matchedKey && Array.isArray(savedRoutes[matchedKey]) && savedRoutes[matchedKey].length > 0) {
              const routeBreadcrumbs = savedRoutes[matchedKey] as Breadcrumb[]
              const started = startBacktracking(routeBreadcrumbs)
              if (started) {
                setScreen("navigate")
                startTracking()
                speak(`Following saved route to ${matchedKey}. ${routeBreadcrumbs.length} steps. Follow audio cues.`, "assertive")
                setStatusMessage(`Navigating to ${matchedKey}`)
              } else {
                speak("Unable to build navigation path for that route.", "assertive")
              }
            } else {
              // List available routes
              const routeNames = Object.keys(savedRoutes)
              if (routeNames.length > 0) {
                speak(`Route ${routeName} not found. Available routes: ${routeNames.join(', ')}.`, "assertive")
              } else {
                speak("No saved routes found. Walk a path and say save route followed by a name.", "assertive")
              }
            }
          } catch {
            speak("Error loading saved routes.", "assertive")
          }
        } else {
          speak("Say navigate to followed by a route name. For example, navigate to kitchen.", "polite")
        }

        // 14. List saved routes — "list routes" / "my routes" / "saved routes"
      } else if (hasPhrase("list route") || hasPhrase("my route") || hasPhrase("saved route")) {
        try {
          const savedRoutes = JSON.parse(localStorage.getItem('visionPathRoutes') || '{}')
          const routeNames = Object.keys(savedRoutes)
          if (routeNames.length > 0) {
            speak(`You have ${routeNames.length} saved routes: ${routeNames.join(', ')}.`, "assertive")
          } else {
            speak("No saved routes. Walk a path and say save route followed by a name to save it.", "polite")
          }
        } catch {
          speak("Error reading saved routes.", "assertive")
        }

        // 15. Delete saved route — "delete route kitchen"
      } else if (hasPhrase("delete route") || hasPhrase("remove route") || hasPhrase("forget route")) {
        const routeMatch = cmd.match(/(?:delete route|remove route|forget route)\s+(.+)/)
        if (routeMatch && routeMatch[1] && routeMatch[1].trim().length > 0) {
          const routeName = routeMatch[1].trim()
          try {
            const savedRoutes = JSON.parse(localStorage.getItem('visionPathRoutes') || '{}')
            const matchedKey = Object.keys(savedRoutes).find(
              k => k.toLowerCase() === routeName.toLowerCase()
            )
            if (matchedKey) {
              delete savedRoutes[matchedKey]
              localStorage.setItem('visionPathRoutes', JSON.stringify(savedRoutes))
              speak(`Route ${matchedKey} deleted.`, "assertive")
            } else {
              speak(`Route ${routeName} not found.`, "assertive")
            }
          } catch {
            speak("Error deleting route.", "assertive")
          }
        } else {
          speak("Say delete route followed by the route name.", "polite")
        }

        // 16. Help (lowest priority — catches remaining "help" not captured above)
      } else if (hasWord("help") || hasWord("commands")) {
        speak(
          "Commands: start, stop, show feed, call help, set emergency number, emergency, go back, where am I, read text, read currency, describe scene, add name, save route, navigate to, list routes, delete route.",
          "polite"
        )
      }
    },
    [] // Stable — reads from refs
  )

  return handleCommand
}
