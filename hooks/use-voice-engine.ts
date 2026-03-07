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
  // Web API context not needed anymore for simple TTS
  // Speech queue for sequential playback without overlap

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
        if (event.error === "not-allowed") {
          console.error('[VOICE] Microphone permission denied. Grant access in browser settings.')
          alert("Microphone permission denied. Please enable it in your browser settings to use voice commands.")
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
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel()
    }
  }, [])

  // ---- Play a single TTS item via native Web Speech API ----
  const playBrowserTTS = useCallback(async (text: string, pan?: number): Promise<void> => {
    return new Promise<void>((resolve) => {
      if (typeof window === 'undefined' || !window.speechSynthesis) {
        resolve()
        return
      }

      // Trigger voice load if not already
      window.speechSynthesis.getVoices()

      const utterance = new SpeechSynthesisUtterance(text)
      utterance.rate = 1.05

      const voices = window.speechSynthesis.getVoices()
      const englishVoices = voices.filter(v => v.lang.startsWith('en'))
      if (englishVoices.length > 0) {
        // Prefer natural sounding standard voices mapping platforms
        const preferred = englishVoices.find(v => 
          v.name.includes("Google") || 
          v.name.includes("Siri") || 
          v.name.includes("Daniel") || 
          v.name.includes("Samantha")
        )
        utterance.voice = preferred || englishVoices[0]
      }

      utterance.onend = () => resolve()
      utterance.onerror = (e) => {
        if (e.error !== 'canceled') {
          console.warn('[VOICE] TTS playback error:', e.error)
        }
        resolve() // Resolve anyway to proceed with queue
      }

      window.speechSynthesis.speak(utterance)
    })
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
        await playBrowserTTS(item.text, item.pan)
      } catch (e) {
        console.error('[VOICE] TTS playback error:', e)
      }
    }

    isProcessingQueueRef.current = false
    // Small buffer to let room echoes die down before re-enabling mic input
    setTimeout(() => {
      isSpeakingRef.current = false
    }, 150)
  }, [playBrowserTTS])

  // ---- Main speak function — always uses Web native TTS ----
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
