import React, { useState, useRef, useEffect } from 'react';
import { useVoiceAgent } from '../../context/VoiceAgentContext';
import VoiceOrb from './VoiceOrb';

export const VoicePartnerDock: React.FC = () => {
  const {
    state,
    isMuted,
    errorMessage,
    analyser,
    activeSpeaker,
    speaker,
    setSpeaker,
    micMode,
    setMicMode,
    activate,
    deactivate,
    toggleMute,
  } = useVoiceAgent();

  const isActive = state !== 'off';

  // Draggable position coordinates with persistence and boundary check
  const [pos, setPos] = useState<{ x: number; y: number }>(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem('mbies_voice_dock_pos');
        if (saved) {
          const parsed = JSON.parse(saved);
          if (typeof parsed.x === 'number' && typeof parsed.y === 'number') {
            return {
              x: Math.min(Math.max(16, parsed.x), window.innerWidth - 200),
              y: Math.min(Math.max(16, parsed.y), window.innerHeight - 200),
            };
          }
        }
      } catch {}
      const defaultX = window.innerWidth - 216;
      const defaultY = window.innerHeight - 216;
      return { x: Math.max(16, defaultX), y: Math.max(16, defaultY) };
    }
    return { x: 800, y: 600 };
  });

  const isDraggingRef = useRef(false);
  const dragDistRef = useRef(0);
  const dragStartRef = useRef<{ startX: number; startY: number; initialX: number; initialY: number }>({
    startX: 0,
    startY: 0,
    initialX: 0,
    initialY: 0,
  });

  // Keep within viewport on window resize
  useEffect(() => {
    const handleResize = () => {
      const size = isActive ? 184 : 64;
      setPos(prev => ({
        x: Math.min(Math.max(16, prev.x), window.innerWidth - size - 16),
        y: Math.min(Math.max(16, prev.y), window.innerHeight - size - 16),
      }));
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [isActive]);

  // Robust pointer drag event handlers using HTML5 pointer capture
  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;

    isDraggingRef.current = false;
    dragDistRef.current = 0;
    dragStartRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      initialX: pos.x,
      initialY: pos.y,
    };

    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {}
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.buttons !== 1) return;

    const dx = e.clientX - dragStartRef.current.startX;
    const dy = e.clientY - dragStartRef.current.startY;
    const dist = Math.hypot(dx, dy);
    dragDistRef.current = dist;

    if (dist > 4) {
      isDraggingRef.current = true;
    }

    const size = isActive ? 184 : 64;
    const newX = Math.min(Math.max(12, dragStartRef.current.initialX + dx), window.innerWidth - size - 12);
    const newY = Math.min(Math.max(12, dragStartRef.current.initialY + dy), window.innerHeight - size - 12);
    setPos({ x: newX, y: newY });
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {}

    if (isDraggingRef.current) {
      // Persist chosen position
      try {
        localStorage.setItem('mbies_voice_dock_pos', JSON.stringify(pos));
      } catch {}
      // Small delay before clearing drag flag to prevent accidental click trigger
      setTimeout(() => {
        isDraggingRef.current = false;
      }, 60);
    } else {
      isDraggingRef.current = false;
      // If inactive and was a clean tap/click, activate!
      if (!isActive) {
        activate();
      }
    }
  };

  // Glow styling based on voice state
  const getGlowStyles = () => {
    switch (state) {
      case 'listening':
        return 'border-blue-500/50 shadow-[0_0_36px_rgba(35,71,217,0.35)] ring-1 ring-blue-500/30';
      case 'speaking':
        return 'border-[#FF4D2E]/50 shadow-[0_0_36px_rgba(255,77,46,0.35)] ring-1 ring-[#FF4D2E]/30';
      case 'thinking':
        return 'border-amber-500/40 shadow-[0_0_28px_rgba(245,158,11,0.25)]';
      case 'muted':
        return 'border-neutral-500/40 shadow-md opacity-80';
      default:
        return 'border-outline/30 shadow-2xl';
    }
  };

  // INACTIVE STATE: Draggable, clickable rounded squircle button with dot grid preview
  if (!isActive) {
    return (
      <div
        style={{ left: `${pos.x}px`, top: `${pos.y}px` }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        className="fixed z-50 w-16 h-16 rounded-2xl bg-surface/90 hover:bg-surface backdrop-blur-xl border border-outline/40 shadow-xl hover:shadow-2xl transition-shadow flex items-center justify-center cursor-grab active:cursor-grabbing select-none touch-none group"
        title="Drag anywhere • Click to wake ERIS (Hold Space to talk)"
      >
        <div className="grid grid-cols-3 gap-1 pointer-events-none group-hover:scale-105 transition-transform duration-200">
          <span className="w-1.5 h-1.5 rounded-full bg-primary/70 group-hover:bg-primary transition-colors" />
          <span className="w-1.5 h-1.5 rounded-full bg-primary/40 group-hover:bg-primary transition-colors" />
          <span className="w-1.5 h-1.5 rounded-full bg-primary/70 group-hover:bg-primary transition-colors" />
          <span className="w-1.5 h-1.5 rounded-full bg-primary/40 group-hover:bg-primary transition-colors" />
          <span className="w-2 h-2 rounded-full bg-primary animate-pulse shadow-[0_0_8px_rgba(35,71,217,0.6)]" />
          <span className="w-1.5 h-1.5 rounded-full bg-primary/40 group-hover:bg-primary transition-colors" />
          <span className="w-1.5 h-1.5 rounded-full bg-primary/70 group-hover:bg-primary transition-colors" />
          <span className="w-1.5 h-1.5 rounded-full bg-primary/40 group-hover:bg-primary transition-colors" />
          <span className="w-1.5 h-1.5 rounded-full bg-primary/70 group-hover:bg-primary transition-colors" />
        </div>
      </div>
    );
  }

  // ACTIVE STATE: Draggable 184x184 squircle with VoiceOrb + subtle top controls
  return (
    <div
      style={{ left: `${pos.x}px`, top: `${pos.y}px` }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      className={`fixed z-50 w-[184px] h-[184px] rounded-3xl bg-surface/85 backdrop-blur-xl border flex items-center justify-center cursor-grab active:cursor-grabbing select-none touch-none transition-shadow duration-300 group ${getGlowStyles()}`}
    >
      {/* Top Controls Bar — Appears on hover */}
      <div className="absolute top-2.5 inset-x-2.5 flex items-center justify-between opacity-0 group-hover:opacity-100 transition-opacity duration-200 z-20">
        {/* Voice Selector Pill (ERIS(F) vs ERIS(M)) */}
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            setSpeaker(speaker === 'roopa' ? 'aayan' : 'roopa');
          }}
          className="h-6 px-2 rounded-full bg-surface-container/90 hover:bg-surface-variant text-[10.5px] font-medium text-on-surface tracking-tight flex items-center gap-1 transition-all shadow-sm border border-outline/30 cursor-pointer backdrop-blur-md active:scale-95"
          title={`Voice Persona: ${speaker === 'roopa' ? 'ERIS(F) · Female' : 'ERIS(M) · Male'} • Click to switch`}
        >
          <span className={`w-1.5 h-1.5 rounded-full ${speaker === 'roopa' ? 'bg-pink-400' : 'bg-blue-400'}`} />
          <span>{speaker === 'roopa' ? 'ERIS(F)' : 'ERIS(M)'}</span>
        </button>

        {/* Right side controls: Mode Toggle (Space vs Free), Mute & Close */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              setMicMode(micMode === 'ptt' ? 'free' : 'ptt');
            }}
            className="h-6 px-1.5 rounded-full bg-surface-container/90 hover:bg-surface-variant text-[10px] font-medium text-on-surface tracking-tight flex items-center gap-1 transition-all shadow-sm border border-outline/30 cursor-pointer backdrop-blur-md active:scale-95"
            title={
              micMode === 'ptt'
                ? 'Space Mode: Hold Spacebar to speak • Click for Free mode'
                : 'Free Mode: Hands-free VAD • Click for Space mode'
            }
          >
            <span className={`w-1.5 h-1.5 rounded-full ${micMode === 'ptt' ? 'bg-primary' : 'bg-emerald-400'}`} />
            <span>{micMode === 'ptt' ? 'Space' : 'Free'}</span>
          </button>

          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              toggleMute();
            }}
            className={`w-6 h-6 rounded-full flex items-center justify-center transition-colors cursor-pointer active:scale-95 ${
              isMuted ? 'bg-red-500 text-white' : 'bg-surface-container/90 text-on-surface-variant hover:text-on-surface hover:bg-surface-variant border border-outline/20'
            }`}
            title={isMuted ? 'Unmute (Alt+M)' : 'Mute (Alt+M)'}
          >
            <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              {isMuted ? (
                <>
                  <line x1="1" y1="1" x2="23" y2="23" />
                  <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" />
                  <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23" />
                  <line x1="12" y1="19" x2="12" y2="23" />
                  <line x1="8" y1="23" x2="16" y2="23" />
                </>
              ) : (
                <>
                  <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                  <line x1="12" y1="19" x2="12" y2="23" />
                  <line x1="8" y1="23" x2="16" y2="23" />
                </>
              )}
            </svg>
          </button>

          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              deactivate();
            }}
            className="w-6 h-6 rounded-full bg-surface-container/90 text-on-surface-variant hover:text-red-500 hover:bg-surface-variant flex items-center justify-center transition-colors cursor-pointer active:scale-95 border border-outline/20"
            title="Turn off voice partner"
          >
            <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      </div>

      {/* The Pure Voice Bloom Dot Grid */}
      <div className="w-full h-full flex items-center justify-center pointer-events-none p-2">
        <VoiceOrb
          state={state}
          analyser={analyser}
          activeSpeaker={activeSpeaker}
        />
      </div>

      {/* Visible Error Banner if state is error */}
      {state === 'error' && errorMessage && (
        <div className="absolute -top-9 inset-x-0 flex justify-center pointer-events-none z-30">
          <div className="bg-red-500/90 text-white text-[10px] font-medium px-2.5 py-1 rounded-full shadow-lg backdrop-blur-md max-w-[200px] truncate border border-red-400/30 animate-bounce">
            {errorMessage}
          </div>
        </div>
      )}

      {/* Subtle Spacebar status helper in PTT mode */}
      {micMode === 'ptt' && (
        <div className="absolute bottom-2.5 inset-x-2.5 flex justify-center pointer-events-none z-20">
          <span
            className={`text-[9px] font-medium tracking-wide uppercase px-2.5 py-0.5 rounded-full backdrop-blur-md transition-all ${
              state === 'listening'
                ? 'bg-primary/20 text-primary border border-primary/40 shadow-sm animate-pulse'
                : 'text-on-surface-variant/70 bg-surface-container/80 border border-outline/20'
            }`}
          >
            {state === 'listening' ? 'Listening • Release Space' : 'Hold Space to talk'}
          </span>
        </div>
      )}
    </div>
  );
};

export default VoicePartnerDock;
