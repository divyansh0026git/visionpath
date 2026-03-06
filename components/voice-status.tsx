"use client"

import { Mic, MicOff, Volume2 } from "lucide-react"

interface VoiceStatusProps {
  isListening: boolean
  lastCommand: string
  onToggle: () => void
}

export function VoiceStatus({ isListening, lastCommand, onToggle }: VoiceStatusProps) {
  return (
    <div className="flex flex-col items-center gap-3">
      <button
        onClick={onToggle}
        className={`flex h-20 w-20 items-center justify-center rounded-full border-4 transition-all active:scale-95 ${
          isListening
            ? "border-primary bg-primary/20 text-primary shadow-[0_0_30px_rgba(0,200,150,0.3)]"
            : "border-muted bg-card text-muted-foreground"
        }`}
        aria-label={isListening ? "Voice listening active. Tap to stop." : "Voice inactive. Tap to start listening."}
        aria-pressed={isListening}
      >
        {isListening ? <Mic className="h-10 w-10" /> : <MicOff className="h-10 w-10" />}
      </button>

      <p className="text-center text-sm text-muted-foreground" aria-live="polite">
        {isListening ? "Listening..." : "Tap mic to start"}
      </p>

      {lastCommand && (
        <div className="flex items-center gap-2 rounded-xl bg-card px-4 py-2" role="log" aria-label={`Last command: ${lastCommand}`}>
          <Volume2 className="h-4 w-4 text-primary" />
          <span className="text-sm text-muted-foreground">&quot;{lastCommand}&quot;</span>
        </div>
      )}
    </div>
  )
}
