import { useState, useEffect, useRef, useCallback } from 'react';
import { Layers3, Check, Loader2, ChevronDown } from 'lucide-react';
import { api } from '../services/api';
import type { LLMSettingsResponse, ProviderMetaResponse } from '../services/api';

interface ProviderSwitcherProps {
  /** Called after the active provider changes so parent can react (e.g. re-fetch briefing) */
  onProviderChange?: () => void;
}

export default function ProviderSwitcher({ onProviderChange }: ProviderSwitcherProps) {
  const [settings, setSettings] = useState<LLMSettingsResponse | null>(null);
  const [providers, setProviders] = useState<ProviderMetaResponse[]>([]);
  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const [settingsRes, providerRes] = await Promise.all([
        api.getLLMSettings(),
        api.getLLMProviders(),
      ]);
      setSettings(settingsRes.settings);
      setProviders(providerRes.providers);
    } catch {
      // Non-fatal — switcher just won't render
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const configuredProviders = providers.filter((p) => Boolean(settings?.providers[p.id]));

  // Only show if 2+ providers are configured
  if (configuredProviders.length < 2 || !settings) return null;

  const activeId = settings.activeProvider;
  const activeMeta = providers.find((p) => p.id === activeId);
  const activeConfig = settings.providers[activeId];

  const handleSwitch = async (providerId: string) => {
    if (providerId === activeId || switching) return;
    setSwitching(true);
    setOpen(false);
    try {
      const result = await api.updateLLMSettings({
        ...settings,
        activeProvider: providerId,
      });
      setSettings(result.settings);
      onProviderChange?.();
    } catch {
      // Revert on error
    } finally {
      setSwitching(false);
    }
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        disabled={switching}
        title="Switch AI provider"
        className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-[var(--border)] bg-[var(--surface)] text-[var(--text-dim)] text-[11px] font-medium hover:bg-[var(--surface2)] hover:text-[var(--text)] transition-colors cursor-pointer disabled:opacity-50 whitespace-nowrap"
      >
        {switching ? (
          <Loader2 size={11} className="animate-spin shrink-0" />
        ) : (
          <Layers3 size={11} className="shrink-0" />
        )}
        <span className="hidden sm:inline">
          {activeMeta?.name ?? activeId}
          {activeConfig?.model ? ` · ${activeConfig.model}` : ''}
        </span>
        <span className="sm:hidden">{activeMeta?.name ?? activeId}</span>
        <ChevronDown size={10} className={`shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1.5 z-50 min-w-[200px] rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] shadow-lg py-1">
          {configuredProviders.map((meta) => {
            const config = settings.providers[meta.id];
            const isActive = meta.id === activeId;
            return (
              <button
                key={meta.id}
                onClick={() => void handleSwitch(meta.id)}
                className={`w-full flex items-center gap-2.5 px-3 py-2 text-left text-[12px] transition-colors cursor-pointer ${
                  isActive
                    ? 'text-[var(--text)] bg-[var(--surface2)]'
                    : 'text-[var(--text-dim)] hover:bg-[var(--surface2)] hover:text-[var(--text)]'
                }`}
              >
                <span className="flex-1 min-w-0">
                  <span className="font-medium">{meta.name}</span>
                  {config?.model && (
                    <span className="ml-1.5 text-[var(--text-faint)] truncate">{config.model}</span>
                  )}
                </span>
                {isActive && <Check size={12} className="text-[var(--accent)] shrink-0" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
