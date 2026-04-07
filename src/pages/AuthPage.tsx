import { useState, useCallback, type FormEvent } from 'react';
import { validateEmail, validatePassword } from '../lib/auth-validation';
import { useAuth } from '../context/AuthContext';
import FlowSpaceLogo from '../components/FlowSpaceLogo';

type AuthMode = 'signin' | 'signup' | 'forgot';

export default function AuthPage() {
  const { signIn, signUp, resetPassword } = useAuth();
  const [mode, setMode] = useState<AuthMode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const switchMode = useCallback((next: AuthMode) => {
    setMode(next);
    setError(null);
    setSuccessMessage(null);
  }, []);

  const handleSubmit = useCallback(async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMessage(null);

    // Validate
    const emailResult = validateEmail(email);
    if (!emailResult.valid) { setError(emailResult.error); return; }

    if (mode !== 'forgot') {
      const passResult = validatePassword(password);
      if (!passResult.valid) { setError(passResult.error); return; }
    }

    setLoading(true);
    try {
      if (mode === 'forgot') {
        const { error: resetErr } = await resetPassword(email.trim());
        if (resetErr) { setError(resetErr); } else { setSuccessMessage('Check your email for a reset link.'); }
      } else if (mode === 'signup') {
        const { error: signupErr } = await signUp(email.trim(), password);
        if (signupErr) { setError(signupErr); } else { setSuccessMessage('Account created! Check your email to confirm.'); }
      } else {
        const { error: loginErr } = await signIn(email.trim(), password);
        if (loginErr) { setError(loginErr); }
      }
    } finally {
      setLoading(false);
    }
  }, [email, password, mode, signIn, signUp, resetPassword]);

  const title = mode === 'signup' ? 'Create your account' : mode === 'forgot' ? 'Reset password' : 'Welcome back';
  const subtitle = mode === 'signup'
    ? 'Start managing your workspace with AI'
    : mode === 'forgot'
      ? "Enter your email and we'll send a reset link"
      : 'Sign in to your FlowSpace account';
  const submitLabel = mode === 'signup' ? 'Create account' : mode === 'forgot' ? 'Send reset link' : 'Sign in';

  return (
    <div className="min-h-screen bg-[var(--bg)] flex items-center justify-center px-4">
      <div className="w-full max-w-[400px]">
        {/* Logo + heading */}
        <div className="flex flex-col items-center mb-8">
          <div className="w-12 h-12 rounded-full bg-gradient-to-tr from-[var(--accent-dim)] to-[var(--accent)]/30 border border-[var(--accent)]/40 flex items-center justify-center mb-5">
            <FlowSpaceLogo size={24} className="text-[var(--accent)]" />
          </div>
          <h1 className="text-[22px] font-bold text-[var(--text)] tracking-tight">{title}</h1>
          <p className="text-[13px] text-[var(--text-dim)] mt-1">{subtitle}</p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <label className="block">
            <span className="text-[11px] font-medium text-[var(--text-dim)] uppercase tracking-wider">Email</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              autoFocus
              className="mt-1 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-[14px] text-[var(--text)] outline-none focus:border-[var(--accent)] transition-colors placeholder:text-[var(--text-faint)]"
              placeholder="you@example.com"
            />
          </label>

          {mode !== 'forgot' && (
            <label className="block">
              <span className="text-[11px] font-medium text-[var(--text-dim)] uppercase tracking-wider">Password</span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                className="mt-1 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-[14px] text-[var(--text)] outline-none focus:border-[var(--accent)] transition-colors placeholder:text-[var(--text-faint)]"
                placeholder={mode === 'signup' ? 'At least 8 characters' : 'Your password'}
              />
            </label>
          )}

          {/* Error / success */}
          {error && (
            <div className="rounded-lg bg-[var(--error-dim)] border border-[var(--error-border)] px-3 py-2 text-[12px] text-[var(--error)]">
              {error}
            </div>
          )}
          {successMessage && (
            <div className="rounded-lg bg-[var(--accent-dim)] border border-[var(--accent)]/30 px-3 py-2 text-[12px] text-[var(--accent)]">
              {successMessage}
            </div>
          )}

          {/* Submit */}
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-xl bg-[var(--accent)] text-black font-semibold py-3 text-[14px] transition-all hover:brightness-110 disabled:opacity-50 cursor-pointer"
          >
            {loading ? 'Please wait...' : submitLabel}
          </button>
        </form>

        {/* Mode switcher */}
        <div className="mt-6 text-center space-y-2">
          {mode === 'signin' && (
            <>
              <button onClick={() => switchMode('forgot')} className="text-[12px] text-[var(--text-faint)] hover:text-[var(--text-dim)] cursor-pointer">
                Forgot password?
              </button>
              <div className="text-[12px] text-[var(--text-faint)]">
                No account?{' '}
                <button onClick={() => switchMode('signup')} className="text-[var(--accent)] font-medium hover:underline cursor-pointer">
                  Sign up
                </button>
              </div>
            </>
          )}
          {mode === 'signup' && (
            <div className="text-[12px] text-[var(--text-faint)]">
              Already have an account?{' '}
              <button onClick={() => switchMode('signin')} className="text-[var(--accent)] font-medium hover:underline cursor-pointer">
                Sign in
              </button>
            </div>
          )}
          {mode === 'forgot' && (
            <button onClick={() => switchMode('signin')} className="text-[12px] text-[var(--accent)] font-medium hover:underline cursor-pointer">
              Back to sign in
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
