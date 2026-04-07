import { useState } from 'react';
import { motion } from 'motion/react';
import { Mail, Calendar, HardDrive, CheckSquare, Loader2 } from 'lucide-react';
import FlowSpaceLogo from './FlowSpaceLogo';
import { startOAuthFlow } from '../lib/oauth-flow';

const FEATURES = [
  { icon: Mail, label: 'Inbox', desc: 'Smart triage' },
  { icon: Calendar, label: 'Calendar', desc: 'Day at a glance' },
  { icon: HardDrive, label: 'Drive', desc: 'Recent files' },
  { icon: CheckSquare, label: 'Tasks', desc: 'Follow-up tracking' },
];

type Status = 'idle' | 'waiting' | 'error';

export default function SignInScreen() {
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);

  const handleSignIn = () => {
    setStatus('waiting');
    setError(null);
    startOAuthFlow('/api/auth/login', {
      onWaiting: () => setStatus('waiting'),
      onSuccess: () => window.location.reload(),
      onError: (msg) => { setError(msg); setStatus('error'); },
    });
  };

  return (
    <div className="fixed inset-0 bg-[var(--bg)] flex items-center justify-center overflow-hidden">
      {/* Atmospheric background — consistent with dashboard dot grid */}
      <div className="absolute inset-0 overflow-hidden">
        <div
          className="absolute inset-0 opacity-[0.022]"
          style={{
            backgroundImage: `radial-gradient(circle, rgba(255,255,255,1) 1px, transparent 1px)`,
            backgroundSize: '28px 28px',
          }}
        />
        <div
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full opacity-[0.06]"
          style={{ background: `radial-gradient(circle, rgba(var(--accent-rgb), 1) 0%, transparent 70%)` }}
        />
        <div className="absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-[var(--bg)] to-transparent" />
        <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-[var(--bg)] to-transparent" />
      </div>

      {/* Content */}
      <div className="relative z-10 flex flex-col items-center gap-10 px-8 max-w-md">
        {/* Logo */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="flex flex-col items-center gap-5"
        >
          <div className="relative">
            <FlowSpaceLogo size={80} className="rounded-[20px]" />
          </div>

          <div className="text-center">
            <h1 className="text-3xl font-bold tracking-tight text-[var(--text)]">FlowSpace</h1>
            <p className="text-[15px] text-[var(--text-dim)] mt-2 leading-relaxed">
              Your entire Google Workspace,<br />one intelligent dashboard.
            </p>
          </div>
        </motion.div>

        {/* Feature pills */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.3 }}
          className="flex flex-wrap justify-center gap-2"
        >
          {FEATURES.map((f, i) => (
            <motion.div
              key={f.label}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: 0.4 + i * 0.08 }}
              className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-[var(--surface)] border border-[var(--border)] text-[12px]"
            >
              <f.icon size={13} className="text-[var(--accent)]" />
              <span className="text-[var(--text-dim)]">{f.label}</span>
              <span className="text-[var(--text-faint)]">{f.desc}</span>
            </motion.div>
          ))}
        </motion.div>

        {/* Sign in button / waiting state */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.6 }}
          className="flex flex-col items-center gap-4"
        >
          {status === 'waiting' ? (
            <>
              <div className="flex items-center gap-3 px-8 py-3 rounded-xl bg-[var(--surface)] border border-[var(--border)] text-[15px]">
                <Loader2 size={18} className="text-[var(--accent)] animate-spin" />
                <span className="text-[var(--text-dim)]">Waiting for sign-in...</span>
              </div>
              <p className="text-[11px] text-[var(--text-faint)] text-center max-w-[280px] leading-relaxed">
                Complete sign-in in your browser. This page will update automatically.
              </p>
            </>
          ) : (
            <>
              <button
                onClick={handleSignIn}
                className="group relative flex items-center gap-3 px-8 py-3 rounded-xl bg-[var(--accent)] text-black font-semibold text-[15px] hover:brightness-110 active:scale-[0.98] transition-all cursor-pointer"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18A10.96 10.96 0 001 12c0 1.77.42 3.44 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                </svg>
                Sign in with Google
              </button>

              {error && (
                <p className="text-[12px] text-[var(--error)] text-center max-w-[280px]">
                  {error}
                </p>
              )}

              <p className="text-[11px] text-[var(--text-faint)] text-center max-w-[260px] leading-relaxed">
                Connect your Google account to access your workspace data securely.
              </p>
            </>
          )}
        </motion.div>
      </div>
    </div>
  );
}
