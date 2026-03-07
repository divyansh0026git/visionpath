"use client"

import { useState, useEffect, useCallback, useRef } from "react"

interface VoiceEngineOptions {
  onCommand?: (command: string) => void
  continuous?: boolean
}

interface SpeechQueueItem {
  text: string
  priority: "polite" | "assertive"
  pan?: number
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
  const currentAudioRef = useRef<HTMLAudioElement | null>(null)
  const currentSourceRef = useRef<AudioBufferSourceNode | null>(null)
  // Web Audio API context for spatial audio panning
  const audioContextRef = useRef<AudioContext | null>(null)

  // Speech queue for sequential playback without overlap
  const speechQueueRef = useRef<SpeechQueueItem[]>([])
  const isProcessingQueueRef = useRef(false)
  const lastSpeakTimeRef = useRef(0)

  // Ref to always have the latest onCommand callback (fixes stale closure in onresult)
  const onCommandRef = useRef(onCommand)
  useEffect(() => { onCommandRef.current = onCommand }, [onCommand])

  // Keep isListeningRef in sync with state
  useEffect(() => {
    isListeningRef.current = isListening
  }, [isListening])

  // ---- Speech Recognition setup (continuous, robust) ----
  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
    if (SpeechRecognition) {
      console.log('[VOICE] SpeechRecognition API available')
      setIsSupported(true)
      const recognition = new SpeechRecognition()
      recognition.continuous = true
      recognition.interimResults = true
      recognition.lang = "en-US"
      recognition.maxAlternatives = 1

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
        // Transient errors — onend will auto-restart
        if (event.error === "no-speech" || event.error === "audio-capture" || event.error === "network" || event.error === "aborted") {
          return
        }
        if (event.error === "not-allowed") {
          console.error('[VOICE] Microphone permission denied. Grant access in browser settings.')
        }
        setIsListening(false)
        isListeningRef.current = false
      }

      recognition.onend = () => {
        // Immediately restart if we should be listening — minimal gap for continuous detection
        if (isListeningRef.current) {
          setTimeout(() => {
            if (!isListeningRef.current) return
            try {
              recognition.start()
            } catch {
              // Already started — ignore
            }
          }, 50) // 50ms restart gap — near-instant continuous detection
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
  }, [])

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
      console.log('[VOICE] Mic listening started (continuous mode)')
    } catch (e: any) {
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

  // ---- Cancel current audio playback ----
  const cancelCurrentAudio = useCallback(() => {
    if (currentSourceRef.current) {
      try { currentSourceRef.current.stop() } catch {}
      currentSourceRef.current = null
    }
    if (currentAudioRef.current) {
      currentAudioRef.current.pause()
      if (currentAudioRef.current.src) {
        URL.revokeObjectURL(currentAudioRef.current.src)
      }
      currentAudioRef.current = null
    }
  }, [])

  // ---- Play a single TTS item via server-side Piper ----
  const playServerTTS = useCallback(async (text: string, pan?: number): Promise<void> => {
    const res = await fetch('/api/speak', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    })
    if (!res.ok) throw new Error(`Server TTS failed: ${res.status}`)
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)

    return new Promise<void>((resolve, reject) => {
      // Spatial audio panning via Web Audio API
      if (pan !== undefined && pan !== 0 && typeof AudioContext !== 'undefined') {
        (async () => {
          try {
            if (!audioContextRef.current) audioContextRef.current = new AudioContext()
            const ctx = audioContextRef.current
            if (ctx.state === 'suspended') await ctx.resume()
            const arrayBuffer = await blob.arrayBuffer()
            const audioBuffer = await ctx.decodeAudioData(arrayBuffer)
            const source = ctx.createBufferSource()
            source.buffer = audioBuffer
            currentSourceRef.current = source
            const panner = ctx.createStereoPanner()
            panner.pan.value = Math.max(-1, Math.min(1, pan))
            source.connect(panner)
            panner.connect(ctx.destination)
            source.onended = () => {
              URL.revokeObjectURL(url)
              currentSourceRef.current = null
              resolve()
            }
            source.start()
          } catch (e) {
            console.warn('[VOICE] Spatial audio fallback to normal:', e)
            // Fall through to normal <audio> playback
            playViaAudioElement(url, resolve, reject)
          }
        })()
        return
      }

      playViaAudioElement(url, resolve, reject)
    })

    function playViaAudioElement(audioUrl: string, resolve: () => void, reject: (e: Error) => void) {
      const audio = new Audio(audioUrl)
      currentAudioRef.current = audio
      audio.onended = () => {
        URL.revokeObjectURL(audioUrl)
        currentAudioRef.current = null
        resolve()
      }
      audio.onerror = () => {
        URL.revokeObjectURL(audioUrl)
        currentAudioRef.current = null
        reject(new Error('Audio playback error'))
      }
      audio.play().catch(reject)
    }
  }, [])

  // ---- Process speech queue sequentially ----
  const processQueue = useCallback(async () => {
    if (isProcessingQueueRef.current) return
    isProcessingQueueRef.current = true
    isSpeakingRef.current = true

    while (speechQueueRef.current.length > 0) {
      const item = speechQueueRef.current.shift()!
      try {
        console.log('[VOICE] TTS playing:', item.text.substring(0, 60))
        await playServerTTS(item.text, item.pan)
      } catch (e) {
        console.error('[VOICE] TTS playback error:', e)
      }
    }

    isProcessingQueueRef.current = false
    // Small buffer to let room echoes die down before re-enabling mic input
    setTimeout(() => {
      isSpeakingRef.current = false
    }, 150)
  }, [playServerTTS])

  // ---- Main speak function — always uses server-side Piper TTS ----
  const speak = useCallback((text: string, priority: "polite" | "assertive" = "polite", pan?: number) => {
    if (typeof window === 'undefined') return

    const now = Date.now()

    // For polite speech: skip if already speaking or spoke recently (1.5s cooldown)
    if (priority === "polite") {
      if (isSpeakingRef.current && speechQueueRef.current.length >= 2) return
      if (now - lastSpeakTimeRef.current < 1500) return
    }

    // Assertive speech: cancel current playback and clear polite items from queue
    if (priority === "assertive") {
      cancelCurrentAudio()
      // Keep only other assertive items in queue, drop polite ones
      speechQueueRef.current = speechQueueRef.current.filter(i => i.priority === "assertive")
      isProcessingQueueRef.current = false
      isSpeakingRef.current = false
    }

    lastSpeakTimeRef.current = now
    speechQueueRef.current.push({ text, priority, pan })
    processQueue()
  }, [cancelCurrentAudio, processQueue])

  return {
    isListening,
    transcript,
    isSupported,
    startListening,
    stopListening,
    speak,
  }
}
