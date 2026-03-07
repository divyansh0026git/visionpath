"use client"

import { useState } from "react"
import { Eye } from "lucide-react"

interface SplashScreenProps {
  onStart: () => void
}

/**
 * Initial full-screen tap gate.
 * Required for iOS compass permissions and user gesture to enable audio.
 */
export function SplashScreen({ onStart }: SplashScreenProps) {
  const [permissionWarning, setPermissionWarning] = useState<string | null>(null)

  const handleTap = async () => {
    // iOS 13+ requires explicit permission to read device orientation
    if (
      typeof DeviceOrientationEvent !== "undefined" &&
      // @ts-ignore – non-standard iOS method
      typeof DeviceOrientationEvent.requestPermission === "function"
    ) {
      try {
        // @ts-ignore
        const state = await DeviceOrientationEvent.requestPermission()
        if (state !== "granted") {
          setPermissionWarning("Compass permission denied. Backtracking will not work accurately.")
        }
      } catch (err) {
        console.error("Error requesting orientation permission:", err)
        setPermissionWarning("Could not request compass permission.")
      }
    }

    onStart()
  }

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-background p-6">
      <button
        onClick={handleTap}
        className="flex h-full w-full flex-col items-center justify-center gap-6 rounded-3xl bg-primary/10 border-4 border-primary p-8 text-primary active:bg-primary/20"
        aria-label="Tap anywhere to start Voice Assistant and grant compass permissions"
      >
        <Eye className="h-24 w-24 animate-pulse" />
        <h1 className="text-3xl font-bold text-center">Vision Path</h1>
        <p className="text-xl text-center font-medium">Tap Anywhere to Start</p>
        <p className="text-sm text-center font-medium opacity-80 mt-2">
          Enables voice assistant and spatial compass
        </p>
        {permissionWarning && (
          <p className="text-sm text-center text-red-400 mt-2" role="alert">
            {permissionWarning}
          </p>
        )}
      </button>
    </main>
  )
}
