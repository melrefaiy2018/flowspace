import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../services/api';
import FlowSpaceLogo from '../components/FlowSpaceLogo';
import { CheckCircle2, Chrome, Loader2, LogOut, WifiOff } from 'lucide-react';
import { startOAuthFlow } from '../lib/oauth-flow';

type Step = 'checking' | 'ready' | 'waiting' | 'done' | 'error';

interface Props {
  onConnected: () => void;
}

export default function ConnectGooglePage({ onConnected }: Props) {
  const { user, signOut } = useAuth();
  const [step, setStep] = useState<Step>('checking');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getAuthStatus()
      .then((status) => {
        if (status.authenticated) {
          setStep('done');
          onConnected();
        } else {
          setStep('ready');
        }
      })
      .catch(() => setStep('ready'));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Check for auth error from OAuth callback redirect
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const authError = params.get('auth_error');
    if (authError) {
      setError(authError);
      setStep('error');
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  return (
    <div className="min-h-screen bg-[var(--bg)] flex items-center justify-center px-4">
      <div className="w-full max-w-[440px]">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <div className="w-12 h-12 rounded-full bg-gradient-to-tr from-[var(--accent-dim)] to-[var(--accent)]/30 border border-[var(--accent)]/40 flex items-center justify-center mb-5">
            <FlowSpaceLogo size={24} className="text-[var(--accent)]" />
          </div>
          <h1 className="text-[22px] font-bold text-[var(--text)] tracking-tight">Connect Google Workspace</h1>
          <p className="text-[13px] text-[var(--text-dim)] mt-1 text-center max-w-[320px]">
            Link your Google account so FlowSpace can read your email, calendar, and drive.
          </p>
        </div>

        {/* Connection card */}
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6">
          {/* User info */}
          {user?.email && (
            <div className="flex items-center gap-3 mb-6 pb-4 border-b border-[var(--border)]">
              <div className="w-9 h-9 rounded-full bg-[var(--accent-dim)] flex items-center justify-center text-[var(--accent)] text-[13px] font-bold">
                {user.email[0].toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-medium text-[var(--text)] truncate">{user.email}</div>
                <div className="text-[11px] text-[var(--text-faint)]">FlowSpace account</div>
              </div>
            </div>
          )}

          {/* Status indicator */}
          {step === 'done' ? (
            <div className="flex items-center gap-3 mb-4">
              <CheckCircle2 size={20} className="text-[var(--accent)]" />
              <span className="text-[14px] font-medium text-[var(--accent)]">Google Workspace connected</span>
            </div>
          ) : step === 'checking' ? (
            <div className="flex items-center gap-3 mb-4">
              <Loader2 size={18} className="text-[var(--accent)] animate-spin" />
              <span className="text-[13px] text-[var(--text-dim)]">Checking connection...</span>
            </div>
          ) : (
            <div className="flex items-center gap-3 mb-4">
              <WifiOff size={18} className="text-[var(--text-faint)]" />
              <span className="text-[13px] text-[var(--text-dim)]">Not connected yet</span>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="mb-4 rounded-lg bg-[var(--error-dim)] border border-[var(--error-border)] px-3 py-2 text-[12px] text-[var(--error)]">
              {error}
            </div>
          )}

          {/* Connect button / waiting state */}
          {step === 'waiting' ? (
            <div className="flex items-center justify-center gap-3 py-3">
              <Loader2 size={18} className="text-[var(--accent)] animate-spin" />
              <span className="text-[13px] text-[var(--text-dim)]">Complete sign-in in your browser...</span>
            </div>
          ) : step !== 'done' && step !== 'checking' && (
            <button
              onClick={() => {
                setStep('waiting');
                setError(null);
                startOAuthFlow('/api/accounts/connect', {
                  onSuccess: () => { setStep('done'); onConnected(); },
                  onError: (msg) => { setError(msg); setStep('error'); },
                });
              }}
              className="w-full flex items-center justify-center gap-2 rounded-xl bg-white text-gray-800 font-semibold py-3 text-[14px] transition-all hover:bg-gray-50 cursor-pointer border border-gray-200"
            >
              <Chrome size={18} />
              Sign in with Google
            </button>
          )}
        </div>

        {/* Actions */}
        <div className="mt-6 flex items-center justify-end">
          <button
            onClick={signOut}
            className="flex items-center gap-1.5 text-[12px] text-[var(--text-faint)] hover:text-[var(--error)] cursor-pointer"
          >
            <LogOut size={11} />
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}
