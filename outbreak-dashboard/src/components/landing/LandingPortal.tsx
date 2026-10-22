import { useState, useEffect } from 'react';
import LandingMapWrapper from './LandingMapWrapper';
import AuthCard from './AuthCard';

interface LandingPortalProps {
  onAuthSuccess?: () => void;
  onGuestAccess?: () => void;
}

export default function LandingPortal({ onAuthSuccess, onGuestAccess }: LandingPortalProps) {
  const [panelState, setPanelState] = useState<'landing' | 'auth'>('landing');

  // Sync with browser back/forward buttons
  useEffect(() => {
    const handlePopState = () => {
      if (window.location.hash.includes('auth')) {
        setPanelState('auth');
      } else {
        setPanelState('landing');
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const goToAuth = () => {
    setPanelState('auth');
    window.history.pushState({ panel: 'auth' }, '', '#auth');
  };

  const goToLanding = () => {
    setPanelState('landing');
    window.history.pushState({ panel: 'landing' }, '', '#overview');
  };

  return (
    <div className="flex flex-col md:flex-row w-screen h-screen overflow-hidden bg-[#F9F9FB] text-slate-800">
      {/* ── LEFT HALF (50%): Rounded Map Frame with Subtle Background Margin ── */}
      <div className="w-full md:w-1/2 h-[45vh] md:h-full p-2.5 sm:p-3 md:p-3.5 lg:p-4 bg-[#F9F9FB] flex flex-col justify-center items-center">
        <div className="w-full h-full rounded-2xl md:rounded-[22px] overflow-hidden border border-slate-200/90 shadow-[0_4px_20px_rgba(0,0,0,0.04)] relative">
          <LandingMapWrapper />
        </div>
      </div>

      {/* ── RIGHT HALF (50%): Interactive Briefing (State 1) & Auth (State 2) ── */}
      <div className="w-full md:w-1/2 h-full flex flex-col justify-center items-center p-3 sm:p-6 md:p-8 overflow-hidden bg-[#F9F9FB] relative">
        {panelState === 'landing' ? (
          <div className="w-full max-w-[480px] flex flex-col justify-between h-full max-h-[500px]">
            {/* Top: Minimalist Institutional Brand Wordmark with Mandala Emblem */}
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 text-slate-800 flex items-center justify-center shrink-0">
                <svg className="w-9 h-9" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <circle cx="24" cy="24" r="5" strokeWidth="2.2" />
                  <circle cx="24" cy="13" r="5" strokeDasharray="1 0" />
                  <circle cx="24" cy="35" r="5" strokeDasharray="1 0" />
                  <circle cx="13" cy="24" r="5" strokeDasharray="1 0" />
                  <circle cx="35" cy="24" r="5" strokeDasharray="1 0" />
                  <circle cx="16" cy="16" r="5" opacity="0.65" />
                  <circle cx="32" cy="16" r="5" opacity="0.65" />
                  <circle cx="16" cy="32" r="5" opacity="0.65" />
                  <circle cx="32" cy="32" r="5" opacity="0.65" />
                </svg>
              </div>
              <span className="font-heading font-extrabold text-2xl sm:text-3xl text-slate-900 tracking-tight">
                MBEIS
              </span>
              <span className="h-4 w-px bg-slate-300" />
              <span className="text-[11px] font-mono tracking-wider text-slate-500 uppercase font-medium">
                Epidemic Decision Support
              </span>
            </div>

            {/* Middle: Newsreader Editorial Headline + 3 Structured Intelligence Points */}
            <div className="mt-2.5 mb-3.5 space-y-3.5">
              <h2
                style={{ fontFamily: '"Newsreader", Georgia, serif', fontWeight: 500 }}
                className="text-2xl sm:text-[28px] lg:text-[32px] text-slate-900 leading-[1.18] tracking-normal"
              >
                Anticipate outbreaks before they overwhelm critical infrastructure.
              </h2>

              <div className="space-y-3 pt-0.5">
                {/* 1. Multi-Modal Transit */}
                <div className="flex items-start gap-3">
                  <div className="shrink-0 mt-0.5 text-slate-800">
                    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="5" cy="12" r="2.2" />
                      <circle cx="19" cy="6" r="2.2" />
                      <circle cx="17" cy="18" r="2.2" />
                      <path d="M7.2 11.2L16.8 6.8" />
                      <path d="M7.1 13.2L14.9 17" />
                      <path d="M18.5 8.2L17.5 15.8" strokeDasharray="2 1.5" />
                    </svg>
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="font-sans font-semibold text-[13.5px] sm:text-[14px] text-slate-900 tracking-tight mb-0.5">
                      Multi-Modal Transit Modeling
                    </h3>
                    <p className="font-sans text-[12px] sm:text-[13px] text-slate-600 leading-snug">
                      Simulates contagion spread across Indian commercial aviation, passenger rail, and interstate highway corridors.
                    </p>
                  </div>
                </div>

                {/* 2. Dynamic Interventions */}
                <div className="flex items-start gap-3">
                  <div className="shrink-0 mt-0.5 text-slate-800">
                    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="2" fill="currentColor" />
                      <circle cx="12" cy="12" r="6" strokeDasharray="2.5 1.5" />
                      <path d="M12 2v2.5m0 15V22M2 12h2.5m15 0H22" />
                      <circle cx="12" cy="12" r="9.5" />
                    </svg>
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="font-sans font-semibold text-[13.5px] sm:text-[14px] text-slate-900 tracking-tight mb-0.5">
                      Dynamic Intervention Testing
                    </h3>
                    <p className="font-sans text-[12px] sm:text-[13px] text-slate-600 leading-snug">
                      Evaluates spatial cordons, rail halts, and localized hospital resource strain before peak surges occur.
                    </p>
                  </div>
                </div>

                {/* 3. Voice AI Assistant */}
                <div className="flex items-start gap-3">
                  <div className="shrink-0 mt-0.5 text-slate-800">
                    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M2 12h2" />
                      <path d="M6 8v8" />
                      <path d="M10 5v14" />
                      <path d="M14 3v18" />
                      <path d="M18 7v10" />
                      <path d="M22 12h-2" />
                      <circle cx="14" cy="12" r="1.5" fill="currentColor" />
                    </svg>
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="font-sans font-semibold text-[13.5px] sm:text-[14px] text-slate-900 tracking-tight mb-0.5">
                      Autonomous Voice AI Assistant
                    </h3>
                    <p className="font-sans text-[12px] sm:text-[13px] text-slate-600 leading-snug">
                      Talk directly with the AI copilot to ask questions, explore 'what-if' scenarios, and receive live voice briefings.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Bottom: Clean Primary CTA Button (No metric cards or colored badges) */}
            <div className="pt-2">
              <button
                type="button"
                onClick={goToAuth}
                className="w-full sm:w-auto min-w-[200px] py-2.5 px-6 rounded-xl bg-[#2E4A8C] hover:bg-[#203668] text-white font-sans font-medium text-sm shadow-sm hover:shadow-md active:scale-[0.99] transition-all flex items-center justify-center gap-2 group cursor-pointer"
              >
                <span>Access Portal</span>
                <svg
                  className="w-4 h-4 transform group-hover:translate-x-1 transition-transform"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                >
                  <path
                    fillRule="evenodd"
                    d="M10.293 3.293a1 1 0 011.414 0l6 6a1 1 0 010 1.414l-6 6a1 1 0 01-1.414-1.414L14.586 11H3a1 1 0 110-2h11.586l-4.293-4.293a1 1 0 010-1.414z"
                    clipRule="evenodd"
                  />
                </svg>
              </button>
            </div>
          </div>
        ) : (
          <div className="w-full max-w-[440px] flex flex-col items-center">
            {/* Top Back Link */}
            <div className="w-full flex items-center justify-start mb-2.5">
              <button
                type="button"
                onClick={goToLanding}
                className="flex items-center gap-1.5 text-xs font-mono font-semibold text-slate-500 hover:text-slate-900 transition-colors cursor-pointer py-1 px-2 rounded-lg hover:bg-slate-200/60"
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
                  <path
                    fillRule="evenodd"
                    d="M9.707 16.707a1 1 0 01-1.414 0l-6-6a1 1 0 010-1.414l6-6a1 1 0 011.414 1.414L5.414 9H17a1 1 0 110 2H5.414l4.293 4.293a1 1 0 010 1.414z"
                    clipRule="evenodd"
                  />
                </svg>
                <span>Back to Overview</span>
              </button>
            </div>

            {/* Auth Form Card */}
            <AuthCard onSuccess={onAuthSuccess} onGuestAccess={onGuestAccess} />
          </div>
        )}
      </div>
    </div>
  );
}
