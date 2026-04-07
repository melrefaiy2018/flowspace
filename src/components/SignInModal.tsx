import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Check, AlertCircle } from 'lucide-react';
import { api } from '../services/api';
import FlowSpaceLogo from './FlowSpaceLogo';
import type { UserProfile } from '../services/api';

type FlowState =
  | 'idle'
  | 'checking'
  | 'installing'
  | 'login'
  | 'polling'
  | 'importing'
  | 'success'
  | 'error';

const STATUS_MESSAGES: Record<FlowState, string> = {
  idle: '',
  checking: 'Checking setup...',
  installing: 'Setting up (this may take a moment)...',
  login: 'Opening browser for sign-in...',
  polling: 'Waiting for approval...',
  importing: 'Completing sign-in...',
  success: 'Welcome to FlowSpace!',
  error: 'Something went wrong',
};

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (user: UserProfile) => void;
}

export default function SignInModal({ isOpen, onClose, onSuccess }: Props) {
  const [state, setState] = useState<FlowState>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const [user, setUser] = useState<UserProfile | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const abortRef = useRef(false);

  useEffect(() => {
    if (isOpen) {
      abortRef.current = false;
      setState('idle');
      setErrorMessage('');
      setUser(null);
      startFlow();
    }
    return () => {
      abortRef.current = true;
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [isOpen]);

  async function startFlow() {
    try {
      // Step 1: Check gws status
      setState('checking');
      const status = await api.getGwsStatus();

      if (abortRef.current) return;

      // Step 2: Install if needed
      if (!status.installed) {
        setState('installing');
        const installResult = await api.installGws();
        if (!installResult.success) {
          throw new Error(installResult.error || 'Failed to install. Please ensure npm is available.');
        }
        if (abortRef.current) return;
      }

      // Step 3: Trigger login (opens browser)
      setState('login');
      const loginResult = await api.startAccountConnect();
      if (!loginResult.success) {
        throw new Error(loginResult.error || 'Failed to start sign-in');
      }

      if (abortRef.current) return;

      // Step 4: Poll for authentication completion
      setState('polling');
      await pollForAuth();
    } catch (err: any) {
      if (!abortRef.current) {
        setState('error');
        setErrorMessage(err.message || 'An unexpected error occurred');
      }
    }
  }

  function pollForAuth(): Promise<void> {
    return new Promise((resolve, reject) => {
      let attempts = 0;
      const maxAttempts = 45; // 90 seconds at 2s intervals

      pollRef.current = setInterval(async () => {
        attempts++;
        if (abortRef.current) {
          if (pollRef.current) clearInterval(pollRef.current);
          return;
        }

        try {
          const status = await api.getGwsStatus();
          if (status.authenticated) {
            if (pollRef.current) clearInterval(pollRef.current);
            await doImport();
            resolve();
          } else if (attempts >= maxAttempts) {
            if (pollRef.current) clearInterval(pollRef.current);
            reject(new Error('Sign-in timed out. Please try again.'));
          }
        } catch {
          // Ignore transient errors during polling
        }
      }, 2000);
    });
  }

  async function doImport() {
    if (abortRef.current) return;
    setState('importing');
    const result = await api.importConnectedAccount();
    if (!result.success) {
      throw new Error(result.error || 'Failed to import credentials');
    }

    if (abortRef.current) return;

    const importedUser = result.account
      ? { name: result.account.name ?? 'User', email: result.account.email, picture: result.account.picture ?? undefined }
      : { name: 'User', email: '' };
    setUser(importedUser);
    setState('success');

    // Auto-close after showing success
    setTimeout(() => {
      if (!abortRef.current) {
        onSuccess(importedUser);
        onClose();
      }
    }, 1500);
  }

  if (!isOpen) return null;

  const isLoading = ['checking', 'installing', 'login', 'polling', 'importing'].includes(state);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={state === 'error' || state === 'idle' ? onClose : undefined}
      />

      {/* Modal */}
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 10 }}
        transition={{ duration: 0.2 }}
        className="relative w-[360px] bg-[var(--bg)] border border-[var(--border)] rounded-2xl p-8 shadow-2xl flex flex-col items-center gap-6"
      >
        {/* Animated icon */}
        <div className="relative">
          <AnimatePresence mode="wait">
            {state === 'success' ? (
              <motion.div
                key="success"
                initial={{ scale: 0, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: 'spring', stiffness: 300, damping: 20 }}
                className="w-16 h-16 rounded-2xl bg-[color-mix(in_srgb,var(--accent)_15%,transparent)] flex items-center justify-center"
              >
                {user?.picture ? (
                  <img src={user.picture} alt="" className="w-12 h-12 rounded-full" referrerPolicy="no-referrer" />
                ) : (
                  <Check size={28} className="text-[var(--accent)]" />
                )}
              </motion.div>
            ) : state === 'error' ? (
              <motion.div
                key="error"
                initial={{ scale: 0, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                className="w-16 h-16 rounded-2xl bg-[color-mix(in_srgb,var(--error)_15%,transparent)] flex items-center justify-center"
              >
                <AlertCircle size={28} className="text-[var(--error)]" />
              </motion.div>
            ) : (
              <motion.div
                key="loading"
                animate={{ scale: [1, 1.05, 1] }}
                transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
              >
                <FlowSpaceLogo size={64} className="rounded-2xl" />
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Title */}
        <div className="text-center">
          <h2 className="text-[15px] font-semibold text-[var(--text)]">
            {state === 'success' ? `Welcome${user?.name ? `, ${user.name.split(' ')[0]}` : ''}!` : 'Sign in to FlowSpace'}
          </h2>
        </div>

        {/* Status line */}
        <AnimatePresence mode="wait">
          <motion.p
            key={state}
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -5 }}
            transition={{ duration: 0.15 }}
            className={`text-[13px] text-center ${state === 'error' ? 'text-[var(--error)]' : 'text-[var(--text-dim)]'}`}
          >
            {state === 'error' ? errorMessage : STATUS_MESSAGES[state]}
          </motion.p>
        </AnimatePresence>

        {/* Loading indicator */}
        {isLoading && (
          <div className="w-32 h-1 bg-[var(--surface)] rounded-full overflow-hidden">
            <motion.div
              className="h-full bg-[var(--accent)] rounded-full"
              animate={{ x: ['-100%', '100%'] }}
              transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
              style={{ width: '50%' }}
            />
          </div>
        )}

        {/* Cancel button during loading states */}
        {isLoading && (
          <button
            onClick={() => {
              abortRef.current = true;
              if (pollRef.current) clearInterval(pollRef.current);
              onClose();
            }}
            className="px-4 py-2 rounded-lg bg-[var(--surface)] text-[var(--text-dim)] text-[13px] font-medium hover:bg-[var(--surface-hover)] transition-all cursor-pointer"
          >
            Cancel
          </button>
        )}

        {/* Error actions */}
        {state === 'error' && (
          <div className="flex gap-3">
            <button
              onClick={() => {
                setState('idle');
                setErrorMessage('');
                startFlow();
              }}
              className="px-4 py-2 rounded-lg bg-[var(--accent)] text-black text-[13px] font-medium hover:brightness-110 transition-all cursor-pointer"
            >
              Try again
            </button>
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-lg bg-[var(--surface)] text-[var(--text-dim)] text-[13px] font-medium hover:bg-[var(--surface-hover)] transition-all cursor-pointer"
            >
              Cancel
            </button>
          </div>
        )}
      </motion.div>
    </div>
  );
}
