import { RefreshCw, LogIn, Loader2 } from 'lucide-react';
import { useState } from 'react';
import type { UserProfile } from '../services/api';
import { startOAuthFlow } from '../lib/oauth-flow';

interface Props {
  user: UserProfile | null;
  onRefresh: () => void;
  loading: boolean;
}

function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

function formatDate(): string {
  return new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

export default function ContextHeader({ user, onRefresh, loading }: Props) {
  const firstName = user?.name?.split(' ')[0];
  const [signingIn, setSigningIn] = useState(false);

  const handleSignIn = () => {
    setSigningIn(true);
    startOAuthFlow('/api/auth/login', {
      onSuccess: () => window.location.reload(),
      onError: () => setSigningIn(false),
    });
  };

  return (
    <div className="flex items-center justify-between px-8 pt-6 pb-2">
      <div>
        <h1 className="text-lg font-medium text-[var(--text)]">
          {getGreeting()}{firstName ? `, ${firstName}` : ''}
        </h1>
        <p className="text-[11px] font-mono text-[var(--text-faint)] mt-0.5">
          {formatDate()}
        </p>
      </div>
      <div className="flex items-center gap-2">
        {!user && (
          <button
            onClick={handleSignIn}
            disabled={signingIn}
            className="flex items-center gap-2 px-3 py-1.5 rounded-[var(--radius-sm)] bg-[var(--accent)] text-black text-[12px] font-medium hover:brightness-110 transition-all cursor-pointer disabled:opacity-60"
          >
            {signingIn ? <Loader2 size={13} className="animate-spin" /> : <LogIn size={13} />}
            {signingIn ? 'Waiting...' : 'Sign in with Google'}
          </button>
        )}
        <button
          onClick={onRefresh}
          disabled={loading}
          className="w-8 h-8 rounded-[var(--radius-sm)] flex items-center justify-center text-[var(--text-faint)] hover:text-[var(--text-dim)] hover:bg-[var(--surface)] transition-colors cursor-pointer disabled:opacity-40"
          title="Refresh"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>
    </div>
  );
}
