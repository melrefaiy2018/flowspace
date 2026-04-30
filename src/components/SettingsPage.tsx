import { useState, useEffect, useCallback } from 'react';
import {
  Loader2,
  ArrowUpCircle,
  RefreshCw,
  LogOut,
  ShieldCheck,
  UserRound,
  Mail,
  BadgeCheck,
  PencilLine,
  RotateCcw,
  Check,
  Clock,
  RadioTower,
  HardDrive,
} from 'lucide-react';
import { api } from '../services/api';
import type { ConnectedAccount, ProviderMetaResponse, LLMSettingsResponse } from '../services/api';
import { useUpdateCheck } from '../hooks/useUpdateCheck';
import PersonaSettings from './PersonaSettings';
import LLMProviderSettings from './LLMProviderSettings';
import SynthesisSettingsPanel from './synthesizer/SynthesisSettingsPanel';
import ActivityLogView from './synthesizer/ActivityLogView';
import { useAuth } from '../context/AuthContext';
import type { SettingsSection } from './SettingsRail';
import { useWorkspaceIdentity } from '../lib/workspaceIdentity';
import { clearAllClientData } from '../lib/clear-client-data';
import ThemeToggle from './ThemeToggle';

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
  return `rounded-[22px] border border-[var(--border)] bg-[var(--surface)] shadow-[0_20px_60px_rgba(0,0,0,0.12)] backdrop-blur-sm ${extra ?? ''}`;
}

// Compact page-level header: title + one-line description + optional right-side action
function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 pb-1">
      <div>
        <h1 className="text-[19px] font-semibold tracking-[-0.03em] text-[var(--text)]">{title}</h1>
        <p className="mt-0.5 text-[12px] leading-5 text-[var(--text-faint)]">{description}</p>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

// Structured metadata cell: a labeled value pair used in status strips
function MetaCell({ label, value, icon: Icon }: { label: string; value: string; icon?: React.ElementType }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--text-faint)]">{label}</span>
      <div className="flex items-center gap-1.5">
        {Icon && <Icon className="h-3.5 w-3.5 shrink-0 text-[var(--accent)]" />}
        <span className="truncate text-[13px] font-medium text-[var(--text)]">{value}</span>
      </div>
    </div>
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
  const [identitySaved, setIdentitySaved] = useState(false);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);
  const [showActivityLog, setShowActivityLog] = useState(false);
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

  useEffect(() => { void loadData(); }, [loadData]);
  useEffect(() => { setIdentityDraft(identityName); }, [identityName]);

  const handleCheckUpdates = useCallback(() => {
    recheckVersion();
    setLastChecked(new Date());
  }, [recheckVersion]);

  const handleIdentitySave = useCallback(() => {
    const trimmed = identityDraft.trim();
    const nextValue = trimmed || fallbackIdentity;
    saveIdentity(nextValue);
    setIdentityDraft(nextValue);
    setIsEditingIdentity(false);
    setIdentitySaved(true);
    setTimeout(() => setIdentitySaved(false), 2000);
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
  const configuredProviders = providers.filter((p) => Boolean(settings?.providers[p.id]));
  const activeProviderMeta = providers.find((p) => p.id === activeProvider) ?? null;
  const activeModel = activeProviderMeta ? (settings?.providers[activeProviderMeta.id]?.model ?? 'Default model') : null;
  const userDisplayName = identityName || user?.user_metadata?.name || user?.email?.split('@')[0] || 'FlowSpace user';

  // ── Helpers ────────────────────────────────────────────────────────────
  function formatLastChecked(d: Date | null) {
    if (!d) return 'Never';
    const mins = Math.floor((Date.now() - d.getTime()) / 60000);
    if (mins < 1) return 'Just now';
    if (mins === 1) return '1 minute ago';
    return `${mins} minutes ago`;
  }

  // ── General ────────────────────────────────────────────────────────────
  const renderGeneralSection = () => (
    <div className="space-y-4">
      <PageHeader
        title="Settings"
        description="Workspace controls for FlowSpace."
      />

      {/* Appearance */}
      <div className={`${panelClassName()} px-5 py-4`}>
        <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--text-faint)] mb-3">
          Appearance
        </div>
        <ThemeToggle variant="row" />
      </div>

      {/* 4-cell status strip */}
      <div className={`${panelClassName()} px-5 py-4`}>
        <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
          <MetaCell label="Account" value={userDisplayName} />
          <MetaCell
            label="Active provider"
            value={activeProviderMeta ? activeProviderMeta.name : 'None'}
          />
          <MetaCell
            label="Configured"
            value={`${configuredProviders.length} of ${providers.length}`}
          />
          <MetaCell
            label="Credentials"
            value="Local"
            icon={ShieldCheck}
          />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {([
          { id: 'providers', title: 'LLM Providers', desc: 'Models, credentials, active routing' },
          { id: 'account', title: 'User Account', desc: 'Identity, email, session actions' },
          { id: 'personalization', title: 'Personalization', desc: 'Persona, tone, custom instructions' },
          { id: 'updates', title: 'Updates', desc: 'Version status and release channel' },
        ] as { id: SettingsSection; title: string; desc: string }[]).map((item) => (
          <button
            key={item.id}
            onClick={() => onSectionChange(item.id)}
            className="rounded-[18px] border border-[var(--border)] bg-[var(--surface2)] px-4 py-3.5 text-left transition hover:border-[var(--border2)] hover:bg-[var(--surface-hover)]"
          >
            <div className="text-[13px] font-semibold text-[var(--text)]">{item.title}</div>
            <div className="mt-0.5 text-[12px] text-[var(--text-faint)]">{item.desc}</div>
          </button>
        ))}
      </div>
    </div>
  );

  // ── Account ────────────────────────────────────────────────────────────
  const renderAccountSection = () => (
    <div className="space-y-4">
      <PageHeader
        title="User Account"
        description="Workspace identity, signed-in account, and connected Google accounts."
      />

      {/* Inline status strip under the title */}
      {(activeProviderMeta || true) && (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-[16px] border border-[var(--border)] bg-[var(--surface2)] px-4 py-3">
          <div className="flex items-center gap-1.5 text-[12px]">
            <BadgeCheck className="h-3.5 w-3.5 shrink-0 text-[var(--accent)]" />
            <span className="text-[var(--text-faint)]">Route:</span>
            <span className="font-medium text-[var(--text-dim)]">
              {activeProviderMeta ? `${activeProviderMeta.name}${activeModel ? ` · ${activeModel}` : ''}` : 'No active provider'}
            </span>
          </div>
          <div className="flex items-center gap-1.5 text-[12px]">
            <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-[var(--accent)]" />
            <span className="text-[var(--text-faint)]">Credentials:</span>
            <span className="font-medium text-[var(--text-dim)]">Stored locally</span>
          </div>
        </div>
      )}

      {/* Main content — single dominant column */}
      <div className="space-y-3">
        {/* Workspace identity */}
        <section className={`${panelClassName()} p-5`}>
          <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--text-faint)]">
            Workspace identity
          </div>
          <p className="mt-1.5 text-[12px] leading-5 text-[var(--text-dim)]">
            Rename how this workspace appears without changing your authenticated email.
          </p>
          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="relative min-w-0 flex-1">
              <input
                value={identityDraft}
                onChange={(e) => setIdentityDraft(e.target.value)}
                onFocus={() => setIsEditingIdentity(true)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); handleIdentitySave(); }
                  else if (e.key === 'Escape') { e.preventDefault(); setIdentityDraft(identityName); setIsEditingIdentity(false); }
                }}
                placeholder="Enter workspace identity"
                className="w-full rounded-[14px] border border-[var(--border)] bg-[var(--surface2)] px-4 py-2.5 pr-10 text-[14px] text-[var(--text)] outline-none transition placeholder:text-[var(--text-faint)] focus:border-[var(--blue)]"
              />
              <PencilLine className="absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--text-faint)]" />
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button
                onClick={handleIdentitySave}
                className="inline-flex items-center gap-1.5 rounded-full border border-[var(--blue)]/30 bg-[linear-gradient(180deg,rgba(59,130,246,0.96),rgba(37,99,235,0.96))] px-4 py-2 text-[12px] font-semibold text-white transition hover:brightness-110"
              >
                {identitySaved ? <><Check size={12} />Saved</> : 'Save'}
              </button>
              <button
                onClick={handleIdentityReset}
                className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface2)] px-3.5 py-2 text-[12px] font-medium text-[var(--text-dim)] transition hover:border-[var(--border2)] hover:text-[var(--text)]"
                title="Reset to default"
              >
                <RotateCcw size={12} />
              </button>
              {isEditingIdentity && (
                <button
                  onClick={() => { setIdentityDraft(identityName); setIsEditingIdentity(false); }}
                  className="text-[12px] text-[var(--text-faint)] transition hover:text-[var(--text-dim)]"
                >
                  Cancel
                </button>
              )}
            </div>
          </div>
        </section>

        {/* Signed-in account */}
        <section className={`${panelClassName()} p-5`}>
          <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--text-faint)]">
            Signed-in account
          </div>
          <div className="mt-3 flex items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[12px] border border-[var(--border)] bg-[var(--surface2)]">
              <UserRound className="h-4.5 w-4.5 text-[var(--text-dim)]" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[14px] font-semibold text-[var(--text)]">{userDisplayName}</div>
              <div className="flex items-center gap-1 text-[12px] text-[var(--text-dim)]">
                <Mail className="h-3 w-3 shrink-0" />
                <span className="truncate">{user?.email ?? 'Unknown'}</span>
              </div>
            </div>
            <button
              onClick={handleLogout}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface2)] px-3 py-1.5 text-[11px] font-medium text-[var(--text-dim)] transition hover:border-[var(--border2)] hover:text-[var(--text)]"
            >
              <LogOut size={11} />
              Sign out
            </button>
          </div>
        </section>

        {/* Connected accounts */}
        <section className={`${panelClassName()} p-5`}>
          <div className="flex items-center justify-between gap-3">
            <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--text-faint)]">
              Connected Google accounts
            </div>
            {onAddAccount && (
              <button
                onClick={onAddAccount}
                className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface2)] px-3 py-1.5 text-[11px] font-medium text-[var(--text)] transition hover:border-[var(--border2)] hover:bg-[var(--surface-hover)]"
              >
                Add account
              </button>
            )}
          </div>
          <p className="mt-1 text-[12px] text-[var(--text-faint)]">
            Switch the active workspace or add another account.
          </p>
          {accounts.length > 0 ? (
            <div className="mt-3 space-y-2">
              {accounts.map((account) => {
                const isActive = account.id === activeAccountId;
                return (
                  <div
                    key={account.id}
                    className={`flex items-center gap-3 rounded-[14px] border px-3.5 py-2.5 ${
                      isActive ? 'border-[var(--accent)]/25 bg-[var(--accent)]/10' : 'border-[var(--border)] bg-[var(--surface2)]'
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-semibold text-[var(--text)]">{account.name || account.email}</div>
                      <div className="truncate text-[11px] text-[var(--text-dim)]">{account.email}</div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      {onSwitchAccount && (
                        <button
                          onClick={() => onSwitchAccount(account.id)}
                          disabled={isActive}
                          className="rounded-full border border-[var(--border)] bg-[var(--surface2)] px-2.5 py-1 text-[11px] font-medium text-[var(--text-dim)] transition hover:border-[var(--border2)] hover:text-[var(--text)] disabled:opacity-50"
                        >
                          {isActive ? 'Active' : 'Switch'}
                        </button>
                      )}
                      {onRemoveAccount && (
                        <button
                          onClick={() => onRemoveAccount(account.id)}
                          className="rounded-full border border-[var(--border)] px-2.5 py-1 text-[11px] font-medium text-[var(--text-dim)] transition hover:border-[var(--error)]/30 hover:text-[var(--error)]"
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="mt-3 text-[12px] text-[var(--text-faint)]">No additional accounts connected.</p>
          )}
        </section>
      </div>
    </div>
  );

  // ── Personalization ────────────────────────────────────────────────────
  const renderPersonalizationSection = () => (
    <div className="space-y-4">
      <PageHeader
        title="Personalization"
        description="Tune how FlowSpace communicates — tone, format, and role guidance."
      />
      <div className={`${panelClassName()} p-5 md:p-6`}>
        <PersonaSettings />
      </div>
    </div>
  );

  // ── Updates ────────────────────────────────────────────────────────────
  const renderUpdatesSection = () => {
    const updateStatus = versionInfo?.updateAvailable
      ? 'Update available'
      : versionInfo && !versionLoading
      ? 'Up to date'
      : 'Unknown';

    return (
      <div className="space-y-4">
        <PageHeader
          title="Updates"
          description="Release channel and version status."
          action={
            <button
              onClick={handleCheckUpdates}
              disabled={versionLoading}
              className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface2)] px-3.5 py-2 text-[12px] font-medium text-[var(--text-dim)] transition hover:border-[var(--border2)] hover:text-[var(--text)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <RefreshCw size={12} className={versionLoading ? 'animate-spin' : ''} />
              Check now
            </button>
          }
        />

        {/* System status strip */}
        <div className={`${panelClassName()} px-5 py-4`}>
          <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
            <MetaCell label="Version" value={__APP_VERSION__} />
            <MetaCell label="Release channel" value="Stable" icon={RadioTower} />
            <MetaCell label="Last checked" value={formatLastChecked(lastChecked)} icon={Clock} />
            <MetaCell
              label="Status"
              value={updateStatus}
              icon={versionInfo?.updateAvailable ? ArrowUpCircle : undefined}
            />
          </div>
        </div>

        {versionInfo?.updateAvailable && (
          <div className={`${panelClassName()} p-5`}>
            <div className="flex items-center gap-2 text-[13px] font-semibold text-[var(--accent)]">
              <ArrowUpCircle size={15} />
              Version {versionInfo.latest} available
            </div>
            <p className="mt-2 text-[12px] leading-5 text-[var(--text-dim)]">
              Update with{' '}
              <code className="rounded bg-[var(--surface3)] px-1.5 py-0.5 text-[var(--text)]">npx flowspace-ai</code>
            </p>
            {versionInfo.releaseUrl && (
              <a
                href={versionInfo.releaseUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 inline-flex text-[12px] font-medium text-[var(--accent)] transition hover:opacity-80"
              >
                View release notes
              </a>
            )}
          </div>
        )}

        <div className={`${panelClassName()} p-5`}>
          <div className="mb-3 flex items-center gap-2">
            <HardDrive className="h-3.5 w-3.5 text-[var(--text-faint)]" />
            <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--text-faint)]">Maintenance</span>
          </div>
          <ul className="space-y-2 text-[12px] leading-5 text-[var(--text-dim)]">
            <li className="flex gap-2"><span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-[var(--border2)]" />Check updates before rotating providers or changing default routes.</li>
            <li className="flex gap-2"><span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-[var(--border2)]" />Review release notes when model defaults or auth behavior changes.</li>
            <li className="flex gap-2"><span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-[var(--border2)]" />Keep local runtime integrations current with your installed tooling.</li>
          </ul>
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-full bg-[var(--bg)]">
      <div className="mx-auto flex max-w-[1420px] flex-col gap-4 px-4 py-5 md:px-6 md:py-5">
        {saveMessage && (
          <div className={`rounded-[16px] border px-4 py-2.5 text-[13px] ${
            saveMessage.startsWith('Error')
              ? 'border-[var(--red)]/20 bg-[var(--red-dim)]/40 text-red-200'
              : 'border-[var(--accent)]/20 bg-[var(--accent-dim)]/45 text-green-200'
          }`}>
            {saveMessage}
          </div>
        )}

        {selectedSection === 'general' && renderGeneralSection()}
        {selectedSection === 'providers' && (
          <>
            <PageHeader
              title="LLM Providers"
              description="Configure credentials, select models, and set the active provider."
            />
            <LLMProviderSettings
              providers={providers}
              settings={settings}
              onSettingsChange={setSettings}
              onProvidersChange={setProviders}
              saveMessage={saveMessage}
              onSaveMessage={setSaveMessage}
            />
          </>
        )}
        {selectedSection === 'account' && renderAccountSection()}
        {selectedSection === 'personalization' && renderPersonalizationSection()}
        {selectedSection === 'suggestions' && (
          <>
            <PageHeader
              title="Workflow Suggestions"
              description="Opt in to surface saved-workflow suggestions from your repeated tool usage."
            />
            {showActivityLog ? (
              <ActivityLogView onBack={() => setShowActivityLog(false)} />
            ) : (
              <SynthesisSettingsPanel onOpenActivityLog={() => setShowActivityLog(true)} />
            )}
          </>
        )}
        {selectedSection === 'updates' && renderUpdatesSection()}
      </div>
    </div>
  );
}
