import { useState, useEffect, useCallback } from 'react';
import {
  Loader2,
  ArrowUpCircle,
  RefreshCw,
  LogOut,
  ShieldCheck,
  Sparkles,
  UserRound,
  Mail,
  BadgeCheck,
  PencilLine,
  RotateCcw,
} from 'lucide-react';
import { api } from '../services/api';
import type { ConnectedAccount, ProviderMetaResponse, LLMSettingsResponse } from '../services/api';
import { useUpdateCheck } from '../hooks/useUpdateCheck';
import PersonaSettings from './PersonaSettings';
import LLMProviderSettings from './LLMProviderSettings';
import { useAuth } from '../context/AuthContext';
import type { SettingsSection } from './SettingsRail';
import { useWorkspaceIdentity } from '../lib/workspaceIdentity';
import { clearAllClientData } from '../lib/clear-client-data';

interface SettingsPageProps {
  selectedSection: SettingsSection;
  onSectionChange: (section: SettingsSection) => void;
  accounts?: ConnectedAccount[];
  activeAccountId?: string | null;
  onAddAccount?: () => void;
  onSwitchAccount?: (accountId: string) => void;
  onRemoveAccount?: (accountId: string) => void;
}

function panelClassName(extra?: string) {
  return `rounded-[22px] border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.045),rgba(255,255,255,0.02))] shadow-[0_20px_60px_rgba(0,0,0,0.24)] backdrop-blur-sm ${extra ?? ''}`;
}

function SettingsHero({
  selectedSection,
  providers,
  configuredProviders,
  localProviders,
  remoteProviders,
  versionLoading,
  recheckVersion,
  userDisplayName,
}: {
  selectedSection: SettingsSection;
  providers: ProviderMetaResponse[];
  configuredProviders: ProviderMetaResponse[];
  localProviders: number;
  remoteProviders: number;
  versionLoading: boolean;
  recheckVersion: () => void;
  userDisplayName: string;
}) {
  const sectionConfig: Record<SettingsSection, { eyebrow: string; title: string; description: string }> = {
    general: {
      eyebrow: 'Control Plane',
      title: 'AI settings',
      description: 'Manage workspace controls for providers, account preferences, updates, and personalization.',
    },
    providers: {
      eyebrow: 'Provider Control',
      title: 'LLM provider management',
      description: 'Configure credentials, select models, and control which provider receives live FlowSpace traffic.',
    },
    account: {
      eyebrow: 'Identity',
      title: `${userDisplayName} account`,
      description: 'Review workspace identity, authenticated email, and the route currently serving your assistant.',
    },
    personalization: {
      eyebrow: 'Assistant Behavior',
      title: 'Persona and response style',
      description: 'Adjust how FlowSpace speaks, structures its output, and adapts to your operating preferences.',
    },
    updates: {
      eyebrow: 'Release Channel',
      title: 'Version and update controls',
      description: 'Inspect release status, verify whether an update is available, and review maintenance guidance.',
    },
  };
  const current = sectionConfig[selectedSection];

  return (
    <section className={`${panelClassName()} overflow-hidden px-5 py-5 md:px-6 md:py-6`}>
      <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
        <div className="max-w-3xl">
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.24em] text-[var(--text-dim)]">
            <Sparkles className="h-3.5 w-3.5 text-[var(--blue)]" />
            {current.eyebrow}
          </div>
          <h1 className="text-[28px] font-semibold tracking-[-0.045em] text-white md:text-[34px]">
            {current.title}
          </h1>
          <p className="mt-3 max-w-2xl text-[14px] leading-7 text-[var(--text-dim)]">
            {current.description}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 xl:justify-end">
          <button
            onClick={recheckVersion}
            disabled={versionLoading}
            className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-4 py-2.5 text-[12px] font-medium text-[var(--text-dim)] transition hover:border-white/20 hover:bg-white/[0.06] hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RefreshCw size={13} className={versionLoading ? 'animate-spin' : ''} />
            Check updates
          </button>
          <div className="inline-flex items-center gap-2 rounded-full border border-[var(--accent)]/20 bg-[var(--accent)]/8 px-4 py-2.5 text-[12px] font-medium text-[var(--text)]">
            <ShieldCheck size={13} className="text-[var(--accent)]" />
            Local credential storage
          </div>
        </div>
      </div>

      {(selectedSection === 'general' || selectedSection === 'providers') && (
        <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[
            { label: 'Providers', value: providers.length, tone: 'text-white' },
            { label: 'Configured', value: configuredProviders.length, tone: 'text-[var(--accent)]' },
            { label: 'Remote', value: remoteProviders, tone: 'text-[var(--blue)]' },
            { label: 'Local', value: localProviders, tone: 'text-[var(--text-dim)]' },
          ].map((item) => (
            <div key={item.label} className="rounded-[18px] border border-white/8 bg-black/20 px-4 py-3.5">
              <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--text-faint)]">
                {item.label}
              </div>
              <div className={`mt-2 text-[28px] font-semibold tracking-[-0.05em] ${item.tone}`}>
                {item.value}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export default function SettingsPage({
  selectedSection,
  onSectionChange,
  accounts = [],
  activeAccountId = null,
  onAddAccount,
  onSwitchAccount,
  onRemoveAccount,
}: SettingsPageProps) {
  const { user } = useAuth();
  const [providers, setProviders] = useState<ProviderMetaResponse[]>([]);
  const [settings, setSettings] = useState<LLMSettingsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [identityDraft, setIdentityDraft] = useState('');
  const [isEditingIdentity, setIsEditingIdentity] = useState(false);
  const { versionInfo, loading: versionLoading, recheck: recheckVersion } = useUpdateCheck();
  const fallbackIdentity = user?.user_metadata?.name ?? user?.email?.split('@')[0] ?? 'FlowSpace user';
  const {
    identity: identityName,
    saveIdentity,
    clearIdentity,
  } = useWorkspaceIdentity(user?.email, fallbackIdentity);

  const handleLogout = useCallback(async () => {
    clearAllClientData();
    await api.logout();
    window.location.reload();
  }, []);

  const loadData = useCallback(async () => {
    try {
      const [providerRes, settingsRes] = await Promise.all([
        api.getLLMProviders(),
        api.getLLMSettings(),
      ]);

      setProviders(providerRes.providers);
      setSettings(settingsRes.settings);
    } catch (err: any) {
      console.error('Failed to load LLM settings:', err);
      setLoadError(err?.message || 'Failed to load settings. Is the server running?');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    setIdentityDraft(identityName);
  }, [identityName]);

  const handleIdentitySave = useCallback(() => {
    const trimmed = identityDraft.trim();
    const nextValue = trimmed || fallbackIdentity;
    saveIdentity(nextValue);
    setIdentityDraft(nextValue);
    setIsEditingIdentity(false);
  }, [fallbackIdentity, identityDraft, saveIdentity]);

  const handleIdentityReset = useCallback(() => {
    clearIdentity();
    setIdentityDraft(fallbackIdentity);
    setIsEditingIdentity(false);
  }, [clearIdentity, fallbackIdentity]);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-[var(--text-faint)]" />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8">
        <div className="rounded-[18px] border border-[var(--red)]/20 bg-[var(--red-dim)]/40 px-4 py-3 text-sm text-red-200">
          Failed to load settings: {loadError}
        </div>
      </div>
    );
  }

  const activeProvider = settings?.activeProvider;
  const configuredProviders = providers.filter((provider) => Boolean(settings?.providers[provider.id]));
  const localProviders = providers.filter((provider) => provider.id === 'lmstudio' || provider.id === 'claude-code').length;
  const remoteProviders = providers.length - localProviders;
  const activeProviderMeta = providers.find((provider) => provider.id === activeProvider) ?? null;
  const userDisplayName = identityName || user?.user_metadata?.name || user?.email?.split('@')[0] || 'FlowSpace user';

  const renderAccountSection = () => (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
      <section className={`${panelClassName()} p-6`}>
        <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--text-faint)]">Account</div>
        <div className="mt-2 text-[28px] font-semibold tracking-[-0.04em] text-white">Workspace identity</div>
        <p className="mt-2 text-[13px] leading-6 text-[var(--text-dim)]">
          Rename how this workspace appears in Settings without changing your authenticated email.
        </p>
        <div className="mt-5 rounded-[18px] border border-white/8 bg-black/20 p-4">
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--text-faint)]">Display name</div>
          <div className="mt-3 flex flex-col gap-3">
            <div className="relative">
              <input
                value={identityDraft}
                onChange={(e) => setIdentityDraft(e.target.value)}
                onFocus={() => setIsEditingIdentity(true)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleIdentitySave();
                  } else if (e.key === 'Escape') {
                    e.preventDefault();
                    setIdentityDraft(identityName);
                    setIsEditingIdentity(false);
                  }
                }}
                placeholder="Enter workspace identity"
                className="w-full rounded-[16px] border border-white/10 bg-white/[0.03] px-4 py-3 pr-11 text-[14px] text-white outline-none transition placeholder:text-[var(--text-faint)] focus:border-[var(--blue)]/45"
              />
              <PencilLine className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-faint)]" />
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={handleIdentitySave}
                className="inline-flex items-center gap-2 rounded-full border border-[var(--blue)]/30 bg-[linear-gradient(180deg,rgba(59,130,246,0.96),rgba(37,99,235,0.96))] px-4 py-2.5 text-[13px] font-semibold text-white transition hover:brightness-110"
              >
                Save identity
              </button>
              <button
                onClick={handleIdentityReset}
                className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-4 py-2.5 text-[13px] font-medium text-[var(--text-dim)] transition hover:border-white/20 hover:bg-white/[0.06] hover:text-white"
              >
                <RotateCcw size={13} />
                Reset to default
              </button>
              {isEditingIdentity && (
                <button
                  onClick={() => {
                    setIdentityDraft(identityName);
                    setIsEditingIdentity(false);
                  }}
                  className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/20 px-4 py-2.5 text-[13px] font-medium text-[var(--text-dim)] transition hover:border-white/20 hover:bg-white/[0.04] hover:text-white"
                >
                  Cancel
                </button>
              )}
            </div>
          </div>
        </div>
        <div className="mt-6 flex items-start gap-4 rounded-[20px] border border-white/8 bg-black/20 p-5">
          <div className="flex h-14 w-14 items-center justify-center rounded-[18px] border border-white/10 bg-white/[0.04] text-white">
            <UserRound className="h-6 w-6" />
          </div>
          <div className="min-w-0">
            <div className="text-[20px] font-semibold text-white">{userDisplayName}</div>
            <div className="mt-2 flex items-center gap-2 text-[13px] text-[var(--text-dim)]">
              <Mail className="h-4 w-4" />
              <span className="truncate">{user?.email ?? 'Unknown user'}</span>
            </div>
            <button
              onClick={handleLogout}
              className="mt-5 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-4 py-2.5 text-[13px] font-medium text-[var(--text-dim)] transition hover:border-white/18 hover:bg-white/[0.06] hover:text-white"
            >
              <LogOut size={13} />
              Sign out
            </button>
          </div>
        </div>
        <div className="mt-6 rounded-[20px] border border-white/8 bg-black/20 p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--text-faint)]">Connected Google accounts</div>
              <div className="mt-1 text-[13px] text-[var(--text-dim)]">Switch the active workspace account or add another slot.</div>
            </div>
            {onAddAccount && (
              <button
                onClick={onAddAccount}
                className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-[12px] font-medium text-white transition hover:border-white/20 hover:bg-white/[0.06]"
              >
                Add account
              </button>
            )}
          </div>
          <div className="mt-4 space-y-2">
            {accounts.map((account) => {
              const isActive = account.id === activeAccountId;
              return (
                <div key={account.id} className={`flex items-center gap-3 rounded-[16px] border px-4 py-3 ${isActive ? 'border-[var(--accent)]/25 bg-[var(--accent)]/10' : 'border-white/8 bg-white/[0.02]'}`}>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[14px] font-semibold text-white">{account.name || account.email}</div>
                    <div className="truncate text-[12px] text-[var(--text-dim)]">{account.email}</div>
                  </div>
                  {onSwitchAccount && (
                    <button
                      onClick={() => onSwitchAccount(account.id)}
                      disabled={isActive}
                      className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-[11px] font-medium text-[var(--text-dim)] transition hover:border-white/20 hover:text-white disabled:opacity-50"
                    >
                      {isActive ? 'Active' : 'Switch'}
                    </button>
                  )}
                  {onRemoveAccount && (
                    <button
                      onClick={() => onRemoveAccount(account.id)}
                      className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-[11px] font-medium text-[var(--text-dim)] transition hover:border-[var(--error)]/30 hover:text-[var(--error)]"
                    >
                      Remove
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section className="space-y-6">
        <div className={`${panelClassName()} p-5`}>
          <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--text-faint)]">Active routing</div>
          <div className="mt-3 flex items-center gap-3">
            <div className="rounded-[14px] border border-[var(--accent)]/20 bg-[var(--accent)]/10 p-2.5">
              <BadgeCheck className="h-4.5 w-4.5 text-[var(--accent)]" />
            </div>
            <div>
              <div className="text-[15px] font-semibold text-white">{activeProviderMeta?.name ?? 'No active provider'}</div>
              <div className="mt-1 text-[12px] text-[var(--text-dim)]">
                {activeProviderMeta ? settings?.providers[activeProviderMeta.id]?.model ?? 'Default model' : 'Activate a provider to route requests.'}
              </div>
            </div>
          </div>
        </div>

        <div className={`${panelClassName()} p-5`}>
          <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--text-faint)]">Security</div>
          <p className="mt-3 text-[13px] leading-6 text-[var(--text-dim)]">
            FlowSpace stores provider settings locally and uses your authenticated workspace identity for app access only.
          </p>
        </div>
      </section>
    </div>
  );

  const renderPersonalizationSection = () => (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
      <section className={`${panelClassName()} p-5 md:p-6`}>
        <div className="mb-5">
          <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--text-faint)]">Personalization</div>
          <div className="mt-1 text-[22px] font-semibold tracking-[-0.03em] text-white">Assistant profile</div>
          <p className="mt-2 text-[13px] leading-6 text-[var(--text-dim)]">
            Tune tone, formatting, and role guidance for how FlowSpace communicates with you.
          </p>
        </div>
        <PersonaSettings />
      </section>

      <section className={`${panelClassName()} p-5`}>
        <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--text-faint)]">What changes here</div>
        <ul className="mt-4 space-y-3 text-[12px] leading-6 text-[var(--text-dim)]">
          <li>Tone changes affect response depth and directness.</li>
          <li>Format style shapes whether replies lean on bullets, structure, or prose.</li>
          <li>Custom instructions apply on top of the selected preset.</li>
        </ul>
      </section>
    </div>
  );

  const renderUpdatesSection = () => (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
      <section className={`${panelClassName()} p-5 md:p-6`}>
        <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--text-faint)]">Release channel</div>
        <div className="mt-1 text-[22px] font-semibold tracking-[-0.03em] text-white">FlowSpace {__APP_VERSION__}</div>
        {versionInfo?.updateAvailable ? (
          <div className="mt-5 rounded-[18px] border border-[var(--accent)]/20 bg-[var(--accent-dim)]/45 p-4">
            <div className="flex items-center gap-2 text-[13px] font-semibold text-[var(--accent)]">
              <ArrowUpCircle size={15} />
              Version {versionInfo.latest} available
            </div>
            <p className="mt-2 text-[12px] leading-6 text-[var(--text-dim)]">
              Update from the desktop shell with <code className="rounded bg-black/30 px-1.5 py-0.5 text-white">npx flowspace-ai</code>.
            </p>
            {versionInfo.releaseUrl && (
              <a href={versionInfo.releaseUrl} target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex text-[12px] font-medium text-[var(--accent)] transition hover:opacity-80">
                View release notes
              </a>
            )}
          </div>
        ) : versionInfo && !versionLoading ? (
          <p className="mt-5 text-[13px] text-[var(--text-dim)]">You are on the latest version.</p>
        ) : (
          <p className="mt-5 text-[13px] text-[var(--text-dim)]">Use the refresh action to verify the latest release.</p>
        )}
      </section>

      <section className={`${panelClassName()} p-5`}>
        <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--text-faint)]">Maintenance</div>
        <ul className="mt-4 space-y-3 text-[12px] leading-6 text-[var(--text-dim)]">
          <li>Check updates before rotating providers or changing default routes.</li>
          <li>Review release notes when model defaults or auth behavior change.</li>
          <li>Keep local runtime integrations current with your installed tooling.</li>
        </ul>
      </section>
    </div>
  );

  const renderGeneralSection = () => (
    <div className="space-y-6">
      <section className={`${panelClassName()} p-5 md:p-6`}>
        <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--text-faint)]">General</div>
        <div className="mt-1 text-[22px] font-semibold tracking-[-0.03em] text-white">Settings overview</div>
        <p className="mt-2 max-w-2xl text-[13px] leading-6 text-[var(--text-dim)]">
          Choose a category to manage a specific part of FlowSpace. Each section below opens a focused workspace with only its related controls.
        </p>
        <div className="mt-5 grid gap-3 md:grid-cols-2">
          <button onClick={() => onSectionChange('providers')} className="rounded-[18px] border border-white/8 bg-black/20 p-4 text-left transition hover:border-white/16 hover:bg-white/[0.04]">
            <div className="text-[14px] font-semibold text-white">LLM Providers</div>
            <div className="mt-1 text-[12px] text-[var(--text-dim)]">Models, credentials, active routing, endpoint controls</div>
          </button>
          <button onClick={() => onSectionChange('account')} className="rounded-[18px] border border-white/8 bg-black/20 p-4 text-left transition hover:border-white/16 hover:bg-white/[0.04]">
            <div className="text-[14px] font-semibold text-white">User Account</div>
            <div className="mt-1 text-[12px] text-[var(--text-dim)]">Identity, email, session actions</div>
          </button>
          <button onClick={() => onSectionChange('personalization')} className="rounded-[18px] border border-white/8 bg-black/20 p-4 text-left transition hover:border-white/16 hover:bg-white/[0.04]">
            <div className="text-[14px] font-semibold text-white">Personalization</div>
            <div className="mt-1 text-[12px] text-[var(--text-dim)]">Persona, tone, formatting, custom instructions</div>
          </button>
          <button onClick={() => onSectionChange('updates')} className="rounded-[18px] border border-white/8 bg-black/20 p-4 text-left transition hover:border-white/16 hover:bg-white/[0.04]">
            <div className="text-[14px] font-semibold text-white">Updates</div>
            <div className="mt-1 text-[12px] text-[var(--text-dim)]">Version status and release channel checks</div>
          </button>
        </div>
      </section>
    </div>
  );

  return (
    <div className="min-h-full bg-[radial-gradient(circle_at_top_left,rgba(59,130,246,0.12),transparent_22%),radial-gradient(circle_at_top_right,rgba(34,197,94,0.1),transparent_18%),linear-gradient(180deg,rgba(255,255,255,0.02),rgba(255,255,255,0))]">
      <div className="mx-auto flex max-w-[1420px] flex-col gap-6 px-4 py-5 md:px-6 md:py-6">
        <SettingsHero
          selectedSection={selectedSection}
          providers={providers}
          configuredProviders={configuredProviders}
          localProviders={localProviders}
          remoteProviders={remoteProviders}
          versionLoading={versionLoading}
          recheckVersion={recheckVersion}
          userDisplayName={userDisplayName}
        />

        {saveMessage && (
          <div className={`rounded-[18px] border px-4 py-3 text-sm ${
            saveMessage.startsWith('Error')
              ? 'border-[var(--red)]/20 bg-[var(--red-dim)]/40 text-red-200'
              : 'border-[var(--accent)]/20 bg-[var(--accent-dim)]/45 text-green-200'
          }`}>
            {saveMessage}
          </div>
        )}

        {selectedSection === 'general' && renderGeneralSection()}
        {selectedSection === 'providers' && (
          <LLMProviderSettings
            providers={providers}
            settings={settings}
            onSettingsChange={setSettings}
            onProvidersChange={setProviders}
            saveMessage={saveMessage}
            onSaveMessage={setSaveMessage}
          />
        )}
        {selectedSection === 'account' && renderAccountSection()}
        {selectedSection === 'personalization' && renderPersonalizationSection()}
        {selectedSection === 'updates' && renderUpdatesSection()}
      </div>
    </div>
  );
}
