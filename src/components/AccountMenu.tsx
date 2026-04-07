import { useMemo, useState, useEffect } from 'react';
import { ChevronDown, Plus, Trash2 } from 'lucide-react';
import type { ConnectedAccount } from '../services/api';

interface Props {
  accounts: ConnectedAccount[];
  activeAccountId?: string | null;
  busy?: boolean;
  onSwitch: (accountId: string) => void;
  onAdd: () => void;
  onRemove: (accountId: string) => void;
}

export default function AccountMenu({ accounts, activeAccountId, busy = false, onSwitch, onAdd, onRemove }: Props) {
  const [open, setOpen] = useState(false);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open]);

  const activeAccount = useMemo(
    () => accounts.find((account) => account.id === activeAccountId) ?? accounts[0] ?? null,
    [accounts, activeAccountId],
  );

  if (accounts.length === 0) return null;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-[12px] text-[var(--text)] hover:bg-[var(--surface2)] cursor-pointer"
      >
        <span className="max-w-[120px] sm:max-w-[200px] truncate">{activeAccount?.email ?? 'Google account'}</span>
        <ChevronDown size={13} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute right-0 z-30 mt-2 w-[280px] rounded-[16px] border border-[var(--border)] bg-[var(--bg-elevated)] p-2 shadow-2xl">
          <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--text-faint)]">
            Connected accounts
          </div>
          <div className="mt-1 flex flex-col gap-1">
            {accounts.map((account) => {
              const isActive = account.id === activeAccountId;
              return (
                <div
                  key={account.id}
                  className={`flex items-center gap-2 rounded-[12px] border px-3 py-2 ${isActive ? 'border-[var(--accent)]/30 bg-[var(--accent-dim)]/15' : 'border-transparent bg-transparent'}`}
                >
                  <button
                    type="button"
                    disabled={busy || isActive}
                    onClick={() => {
                      setOpen(false);
                      onSwitch(account.id);
                    }}
                    className="min-w-0 flex-1 text-left disabled:opacity-60 cursor-pointer"
                  >
                    <div className="truncate text-[12px] font-medium text-[var(--text)]">{account.name || account.email}</div>
                    <div className="truncate text-[11px] text-[var(--text-faint)]">{account.email}</div>
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setOpen(false);
                      onRemove(account.id);
                    }}
                    className="rounded-md p-1 text-[var(--text-faint)] hover:text-[var(--error)] cursor-pointer disabled:opacity-50"
                    title={`Remove ${account.email}`}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              );
            })}
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setOpen(false);
              onAdd();
            }}
            className="mt-2 flex w-full items-center justify-center gap-2 rounded-[12px] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[12px] text-[var(--text)] hover:bg-[var(--surface2)] cursor-pointer disabled:opacity-50"
          >
            <Plus size={13} />
            Add Google account
          </button>
        </div>
      )}
    </div>
  );
}
