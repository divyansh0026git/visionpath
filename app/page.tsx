"use client"

import { useState, useCallback, useEffect, useRef } from "react"
import { Eye } from "lucide-react"
import { useVoiceEngine } from "@/hooks/use-voice-engine"
import { useDeviceSensors } from "@/hooks/use-device-sensors"
import { useCommandHandler } from "@/hooks/use-command-handler"
import { useBacktrackGuidance, usePanicHandler } from "@/hooks/use-backtrack-guidance"
import { VoiceStatus } from "@/components/voice-status"
import { BackgroundCamera, BackgroundCameraHandle } from "@/components/background-camera"
import { SplashScreen } from "@/components/screens/splash-screen"
import { HomeScreen } from "@/components/screens/home-screen"
import { NavigateScreen } from "@/components/screens/navigate-screen"
import { EmergencyScreen } from "@/components/screens/emergency-screen"

type AppScreen = "home" | "navigate" | "emergency"

export default function VisionPathApp() {
  // --- Core app state ---
  const [screen, setScreen] = useState<AppScreen>("home")
  const [isPanicActive, setIsPanicActive] = useState(false)
  const [statusMessage, setStatusMessage] = useState("")
  const statusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Auto-clear status messages after 5 seconds
  const setStatusMessageWithAutoClear = useCallback((msg: string) => {
    setStatusMessage(msg)
    if (statusTimerRef.current) clearTimeout(statusTimerRef.current)
    if (msg) {
      statusTimerRef.current = setTimeout(() => setStatusMessage(""), 5000)
    }
  }, [])
  const [showLiveCamera, setShowLiveCamera] = useState(false)
  const [triggerPermissionRequest, setTriggerPermissionRequest] = useState(false)
  const [hasInteracted, setHasInteracted] = useState(false)
  const [emergencyNumber, setEmergencyNumber] = useState("911")
  const [lowPowerMode, setLowPowerMode] = useState(false)
  const cameraRef = useRef<BackgroundCameraHandle>(null)
  const lowPowerAnnouncedRef = useRef(false)

  // --- Load saved emergency number ---
  useEffect(() => {
    const saved = localStorage.getItem("visionPathEmergencyNumber")
    if (saved) setEmergencyNumber(saved)
  }, [])

  // --- Battery monitoring for power-saving mode ---
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('getBattery' in navigator)) return
    let battery: any = null
    const checkBattery = () => {
      if (!battery) return
      const level = battery.level
      if (level <= 0.20 && !lowPowerMode) {
        setLowPowerMode(true)
        if (!lowPowerAnnouncedRef.current) {
          lowPowerAnnouncedRef.current = true
          // Speak will be available after voice engine loads — use timeout
          setTimeout(() => {
            speakRef.current?.("Battery low. Switching to power saving mode. Detection frequency reduced.", "assertive")
          }, 500)
        }
      } else if (level > 0.25 && lowPowerMode) {
        setLowPowerMode(false)
        lowPowerAnnouncedRef.current = false
      }
    }

      ; (navigator as any).getBattery().then((b: any) => {
        battery = b
        checkBattery()
        b.addEventListener('levelchange', checkBattery)
      }).catch(() => { })

    return () => {
      if (battery) battery.removeEventListener('levelchange', checkBattery)
    }
  }, [lowPowerMode])

  const saveEmergencyNumber = useCallback((num: string) => {
    setEmergencyNumber(num)
    localStorage.setItem("visionPathEmergencyNumber", num)
  }, [])

  // --- Sensor + navigation hooks ---
  const {
    sensorData, breadcrumbs, isTracking, backtrackState,
    fallDetected, fallCountdown,
    startTracking, stopTracking, startBacktracking, stopBacktracking, dismissFall,
  } = useDeviceSensors()

  // --- Stable speak reference (fixes circular dependency with useVoiceEngine) ---
  const speakRef = useRef<(text: string, priority?: "polite" | "assertive") => void>(() => { })
  const stableSpeak = useCallback((text: string, priority?: "polite" | "assertive") => {
    speakRef.current(text, priority)
  }, [])

  // --- Voice command dispatcher (extracted hook) ---
  const handleCommand = useCommandHandler(
    {
      setScreen, setIsPanicActive, setStatusMessage: setStatusMessageWithAutoClear, setShowLiveCamera,
      setTriggerPermissionRequest, startTracking, stopTracking,
      startBacktracking, stopBacktracking, speak: stableSpeak, dismissFall, saveEmergencyNumber,
    },
    { sensorData, breadcrumbs, backtrackState, emergencyNumber, cameraRef }
  )

  // --- Voice engine ---
  const { isListening, transcript, isSupported, startListening, stopListening, speak } =
    useVoiceEngine({ onCommand: handleCommand })

  // Keep speakRef in sync with the real speak function
  useEffect(() => { speakRef.current = speak }, [speak])

  // --- Backtracking audio guidance (extracted hook) ---
  useBacktrackGuidance({
    backtrackState,
    currentHeading: sensorData.heading,
    speak,
    setStatusMessage: setStatusMessageWithAutoClear,
    setIsPanicActive,
  })

  // --- Fall detection auto-emergency ---
  useEffect(() => {
    if (!fallDetected) return
    if (fallCountdown > 0) {
      // Countdown in progress — vibrate and announce
      speak(`Fall detected. Emergency in ${fallCountdown} seconds. Say cancel to abort.`, "assertive")
      if (typeof navigator !== 'undefined' && navigator.vibrate) {
        navigator.vibrate([300, 200, 300])
      }
    } else if (fallCountdown === 0 && fallDetected) {
      // Countdown finished — trigger emergency
      setIsPanicActive(true)
      setScreen("emergency")
      if (breadcrumbs.length > 0) {
        startBacktracking(breadcrumbs)
      }
      speak("Fall emergency activated. Calling for help. Stay calm.", "assertive")
      setStatusMessageWithAutoClear("FALL DETECTED - EMERGENCY")
      if (typeof navigator !== 'undefined' && navigator.vibrate) {
        navigator.vibrate([500, 200, 500, 200, 500])
      }
    }
  }, [fallDetected, fallCountdown, speak, setIsPanicActive, breadcrumbs, startBacktracking, setStatusMessageWithAutoClear])

  // --- Panic button handler (extracted hook) ---
  const handlePanic = usePanicHandler({
    isPanicActive, breadcrumbs, speak,
    setIsPanicActive, setScreen, setStatusMessage: setStatusMessageWithAutoClear,
    startBacktracking, stopBacktracking,
  })

  // --- Welcome message + auto-start mic ---
  useEffect(() => {
    if (!hasInteracted) return
    const micTimer = setTimeout(() => startListening(), 300)
    const welcomeTimer = setTimeout(() => {
      speak(
        "Welcome to Vision Path. Eyes-free indoor navigation. Say start to begin continuous environment scanning. Say help for available commands.",
        "assertive"
      )
    }, 1000)
    return () => { clearTimeout(micTimer); clearTimeout(welcomeTimer) }
  }, [hasInteracted, startListening, speak])

  const toggleVoice = useCallback(() => {
    if (isListening) {
      stopListening()
      speak("Voice commands disabled.", "polite")
    } else {
      startListening()
      speak("Voice commands enabled. Listening.", "polite")
    }
  }, [isListening, startListening, stopListening, speak])

  // --- Splash gate ---
  if (!hasInteracted) {
    return <SplashScreen onStart={() => setHasInteracted(true)} />
  }

  // --- Main app shell ---
  return (
    <main className="flex min-h-dvh flex-col bg-background" role="application" aria-label="Vision Path navigation app">
      {/* Compact header */}
      <header className="flex items-center justify-between px-5 py-3 pt-6">
        <div className="flex items-center gap-2">
          <Eye className="h-6 w-6 text-primary" />
          <h1 className="text-lg font-bold text-foreground">Vision Path</h1>
        </div>
        <div
          className={`rounded-full px-3 py-1 text-xs font-bold ${isTracking ? "bg-primary/20 text-primary" : "bg-secondary text-secondary-foreground"
            }`}
          role="status"
          aria-label={isTracking ? "Navigation active" : "Navigation inactive"}
        >
          {isTracking ? "ACTIVE" : "READY"}
        </div>
      </header>

      {/* Status bar */}
      {statusMessage && (
        <div className="mx-5 mb-3 rounded-xl bg-card px-4 py-3 text-center text-sm font-medium text-foreground" role="status" aria-live="assertive">
          {statusMessage}
        </div>
      )}

      {/* Screen router */}
      <div className="flex flex-1 flex-col items-center gap-4 px-5 pb-4">
        {screen === "home" && (
          <HomeScreen
            onStartNavigation={() => {
              setScreen("navigate")
              startTracking()
              speak("Navigation started. Continuous scanning is active.", "assertive")
            }}
            isSupported={isSupported}
            speak={speak}
            triggerPermissionRequest={triggerPermissionRequest}
            onPermissionHandled={() => setTriggerPermissionRequest(false)}
            emergencyNumber={emergencyNumber}
            onSaveEmergencyNumber={saveEmergencyNumber}
          />
        )}

        {screen === "navigate" && (
          <NavigateScreen
            heading={sensorData.heading}
            steps={sensorData.steps}
            isMoving={sensorData.isMoving}
            breadcrumbCount={breadcrumbs.length}
            onPanic={handlePanic}
            isPanicActive={isPanicActive}
            showLiveCamera={showLiveCamera}
            setShowLiveCamera={setShowLiveCamera}
          />
        )}

        {screen === "emergency" && (
          <EmergencyScreen
            heading={sensorData.heading}
            steps={sensorData.steps}
            breadcrumbCount={breadcrumbs.length}
            onDeactivate={handlePanic}
            backtrackState={backtrackState}
          />
        )}

        {(screen === "navigate" || screen === "emergency") && (
          <BackgroundCamera
            ref={cameraRef}
            isNavigating={isTracking || isPanicActive}
            speak={speak}
            showLiveView={showLiveCamera}
            lowPowerMode={lowPowerMode}
          />
        )}

        <div className="mt-auto w-full max-w-lg">
          <VoiceStatus isListening={isListening} lastCommand={transcript} onToggle={toggleVoice} />
        </div>
      </div>
    </main>
  )
}
