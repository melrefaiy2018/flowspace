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
} from 'lucide-react';
import { api } from '../services/api';
import type { ProviderMetaResponse, LLMSettingsResponse, LLMProviderConfigResponse } from '../services/api';

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
  return `rounded-[22px] border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.045),rgba(255,255,255,0.02))] shadow-[0_20px_60px_rgba(0,0,0,0.24)] backdrop-blur-sm ${extra ?? ''}`;
}

function statusPillClassName(tone: 'active' | 'configured' | 'idle') {
  if (tone === 'active') return 'border-[var(--accent)]/20 bg-[var(--accent)]/10 text-[var(--accent)]';
  if (tone === 'configured') return 'border-[var(--blue)]/18 bg-[var(--blue)]/10 text-[var(--blue)]';
  return 'border-white/10 bg-white/[0.04] text-[var(--text-dim)]';
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
  const [testResult, setTestResult] = useState<{ id: string; success: boolean; error?: string } | null>(null);
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
      const { authenticated } = await api.pollCodexLogin();
      if (authenticated) {
        setCodexLoginState('success');
        setCodexStatus({ installed: true, authenticated: true });
      } else {
        setCodexLoginState('error');
        setCodexLoginError('Not signed in yet — run "codex login" in your terminal first.');
      }
    } catch (err: any) {
      setCodexLoginState('error');
      setCodexLoginError(err.message ?? 'Failed to check login status');
    }
  }, []);

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
    setTestResult(null);

    try {
      const result = await api.testLLMProvider({
        provider: meta.id,
        apiKey: form.apiKey,
        model: form.model,
        baseURL: form.baseURL || undefined,
      });
      setTestResult({ id: meta.id, ...result });
    } catch (err: any) {
      setTestResult({ id: meta.id, success: false, error: err.message });
    } finally {
      setTestingId(null);
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
      if (savedConfig) updateForm(meta.id, { apiKey: savedConfig.apiKey });
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

  return (
    <div className="space-y-6">
      {/* Provider Grid */}
      <section className={panelClassName('p-3')}>
        <div className="flex flex-col gap-4 border-b border-white/8 px-3 pb-4 pt-2 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--text-faint)]">
              Provider Matrix
            </div>
            <div className="mt-1 text-[18px] font-semibold tracking-[-0.03em] text-white">
              Routing inventory
            </div>
          </div>
          <div className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[12px] text-[var(--text-dim)]">
            {configuredProviders.length}/{providers.length} configured
          </div>
        </div>

        <div className="grid gap-3 p-2 md:grid-cols-2 2xl:grid-cols-3">
          {providers.map((meta) => {
            const saved = settings?.providers[meta.id];
            const isActive = activeProvider === meta.id;
            const isConfigured = Boolean(saved);
            const isSelected = selectedProvider?.id === meta.id;

            return (
              <button
                key={meta.id}
                onClick={() => setSelectedId(meta.id)}
                className={`group rounded-[18px] border px-4 py-4 text-left transition ${
                  isSelected
                    ? 'border-[var(--blue)]/45 bg-[linear-gradient(180deg,rgba(59,130,246,0.16),rgba(255,255,255,0.02))]'
                    : 'border-white/8 bg-white/[0.02] hover:border-white/16 hover:bg-white/[0.04]'
                }`}
              >
                <div className="flex items-start gap-3">
                  <div className={`rounded-[14px] border p-2.5 ${
                    isSelected ? 'border-[var(--blue)]/35 bg-[var(--blue)]/12' : 'border-white/10 bg-black/20'
                  }`}>
                    <ProviderIcon id={meta.id} className="h-4.5 w-4.5 text-[var(--text-dim)]" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="text-[15px] font-semibold text-white">{meta.name}</div>
                      <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] ${statusPillClassName(isActive ? 'active' : isConfigured ? 'configured' : 'idle')}`}>
                        {isActive ? 'Active' : isConfigured ? 'Configured' : 'Available'}
                      </span>
                    </div>
                    <div className="mt-1 text-[12px] text-[var(--text-faint)]">
                      {saved ? `Model: ${saved.model}` : meta.requiresKey ? 'Credential required' : 'Ready for local runtime'}
                    </div>
                    <div className="mt-4 flex items-center justify-between text-[11px] text-[var(--text-faint)]">
                      <span>
                        {meta.models.length > 0
                          ? `${meta.models.length} model option${meta.models.length === 1 ? '' : 's'}`
                          : 'Custom model'}
                      </span>
                      <div className="inline-flex items-center gap-2">
                        {meta.isCustom && !isActive && (
                          <span
                            role="button"
                            tabIndex={0}
                            onClick={(e) => { e.stopPropagation(); void handleDelete(meta.id); }}
                            onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); void handleDelete(meta.id); } }}
                            className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[var(--text-faint)] transition hover:bg-[var(--red-dim)]/40 hover:text-red-300"
                            title="Remove custom provider"
                          >
                            <Trash2 className="h-3 w-3" />
                          </span>
                        )}
                        <span className="inline-flex items-center gap-1">
                          Configure
                          <ChevronRight className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" />
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </button>
            );
          })}

          {/* Add Custom Provider Card */}
          <button
            onClick={() => setShowAddCustom(true)}
            className="group rounded-[18px] border border-dashed border-white/12 px-4 py-4 text-left transition hover:border-white/24 hover:bg-white/[0.03]"
          >
            <div className="flex items-start gap-3">
              <div className="rounded-[14px] border border-white/10 bg-black/20 p-2.5">
                <Plus className="h-4.5 w-4.5 text-[var(--text-faint)]" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[15px] font-semibold text-[var(--text-dim)] group-hover:text-white">
                  Add custom provider
                </div>
                <div className="mt-1 text-[12px] text-[var(--text-faint)]">
                  Any OpenAI-compatible endpoint
                </div>
                <div className="mt-4 text-[11px] text-[var(--text-faint)]">
                  Groq, Together, Fireworks, Ollama, etc.
                </div>
              </div>
            </div>
          </button>
        </div>
      </section>

      {/* Add Custom Provider Form */}
      {showAddCustom && (
        <section className={`${panelClassName()} overflow-hidden`}>
          <div className="border-b border-white/8 px-5 py-5 md:px-6">
            <div className="flex items-center gap-3">
              <div className="rounded-[18px] border border-[var(--blue)]/20 bg-[var(--blue)]/10 p-3">
                <Plus className="h-6 w-6 text-white" />
              </div>
              <div>
                <h2 className="text-[22px] font-semibold tracking-[-0.04em] text-white">Add custom provider</h2>
                <p className="mt-1 text-[13px] text-[var(--text-dim)]">Any OpenAI-compatible API endpoint</p>
              </div>
            </div>
          </div>
          <div className="space-y-5 px-5 py-5 md:px-6 md:py-6">
            <div className="grid gap-5 lg:grid-cols-2">
              <div className="space-y-2">
                <label className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--text-faint)]">
                  Provider name
                </label>
                <input
                  type="text"
                  value={customDraft.name}
                  onChange={(e) => setCustomDraft({ ...customDraft, name: e.target.value })}
                  placeholder="e.g. Groq"
                  className="w-full rounded-[18px] border border-white/10 bg-black/20 px-4 py-3 text-[14px] text-white outline-none transition placeholder:text-[var(--text-faint)] focus:border-[var(--blue)]/45 focus:bg-black/28"
                />
              </div>
              <div className="space-y-2">
                <label className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--text-faint)]">
                  Base URL
                </label>
                <input
                  type="text"
                  value={customDraft.baseURL}
                  onChange={(e) => setCustomDraft({ ...customDraft, baseURL: e.target.value })}
                  placeholder="e.g. https://api.groq.com/openai/v1"
                  className="w-full rounded-[18px] border border-white/10 bg-black/20 px-4 py-3 text-[14px] text-white outline-none transition placeholder:text-[var(--text-faint)] focus:border-[var(--blue)]/45 focus:bg-black/28"
                />
              </div>
            </div>
            <div className="grid gap-5 lg:grid-cols-2">
              <div className="space-y-2">
                <label className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--text-faint)]">
                  API key
                </label>
                <input
                  type="password"
                  value={customDraft.apiKey}
                  onChange={(e) => setCustomDraft({ ...customDraft, apiKey: e.target.value })}
                  placeholder="API key (leave empty for local providers)"
                  className="w-full rounded-[18px] border border-white/10 bg-black/20 px-4 py-3 text-[14px] text-white outline-none transition placeholder:text-[var(--text-faint)] focus:border-[var(--blue)]/45 focus:bg-black/28"
                />
              </div>
              <div className="space-y-2">
                <label className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--text-faint)]">
                  Model
                </label>
                <input
                  type="text"
                  value={customDraft.model}
                  onChange={(e) => setCustomDraft({ ...customDraft, model: e.target.value })}
                  placeholder="e.g. llama-3.3-70b-versatile"
                  className="w-full rounded-[18px] border border-white/10 bg-black/20 px-4 py-3 text-[14px] text-white outline-none transition placeholder:text-[var(--text-faint)] focus:border-[var(--blue)]/45 focus:bg-black/28"
                />
              </div>
            </div>
            <div className="flex items-center gap-3 pt-1">
              <button
                onClick={() => void handleAddCustom()}
                disabled={!customDraft.name || !customDraft.baseURL || savingId !== null}
                className="inline-flex items-center gap-2 rounded-full border border-[var(--blue)]/30 bg-[linear-gradient(180deg,rgba(59,130,246,0.96),rgba(37,99,235,0.96))] px-4 py-2.5 text-[13px] font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {savingId ? <><Loader2 className="h-4 w-4 animate-spin" />Adding</> : 'Add provider'}
              </button>
              <button
                onClick={() => { setShowAddCustom(false); setCustomDraft({ name: '', baseURL: '', apiKey: '', model: '' }); }}
                className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/20 px-4 py-2.5 text-[13px] font-medium text-[var(--text-dim)] transition hover:border-white/20 hover:bg-white/[0.04] hover:text-white"
              >
                Cancel
              </button>
            </div>
          </div>
        </section>
      )}

      {/* Selected Provider Config Panel */}
      {selectedProvider && selectedForm && !showAddCustom && (
        <section className={`${panelClassName()} overflow-hidden`}>
          <div className="border-b border-white/8 px-5 py-5 md:px-6">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
              <div className="flex items-start gap-4">
                <div className="rounded-[18px] border border-[var(--blue)]/20 bg-[var(--blue)]/10 p-3">
                  <ProviderIcon id={selectedProvider.id} className="h-6 w-6 text-white" />
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-[26px] font-semibold tracking-[-0.04em] text-white">
                      {selectedProvider.name}
                    </h2>
                    <span className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] ${statusPillClassName(activeProvider === selectedProvider.id ? 'active' : selectedSavedConfig ? 'configured' : 'idle')}`}>
                      {activeProvider === selectedProvider.id ? 'Live route' : selectedSavedConfig ? 'Standby route' : 'Pending setup'}
                    </span>
                  </div>
                  <p className="mt-2 max-w-2xl text-[13px] leading-6 text-[var(--text-dim)]">
                    Configure credentials, routing defaults, and endpoint behavior for this provider.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <div className="rounded-[16px] border border-white/8 bg-black/20 px-4 py-3">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--text-faint)]">Mode</div>
                  <div className="mt-2 text-[13px] font-semibold text-white">
                    {selectedProvider.requiresKey ? 'Managed API' : 'Local runtime'}
                  </div>
                </div>
                <div className="rounded-[16px] border border-white/8 bg-black/20 px-4 py-3">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--text-faint)]">Catalog</div>
                  <div className="mt-2 text-[13px] font-semibold text-white">
                    {selectedProvider.models.length > 0
                      ? `${selectedProvider.models.length} options`
                      : 'Custom'}
                  </div>
                </div>
                <div className="rounded-[16px] border border-white/8 bg-black/20 px-4 py-3 col-span-2 sm:col-span-1">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--text-faint)]">Status</div>
                  <div className="mt-2 text-[13px] font-semibold text-white">
                    {selectedSavedConfig ? 'Provisioned' : 'Not saved'}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="grid gap-5 px-5 py-5 md:px-6 md:py-6 2xl:grid-cols-[minmax(0,1fr)_300px]">
            <div className="space-y-5 min-w-0">
              {selectedProvider.requiresKey && (
                <div className="space-y-2">
                  <label className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--text-faint)]">
                    API key
                  </label>
                  <div className="relative">
                    <input
                      type={selectedForm.showKey ? 'text' : 'password'}
                      value={selectedForm.apiKey}
                      onChange={(e) => updateForm(selectedProvider.id, { apiKey: e.target.value })}
                      placeholder={selectedProvider.keyPlaceholder}
                      className="w-full rounded-[18px] border border-white/10 bg-black/20 px-4 py-3 pr-12 text-[14px] text-white outline-none transition placeholder:text-[var(--text-faint)] focus:border-[var(--blue)]/45 focus:bg-black/28"
                    />
                    <button
                      type="button"
                      onClick={() => updateForm(selectedProvider.id, { showKey: !selectedForm.showKey })}
                      className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-2 text-[var(--text-faint)] transition hover:bg-white/[0.05] hover:text-white"
                      aria-label={selectedForm.showKey ? 'Hide API key' : 'Show API key'}
                    >
                      {selectedForm.showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
              )}

              <div className="grid gap-5 lg:grid-cols-2">
                {/* Model input — combobox with datalist for suggestions */}
                <div className="space-y-2">
                  <label className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--text-faint)]">
                    Model
                  </label>
                  <input
                    type="text"
                    list={`models-${selectedProvider.id}`}
                    value={selectedForm.model}
                    onChange={(e) => updateForm(selectedProvider.id, { model: e.target.value })}
                    placeholder={selectedProvider.models[0]?.id || 'Enter model ID'}
                    className="w-full rounded-[18px] border border-white/10 bg-black/20 px-4 py-3 text-[14px] text-white outline-none transition placeholder:text-[var(--text-faint)] focus:border-[var(--blue)]/45 focus:bg-black/28"
                  />
                  {selectedProvider.models.length > 0 && (
                    <datalist id={`models-${selectedProvider.id}`}>
                      {selectedProvider.models.map((model) => (
                        <option key={model.id} value={model.id}>{model.label}</option>
                      ))}
                    </datalist>
                  )}
                </div>

                {/* Base URL — shown for all providers except claude-code */}
                {showBaseURL ? (
                  <div className="space-y-2">
                    <label className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--text-faint)]">
                      Base URL
                    </label>
                    <input
                      type="text"
                      value={selectedForm.baseURL}
                      onChange={(e) => updateForm(selectedProvider.id, { baseURL: e.target.value })}
                      placeholder={selectedProvider.defaultBaseURL}
                      className="w-full rounded-[18px] border border-white/10 bg-black/20 px-4 py-3 text-[14px] text-white outline-none transition placeholder:text-[var(--text-faint)] focus:border-[var(--blue)]/45 focus:bg-black/28"
                    />
                  </div>
                ) : (
                  <div className="rounded-[18px] border border-dashed border-white/10 bg-white/[0.02] p-4">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--text-faint)]">
                      Endpoint policy
                    </div>
                    <p className="mt-2 text-[13px] leading-6 text-[var(--text-dim)]">
                      This provider uses the CLI subprocess. No base URL is needed.
                    </p>
                  </div>
                )}
              </div>

              {selectedProvider.id === 'codex' && (
                <div className="rounded-[18px] border border-[var(--blue)]/20 bg-[var(--blue)]/5 p-4 space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--blue)]">
                      ChatGPT Plus connection
                    </div>
                    {codexStatus?.authenticated && (
                      <span className="flex items-center gap-1.5 rounded-full border border-[var(--accent)]/25 bg-[var(--accent)]/10 px-2.5 py-1 text-[11px] font-semibold text-[var(--accent)]">
                        <Check className="h-3 w-3" /> Connected
                      </span>
                    )}
                  </div>

                  {!codexStatus?.installed && (
                    <p className="text-[13px] leading-6 text-[var(--text-dim)]">
                      First, install the Codex CLI in your terminal:
                      <span className="block mt-2 rounded-[10px] border border-white/10 bg-black/30 px-3 py-2 font-mono text-[12px] text-green-300">
                        npm install -g @openai/codex
                      </span>
                      Then reload this page and click Connect below.
                    </p>
                  )}

                  {codexStatus?.installed && !codexStatus.authenticated && (
                    <div className="space-y-3">
                      <p className="text-[13px] leading-6 text-[var(--text-dim)]">
                        Run this in your terminal to sign in with ChatGPT, then click <strong className="text-white">I've signed in</strong>:
                      </p>
                      <div className="flex items-center gap-2 rounded-[12px] border border-white/10 bg-black/30 px-4 py-2.5">
                        <code className="flex-1 text-[13px] text-green-300 font-mono">codex login</code>
                        <button
                          onClick={() => navigator.clipboard.writeText('codex login')}
                          className="rounded-full p-1.5 text-[var(--text-faint)] transition hover:bg-white/[0.08] hover:text-white"
                          title="Copy"
                        >
                          <Copy className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      <button
                        onClick={() => void startCodexLogin()}
                        disabled={codexLoginState === 'starting'}
                        className="inline-flex items-center gap-2 rounded-full border border-[var(--blue)]/30 bg-[linear-gradient(180deg,rgba(59,130,246,0.96),rgba(37,99,235,0.96))] px-4 py-2.5 text-[13px] font-semibold text-white transition hover:brightness-110 disabled:opacity-50"
                      >
                        {codexLoginState === 'starting'
                          ? <><Loader2 className="h-4 w-4 animate-spin" />Checking…</>
                          : <><Check className="h-4 w-4" />I've signed in</>}
                      </button>
                    </div>
                  )}

                  {codexLoginState === 'error' && (
                    <div className="flex items-center gap-2 text-[13px] text-red-300">
                      <X className="h-4 w-4" />
                      {codexLoginError || 'Not signed in yet. Run "codex login" in your terminal first.'}
                    </div>
                  )}

                  {(codexLoginState === 'success' || codexStatus?.authenticated) && (
                    <div className="flex items-center gap-2 text-[13px] text-green-300">
                      <Check className="h-4 w-4" />
                      Signed in! Click <strong>Save and activate</strong> to use Codex.
                    </div>
                  )}
                </div>
              )}

              {testResult?.id === selectedProvider.id && (
                <div className={`rounded-[18px] border px-4 py-3 text-sm ${
                  testResult.success
                    ? 'border-[var(--accent)]/20 bg-[var(--accent-dim)]/45 text-green-200'
                    : 'border-[var(--red)]/20 bg-[var(--red-dim)]/40 text-red-200'
                }`}>
                  <div className="flex items-center gap-2">
                    {testResult.success ? <Check className="h-4 w-4" /> : <X className="h-4 w-4" />}
                    {testResult.success ? 'Connection successful.' : testResult.error || 'Connection failed.'}
                  </div>
                </div>
              )}

              <div className="flex flex-wrap items-center gap-3 pt-1">
                <button
                  onClick={() => void handleTest(selectedProvider)}
                  disabled={testingId !== null || (selectedProvider.requiresKey && (!selectedForm.apiKey || selectedForm.apiKey.startsWith('••••')))}
                  className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-4 py-2.5 text-[13px] font-medium text-[var(--text-dim)] transition hover:border-white/20 hover:bg-white/[0.06] hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {testingId === selectedProvider.id ? <><Loader2 className="h-4 w-4 animate-spin" />Testing</> : 'Test connection'}
                </button>
                <button
                  onClick={() => void handleSave(selectedProvider, true)}
                  disabled={savingId !== null || (selectedProvider.requiresKey && !selectedForm.apiKey)}
                  className="inline-flex items-center gap-2 rounded-full border border-[var(--blue)]/30 bg-[linear-gradient(180deg,rgba(59,130,246,0.96),rgba(37,99,235,0.96))] px-4 py-2.5 text-[13px] font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {savingId === selectedProvider.id ? <><Loader2 className="h-4 w-4 animate-spin" />Saving</> : activeProvider === selectedProvider.id ? 'Save changes' : 'Save and activate'}
                </button>
                <button
                  onClick={() => void handleSave(selectedProvider, false)}
                  disabled={savingId !== null || (selectedProvider.requiresKey && !selectedForm.apiKey)}
                  className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/20 px-4 py-2.5 text-[13px] font-medium text-[var(--text-dim)] transition hover:border-white/20 hover:bg-white/[0.04] hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Save only
                </button>
                {/* Delete button for custom providers only */}
                {selectedProvider.isCustom && (
                  <button
                    onClick={() => void handleDelete(selectedProvider.id)}
                    disabled={deletingId !== null || activeProvider === selectedProvider.id}
                    className="inline-flex items-center gap-2 rounded-full border border-[var(--red)]/20 bg-[var(--red-dim)]/20 px-4 py-2.5 text-[13px] font-medium text-red-300 transition hover:border-[var(--red)]/40 hover:bg-[var(--red-dim)]/40 disabled:cursor-not-allowed disabled:opacity-40"
                    title={activeProvider === selectedProvider.id ? 'Switch to another provider before deleting' : 'Remove this custom provider'}
                  >
                    {deletingId === selectedProvider.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                    Remove
                  </button>
                )}
              </div>
            </div>

            <aside className="space-y-4">
              {selectedProvider.models.length > 0 && (
                <div className="rounded-[20px] border border-white/8 bg-black/20 p-4">
                  <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--text-faint)]">
                    <Layers3 className="h-4 w-4 text-[var(--blue)]" />
                    Suggested models
                  </div>
                  <div className="mt-3 space-y-2">
                    {selectedProvider.models.map((model) => {
                      const selectedModel = selectedForm.model === model.id;
                      return (
                        <button
                          key={model.id}
                          onClick={() => updateForm(selectedProvider.id, { model: model.id })}
                          className={`w-full rounded-[14px] border px-3 py-3 text-left transition ${
                            selectedModel
                              ? 'border-[var(--blue)]/40 bg-[var(--blue)]/10'
                              : 'border-white/8 bg-white/[0.02] hover:border-white/16 hover:bg-white/[0.04]'
                          }`}
                        >
                          <div className="text-[13px] font-medium text-white">{model.label}</div>
                          <div className="mt-1 truncate text-[11px] text-[var(--text-faint)]">{model.id}</div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="rounded-[20px] border border-white/8 bg-black/20 p-4">
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--text-faint)]">
                  Security posture
                </div>
                <div className="mt-3 rounded-[16px] border border-white/8 bg-white/[0.02] p-4">
                  <div className="flex items-center gap-2 text-[12px] font-medium text-white">
                    <KeyRound className="h-4 w-4 text-[var(--accent)]" />
                    Local-only secrets
                  </div>
                  <p className="mt-2 text-[12px] leading-6 text-[var(--text-dim)]">
                    Credentials are written to <code className="rounded bg-black/30 px-1.5 py-0.5 text-white">~/Library/Application Support/FlowSpace/.llm-settings.json</code>.
                  </p>
                </div>
              </div>
            </aside>
          </div>
        </section>
      )}
    </div>
  );
}
