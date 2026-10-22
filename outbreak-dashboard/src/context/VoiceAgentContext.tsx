import React, { createContext, useContext, useState, useRef, useEffect, useCallback, type ReactNode } from 'react';
import type { VoiceState, ScreenContext, VoiceConversationTurn, VoiceAgentContextType } from '../types/voice';
import { encodeWAV, resampleTo16k } from '../lib/wavEncoder';

const BACKEND_URL = 'http://127.0.0.1:8000';
const IDLE_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes of silence auto-deactivates mic
const TAB_ID = Math.random().toString(36).substring(2, 9);

function floatTo16kPcmBase64(channelData: Float32Array, inputSampleRate: number): string {
  const resampled = resampleTo16k(channelData, inputSampleRate);
  const pcm16 = new Int16Array(resampled.length);
  for (let i = 0; i < resampled.length; i++) {
    const s = Math.max(-1, Math.min(1, resampled[i]));
    pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  let binary = '';
  const bytes = new Uint8Array(pcm16.buffer, pcm16.byteOffset, pcm16.byteLength);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
}

const VoiceAgentContext = createContext<VoiceAgentContextType | null>(null);

export const VoiceAgentProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [state, setStateInternal] = useState<VoiceState>('off');
  const [isMuted, setIsMuted] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [history, setHistory] = useState<VoiceConversationTurn[]>([]);
  const [activeLanguage, setActiveLanguage] = useState<string>('en-IN');
  const [currentTranscript, setCurrentTranscript] = useState<string>('');
  const [agentResponse, setAgentResponse] = useState<string>('');
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);
  const [activeSpeaker, setActiveSpeaker] = useState<'user' | 'agent' | null>(null);
  const [speaker, setSpeakerState] = useState<'roopa' | 'aayan'>(() => {
    const saved = localStorage.getItem('mbies_voice_speaker');
    if (saved === 'aayan' || saved === 'girish') return 'aayan';
    return 'roopa';
  });

  const stateRef = useRef<VoiceState>('off');
  const isMutedRef = useRef(false);
  const historyRef = useRef<VoiceConversationTurn[]>([]);
  const speakerRef = useRef<'roopa' | 'aayan'>(speaker);
  speakerRef.current = speaker;

  const setSpeaker = useCallback((newSpeaker: 'roopa' | 'aayan') => {
    setSpeakerState(newSpeaker);
    speakerRef.current = newSpeaker;
    localStorage.setItem('mbies_voice_speaker', newSpeaker);
  }, []);

  const [micMode, setMicModeState] = useState<'ptt' | 'free'>(() => {
    return (localStorage.getItem('mbies_voice_mic_mode') as 'ptt' | 'free') || 'ptt';
  });
  const micModeRef = useRef<'ptt' | 'free'>(micMode);
  micModeRef.current = micMode;

  const setMicMode = useCallback((newMode: 'ptt' | 'free') => {
    setMicModeState(newMode);
    micModeRef.current = newMode;
    localStorage.setItem('mbies_voice_mic_mode', newMode);
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'set_mic_mode', mode: newMode }));
    }
  }, []);

  const isSpaceHeldRef = useRef(false);
  const isPhysicalSpaceDownRef = useRef(false);
  const stopPttRecordingRef = useRef<(() => void) | null>(null);

  const screenContextRef = useRef<ScreenContext>({
    currentView: 'analyst',
    scenarioId: 'bb0ff20e-b086-411b-8054-91560b1e88ec',
  });

  // Keep refs in sync
  stateRef.current = state;
  isMutedRef.current = isMuted;
  historyRef.current = history;

  const streamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const micAnalyserRef = useRef<AnalyserNode | null>(null);
  const agentAnalyserRef = useRef<AnalyserNode | null>(null);
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);
  const currentReplyCtxRef = useRef<AudioContext | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const idleTimerRef = useRef<number | null>(null);
  const channelRef = useRef<BroadcastChannel | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const audioQueueRef = useRef<AudioBufferSourceNode[]>([]);
  const nextPlayTimeRef = useRef<number>(0);
  const currentStreamingTurnTextRef = useRef<{ user: string; assistant: string }>({ user: '', assistant: '' });
  const thinkingTimeoutRef = useRef<number | null>(null);

  // Single transition function for state machine with watchdog
  const setVoiceState = useCallback((nextState: VoiceState) => {
    stateRef.current = nextState;
    setStateInternal(nextState);

    if (thinkingTimeoutRef.current) {
      clearTimeout(thinkingTimeoutRef.current);
      thinkingTimeoutRef.current = null;
    }

    if (nextState === 'thinking') {
      thinkingTimeoutRef.current = window.setTimeout(() => {
        if (stateRef.current === 'thinking') {
          console.warn('[VoiceAgent] Thinking watchdog triggered (12s). Resetting to idle.');
          stateRef.current = 'idle';
          setStateInternal('idle');
          setActiveSpeaker(null);
          setAnalyser(null);
        }
      }, 12000); // voice turns must complete in <10s; 12s is a safe ceiling
    }
  }, []);

  const resetIdleTimer = useCallback(() => {
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    idleTimerRef.current = window.setTimeout(() => {
      if (stateRef.current !== 'off') {
        console.log('[VoiceAgent] Idle timeout reached (10 min). Turning off mic.');
        deactivate();
      }
    }, IDLE_TIMEOUT_MS);
  }, []);

  // Barge-in: abort thinking or stop agent speech immediately
  const handleBargeIn = useCallback(() => {
    setActiveSpeaker(null);
    setAnalyser(null);
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
      currentAudioRef.current.currentTime = 0;
      currentAudioRef.current = null;
    }
    if (currentReplyCtxRef.current) {
      currentReplyCtxRef.current.close().catch(() => {});
      currentReplyCtxRef.current = null;
    }
    for (const src of audioQueueRef.current) {
      try { src.stop(); } catch (_) {}
    }
    audioQueueRef.current = [];
    nextPlayTimeRef.current = 0;

    setCurrentTranscript('');
    setAgentResponse('');
    currentStreamingTurnTextRef.current = { user: '', assistant: '' };

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'abort' }));
    }
  }, []);

  // Playback audio sentence chunk decoded directly via Web Audio API for gapless stream
  const playAudioSentence = useCallback(async (b64Audio: string) => {
    try {
      const ctx = audioContextRef.current;
      if (!ctx || ctx.state === 'closed') return;
      if (ctx.state === 'suspended') {
        await ctx.resume();
      }

      const binary = window.atob(b64Audio);
      const len = binary.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      const arrayBuf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      const audioBuffer = await ctx.decodeAudioData(arrayBuf);

      if (!agentAnalyserRef.current) {
        const an = ctx.createAnalyser();
        an.fftSize = 512;
        an.connect(ctx.destination);
        agentAnalyserRef.current = an;
      }
      const agentAnalyser = agentAnalyserRef.current;

      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(agentAnalyser);

      const PLAYBACK_LEAD_SEC = 0.12;
      const now = ctx.currentTime;
      const startTime = Math.max(now + PLAYBACK_LEAD_SEC, nextPlayTimeRef.current);
      source.start(startTime);
      nextPlayTimeRef.current = startTime + audioBuffer.duration;

      audioQueueRef.current.push(source);
      setVoiceState('speaking');
      setActiveSpeaker('agent');
      setAnalyser(agentAnalyser);

      source.onended = () => {
        const idx = audioQueueRef.current.indexOf(source);
        if (idx !== -1) {
          audioQueueRef.current.splice(idx, 1);
        }
        if (audioQueueRef.current.length === 0 && ctx.currentTime >= nextPlayTimeRef.current - 0.08) {
          setActiveSpeaker(null);
          setAnalyser(null);
          setVoiceState('idle');
          resetIdleTimer();
        }
      };
    } catch (err) {
      console.error('[VoiceAgent] Error playing audio sentence:', err);
    }
  }, [resetIdleTimer, setVoiceState]);

  // Connect streaming WebSocket to backend orchestrator
  const connectWebSocket = useCallback(() => {
    if (wsRef.current && (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING)) {
      return;
    }

    const wsUrl = BACKEND_URL.replace(/^http/, 'ws') + '/api/v1/voice/stream';
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({
        scenario_id: screenContextRef.current.scenarioId,
        speaker: speakerRef.current,
        language_code: activeLanguage,
        mic_mode: micModeRef.current,
        screen_context: screenContextRef.current,
        conversation_history: historyRef.current.slice(-6).map(h => ({ role: h.role, content: h.content }))
      }));
    };

    ws.onmessage = async (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'transcript_partial') {
          setCurrentTranscript(data.text);
          currentStreamingTurnTextRef.current.user = data.text;
        } else if (data.type === 'transcript_final') {
          setCurrentTranscript(data.text);
          currentStreamingTurnTextRef.current.user = data.text;
          currentStreamingTurnTextRef.current.assistant = '';
          setAgentResponse('');
          setVoiceState('thinking');
        } else if (data.type === 'agent_chunk') {
          currentStreamingTurnTextRef.current.assistant = (currentStreamingTurnTextRef.current.assistant ? currentStreamingTurnTextRef.current.assistant + ' ' : '') + data.text;
          setAgentResponse(currentStreamingTurnTextRef.current.assistant);
        } else if (data.type === 'audio_sentence') {
          if (data.audio) {
            await playAudioSentence(data.audio);
          }
        } else if (data.type === 'turn_complete') {
          const userText = currentStreamingTurnTextRef.current.user || currentTranscript;
          const assistantText = data.full_text || currentStreamingTurnTextRef.current.assistant;
          if (userText && assistantText) {
            setHistory(prev => [
              ...prev.slice(-8),
              { role: 'user', content: userText, timestamp: Date.now(), language: activeLanguage },
              { role: 'assistant', content: assistantText, timestamp: Date.now() + 1, language: activeLanguage }
            ]);
          }
        } else if (data.type === 'logged_findings') {
          const findings = data.findings || [];
          if (Array.isArray(findings) && findings.length > 0) {
            findings.forEach((f: any) => {
              window.dispatchEvent(
                new CustomEvent('eris-append-finding', {
                  detail: f,
                })
              );
            });
          }
        } else if (data.type === 'aborted') {
          for (const src of audioQueueRef.current) {
            try { src.stop(); } catch (_) {}
          }
          audioQueueRef.current = [];
          nextPlayTimeRef.current = 0;
          // Never reset to idle if user is actively holding spacebar / speaking
          if (!isSpaceHeldRef.current && stateRef.current !== 'listening') {
            setActiveSpeaker(null);
            setAnalyser(null);
            setVoiceState('idle');
          }
        } else if (data.type === 'turn_empty') {
          for (const src of audioQueueRef.current) {
            try { src.stop(); } catch (_) {}
          }
          audioQueueRef.current = [];
          nextPlayTimeRef.current = 0;
          setActiveSpeaker(null);
          setAnalyser(null);
          setVoiceState('idle');
          // Surface to user — silent idle is the recurring bug
          console.warn('[VoiceAgent] turn_empty received — STT returned no transcript. Possible causes: audio too short, STT network hiccup, VAD mismatch.');
          setErrorMessage("Sorry, I didn't catch that — could you say that again?");
          setTimeout(() => setErrorMessage(null), 3500);
        } else if (data.type === 'error') {
          console.warn('[VoiceAgent] WebSocket backend message:', data.message);
          setErrorMessage(data.message || 'Voice processing error occurred');
          setActiveSpeaker(null);
          setAnalyser(null);
          setVoiceState('error');
          setTimeout(() => {
            if (stateRef.current === 'error') {
              setVoiceState('idle');
            }
          }, 4000);
        }
      } catch (err) {
        console.warn('[VoiceAgent] WS message error:', err);
      }
    };

    ws.onerror = (e) => {
      console.warn('[VoiceAgent] WebSocket error, fallback available:', e);
    };

    ws.onclose = () => {
      wsRef.current = null;
      // Auto-reconnect streaming socket after 1 second if voice agent is active
      if (stateRef.current !== 'off' && !isMutedRef.current) {
        setTimeout(() => {
          if (stateRef.current !== 'off' && (!wsRef.current || wsRef.current.readyState === WebSocket.CLOSED)) {
            connectWebSocket();
          }
        }, 1000);
      }
    };
  }, [activeLanguage, playAudioSentence, setVoiceState]);

  // Process completed speech audio segment
  const processSpeech = useCallback(async (wavBlob: Blob) => {
    // If WS is open, the WebSocket pipeline already handled this — don't double-fire
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      setVoiceState('idle');
      return;
    }

    if (isMutedRef.current || stateRef.current === 'off') {
      setVoiceState('idle');
      return;
    }

    resetIdleTimer();
    setVoiceState('thinking');
    handleBargeIn();

    const abortCtrl = new AbortController();
    abortControllerRef.current = abortCtrl;

    try {
      // 1. Unified ultra-low-latency voice turn (STT -> Fast Groq LLM -> TTS)
      const currentHistory = historyRef.current.slice(-6).map(h => ({
        role: h.role,
        content: h.content,
      }));

      const formData = new FormData();
      formData.append('file', wavBlob, 'speech.wav');
      formData.append('scenario_id', screenContextRef.current.scenarioId);
      formData.append('speaker', speakerRef.current);
      formData.append('conversation_history', JSON.stringify(currentHistory));
      formData.append('screen_context', JSON.stringify(screenContextRef.current));

      const turnRes = await fetch(`${BACKEND_URL}/api/v1/voice/turn`, {
        method: 'POST',
        body: formData,
        signal: abortCtrl.signal,
      });

      if (!turnRes.ok) throw new Error(`Voice turn failed: ${turnRes.status}`);
      const turnData = await turnRes.json();

      const transcript = (turnData.transcript || '').trim();
      const detectedLang = turnData.language_code || 'en-IN';
      const agentReply = (turnData.response || '').trim();
      const audioBase64 = turnData.audio_base64;
      const loggedFindings = turnData.logged_findings || [];

      if (!transcript) {
        console.warn('[VoiceAgent] HTTP fallback: STT returned empty transcript');
        setErrorMessage("Sorry, I didn't catch that — could you say that again?");
        setTimeout(() => setErrorMessage(null), 3500);
        setVoiceState('idle');
        return;
      }

      // Dispatch any analytical findings / brief items autonomously generated by the voice agent
      if (Array.isArray(loggedFindings) && loggedFindings.length > 0) {
        loggedFindings.forEach((f: any) => {
          window.dispatchEvent(
            new CustomEvent('eris-append-finding', {
              detail: f,
            })
          );
        });
      }

      setCurrentTranscript(transcript);
      setActiveLanguage(detectedLang);
      setAgentResponse(agentReply);

      const userTurn: VoiceConversationTurn = {
        role: 'user',
        content: transcript,
        timestamp: Date.now(),
        language: detectedLang,
      };

      const assistantTurn: VoiceConversationTurn = {
        role: 'assistant',
        content: agentReply,
        timestamp: Date.now() + 1,
        language: detectedLang,
        audioBase64,
      };

      setHistory(prev => [...prev.slice(-8), userTurn, assistantTurn]);

      if (abortCtrl.signal.aborted) return;

      // 5. Playback audio response
      if (audioBase64) {
        setVoiceState('speaking');
        const audio = new Audio(`data:audio/wav;base64,${audioBase64}`);
        currentAudioRef.current = audio;

        try {
          const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
          const replyCtx = new AudioCtx();
          currentReplyCtxRef.current = replyCtx;
          const replyAnalyser = replyCtx.createAnalyser();
          replyAnalyser.fftSize = 512;
          const src = replyCtx.createMediaElementSource(audio);
          src.connect(replyAnalyser);
          replyAnalyser.connect(replyCtx.destination);
          setAnalyser(replyAnalyser);
          setActiveSpeaker('agent');

          audio.onended = () => {
            replyCtx.close().catch(() => {});
            currentReplyCtxRef.current = null;
            currentAudioRef.current = null;
            setAnalyser(null);
            setActiveSpeaker(null);
            setVoiceState('idle');
            resetIdleTimer();
          };

          audio.onerror = () => {
            replyCtx.close().catch(() => {});
            currentReplyCtxRef.current = null;
            currentAudioRef.current = null;
            setAnalyser(null);
            setActiveSpeaker(null);
            setVoiceState('idle');
            resetIdleTimer();
          };

          await audio.play();
        } catch (audioErr) {
          console.warn('[VoiceAgent] Web Audio routing fallback:', audioErr);
          audio.onended = () => {
            currentAudioRef.current = null;
            setVoiceState('idle');
            resetIdleTimer();
          };
          await audio.play();
        }
      } else {
        setVoiceState('idle');
      }
    } catch (err: any) {
      if (err.name === 'AbortError') {
        console.log('[VoiceAgent] Request aborted by barge-in');
        return;
      }
      console.error('[VoiceAgent] Pipeline error:', err);
      setErrorMessage(err.message || 'Voice connection failed');
      setVoiceState('error');
      setTimeout(() => setVoiceState('idle'), 3000);
    } finally {
      abortControllerRef.current = null;
    }
  }, [handleBargeIn, resetIdleTimer, setVoiceState]);

  // Activate hands-free voice session (requires user gesture)
  const activate = useCallback(async () => {
    try {
      setErrorMessage(null);

      // Multi-tab single lock: announce mic claim
      if (channelRef.current) {
        channelRef.current.postMessage({ type: 'CLAIM_MIC', tabId: TAB_ID });
      }

      // Request microphone stream
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      streamRef.current = stream;

      // Initialize / resume AudioContext inside user gesture
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      const ctx = new AudioCtx();
      audioContextRef.current = ctx;
      if (ctx.state === 'suspended') {
        await ctx.resume();
      }

      const source = ctx.createMediaStreamSource(stream);
      const micAnalyser = ctx.createAnalyser();
      micAnalyser.fftSize = 512;
      source.connect(micAnalyser);
      micAnalyserRef.current = micAnalyser;

      // Real-time audio buffer processor for hands-free speech detection
      const processor = ctx.createScriptProcessor(2048, 1, 1);
      processorRef.current = processor;

      const dummyGain = ctx.createGain();
      dummyGain.gain.value = 0;
      source.connect(processor);
      processor.connect(dummyGain);
      dummyGain.connect(ctx.destination);

      const sampleRate = ctx.sampleRate;
      let isSpeaking = false;
      let silenceMs = 0;
      let speechDurationMs = 0;
      let pttHoldDurationMs = 0;
      let recordedChunks: Float32Array[] = [];

      // Stop and process logic for Push-To-Talk (Spacebar) mode
      const stopAndProcessPtt = () => {
        const wasValidSpeech = pttHoldDurationMs >= 200;
        pttHoldDurationMs = 0;

        if (wasValidSpeech) {
          // If WebSocket is connected, commit streaming turn for sub-second response
          if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            setVoiceState('thinking');
            wsRef.current.send(JSON.stringify({ type: 'commit_turn' }));
            recordedChunks = [];
            return;
          }

          // Otherwise fall back to HTTP POST /api/v1/voice/turn
          if (recordedChunks.length > 0) {
            const totalLen = recordedChunks.reduce((acc, c) => acc + c.length, 0);
            const combined = new Float32Array(totalLen);
            let offset = 0;
            for (const chunk of recordedChunks) {
              combined.set(chunk, offset);
              offset += chunk.length;
            }
            recordedChunks = [];

            const resampled = resampleTo16k(combined, sampleRate);
            const wavBlob = encodeWAV(resampled, 16000);
            processSpeech(wavBlob);
            return;
          }
        }

        recordedChunks = [];
        setActiveSpeaker(null);
        setAnalyser(null);
        setVoiceState('idle');
      };
      stopPttRecordingRef.current = stopAndProcessPtt;

      // Adaptive noise floor tracking
      let noiseFloorRms = 0.015;
      let calibrationFrames = 0;
      const MAX_CALIBRATION_FRAMES = 35; // ~1.5s initial calibration
      let bargeInSustainMs = 0;

      processor.onaudioprocess = (e) => {
        if (isMutedRef.current || stateRef.current === 'off') return;

        const channelData = e.inputBuffer.getChannelData(0);

        // ── PTT (Hold Spacebar) Mode ──
        if (micModeRef.current === 'ptt') {
          if (isSpaceHeldRef.current) {
            recordedChunks.push(new Float32Array(channelData));
            pttHoldDurationMs += (channelData.length / sampleRate) * 1000;
            // Stream audio chunks in real-time over WebSocket if connected
            if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
              const b64 = floatTo16kPcmBase64(channelData, sampleRate);
              wsRef.current.send(JSON.stringify({ type: 'audio', data: b64 }));
            }
          }
          return;
        }
        let sum = 0;
        for (let i = 0; i < channelData.length; i++) {
          sum += channelData[i] * channelData[i];
        }
        const rms = Math.sqrt(sum / channelData.length);
        const chunkDurationMs = (channelData.length / sampleRate) * 1000;

        // Dynamic noise floor calibration during initial moments or silence
        if (calibrationFrames < MAX_CALIBRATION_FRAMES) {
          calibrationFrames++;
          noiseFloorRms = Math.min(0.04, Math.max(0.012, (noiseFloorRms * 0.8) + (rms * 0.2)));
        } else if (!isSpeaking && stateRef.current === 'idle') {
          // Slow continuous baseline drift adaptation
          noiseFloorRms = (noiseFloorRms * 0.98) + (Math.min(rms, 0.035) * 0.02);
        }

        // 1. Idle speech threshold: higher than background noise floor (min 0.032)
        const SPEECH_THRESHOLD = Math.max(0.032, noiseFloorRms * 1.75);

        // 2. High threshold for intentional barge-in when agent is speaking/thinking
        const BARGE_IN_THRESHOLD = Math.max(0.075, noiseFloorRms * 3.0);

        const isAgentActive = stateRef.current === 'thinking' || stateRef.current === 'speaking';

        // Check for intentional barge-in while agent is active
        if (isAgentActive) {
          if (rms >= BARGE_IN_THRESHOLD) {
            bargeInSustainMs += chunkDurationMs;
            // Require at least 250ms of sustained loud speech to barge in
            if (bargeInSustainMs >= 250) {
              console.log('[VoiceAgent] Intentional user barge-in detected. Halting playback.');
              handleBargeIn();
              bargeInSustainMs = 0;
              isSpeaking = true;
              silenceMs = 0;
              speechDurationMs = chunkDurationMs;
              if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
                const b64 = floatTo16kPcmBase64(channelData, sampleRate);
                wsRef.current.send(JSON.stringify({ type: 'audio', data: b64 }));
              } else {
                recordedChunks = [new Float32Array(channelData)];
              }
              setActiveSpeaker('user');
              setAnalyser(micAnalyserRef.current);
              setVoiceState('listening');
            }
          } else {
            bargeInSustainMs = 0;
          }
          return; // Ignore normal mic input while agent is thinking/speaking
        }

        // When agent is not speaking, reset barge-in counter
        bargeInSustainMs = 0;

        if (rms >= SPEECH_THRESHOLD) {
          silenceMs = 0;
          speechDurationMs += chunkDurationMs;

          if (!isSpeaking) {
            isSpeaking = true;
            setActiveSpeaker('user');
            setAnalyser(micAnalyserRef.current);
            setVoiceState('listening');
          }

          if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            const b64 = floatTo16kPcmBase64(channelData, sampleRate);
            wsRef.current.send(JSON.stringify({ type: 'audio', data: b64 }));
          } else {
            recordedChunks.push(new Float32Array(channelData));
          }
        } else {
          if (isSpeaking) {
            if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
              const b64 = floatTo16kPcmBase64(channelData, sampleRate);
              wsRef.current.send(JSON.stringify({ type: 'audio', data: b64 }));
            } else {
              recordedChunks.push(new Float32Array(channelData));
            }
            silenceMs += chunkDurationMs;

            // 450ms of silence indicates natural end of user utterance (aligned with Sarvam STT endpointing)
            if (silenceMs >= 450) {
              isSpeaking = false;
              silenceMs = 0;

              // Require at least 400ms of speech
              if (speechDurationMs >= 400) {
                if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
                  wsRef.current.send(JSON.stringify({ type: 'commit_turn' }));
                  setVoiceState('thinking');
                  recordedChunks = [];
                  speechDurationMs = 0;
                } else {
                  const totalLen = recordedChunks.reduce((acc, c) => acc + c.length, 0);
                  const combined = new Float32Array(totalLen);
                  let offset = 0;
                  for (const chunk of recordedChunks) {
                    combined.set(chunk, offset);
                    offset += chunk.length;
                  }
                  recordedChunks = [];
                  speechDurationMs = 0;

                  const resampled = resampleTo16k(combined, sampleRate);
                  const wavBlob = encodeWAV(resampled, 16000);
                  processSpeech(wavBlob);
                }
              } else {
                // Short blip ignored
                recordedChunks = [];
                speechDurationMs = 0;
                setActiveSpeaker(null);
                setAnalyser(null);
                if (stateRef.current === 'listening') {
                  setVoiceState('idle');
                }
              }
            }
          }
        }
      };

      // Connect streaming WebSocket session
      connectWebSocket();

      setVoiceState('idle');
      resetIdleTimer();
    } catch (err: any) {
      console.error('[VoiceAgent] Activation error:', err);
      setErrorMessage(err.message || 'Failed to activate microphone');
      setVoiceState('error');
      setTimeout(() => setVoiceState('off'), 3500);
    }
  }, [connectWebSocket, handleBargeIn, processSpeech, resetIdleTimer, setVoiceState]);

  // Deactivate voice session completely
  const deactivate = useCallback(() => {
    handleBargeIn();
    if (wsRef.current) {
      try {
        wsRef.current.close();
      } catch (_) {}
      wsRef.current = null;
    }
    if (idleTimerRef.current) {
      clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }
    if (processorRef.current) {
      try {
        processorRef.current.disconnect();
      } catch (e) {
        console.warn('[VoiceAgent] Error disconnecting processor:', e);
      }
      processorRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    micAnalyserRef.current = null;
    agentAnalyserRef.current = null;
    stopPttRecordingRef.current = null;
    isSpaceHeldRef.current = false;
    setVoiceState('off');
  }, [handleBargeIn, setVoiceState]);

  // Toggle mute
  const toggleMute = useCallback(() => {
    setIsMuted(prev => {
      const next = !prev;
      isMutedRef.current = next;
      if (next) {
        handleBargeIn();
        if (stateRef.current === 'listening' || stateRef.current === 'speaking') {
          setVoiceState('muted');
        }
      } else {
        if (stateRef.current === 'muted') {
          setVoiceState('idle');
        }
      }
      return next;
    });
  }, [handleBargeIn, setVoiceState]);

  // Proactive attention mode
  const setAttention = useCallback((active: boolean) => {
    if (stateRef.current !== 'off') {
      setVoiceState(active ? 'attention' : 'idle');
    }
  }, [setVoiceState]);

  // Direct programmatic speech output
  const speakText = useCallback(async (text: string, languageCode: string = 'en-IN') => {
    if (isMutedRef.current || !text || !text.trim()) return;
    const prevState = stateRef.current;
    try {
      setVoiceState('speaking');
      const ttsRes = await fetch(`${BACKEND_URL}/api/v1/sarvam/tts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, language_code: languageCode, speaker: speakerRef.current }),
      });
      if (!ttsRes.ok) throw new Error('TTS failed');
      const ttsData = await ttsRes.json();
      const audioBase64 = ttsData.audio_base64;
      if (audioBase64) {
        const audio = new Audio(`data:audio/wav;base64,${audioBase64}`);
        currentAudioRef.current = audio;
        audio.onended = () => {
          currentAudioRef.current = null;
          setVoiceState(prevState === 'off' ? 'off' : 'idle');
        };
        try {
          await audio.play();
        } catch (playErr) {
          console.warn('[VoiceAgent] HTML5 audio play blocked, falling back to Web Audio API:', playErr);
          try {
            const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
            const ctx = new AudioCtx();
            if (ctx.state === 'suspended') {
              await ctx.resume();
            }
            const binary = atob(audioBase64);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) {
              bytes[i] = binary.charCodeAt(i);
            }
            const decoded = await ctx.decodeAudioData(bytes.buffer);
            const source = ctx.createBufferSource();
            source.buffer = decoded;
            source.connect(ctx.destination);
            source.onended = () => {
              ctx.close().catch(() => {});
              setVoiceState(prevState === 'off' ? 'off' : 'idle');
            };
            source.start(0);
          } catch (webAudioErr) {
            console.error('[VoiceAgent] Web Audio API fallback failed:', webAudioErr);
            setVoiceState(prevState === 'off' ? 'off' : 'idle');
          }
        }
      } else {
        setVoiceState(prevState === 'off' ? 'off' : 'idle');
      }
    } catch (e) {
      console.error('[VoiceAgent] Programmatic speak error:', e);
      setVoiceState(prevState === 'off' ? 'off' : 'idle');
    }
  }, [setVoiceState]);

  const [screenContext, setScreenContextState] = useState<ScreenContext>(screenContextRef.current);

  // Update screen context
  const updateScreenContext = useCallback((ctx: Partial<ScreenContext>) => {
    screenContextRef.current = { ...screenContextRef.current, ...ctx };
    setScreenContextState({ ...screenContextRef.current });
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'screen_update', data: screenContextRef.current }));
    }
  }, []);

  // Keyboard shortcut: Alt+M to mute/unmute
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.altKey && (e.key === 'm' || e.key === 'M')) {
        e.preventDefault();
        toggleMute();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [toggleMute]);

  // Push-To-Talk: Hold Spacebar to speak
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (micModeRef.current !== 'ptt' || isMutedRef.current) return;
      if (e.code !== 'Space') return;

      // Ignore if user is typing in an input, textarea, or contentEditable
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable ||
          target.closest('input, textarea, [contenteditable="true"]'))
      ) {
        return;
      }

      // Ignore browser auto-repeat when holding spacebar
      if (e.repeat) {
        e.preventDefault();
        return;
      }

      e.preventDefault();

      isPhysicalSpaceDownRef.current = true;

      // If voice session is off, activate it first
      if (stateRef.current === 'off') {
        activate().then(() => {
          if (isPhysicalSpaceDownRef.current) {
            isSpaceHeldRef.current = true;
            setActiveSpeaker('user');
            setAnalyser(micAnalyserRef.current);
            setVoiceState('listening');
          } else {
            isSpaceHeldRef.current = false;
            setVoiceState('idle');
          }
        });
        return;
      }

      isSpaceHeldRef.current = true;
      if (stateRef.current === 'speaking' || stateRef.current === 'thinking') {
        handleBargeIn();
      }
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'start_turn' }));
      } else if (!wsRef.current || wsRef.current.readyState === WebSocket.CLOSED) {
        connectWebSocket();
      }
      setCurrentTranscript('');
      setAgentResponse('');
      setActiveSpeaker('user');
      setAnalyser(micAnalyserRef.current);
      setVoiceState('listening');
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (micModeRef.current !== 'ptt') return;
      if (e.code !== 'Space') return;

      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable ||
          target.closest('input, textarea, [contenteditable="true"]'))
      ) {
        return;
      }

      e.preventDefault();
      isPhysicalSpaceDownRef.current = false;

      if (!isSpaceHeldRef.current) return;
      isSpaceHeldRef.current = false;

      if (stopPttRecordingRef.current) {
        stopPttRecordingRef.current();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [activate, handleBargeIn, setVoiceState]);

  // Multi-tab single mic coordinator
  useEffect(() => {
    const channel = new BroadcastChannel('mbies_voice_session');
    channelRef.current = channel;

    channel.onmessage = (event) => {
      if (event.data?.type === 'CLAIM_MIC' && event.data?.tabId !== TAB_ID) {
        if (stateRef.current !== 'off') {
          console.log('[VoiceAgent] Microphone claimed by another tab. Deactivating this tab.');
          deactivate();
          setErrorMessage('Microphone transferred to another tab');
          setTimeout(() => setErrorMessage(null), 4000);
        }
      }
    };

    return () => {
      channel.close();
    };
  }, [deactivate]);

  // Clean up on component unmount
  useEffect(() => {
    return () => {
      deactivate();
    };
  }, [deactivate]);

  return (
    <VoiceAgentContext.Provider
      value={{
        state,
        isMuted,
        errorMessage,
        history,
        activeLanguage,
        currentTranscript,
        agentResponse,
        analyser,
        activeSpeaker,
        speaker,
        setSpeaker,
        micMode,
        setMicMode,
        activate,
        deactivate,
        toggleMute,
        setAttention,
        speakText,
        updateScreenContext,
        screenContext,
      }}
    >
      {children}
    </VoiceAgentContext.Provider>
  );
};

export const useVoiceAgent = (): VoiceAgentContextType => {
  const context = useContext(VoiceAgentContext);
  if (!context) {
    throw new Error('useVoiceAgent must be used within a VoiceAgentProvider');
  }
  return context;
};
