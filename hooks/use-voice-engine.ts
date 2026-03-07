"use client"

import { useState, useEffect, useCallback, useRef } from "react"

interface VoiceEngineOptions {
  onCommand?: (command: string) => void
  continuous?: boolean
}

export function useVoiceEngine({ onCommand, continuous = true }: VoiceEngineOptions = {}) {
  const [isListening, setIsListening] = useState(false)
  const [transcript, setTranscript] = useState("")
  const [isSupported, setIsSupported] = useState(false)
  const recognitionRef = useRef<SpeechRecognition | null>(null)
  const transcriptTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Ref to track the latest isListening state inside async closures (avoids stale closure bug)
  const isListeningRef = useRef(false)
  const isSpeakingRef = useRef(false)
  const pendingUtteranceRef = useRef<SpeechSynthesisUtterance | null>(null)
  const useFallbackTTSRef = useRef(false)
  const fallbackAudioRef = useRef<HTMLAudioElement | null>(null)
  const speakViaServerRef = useRef<((text: string) => void) | null>(null)
  // Web Audio API context for spatial audio panning
  const audioContextRef = useRef<AudioContext | null>(null)

  // Ref to always have the latest onCommand callback (fixes stale closure in onresult)
  const onCommandRef = useRef(onCommand)
  useEffect(() => { onCommandRef.current = onCommand }, [onCommand])

  // Keep isListeningRef in sync with state
  useEffect(() => {
    isListeningRef.current = isListening
  }, [isListening])

  // ---- TTS voice warmup ----
  // Chrome/Linux loads voices asynchronously. speechSynthesis.speak() silently fails
  // if called before voices are loaded. Queue critical messages until ready.
  useEffect(() => {
    if (typeof window === 'undefined' || !window.speechSynthesis) {
      console.warn('[VOICE] speechSynthesis API not available in this browser')
      return
    }

    const handleVoicesReady = () => {
      const voices = window.speechSynthesis.getVoices()
      if (voices.length > 0) {
        console.log(`[VOICE] TTS ready — ${voices.length} voice(s) available`)
        // Play any queued utterance that was waiting for voices to load
        if (pendingUtteranceRef.current) {
          const utterance = pendingUtteranceRef.current
          pendingUtteranceRef.current = null
          window.speechSynthesis.speak(utterance)
        }
      }
    }

    // Trigger voice loading and check immediately (Firefox loads synchronously)
    window.speechSynthesis.getVoices()
    handleVoicesReady()

    window.speechSynthesis.addEventListener('voiceschanged', handleVoicesReady)

    // If voices never load, switch to server-side TTS fallback
    const warnTimer = setTimeout(() => {
      if (window.speechSynthesis.getVoices().length === 0) {
        console.warn('[VOICE] No browser TTS voices after 5s — switching to server-side TTS fallback')
        useFallbackTTSRef.current = true
        // Play any queued message via fallback
        if (pendingUtteranceRef.current) {
          const pendingText = pendingUtteranceRef.current.text
          pendingUtteranceRef.current = null
          speakViaServerRef.current?.(pendingText)
        }
      }
    }, 5000)

    return () => {
      window.speechSynthesis.removeEventListener('voiceschanged', handleVoicesReady)
      clearTimeout(warnTimer)
    }
  }, [])

  // ---- Speech Recognition setup ----
  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
    if (SpeechRecognition) {
      console.log('[VOICE] SpeechRecognition API available')
      setIsSupported(true)
      const recognition = new SpeechRecognition()
      recognition.continuous = continuous
      recognition.interimResults = true
      recognition.lang = "en-US"

      recognition.onresult = (event: SpeechRecognitionEvent) => {
        if (isSpeakingRef.current) return // Ignore input if TTS is currently active

        let finalTranscript = ""
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i]
          if (result.isFinal) {
            finalTranscript += result[0].transcript
          }
        }
        if (finalTranscript) {
          const processed = finalTranscript.trim().toLowerCase()
          setTranscript(processed)
          onCommandRef.current?.(processed)

          // Auto-clear transcript after 4 seconds
          if (transcriptTimerRef.current) clearTimeout(transcriptTimerRef.current)
          transcriptTimerRef.current = setTimeout(() => setTranscript(""), 4000)
        }
      }

      recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
        console.warn('[VOICE] Recognition error:', event.error)
        // On "no-speech" or "audio-capture" errors, try to restart rather than stopping
        if (event.error === "no-speech" || event.error === "audio-capture") {
          // Will be restarted by onend
          return
        }
        // Network errors are often transient — allow onend to auto-restart
        if (event.error === "network") {
          console.warn('[VOICE] Network error — will retry. If persistent, restart the browser.')
          return
        }
        if (event.error === "not-allowed") {
          console.error('[VOICE] Microphone permission denied. Grant access in browser settings.')
        }
        setIsListening(false)
        isListeningRef.current = false
      }

      recognition.onend = () => {
        // Use ref (not state) to avoid stale closure — this ensures continuous restarts work
        if (continuous && isListeningRef.current) {
          try {
            recognition.start()
          } catch {
            // Already started — ignore
          }
        } else {
          setIsListening(false)
          isListeningRef.current = false
        }
      }

      recognitionRef.current = recognition
    } else {
      console.warn('[VOICE] SpeechRecognition not supported. Use Chrome/Chromium for voice commands.')
    }

    return () => {
      recognitionRef.current?.stop()
      if (transcriptTimerRef.current) clearTimeout(transcriptTimerRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [continuous])

  const startListening = useCallback(() => {
    if (!recognitionRef.current) {
      console.warn('[VOICE] Cannot start — SpeechRecognition not supported. Use Chrome/Chromium.')
      return
    }
    if (isListeningRef.current) return
    try {
      recognitionRef.current.start()
      setIsListening(true)
      isListeningRef.current = true
      console.log('[VOICE] Mic listening started')
    } catch (e: any) {
      // InvalidStateError = already started (harmless). Any other error is real.
      if (e?.name !== 'InvalidStateError') {
        console.error('[VOICE] Failed to start recognition:', e)
      }
    }
  }, [])

  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      isListeningRef.current = false
      recognitionRef.current.stop()
      setIsListening(false)
    }
  }, [])

  const speakTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastSpeakTimeRef = useRef(0)

  // Server-side TTS fallback via /api/speak (Piper neural TTS)
  const speakViaServer = useCallback(async (text: string, pan?: number) => {
    try {
      isSpeakingRef.current = true
      console.log('[VOICE] Server TTS:', text.substring(0, 50))
      const res = await fetch('/api/speak', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      })
      if (!res.ok) throw new Error(`Server TTS failed: ${res.status}`)
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)

      // If spatial pan requested and Web Audio API is available, route through panner
      if (pan !== undefined && pan !== 0 && typeof AudioContext !== 'undefined') {
        try {
          if (!audioContextRef.current) audioContextRef.current = new AudioContext()
          const ctx = audioContextRef.current
          if (ctx.state === 'suspended') await ctx.resume()
          const arrayBuffer = await blob.arrayBuffer()
          const audioBuffer = await ctx.decodeAudioData(arrayBuffer)
          const source = ctx.createBufferSource()
          source.buffer = audioBuffer
          const panner = ctx.createStereoPanner()
          panner.pan.value = Math.max(-1, Math.min(1, pan))
          source.connect(panner)
          panner.connect(ctx.destination)
          source.onended = () => {
            URL.revokeObjectURL(url)
            setTimeout(() => { isSpeakingRef.current = false }, 200)
          }
          source.start()
          return
        } catch (e) {
          console.warn('[VOICE] Spatial audio fallback to normal:', e)
        }
      }

      const audio = new Audio(url)
      fallbackAudioRef.current = audio
      audio.onended = () => {
        URL.revokeObjectURL(url)
        fallbackAudioRef.current = null
        setTimeout(() => { isSpeakingRef.current = false }, 200)
      }
      audio.onerror = () => {
        URL.revokeObjectURL(url)
        fallbackAudioRef.current = null
        isSpeakingRef.current = false
      }
      await audio.play()
    } catch (e) {
      console.error('[VOICE] Server TTS error:', e)
      isSpeakingRef.current = false
    }
  }, [])
  speakViaServerRef.current = speakViaServer

  const speak = useCallback((text: string, priority: "polite" | "assertive" = "polite", pan?: number) => {
    if (typeof window === 'undefined') return

    const now = Date.now()

    // For polite speech: skip entirely if already speaking or spoke recently (2.5s cooldown)
    if (priority === "polite") {
      if (isSpeakingRef.current) return
      if (now - lastSpeakTimeRef.current < 2500) return
    }

    // Assertive speech cancels current speech
    if (priority === "assertive") {
      if (fallbackAudioRef.current) {
        fallbackAudioRef.current.pause()
        fallbackAudioRef.current = null
      }
      if (window.speechSynthesis) window.speechSynthesis.cancel()
    }

    if (speakTimeoutRef.current) clearTimeout(speakTimeoutRef.current)
    lastSpeakTimeRef.current = now

    // Use server-side fallback when browser has no voices
    if (useFallbackTTSRef.current || !window.speechSynthesis) {
      speakViaServer(text, pan)
      return
    }

    const utterance = new SpeechSynthesisUtterance(text)

    // Block the microphone from processing this utterance
    utterance.onstart = () => {
      isSpeakingRef.current = true
    }
    const resetSpeaking = () => {
      if (speakTimeoutRef.current) clearTimeout(speakTimeoutRef.current)
      speakTimeoutRef.current = null
      // Small buffer to let room echoes die down
      setTimeout(() => {
        isSpeakingRef.current = false
      }, 200)
    }
    utterance.onend = resetSpeaking
    utterance.onerror = (e) => {
      // "interrupted" fires when cancel() is called — keep isSpeaking true for the replacement utterance
      if (e.error === 'interrupted') return
      isSpeakingRef.current = false
    }

    // Failsafe: Chrome sometimes doesn't fire onend for long utterances.
    // At 1.25x rate: ~64ms per character + 2s buffer. Reset speaking flag if stuck.
    const estimatedMs = Math.max(3000, text.length * 64 + 2000)
    speakTimeoutRef.current = setTimeout(() => {
      if (isSpeakingRef.current) {
        isSpeakingRef.current = false
        speakTimeoutRef.current = null
      }
    }, estimatedMs)

    utterance.rate = priority === "assertive" ? 1.35 : 1.25
    utterance.pitch = 1
    utterance.volume = 1

    // If voices haven't loaded yet, use server fallback
    if (window.speechSynthesis.getVoices().length === 0) {
      console.log('[VOICE] No browser voices — using server TTS for:', text.substring(0, 50))
      useFallbackTTSRef.current = true
      speakViaServer(text, pan)
      return
    }

    window.speechSynthesis.speak(utterance)
  }, [speakViaServer])

  return {
    isListening,
    transcript,
    isSupported,
    startListening,
    stopListening,
    speak,
  }
}
