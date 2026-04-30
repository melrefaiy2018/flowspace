import { useState, useEffect, useCallback } from 'react';
import {
  Settings,
  Eye,
  EyeOff,
  Check,
  X,
  Loader2,
  Zap,
  Globe,
  Server,
  Bot,
  Terminal,
  ChevronRight,
  Layers3,
  KeyRound,
  Plus,
  Trash2,
  Copy,
  RadioTower,
} from 'lucide-react';
import { api } from '../services/api';
import type { ProviderMetaResponse, LLMSettingsResponse, LLMProviderConfigResponse, CheckResult } from '../services/api';
import SavedConnectionStatus from './SavedConnectionStatus';
import ProviderDiagnostics from './ProviderDiagnostics';

// ── Helpers ─────────────────────────────────────────────────────────

function ProviderIcon({ id, className }: { id: string; className?: string }) {
  switch (id) {
    case 'anthropic': return <Bot className={className} />;
    case 'openai': return <Zap className={className} />;
    case 'openrouter': return <Globe className={className} />;
    case 'lmstudio': return <Server className={className} />;
    case 'claude-code': return <Terminal className={className} />;
    case 'codex': return <Zap className={className} />;
    default: return <Settings className={className} />;
  }
}

function panelClassName(extra?: string) {
  return `rounded-[22px] border border-[var(--border)] bg-[var(--surface)] shadow-[0_20px_60px_rgba(0,0,0,0.12)] backdrop-blur-sm ${extra ?? ''}`;
}

function statusPillClassName(tone: 'active' | 'configured' | 'idle') {
  if (tone === 'active') return 'border-[var(--accent)]/20 bg-[var(--accent)]/10 text-[var(--accent)]';
  if (tone === 'configured') return 'border-[var(--blue)]/18 bg-[var(--blue)]/10 text-[var(--blue)]';
  return 'border-[var(--border)] bg-[var(--surface2)] text-[var(--text-dim)]';
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'custom';
}

// ── Types ───────────────────────────────────────────────────────────

interface ProviderFormState {
  apiKey: string;
  model: string;
  baseURL: string;
  showKey: boolean;
}

interface CustomProviderDraft {
  name: string;
  baseURL: string;
  apiKey: string;
  model: string;
}

export interface LLMProviderSettingsProps {
  providers: ProviderMetaResponse[];
  settings: LLMSettingsResponse | null;
  onSettingsChange: (settings: LLMSettingsResponse) => void;
  onProvidersChange: (providers: ProviderMetaResponse[]) => void;
  saveMessage: string | null;
  onSaveMessage: (msg: string | null) => void;
}

// ── Component ───────────────────────────────────────────────────────

export default function LLMProviderSettings({
  providers,
  settings,
  onSettingsChange,
  onProvidersChange,
  saveMessage,
  onSaveMessage,
}: LLMProviderSettingsProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [forms, setForms] = useState<Record<string, ProviderFormState>>({});
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, CheckResult>>({});
  const [checkingLiveId, setCheckingLiveId] = useState<string | null>(null);
  const [liveCheckResults, setLiveCheckResults] = useState<Record<string, CheckResult>>({});
  const [savedFormState, setSavedFormState] = useState<Record<string, ProviderFormState>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [showAddCustom, setShowAddCustom] = useState(false);
  const [customDraft, setCustomDraft] = useState<CustomProviderDraft>({ name: '', baseURL: '', apiKey: '', model: '' });
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Codex login flow state
  const [codexStatus, setCodexStatus] = useState<{ installed: boolean; authenticated: boolean } | null>(null);
  const [codexLoginState, setCodexLoginState] = useState<'idle' | 'starting' | 'success' | 'error'>('idle');
  const [codexLoginError, setCodexLoginError] = useState<string | null>(null);

  // Check codex status when codex panel is selected
  useEffect(() => {
    if (selectedId !== 'codex') return;
    api.getCodexStatus().then(setCodexStatus).catch(() => setCodexStatus({ installed: false, authenticated: false }));
  }, [selectedId]);

  // "I've signed in" button — just re-checks codex login status
  const startCodexLogin = useCallback(async () => {
    setCodexLoginState('starting');
    setCodexLoginError(null);
    try {
      const { authenticated, reason } = await api.pollCodexLogin();
      if (authenticated) {
        setCodexLoginState('success');
        setCodexStatus({ installed: true, authenticated: true });
      } else {
        setCodexLoginState('error');
        setCodexLoginError(`Not signed in yet — run "codex login" in your terminal first. (${reason ?? 'unknown'})`);
      }
    } catch (err: any) {
      setCodexLoginState('error');
      setCodexLoginError(err.message ?? 'Failed to check login status');
    }
  }, []);

  const isDirty = useCallback((id: string): boolean => {
    const current = forms[id];
    const saved = savedFormState[id];
    if (!current || !saved) return false;
    return current.apiKey !== saved.apiKey || current.model !== saved.model || current.baseURL !== saved.baseURL;
  }, [forms, savedFormState]);

  // Initialize forms when providers or settings change
  useEffect(() => {
    const initialForms: Record<string, ProviderFormState> = {};
    for (const provider of providers) {
      const saved = settings?.providers[provider.id];
      initialForms[provider.id] = {
        apiKey: saved?.apiKey ?? '',
        model: saved?.model ?? provider.models[0]?.id ?? '',
        baseURL: saved?.baseURL ?? provider.defaultBaseURL,
        showKey: false,
      };
    }
    setForms(initialForms);
    setSavedFormState(initialForms);
    setSelectedId((current) => current ?? settings?.activeProvider ?? providers[0]?.id ?? null);
  }, [providers, settings]);

  const updateForm = (id: string, updates: Partial<ProviderFormState>) => {
    setForms((prev) => ({
      ...prev,
      [id]: { ...prev[id], ...updates },
    }));
  };

  const handleTest = async (meta: ProviderMetaResponse) => {
    const form = forms[meta.id];
    if (!form) return;

    setTestingId(meta.id);
    setTestResults((prev) => { const n = { ...prev }; delete n[meta.id]; return n; });

    try {
      const raw = await api.testLLMProvider({
        provider: meta.id,
        apiKey: form.apiKey,
        model: form.model,
        baseURL: form.baseURL || undefined,
      });
      setTestResults((prev) => ({
        ...prev,
        [meta.id]: { ...raw, latencyMs: 0, testedAt: new Date().toISOString(), configSource: 'draft', provider: meta.id },
      }));
    } catch (err: any) {
      setTestResults((prev) => ({
        ...prev,
        [meta.id]: { success: false, error: err.message, latencyMs: 0, testedAt: new Date().toISOString(), configSource: 'draft', provider: meta.id },
      }));
    } finally {
      setTestingId(null);
    }
  };

  const handleLiveCheck = async (meta: ProviderMetaResponse) => {
    setCheckingLiveId(meta.id);
    try {
      const raw = await api.checkSavedLLMProvider(meta.id);
      setLiveCheckResults((prev) => ({ ...prev, [meta.id]: { ...raw, provider: meta.id } }));
    } catch (err: any) {
      setLiveCheckResults((prev) => ({
        ...prev,
        [meta.id]: { success: false, error: err.message, latencyMs: 0, testedAt: new Date().toISOString(), configSource: 'saved', provider: meta.id },
      }));
    } finally {
      setCheckingLiveId(null);
    }
  };

  const handleSave = async (meta: ProviderMetaResponse, setActive: boolean) => {
    const form = forms[meta.id];
    if (!form) return;

    setSavingId(meta.id);
    onSaveMessage(null);

    try {
      const providerConfig: LLMProviderConfigResponse = {
        provider: meta.id,
        apiKey: form.apiKey,
        model: form.model,
        baseURL: form.baseURL || undefined,
        ...(meta.isCustom ? { name: meta.name } : {}),
      };

      const newSettings: LLMSettingsResponse = {
        activeProvider: setActive ? meta.id : (settings?.activeProvider ?? meta.id),
        providers: {
          ...(settings?.providers ?? {}),
          [meta.id]: providerConfig,
        },
      };

      const result = await api.updateLLMSettings(newSettings);
      onSettingsChange(result.settings);
      setSelectedId(meta.id);
      onSaveMessage(`${meta.name} saved${setActive ? ' and activated' : ''}.`);

      const savedConfig = result.settings.providers[meta.id];
      if (savedConfig) {
        updateForm(meta.id, { apiKey: savedConfig.apiKey });
        setSavedFormState((prev) => ({ ...prev, [meta.id]: { ...forms[meta.id], apiKey: savedConfig.apiKey } }));
      }
      setTimeout(() => onSaveMessage(null), 3200);
    } catch (err: any) {
      onSaveMessage(`Error: ${err.message}`);
    } finally {
      setSavingId(null);
    }
  };

  const handleAddCustom = async () => {
    if (!customDraft.name || !customDraft.baseURL) return;

    const slug = slugify(customDraft.name);
    setSavingId(slug);
    onSaveMessage(null);

    try {
      const providerConfig: LLMProviderConfigResponse = {
        provider: slug,
        apiKey: customDraft.apiKey,
        model: customDraft.model || 'default',
        baseURL: customDraft.baseURL,
        name: customDraft.name,
      };

      const newSettings: LLMSettingsResponse = {
        activeProvider: settings?.activeProvider ?? slug,
        providers: {
          ...(settings?.providers ?? {}),
          [slug]: providerConfig,
        },
      };

      const result = await api.updateLLMSettings(newSettings);
      onSettingsChange(result.settings);

      // Refresh providers list to include the new custom provider
      const providerRes = await api.getLLMProviders();
      onProvidersChange(providerRes.providers);

      setSelectedId(slug);
      setShowAddCustom(false);
      setCustomDraft({ name: '', baseURL: '', apiKey: '', model: '' });
      onSaveMessage(`${customDraft.name} added.`);
      setTimeout(() => onSaveMessage(null), 3200);
    } catch (err: any) {
      onSaveMessage(`Error: ${err.message}`);
    } finally {
      setSavingId(null);
    }
  };

  const handleDelete = async (providerId: string) => {
    setDeletingId(providerId);
    try {
      const result = await api.deleteLLMProvider(providerId);
      onSettingsChange(result.settings);
      const providerRes = await api.getLLMProviders();
      onProvidersChange(providerRes.providers);
      setSelectedId(settings?.activeProvider ?? providers[0]?.id ?? null);
      onSaveMessage('Provider removed.');
      setTimeout(() => onSaveMessage(null), 3200);
    } catch (err: any) {
      onSaveMessage(`Error: ${err.message}`);
    } finally {
      setDeletingId(null);
    }
  };

  const activeProvider = settings?.activeProvider;
  const selectedProvider = providers.find((p) => p.id === selectedId) ?? providers[0];
  const selectedForm = selectedProvider ? forms[selectedProvider.id] : null;
  const configuredProviders = providers.filter((p) => Boolean(settings?.providers[p.id]));
  const selectedSavedConfig = selectedProvider ? settings?.providers[selectedProvider.id] : null;
  const showBaseURL = selectedProvider && selectedProvider.id !== 'claude-code' && selectedProvider.id !== 'codex';

  // ── Master-detail layout ────────────────────────────────────────────────
  return (
    <div className="grid gap-4 xl:grid-cols-[280px_minmax(0,1fr)]">

      {/* ── Left: provider list ──────────────────────────────────────────── */}
      <div className="space-y-2">
        <div className="flex items-center justify-between px-1 pb-1">
          <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--text-faint)]">
            {configuredProviders.length} of {providers.length} configured
          </span>
          <button
            onClick={() => setShowAddCustom(true)}
            className="inline-flex items-center gap-1 text-[11px] font-medium text-[var(--text-faint)] transition hover:text-[var(--text-dim)]"
          >
            <Plus className="h-3 w-3" />
            Add custom
          </button>
        </div>

        {providers.map((meta) => {
          const saved = settings?.providers[meta.id];
          const isActive = activeProvider === meta.id;
          const isConfigured = Boolean(saved);
          const isSelected = selectedProvider?.id === meta.id;

          return (
            <button
              key={meta.id}
              onClick={() => { setShowAddCustom(false); setSelectedId(meta.id); }}
              className={`group flex w-full items-center gap-3 rounded-[16px] border px-3.5 py-3 text-left transition ${
                isSelected
                  ? 'border-[var(--blue)]/35 bg-[linear-gradient(180deg,rgba(59,130,246,0.12),rgba(255,255,255,0.02))]'
                  : 'border-[var(--border)] bg-[var(--surface2)] hover:border-[var(--border2)] hover:bg-[var(--surface-hover)]'
              }`}
            >
              <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-[10px] border ${
                isSelected ? 'border-[var(--blue)]/30 bg-[var(--blue)]/12' : 'border-[var(--border)] bg-[var(--surface3)]'
              }`}>
                <ProviderIcon id={meta.id} className="h-3.5 w-3.5 text-[var(--text-dim)]" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-[13px] font-medium text-[var(--text)]">{meta.name}</span>
                  {isActive && (
                    <span className="shrink-0 rounded-full border border-[var(--accent)]/20 bg-[var(--accent)]/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.14em] text-[var(--accent)]">
                      Active
                    </span>
                  )}
                </div>
                <div className="mt-0.5 truncate text-[11px] text-[var(--text-faint)]">
                  {saved ? saved.model : isConfigured ? 'Configured' : meta.requiresKey ? 'Needs key' : 'Local runtime'}
                </div>
              </div>
              {meta.isCustom && !isActive && (
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(e) => { e.stopPropagation(); void handleDelete(meta.id); }}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); void handleDelete(meta.id); } }}
                  className="shrink-0 rounded-full p-1 text-[var(--text-faint)] opacity-0 transition group-hover:opacity-100 hover:bg-[var(--red-dim)]/40 hover:text-red-300"
                  title="Remove"
                >
                  <Trash2 className="h-3 w-3" />
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* ── Right: editor ────────────────────────────────────────────────── */}
      <div>
        {/* Add custom provider form */}
        {showAddCustom && (
          <section className={`${panelClassName()} overflow-hidden`}>
            <div className="border-b border-[var(--border)] px-5 py-4">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-[10px] border border-[var(--blue)]/20 bg-[var(--blue)]/10">
                    <Plus className="h-4 w-4 text-[var(--blue)]" />
                  </div>
                  <div>
                    <h2 className="text-[15px] font-semibold tracking-[-0.02em] text-[var(--text)]">Add custom provider</h2>
                    <p className="text-[11px] text-[var(--text-faint)]">Any OpenAI-compatible API endpoint</p>
                  </div>
                </div>
                <button
                  onClick={() => { setShowAddCustom(false); setCustomDraft({ name: '', baseURL: '', apiKey: '', model: '' }); }}
                  className="rounded-full p-1.5 text-[var(--text-faint)] transition hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
            <div className="space-y-4 px-5 py-5">
              <div className="grid gap-4 lg:grid-cols-2">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--text-faint)]">Provider name</label>
                  <input
                    type="text"
                    value={customDraft.name}
                    onChange={(e) => setCustomDraft({ ...customDraft, name: e.target.value })}
                    placeholder="e.g. Groq"
                    className="w-full rounded-[14px] border border-[var(--border)] bg-[var(--surface2)] px-3.5 py-2.5 text-[13px] text-[var(--text)] outline-none transition placeholder:text-[var(--text-faint)] focus:border-[var(--blue)]"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--text-faint)]">Base URL</label>
                  <input
                    type="text"
                    value={customDraft.baseURL}
                    onChange={(e) => setCustomDraft({ ...customDraft, baseURL: e.target.value })}
                    placeholder="e.g. https://api.groq.com/openai/v1"
                    className="w-full rounded-[14px] border border-[var(--border)] bg-[var(--surface2)] px-3.5 py-2.5 text-[13px] text-[var(--text)] outline-none transition placeholder:text-[var(--text-faint)] focus:border-[var(--blue)]"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--text-faint)]">API key</label>
                  <input
                    type="password"
                    value={customDraft.apiKey}
                    onChange={(e) => setCustomDraft({ ...customDraft, apiKey: e.target.value })}
                    placeholder="Leave empty for local providers"
                    className="w-full rounded-[14px] border border-[var(--border)] bg-[var(--surface2)] px-3.5 py-2.5 text-[13px] text-[var(--text)] outline-none transition placeholder:text-[var(--text-faint)] focus:border-[var(--blue)]"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--text-faint)]">Model</label>
                  <input
                    type="text"
                    value={customDraft.model}
                    onChange={(e) => setCustomDraft({ ...customDraft, model: e.target.value })}
                    placeholder="e.g. llama-3.3-70b-versatile"
                    className="w-full rounded-[14px] border border-[var(--border)] bg-[var(--surface2)] px-3.5 py-2.5 text-[13px] text-[var(--text)] outline-none transition placeholder:text-[var(--text-faint)] focus:border-[var(--blue)]"
                  />
                </div>
              </div>
              <div className="flex items-center gap-2 pt-1">
                <button
                  onClick={() => void handleAddCustom()}
                  disabled={!customDraft.name || !customDraft.baseURL || savingId !== null}
                  className="inline-flex items-center gap-2 rounded-full border border-[var(--blue)]/30 bg-[linear-gradient(180deg,rgba(59,130,246,0.96),rgba(37,99,235,0.96))] px-4 py-2 text-[12px] font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {savingId ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Adding</> : 'Add provider'}
                </button>
                <button
                  onClick={() => { setShowAddCustom(false); setCustomDraft({ name: '', baseURL: '', apiKey: '', model: '' }); }}
                  className="text-[12px] font-medium text-[var(--text-faint)] transition hover:text-[var(--text-dim)]"
                >
                  Cancel
                </button>
              </div>
            </div>
          </section>
        )}

        {/* Selected provider config */}
        {selectedProvider && selectedForm && !showAddCustom && (
          <section className={`${panelClassName()} overflow-hidden`}>
            {/* Provider header */}
            <div className="border-b border-[var(--border)] px-5 py-4">
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] border border-[var(--blue)]/20 bg-[var(--blue)]/10">
                  <ProviderIcon id={selectedProvider.id} className="h-4 w-4 text-[var(--blue)]" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-[15px] font-semibold tracking-[-0.02em] text-[var(--text)]">{selectedProvider.name}</h2>
                    <span className={`rounded-full border px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.16em] ${statusPillClassName(activeProvider === selectedProvider.id ? 'active' : selectedSavedConfig ? 'configured' : 'idle')}`}>
                      {activeProvider === selectedProvider.id ? 'Live route' : selectedSavedConfig ? 'Standby' : 'Not configured'}
                    </span>
                  </div>
                </div>
              </div>
              {/* Structured metadata pills */}
              <div className="mt-3 flex flex-wrap gap-2">
                {[
                  { label: selectedProvider.requiresKey ? 'Managed API' : 'Local runtime' },
                  {
                    label: selectedProvider.models.length > 0
                      ? `${selectedProvider.models.length} model${selectedProvider.models.length === 1 ? '' : 's'}`
                      : 'Custom model',
                  },
                  { label: selectedSavedConfig ? 'Provisioned' : 'Not saved' },
                ].map((pill) => (
                  <span
                    key={pill.label}
                    className="rounded-full border border-[var(--border)] bg-[var(--surface2)] px-2.5 py-1 text-[10px] font-medium text-[var(--text-faint)]"
                  >
                    {pill.label}
                  </span>
                ))}
              </div>
            </div>

            {/* Saved connection status */}
            {selectedSavedConfig && (
              <div className="border-t border-[var(--border)] px-5 py-4">
                <SavedConnectionStatus
                  providerId={selectedProvider.id}
                  activeProvider={activeProvider}
                  savedConfig={selectedSavedConfig}
                  liveCheckResult={liveCheckResults[selectedProvider.id] ?? null}
                  showBaseURL={!!showBaseURL}
                />
              </div>
            )}

            <div className="grid gap-5 px-5 py-5 2xl:grid-cols-[minmax(0,1fr)_260px]">
              {/* Form */}
              <div className="space-y-4 min-w-0">
                {selectedProvider.requiresKey && (
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--text-faint)]">
                      API key
                    </label>
                    <div className="relative">
                      <input
                        type={selectedForm.showKey ? 'text' : 'password'}
                        value={
                          selectedForm.showKey && selectedForm.apiKey.startsWith('••••')
                            ? `${'•'.repeat(24)}${selectedForm.apiKey.slice(-4)}`
                            : selectedForm.apiKey
                        }
                        onChange={(e) => updateForm(selectedProvider.id, { apiKey: e.target.value })}
                        placeholder={selectedProvider.keyPlaceholder}
                        className="w-full rounded-[14px] border border-[var(--border)] bg-[var(--surface2)] px-3.5 py-2.5 pr-11 text-[13px] text-[var(--text)] outline-none transition placeholder:text-[var(--text-faint)] focus:border-[var(--blue)]"
                      />
                      <button
                        type="button"
                        onClick={() => updateForm(selectedProvider.id, { showKey: !selectedForm.showKey })}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-full p-1.5 text-[var(--text-faint)] transition hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
                        aria-label={selectedForm.showKey ? 'Hide API key' : 'Show API key'}
                      >
                        {selectedForm.showKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                      </button>
                    </div>
                  </div>
                )}

                <div className="grid gap-4 lg:grid-cols-2">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--text-faint)]">Model</label>
                    <input
                      type="text"
                      list={`models-${selectedProvider.id}`}
                      value={selectedForm.model}
                      onChange={(e) => updateForm(selectedProvider.id, { model: e.target.value })}
                      placeholder={selectedProvider.models[0]?.id || 'Enter model ID'}
                      className="w-full rounded-[14px] border border-[var(--border)] bg-[var(--surface2)] px-3.5 py-2.5 text-[13px] text-[var(--text)] outline-none transition placeholder:text-[var(--text-faint)] focus:border-[var(--blue)]"
                    />
                    {selectedProvider.models.length > 0 && (
                      <datalist id={`models-${selectedProvider.id}`}>
                        {selectedProvider.models.map((model) => (
                          <option key={model.id} value={model.id}>{model.label}</option>
                        ))}
                      </datalist>
                    )}
                  </div>

                  {showBaseURL ? (
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--text-faint)]">Base URL</label>
                      <input
                        type="text"
                        value={selectedForm.baseURL}
                        onChange={(e) => updateForm(selectedProvider.id, { baseURL: e.target.value })}
                        placeholder={selectedProvider.defaultBaseURL}
                        className="w-full rounded-[14px] border border-[var(--border)] bg-[var(--surface2)] px-3.5 py-2.5 text-[13px] text-[var(--text)] outline-none transition placeholder:text-[var(--text-faint)] focus:border-[var(--blue)]"
                      />
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 rounded-[14px] border border-dashed border-[var(--border)] bg-[var(--surface2)] px-3.5 py-2.5">
                      <p className="text-[12px] text-[var(--text-faint)]">CLI subprocess — no base URL needed.</p>
                    </div>
                  )}
                </div>

                {/* Codex login flow */}
                {selectedProvider.id === 'codex' && (
                  <div className="rounded-[14px] border border-[var(--blue)]/20 bg-[var(--blue)]/5 p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--blue)]">ChatGPT Plus connection</span>
                      {codexStatus?.authenticated && (
                        <span className="flex items-center gap-1.5 rounded-full border border-[var(--accent)]/25 bg-[var(--accent)]/10 px-2 py-0.5 text-[10px] font-semibold text-[var(--accent)]">
                          <Check className="h-2.5 w-2.5" /> Connected
                        </span>
                      )}
                    </div>
                    {!codexStatus?.installed && (
                      <p className="text-[12px] leading-5 text-[var(--text-dim)]">
                        Install the Codex CLI first:{' '}
                        <code className="rounded bg-[var(--surface3)] px-1.5 py-0.5 text-[11px] text-[var(--accent)]">npm install -g @openai/codex</code>
                      </p>
                    )}
                    {codexStatus?.installed && !codexStatus.authenticated && (
                      <div className="space-y-2.5">
                        <div className="flex items-center gap-2 rounded-[10px] border border-[var(--border)] bg-[var(--surface2)] px-3 py-2">
                          <code className="flex-1 text-[12px] text-green-300 font-mono">codex login</code>
                          <button
                            onClick={() => navigator.clipboard.writeText('codex login')}
                            className="rounded-full p-1 text-[var(--text-faint)] transition hover:text-[var(--text)]"
                            title="Copy"
                          >
                            <Copy className="h-3 w-3" />
                          </button>
                        </div>
                        <button
                          onClick={() => void startCodexLogin()}
                          disabled={codexLoginState === 'starting'}
                          className="inline-flex items-center gap-2 rounded-full border border-[var(--blue)]/30 bg-[linear-gradient(180deg,rgba(59,130,246,0.96),rgba(37,99,235,0.96))] px-3.5 py-2 text-[12px] font-semibold text-white transition hover:brightness-110 disabled:opacity-50"
                        >
                          {codexLoginState === 'starting'
                            ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Checking…</>
                            : <><Check className="h-3.5 w-3.5" />I've signed in</>}
                        </button>
                      </div>
                    )}
                    {codexLoginState === 'error' && (
                      <div className="flex items-center gap-2 text-[12px] text-red-300">
                        <X className="h-3.5 w-3.5" />
                        {codexLoginError || 'Not signed in yet. Run "codex login" first.'}
                      </div>
                    )}
                    {(codexLoginState === 'success' || codexStatus?.authenticated) && (
                      <div className="flex items-center gap-2 text-[12px] text-green-300">
                        <Check className="h-3.5 w-3.5" />
                        Signed in — click Save and activate to use Codex.
                      </div>
                    )}
                  </div>
                )}

                {/* Actions */}
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  {/* Check live connection — only visible when provider has a saved config */}
                  {selectedSavedConfig && (
                    <button
                      onClick={() => void handleLiveCheck(selectedProvider)}
                      disabled={checkingLiveId !== null || testingId !== null}
                      className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface2)] px-3.5 py-2 text-[12px] font-medium text-[var(--text-dim)] transition hover:border-[var(--border2)] hover:text-[var(--text)] disabled:cursor-not-allowed disabled:opacity-40"
                      title="Verify the saved configuration currently used by the app."
                    >
                      {checkingLiveId === selectedProvider.id
                        ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Checking live</>
                        : <><RadioTower className="h-3.5 w-3.5" />Check live connection</>}
                    </button>
                  )}
                  {/* Test draft — enabled only when the user has unsaved changes */}
                  <button
                    onClick={() => void handleTest(selectedProvider)}
                    disabled={
                      !isDirty(selectedProvider.id) ||
                      testingId !== null ||
                      checkingLiveId !== null ||
                      (selectedProvider.requiresKey && (!selectedForm.apiKey || selectedForm.apiKey.startsWith('••••')))
                    }
                    className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface2)] px-3.5 py-2 text-[12px] font-medium text-[var(--text-dim)] transition hover:border-[var(--border2)] hover:text-[var(--text)] disabled:cursor-not-allowed disabled:opacity-40"
                    title="Validate the unsaved values in this form."
                  >
                    {testingId === selectedProvider.id ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Testing draft</> : 'Test draft'}
                  </button>
                  <button
                    onClick={() => void handleSave(selectedProvider, true)}
                    disabled={savingId !== null || (selectedProvider.requiresKey && !selectedForm.apiKey)}
                    className="inline-flex items-center gap-1.5 rounded-full border border-[var(--blue)]/30 bg-[linear-gradient(180deg,rgba(59,130,246,0.96),rgba(37,99,235,0.96))] px-3.5 py-2 text-[12px] font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {savingId === selectedProvider.id ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Saving</> : activeProvider === selectedProvider.id ? 'Save changes' : 'Save and activate'}
                  </button>
                  <button
                    onClick={() => void handleSave(selectedProvider, false)}
                    disabled={savingId !== null || (selectedProvider.requiresKey && !selectedForm.apiKey)}
                    className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface2)] px-3.5 py-2 text-[12px] font-medium text-[var(--text-dim)] transition hover:border-[var(--border2)] hover:text-[var(--text)] disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Save without testing
                  </button>
                  {selectedProvider.isCustom && (
                    <button
                      onClick={() => void handleDelete(selectedProvider.id)}
                      disabled={deletingId !== null || activeProvider === selectedProvider.id}
                      className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-[var(--red)]/20 px-3.5 py-2 text-[12px] font-medium text-red-300/70 transition hover:border-[var(--red)]/40 hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-40"
                      title={activeProvider === selectedProvider.id ? 'Switch to another provider before deleting' : 'Remove this custom provider'}
                    >
                      {deletingId === selectedProvider.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                      Remove
                    </button>
                  )}
                </div>
              </div>

              {/* Sidebar: model picker + diagnostics */}
              <aside className="space-y-3">
                {selectedProvider.models.length > 0 && (
                  <div className="rounded-[18px] border border-[var(--border)] bg-[var(--surface2)] p-3.5">
                    <div className="mb-2.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--text-faint)]">
                      <Layers3 className="h-3.5 w-3.5 text-[var(--blue)]" />
                      Suggested models
                    </div>
                    <div className="space-y-1.5">
                      {selectedProvider.models.map((model) => {
                        const isChosen = selectedForm.model === model.id;
                        return (
                          <button
                            key={model.id}
                            onClick={() => updateForm(selectedProvider.id, { model: model.id })}
                            className={`w-full rounded-[12px] border px-3 py-2.5 text-left transition ${
                              isChosen
                                ? 'border-[var(--blue)]/30 bg-[var(--blue)]/8'
                                : 'border-[var(--border)] bg-[var(--surface)] hover:border-[var(--border2)] hover:bg-[var(--surface-hover)]'
                            }`}
                          >
                            <div className={`text-[12px] font-medium ${isChosen ? 'text-[var(--text)]' : 'text-[var(--text-dim)]'}`}>{model.label}</div>
                            <div className="mt-0.5 truncate text-[10px] text-[var(--text-faint)]">{model.id}</div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                <ProviderDiagnostics
                  providerId={selectedProvider.id}
                  activeProvider={activeProvider}
                  savedConfig={selectedSavedConfig}
                  liveCheckResult={liveCheckResults[selectedProvider.id] ?? null}
                  testResult={testResults[selectedProvider.id] ?? null}
                />
              </aside>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
