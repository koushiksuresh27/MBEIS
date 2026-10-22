import React, { useEffect, useRef } from 'react';
import type { VoiceState } from '../../types/voice';
import './VoiceOrb.css';

interface VoiceOrbProps {
  state: VoiceState;
  analyser?: AnalyserNode | null;
  activeSpeaker?: 'user' | 'agent' | null;
  className?: string;
}

class VoiceDots {
  el: HTMLDivElement;
  H = 60;
  hist: number[];
  s = 0;
  analyser: AnalyserNode | null = null;
  state: VoiceState = 'idle';
  raf = 0;
  dots: HTMLElement[] = [];
  idx: number[] = [];
  buf: Uint8Array<ArrayBuffer> = new Uint8Array(0);

  constructor(el: HTMLDivElement, variant: 'wave' | 'spiral') {
    this.el = el;
    this.hist = new Array(this.H).fill(0);
    el.dataset.variant = variant;

    const cfg =
      variant === 'wave'
        ? {
            c: 12,
            r: 5,
            think: (c: number) => c * 0.1,
            lag: (c: number) => c * 0.04, // voice travels left → right
          }
        : {
            c: 11,
            r: 11,
            think: (c: number, r: number) => {
              const x = c - 5;
              const y = r - 5;
              return Math.hypot(x, y) * 0.09 + ((Math.atan2(y, x) + Math.PI) / (2 * Math.PI)) * 1.3;
            },
            lag: (c: number, r: number) => Math.hypot(c - 5, r - 5) * 0.05, // voice travels outward from centre
          };

    el.style.gridTemplateColumns = `repeat(${cfg.c}, var(--dot-size, 9px))`;
    el.replaceChildren();
    this.dots = [];
    this.idx = [];

    for (let r = 0; r < cfg.r; r++) {
      for (let c = 0; c < cfg.c; c++) {
        const i = document.createElement('i');
        i.style.setProperty('--d', cfg.think(c, r).toFixed(2) + 's');
        el.appendChild(i);
        this.dots.push(i);
        this.idx.push(Math.min(this.H - 1, Math.round(cfg.lag(c, r) * 60)));
      }
    }

    this.loop = this.loop.bind(this);
    this.raf = requestAnimationFrame(this.loop);
  }

  setState(state: VoiceState) {
    this.state = state;
    this.el.dataset.state = state;
    if (state === 'idle' || state === 'thinking' || state === 'off') {
      this.analyser = null;
    }
  }

  attach(analyser: AnalyserNode | null) {
    this.analyser = analyser;
    if (analyser) {
      this.buf = new Uint8Array(analyser.fftSize);
    }
  }

  level(): number {
    if (this.state !== 'listening' && this.state !== 'speaking') return 0;
    if (this.analyser && this.buf.length > 0) {
      this.analyser.getByteTimeDomainData(this.buf);
      let sum = 0;
      for (let i = 0; i < this.buf.length; i++) {
        const v = (this.buf[i] - 128) / 128;
        sum += v * v;
      }
      return Math.min(1, Math.sqrt(sum / this.buf.length) * 3.4);
    }
    return 0;
  }

  loop() {
    this.raf = requestAnimationFrame(this.loop);
    this.s += (this.level() - this.s) * 0.35; // smooth envelope
    this.hist.unshift(this.s);
    this.hist.length = this.H;

    const think = this.state === 'thinking';
    for (let k = 0; k < this.dots.length; k++) {
      const val = think ? '0' : (this.hist[this.idx[k]] || 0).toFixed(3);
      this.dots[k].style.setProperty('--v', val);
    }
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.el.replaceChildren();
  }
}

export const VoiceOrb: React.FC<VoiceOrbProps> = ({
  state,
  analyser = null,
  activeSpeaker = null,
  className = '',
}) => {
  const userVizRef = useRef<HTMLDivElement>(null);
  const agentVizRef = useRef<HTMLDivElement>(null);
  const userDotsRef = useRef<VoiceDots | null>(null);
  const agentDotsRef = useRef<VoiceDots | null>(null);

  // Initialize dot grids
  useEffect(() => {
    if (userVizRef.current && !userDotsRef.current) {
      userDotsRef.current = new VoiceDots(userVizRef.current, 'wave');
    }
    if (agentVizRef.current && !agentDotsRef.current) {
      agentDotsRef.current = new VoiceDots(agentVizRef.current, 'spiral');
    }

    return () => {
      userDotsRef.current?.destroy();
      agentDotsRef.current?.destroy();
      userDotsRef.current = null;
      agentDotsRef.current = null;
    };
  }, []);

  // Update states and attached analyser nodes
  useEffect(() => {
    if (!userDotsRef.current || !agentDotsRef.current) return;

    userDotsRef.current.setState(state);
    agentDotsRef.current.setState(state);

    if (state === 'listening' && activeSpeaker === 'user') {
      userDotsRef.current.attach(analyser);
    } else if (state === 'speaking' && activeSpeaker === 'agent') {
      agentDotsRef.current.attach(analyser);
    } else {
      userDotsRef.current.attach(null);
      agentDotsRef.current.attach(null);
    }
  }, [state, analyser, activeSpeaker]);

  // Determine which visual is active: only show user wavefront when listening
  const isUserActive = state === 'listening';
  const announcement =
    state === 'listening'
      ? 'Listening'
      : state === 'thinking'
      ? 'Thinking'
      : state === 'speaking'
      ? 'Speaking'
      : state === 'muted'
      ? 'Muted'
      : '';

  return (
    <div className={`vd-stage ${className}`}>
      {/* Visually hidden screen-reader live announcements */}
      <div aria-live="polite" className="sr-only">
        {announcement}
      </div>

      {/* User Wavefront Grid (Blue #2347D9) */}
      <div
        ref={userVizRef}
        id="userViz"
        className={`vd ${!isUserActive ? 'off' : ''}`}
        data-variant="wave"
        data-state={state}
        role="img"
        aria-label="User voice activity"
      />

      {/* Agent Spiral Bloom Grid (Coral #FF4D2E / Idle #C9D1E0) */}
      <div
        ref={agentVizRef}
        id="agentViz"
        className={`vd ${isUserActive ? 'off' : ''}`}
        data-variant="spiral"
        data-state={state}
        role="img"
        aria-label="AI Partner response"
      />
    </div>
  );
};

export default VoiceOrb;
