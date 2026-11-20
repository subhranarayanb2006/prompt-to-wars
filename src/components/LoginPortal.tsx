import React, { useEffect, useRef, useState } from 'react';
import { Loader2, Plane } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

const LOGIN_VIDEO_SRC = '/src/assets/videos/domino_sky_flight.mp4';
const LOGIN_POSTER_SRC = '/src/assets/images/domino_sky_panorama_1795152823592.jpg';

export const LoginPortal: React.FC = () => {
  const { signInWithGoogle, continueAsGuest, authLoading, authError } = useAuth();
  const [videoFailed, setVideoFailed] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    el.muted = true;
    const playPromise = el.play();
    if (playPromise && typeof playPromise.catch === 'function') {
      playPromise.catch(() => {
        // Autoplay policy fallback handled by poster
      });
    }
  }, []);

  return (
    <div className="relative min-h-screen flex items-center justify-center p-6 bg-slate-950 overflow-hidden">
      {/* Full-Viewport Looping Aviation Background Video */}
      <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
        {!videoFailed ? (
          <video
            ref={videoRef}
            autoPlay
            loop
            muted
            playsInline
            preload="auto"
            poster={LOGIN_POSTER_SRC}
            onError={() => setVideoFailed(true)}
            className="w-full h-full object-cover object-center scale-[1.02]"
          >
            <source src={LOGIN_VIDEO_SRC} type="video/mp4" />
          </video>
        ) : (
          <img
            src={LOGIN_POSTER_SRC}
            alt=""
            referrerPolicy="no-referrer"
            className="w-full h-full object-cover object-center scale-[1.02]"
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-b from-slate-950/45 via-slate-950/25 to-slate-950/55" />
      </div>

      {/* Minimal Centered Login Card: Only Airplane Logo + Domino Sky */}
      <main className="relative z-10 w-full max-w-sm">
        <div className="bg-slate-950/58 backdrop-blur-2xl border border-white/20 rounded-2xl px-8 py-9 shadow-[0_24px_80px_rgba(0,0,0,0.55)] flex flex-col items-center text-center space-y-7">
          {/* Airplane Emblem & Brand Wordmark Only */}
          <div className="flex flex-col items-center space-y-3.5">
            <div className="w-16 h-16 rounded-2xl bg-white/12 border border-white/25 flex items-center justify-center shadow-lg">
              <Plane className="w-8 h-8 text-white -rotate-45" strokeWidth={1.85} />
            </div>
            <h1 className="text-3xl font-extrabold font-display tracking-tight text-white">
              Domino Sky
            </h1>
          </div>

          {authError && (
            <div
              role="alert"
              className="w-full rounded-lg border border-rose-300/40 bg-rose-950/70 px-3.5 py-2.5 text-xs text-rose-100 leading-relaxed"
            >
              {authError}
            </div>
          )}

          {/* Authentication Controls */}
          <div className="w-full space-y-3">
            <button
              type="button"
              onClick={() => void signInWithGoogle()}
              disabled={authLoading}
              className="w-full flex items-center justify-center gap-3 px-4 py-3 rounded-xl bg-white hover:bg-slate-100 disabled:opacity-60 text-slate-900 text-sm font-semibold transition-colors shadow-md cursor-pointer"
            >
              {authLoading ? (
                <Loader2 className="w-4 h-4 animate-spin text-slate-700" />
              ) : (
                <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    fill="#4285F4"
                    d="M23.49 12.27c0-.79-.07-1.54-.2-2.27H12v4.51h6.47c-.29 1.48-1.14 2.73-2.4 3.58v3h3.86c2.26-2.09 3.56-5.17 3.56-8.82z"
                  />
                  <path
                    fill="#34A853"
                    d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.29v3.09C3.26 21.3 7.31 24 12 24z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M5.27 14.29c-.25-.72-.38-1.49-.38-2.29s.14-1.57.38-2.29V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.98-3.09z"
                  />
                  <path
                    fill="#EA4335"
                    d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.98 3.09c.95-2.85 3.6-4.96 6.73-4.96z"
                  />
                </svg>
              )}
              <span>{authLoading ? 'Signing in...' : 'Sign in with Google'}</span>
            </button>

            <button
              type="button"
              onClick={continueAsGuest}
              disabled={authLoading}
              className="w-full px-4 py-2.5 rounded-xl border border-white/25 bg-white/10 hover:bg-white/18 text-white text-xs font-semibold transition-colors cursor-pointer"
            >
              Continue as Guest
            </button>
          </div>
        </div>
      </main>
    </div>
  );
};
