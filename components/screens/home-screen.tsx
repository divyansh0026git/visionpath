"use client"

import { useState, useCallback, useEffect } from "react"
import { Camera, ChevronRight, Shield } from "lucide-react"

interface HomeScreenProps {
  onStartNavigation: () => void
  isSupported: boolean
  speak: (text: string, priority?: "polite" | "assertive") => void
  triggerPermissionRequest: boolean
  onPermissionHandled: () => void
  emergencyNumber: string
  onSaveEmergencyNumber: (num: string) => void
}

export function HomeScreen({
  onStartNavigation,
  isSupported,
  speak,
  triggerPermissionRequest,
  onPermissionHandled,
  emergencyNumber,
  onSaveEmergencyNumber,
}: HomeScreenProps) {
  const [permissionsGranted, setPermissionsGranted] = useState(false)
  const [tempNumber, setTempNumber] = useState(emergencyNumber)
  const [showSettings, setShowSettings] = useState(false)

  useEffect(() => {
    setTempNumber(emergencyNumber)
  }, [emergencyNumber])

  const requestPermissions = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
      stream.getTracks().forEach(track => track.stop())
      setPermissionsGranted(true)
      speak("Camera and microphone permissions granted.", "assertive")
    } catch (err) {
      console.error(err)
      speak("Permission denied. Please grant access in your browser settings.", "assertive")
    }
  }, [speak])

  useEffect(() => {
    if (triggerPermissionRequest) {
      requestPermissions().finally(() => {
        onPermissionHandled();
      });
    }
  }, [triggerPermissionRequest, requestPermissions, onPermissionHandled])

  return (
    <div className="flex w-full max-w-lg flex-1 flex-col items-center justify-center gap-6">
      {/* Primary action — huge tap target */}
      <button
        onClick={onStartNavigation}
        className="flex h-40 w-full flex-col items-center justify-center gap-3 rounded-3xl border-4 border-primary bg-primary/10 transition-all active:scale-[0.97] hover:bg-primary/20"
        aria-label="Start continuous environment scanning and navigation"
      >
        <Camera className="h-14 w-14 text-primary" />
        <span className="text-2xl font-bold text-foreground">Start Scanning</span>
        <span className="text-sm text-muted-foreground">Tap or say &quot;start&quot;</span>
      </button>

      {/* Permission grant — only if needed */}
      {!permissionsGranted && (
        <button
          onClick={requestPermissions}
          className="w-full rounded-2xl border-2 border-primary bg-primary/20 py-5 text-center text-base font-bold text-foreground transition-all active:scale-[0.97]"
          aria-label="Grant camera and microphone permissions"
        >
          Grant Permissions (Camera &amp; Mic)
        </button>
      )}

      {/* Emergency contact — collapsible */}
      <div className="w-full">
        <button
          onClick={() => setShowSettings(!showSettings)}
          className="flex w-full items-center justify-between rounded-2xl bg-card px-5 py-4"
          aria-expanded={showSettings}
          aria-label="Emergency contact settings"
        >
          <div className="flex items-center gap-3">
            <Shield className="h-5 w-5 text-destructive" />
            <span className="text-sm font-bold text-foreground">Emergency: {emergencyNumber}</span>
          </div>
          <ChevronRight className={`h-5 w-5 text-muted-foreground transition-transform ${showSettings ? 'rotate-90' : ''}`} />
        </button>

        {showSettings && (
          <div className="mt-2 rounded-2xl bg-card p-4">
            <div className="flex gap-2">
              <input
                type="tel"
                value={tempNumber}
                onChange={(e) => setTempNumber(e.target.value)}
                className="flex-1 rounded-xl bg-background px-4 py-3 text-foreground border-2 border-border focus:border-primary outline-none text-lg"
                placeholder="e.g. 911"
                aria-label="Emergency contact number"
              />
              <button
                onClick={() => {
                  const sanitized = tempNumber.replace(/[^\d+\-() ]/g, "").trim()
                  if (!sanitized || sanitized.replace(/[^\d]/g, "").length < 3) {
                    speak("Please enter a valid phone number.", "assertive")
                    return
                  }
                  onSaveEmergencyNumber(sanitized)
                  setTempNumber(sanitized)
                  setShowSettings(false)
                  speak("Emergency number saved.", "polite")
                }}
                className="rounded-xl bg-primary px-5 py-3 font-bold text-primary-foreground"
                aria-label="Save emergency number"
              >
                Save
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Quick voice hint */}
      <p className="text-center text-sm text-muted-foreground">
        Say <strong>&quot;help&quot;</strong> for all voice commands
      </p>

      {!isSupported && (
        <div className="rounded-xl bg-destructive/10 p-4 text-center text-sm text-destructive" role="alert">
          Voice recognition not supported. Use Chrome for best experience.
        </div>
      )}
    </div>
  )
}
