import { useState } from 'react';
import { supabase } from '../../lib/supabase';

interface AuthCardProps {
  onSuccess?: () => void;
  onGuestAccess?: () => void;
}

export default function AuthCard({ onSuccess, onGuestAccess }: AuthCardProps) {
  const [authMode, setAuthMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [infoMsg, setInfoMsg] = useState<string | null>(null);

  // 1. Google OAuth
  const handleGoogleSignIn = async () => {
    setErrorMsg(null);
    setInfoMsg(null);
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: window.location.origin,
        },
      });
      if (error) throw error;
    } catch (err: any) {
      setErrorMsg(err.message || 'Google authentication failed.');
      setLoading(false);
    }
  };

  // 2. Email / Password Submission
  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      setErrorMsg('Please enter both your email and password.');
      return;
    }

    setErrorMsg(null);
    setInfoMsg(null);
    setLoading(true);

    try {
      if (authMode === 'signup') {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
        });
        if (error) throw error;
        if (data.session) {
          onSuccess?.();
        } else {
          setInfoMsg('Account created! Please check your email inbox to confirm your registration.');
        }
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (error) throw error;
        if (data.session) {
          onSuccess?.();
        }
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Authentication error.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-full max-w-[420px] mx-auto flex flex-col items-center">
      {/* Brand Subtitle & Emblem (from Sarvam Indus reference) */}
      <div className="flex flex-col items-center mb-2.5 text-center">
        {/* Geometric Floral / Network Mandala Icon */}
        <div className="w-12 h-12 mb-2 text-slate-800 dark:text-slate-100 flex items-center justify-center">
          <svg className="w-11 h-11" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.8">
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

        <h1 className="text-xl sm:text-2xl font-heading font-semibold text-slate-900 tracking-tight">
          Log into your account
        </h1>
        <p className="text-xs text-slate-500 mt-0.5 font-sans">
          Epidemic decision support, simplified
        </p>
      </div>

      {/* Main Authentication Card */}
      <div className="w-full bg-white rounded-2xl p-5 sm:p-6 shadow-[0_6px_28px_rgb(0,0,0,0.06)] border border-[#E3E2E8] transition-all">
        {/* Header Tag */}
        <div className="text-center mb-3">
          <span className="text-[10px] font-mono tracking-widest font-semibold uppercase text-slate-400">
            Sign in to continue
          </span>
        </div>

        {/* Error / Info Alerts */}
        {errorMsg && (
          <div className="mb-4 p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-red-600 flex items-start gap-2">
            <svg className="w-4 h-4 shrink-0 mt-0.5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
            <span className="leading-relaxed">{errorMsg}</span>
          </div>
        )}

        {infoMsg && (
          <div className="mb-4 p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-700 flex items-start gap-2">
            <svg className="w-4 h-4 shrink-0 mt-0.5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
            </svg>
            <span className="leading-relaxed">{infoMsg}</span>
          </div>
        )}

        {/* 1. Continue with Google Button */}
        <button
          type="button"
          onClick={handleGoogleSignIn}
          disabled={loading}
          className="w-full flex items-center justify-center gap-2.5 py-2 px-3 rounded-xl border border-slate-200 bg-white text-slate-700 font-sans font-medium text-xs shadow-xs hover:bg-slate-50 active:scale-[0.99] transition-all cursor-pointer disabled:opacity-60"
        >
          {/* Official Google 'G' icon */}
          <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24">
            <path
              fill="#4285F4"
              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
            />
            <path
              fill="#34A853"
              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
            />
            <path
              fill="#FBBC05"
              d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
            />
            <path
              fill="#EA4335"
              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
            />
          </svg>
          <span>Continue with Google</span>
        </button>

        {/* Divider: or sign in with email */}
        <div className="relative my-2.5 flex items-center justify-center">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-slate-200" />
          </div>
          <span className="relative bg-white px-2.5 text-[10px] font-sans text-slate-400">
            or sign in with email
          </span>
        </div>

        {/* 2. Direct Email Form */}
        <form onSubmit={handleEmailSubmit} className="space-y-2.5 pt-0.5">
          {/* Mode Switcher Tabs */}
          <div className="flex rounded-lg bg-slate-100 p-0.5 border border-slate-200">
            <button
              type="button"
              onClick={() => setAuthMode('signin')}
              className={`flex-1 py-1 text-xs font-sans font-medium rounded-md transition-all ${
                authMode === 'signin'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => setAuthMode('signup')}
              className={`flex-1 py-1 text-xs font-sans font-medium rounded-md transition-all ${
                authMode === 'signup'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              Create Account
            </button>
          </div>

          {/* Email Field */}
          <div>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="e.g., official@gov.in"
              required
              className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50/50 text-slate-900 text-xs placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#2E4A8C]/20 focus:border-[#2E4A8C] transition-all"
            />
          </div>

          {/* Password Field */}
          <div className="relative">
            <input
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="Password"
              required
              className="w-full px-3 py-2 pr-9 rounded-xl border border-slate-200 bg-slate-50/50 text-slate-900 text-xs placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#2E4A8C]/20 focus:border-[#2E4A8C] transition-all"
            />
            <button
              type="button"
              onClick={() => setShowPassword(p => !p)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
            >
              {showPassword ? (
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" x2="22" y1="2" y2="22"/></svg>
              ) : (
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>
              )}
            </button>
          </div>

          {/* Continue Submit Button - Dashboard Primary Palette */}
          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 px-4 rounded-xl bg-[#2E4A8C] hover:bg-[#253C73] text-white font-sans font-semibold text-sm shadow-md active:scale-[0.99] transition-all cursor-pointer disabled:opacity-60 flex items-center justify-center gap-2 mt-2"
          >
            {loading && (
              <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" strokeOpacity="0.25"/>
                <path d="M12 2a10 10 0 0 1 10 10" />
              </svg>
            )}
            <span>{authMode === 'signup' ? 'Create Account' : 'Continue'}</span>
          </button>

          {/* Institutional Guest / Sandbox Demo Access */}
          {onGuestAccess && (
            <div className="pt-2 text-center">
              <button
                type="button"
                onClick={onGuestAccess}
                className="text-[11px] font-sans text-slate-500 hover:text-[#2E4A8C] transition-colors cursor-pointer inline-flex items-center gap-1 font-medium"
              >
                <span>Or explore as Institutional Guest →</span>
              </button>
            </div>
          )}
        </form>
      </div>
    </div>
  );
}
