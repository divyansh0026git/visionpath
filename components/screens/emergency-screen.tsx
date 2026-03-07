"use client"

import { getTurnInstruction, type BacktrackState } from "@/hooks/use-device-sensors"

interface EmergencyScreenProps {
  heading: number
  steps: number
  breadcrumbCount: number
  onDeactivate: () => void
  backtrackState: BacktrackState
}

export function EmergencyScreen({
  heading,
  steps,
  breadcrumbCount,
  onDeactivate,
  backtrackState,
}: EmergencyScreenProps) {
  const currentInstruction = backtrackState.currentSegment
    ? getTurnInstruction(heading, backtrackState.currentSegment.targetHeading)
    : null

  return (
    <div className="flex w-full max-w-lg flex-1 flex-col items-center gap-5">
      {/* Emergency status banner */}
      <div
        className={`w-full rounded-2xl border-4 p-6 text-center ${
          backtrackState.reachedStart
            ? "border-primary bg-primary/10"
            : "animate-pulse border-destructive bg-destructive/10"
        }`}
        role="alert"
        aria-live="assertive"
      >
        {backtrackState.reachedStart ? (
          <>
            <p className="text-3xl font-bold text-primary">SAFE</p>
            <p className="mt-2 text-lg text-foreground">You reached the starting position</p>
          </>
        ) : (
          <>
            <p className="text-3xl font-bold text-destructive">EMERGENCY</p>
            <p className="mt-2 text-lg text-foreground">Retracing to safe exit</p>
          </>
        )}
      </div>

      {/* Backtracking guidance — large text for any sighted helper nearby */}
      {backtrackState.isBacktracking && backtrackState.currentSegment && currentInstruction && (
        <div className="w-full rounded-2xl border-2 border-primary/30 bg-primary/5 p-6 text-center">
          <p className="text-2xl font-bold text-foreground">{currentInstruction.instruction}</p>
          <p className="mt-3 text-xl text-primary font-bold">
            {backtrackState.stepsRemaining} steps
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Segment {backtrackState.currentSegmentIndex + 1}/{backtrackState.totalSegments} · {backtrackState.totalStepsRemaining} total left
          </p>
        </div>
      )}

      {!backtrackState.isBacktracking && !backtrackState.reachedStart && breadcrumbCount === 0 && (
        <div className="w-full rounded-2xl bg-card p-5 text-center">
          <p className="text-base text-muted-foreground">
            No path recorded. Stay calm and call for help.
          </p>
        </div>
      )}

      {/* Deactivate button */}
      <button
        onClick={onDeactivate}
        className="mt-auto h-16 w-full rounded-2xl border-2 border-secondary bg-secondary text-lg font-bold text-secondary-foreground transition-all active:scale-95"
        aria-label="Deactivate emergency mode"
      >
        {backtrackState.reachedStart ? "Return Home" : "Deactivate Emergency"}
      </button>
    </div>
  )
}
