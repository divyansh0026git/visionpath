"use client"

import { Camera, CameraOff } from "lucide-react"
import { PanicButton } from "@/components/spatial-compass"

interface NavigateScreenProps {
  heading: number
  steps: number
  isMoving: boolean
  breadcrumbCount: number
  onPanic: () => void
  isPanicActive: boolean
  showLiveCamera: boolean
  setShowLiveCamera: (show: boolean) => void
}

export function NavigateScreen({
  heading,
  steps,
  isMoving,
  breadcrumbCount,
  onPanic,
  isPanicActive,
  showLiveCamera,
  setShowLiveCamera,
}: NavigateScreenProps) {
  return (
    <div className="flex w-full max-w-lg flex-1 flex-col items-center gap-5">
      {/* Scanning active indicator */}
      <div
        className="flex w-full items-center justify-center gap-3 rounded-2xl bg-primary/10 border-2 border-primary/30 px-5 py-4"
        role="status"
        aria-live="polite"
        aria-label={`Scanning active. ${steps} steps, heading ${heading} degrees. ${breadcrumbCount} breadcrumbs.`}
      >
        <div className="h-3 w-3 rounded-full bg-primary animate-pulse" />
        <span className="text-base font-bold text-foreground">Scanning Active</span>
        <span className="text-sm text-muted-foreground ml-auto">{steps} steps</span>
      </div>

      {/* Camera toggle — secondary action */}
      <button
        onClick={() => setShowLiveCamera(!showLiveCamera)}
        className={`flex w-full items-center justify-center gap-3 rounded-2xl border-2 py-4 font-bold transition-all active:scale-[0.97] ${
          showLiveCamera
            ? "border-primary bg-primary text-primary-foreground"
            : "border-border bg-card text-muted-foreground"
        }`}
        aria-label={showLiveCamera ? "Hide live camera feed" : "Show live camera feed"}
      >
        {showLiveCamera ? <CameraOff className="h-5 w-5" /> : <Camera className="h-5 w-5" />}
        <span>{showLiveCamera ? "Hide Camera" : "Show Camera"}</span>
      </button>

      {/* Emergency — always visible, always big */}
      <div className="mt-auto w-full">
        <PanicButton onPanic={onPanic} isActive={isPanicActive} />
      </div>
    </div>
  )
}
