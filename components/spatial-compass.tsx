"use client"

import { Navigation, Footprints, TriangleAlert } from "lucide-react"
import { getCardinalDirection } from "@/lib/navigation"

interface SpatialCompassProps {
  heading: number
  steps: number
  isMoving: boolean
  isNavigating: boolean
}

export function SpatialCompass({ heading, steps, isMoving, isNavigating }: SpatialCompassProps) {
  const direction = getCardinalDirection(heading)

  return (
    <div
      className="flex flex-col items-center gap-6"
      role="status"
      aria-live="polite"
      aria-label={`Heading ${direction}, ${heading} degrees. ${steps} steps taken. ${isMoving ? "Moving" : "Stationary"}`}
    >
      <div className="relative flex h-48 w-48 items-center justify-center rounded-full border-4 border-border bg-card">
        <div
          className="absolute inset-4 flex items-center justify-center rounded-full border-2 border-muted"
          style={{ transform: `rotate(-${heading}deg)` }}
        >
          <Navigation
            className={`h-16 w-16 transition-colors ${isNavigating ? "text-primary" : "text-muted-foreground"}`}
            style={{ transform: "rotate(-45deg)" }}
          />
        </div>

        <span className="absolute -top-3 text-sm font-bold text-primary">N</span>
        <span className="absolute -right-3 text-sm font-bold text-muted-foreground">E</span>
        <span className="absolute -bottom-3 text-sm font-bold text-muted-foreground">S</span>
        <span className="absolute -left-3 text-sm font-bold text-muted-foreground">W</span>
      </div>

      <div className="text-center">
        <p className="text-3xl font-bold text-foreground">{direction}</p>
        <p className="text-lg text-muted-foreground">{heading}&#176;</p>
      </div>

      <div className="flex items-center gap-8">
        <div className="flex items-center gap-3">
          <Footprints className="h-6 w-6 text-primary" />
          <span className="text-2xl font-bold text-foreground">{steps}</span>
          <span className="text-muted-foreground">steps</span>
        </div>

        <div className="flex items-center gap-2">
          <div
            className={`h-4 w-4 rounded-full ${isMoving ? "animate-pulse bg-primary" : "bg-muted-foreground"}`}
            aria-hidden="true"
          />
          <span className="text-lg text-muted-foreground">
            {isMoving ? "Moving" : "Stationary"}
          </span>
        </div>
      </div>
    </div>
  )
}

interface PanicButtonProps {
  onPanic: () => void
  isActive: boolean
}

export function PanicButton({ onPanic, isActive }: PanicButtonProps) {
  return (
    <button
      onClick={onPanic}
      className={`flex h-20 w-full items-center justify-center gap-4 rounded-2xl border-4 text-2xl font-bold transition-all active:scale-95 ${
        isActive
          ? "animate-pulse border-destructive bg-destructive text-destructive-foreground"
          : "border-destructive/50 bg-destructive/10 text-destructive hover:bg-destructive/20"
      }`}
      aria-label={isActive ? "Emergency mode active. Tap to deactivate." : "Emergency panic button. Tap to activate safe exit guidance."}
      role="button"
    >
      <TriangleAlert className="h-8 w-8" />
      {isActive ? "EMERGENCY ACTIVE" : "EMERGENCY"}
    </button>
  )
}
