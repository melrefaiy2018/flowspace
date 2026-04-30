import { useState, useEffect, useCallback } from 'react';
import { Check, Loader2 } from 'lucide-react';
import { api } from '../services/api';
import { DEFAULT_PERSONA, PERSONA_PRESETS, type Persona } from '../lib/persona';
import { AGENT_NAME } from '../lib/branding';

const TONE_OPTIONS: { value: Persona['tone']; label: string; desc: string }[] = [
  { value: 'concise', label: 'Concise', desc: 'Short, punchy, no fluff' },
  { value: 'balanced', label: 'Balanced', desc: 'Clear with enough context' },
  { value: 'detailed', label: 'Detailed', desc: 'Thorough with full context' },
];

const STYLE_OPTIONS: { value: Persona['style']; label: string; desc: string }[] = [
  { value: 'bullets', label: 'Bullets', desc: 'Scannable lists' },
  { value: 'structured', label: 'Structured', desc: 'Headers + tables + lists' },
  { value: 'prose', label: 'Prose', desc: 'Flowing paragraphs' },
];

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--text-faint)]">
      {children}
    </div>
  );
}

export default function PersonaSettings() {
  const [persona, setPersona] = useState<Persona>(DEFAULT_PERSONA);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    api.getPersona().then(({ persona: p }) => {
      if (p) setPersona(p);
      setLoaded(true);
    }).catch(() => setLoaded(true));
  }, []);

  const save = useCallback(async (updated: Persona) => {
    setPersona(updated);
    setSaving(true);
    setSaved(false);
    try {
      await api.savePersona(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      // Persona is optional — silently skip
    } finally {
      setSaving(false);
    }
  }, []);

  const applyPreset = useCallback((key: string) => {
    const preset = PERSONA_PRESETS[key];
    if (preset) void save({ ...preset, customInstructions: persona.customInstructions });
  }, [save, persona.customInstructions]);

  if (!loaded) return null;

  return (
    <div className="space-y-7">
      {/* Header */}
      <div>
        <div className="text-[14px] font-semibold text-[var(--text)]">{AGENT_NAME} persona</div>
        <p className="mt-0.5 text-[12px] text-[var(--text-faint)]">Customize how {AGENT_NAME} communicates with you.</p>
      </div>

      {/* ── Presets ─── strongest selected state */}
      <div className="space-y-2">
        <SectionLabel>Quick presets</SectionLabel>
        <div className="flex flex-wrap gap-2">
          {Object.entries(PERSONA_PRESETS).map(([key, preset]) => {
            const isActive = persona.name === preset.name;
            return (
              <button
                key={key}
                onClick={() => applyPreset(key)}
                className={`rounded-[10px] border px-3.5 py-1.5 text-[12px] font-medium transition ${
                  isActive
                    ? 'border-[var(--accent)]/40 bg-[var(--accent)]/15 text-[var(--accent)]'
                    : 'border-[var(--border)] bg-[var(--surface)] text-[var(--text-dim)] hover:border-[var(--border2)] hover:text-[var(--text)]'
                }`}
              >
                {preset.name}
              </button>
            );
          })}
        </div>
      </div>

      {/* Divider */}
      <div className="border-t border-white/6" />

      {/* ── Tone ─── lighter selection treatment */}
      <div className="space-y-2">
        <SectionLabel>Tone</SectionLabel>
        <div className="flex gap-2">
          {TONE_OPTIONS.map((opt) => {
            const isActive = persona.tone === opt.value;
            return (
              <button
                key={opt.value}
                onClick={() => void save({ ...persona, tone: opt.value, name: 'Custom' })}
                className={`flex-1 rounded-[10px] border px-3 py-2 text-center transition ${
                  isActive
                    ? 'border-white/20 bg-white/[0.07]'
                    : 'border-[var(--border)] bg-transparent hover:border-white/14 hover:bg-white/[0.03]'
                }`}
              >
                <div className={`text-[12px] font-medium ${isActive ? 'text-white' : 'text-[var(--text-dim)]'}`}>
                  {opt.label}
                </div>
                <div className="mt-0.5 text-[10px] text-[var(--text-faint)]">{opt.desc}</div>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Format style ─── same lighter treatment */}
      <div className="space-y-2">
        <SectionLabel>Format style</SectionLabel>
        <div className="flex gap-2">
          {STYLE_OPTIONS.map((opt) => {
            const isActive = persona.style === opt.value;
            return (
              <button
                key={opt.value}
                onClick={() => void save({ ...persona, style: opt.value, name: 'Custom' })}
                className={`flex-1 rounded-[10px] border px-3 py-2 text-center transition ${
                  isActive
                    ? 'border-white/20 bg-white/[0.07]'
                    : 'border-[var(--border)] bg-transparent hover:border-white/14 hover:bg-white/[0.03]'
                }`}
              >
                <div className={`text-[12px] font-medium ${isActive ? 'text-white' : 'text-[var(--text-dim)]'}`}>
                  {opt.label}
                </div>
                <div className="mt-0.5 text-[10px] text-[var(--text-faint)]">{opt.desc}</div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Divider before text inputs */}
      <div className="border-t border-white/6" />

      {/* ── Role description ─── second tier, follow-through */}
      <div className="space-y-1.5">
        <SectionLabel>Role description</SectionLabel>
        <input
          value={persona.role}
          onChange={(e) => setPersona({ ...persona, role: e.target.value, name: 'Custom' })}
          onBlur={(e) => void save({ ...persona, role: e.currentTarget.value, name: 'Custom' })}
          className="w-full rounded-[10px] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[13px] text-[var(--text)] outline-none transition focus:border-white/20 placeholder:text-[var(--text-faint)]"
          placeholder="e.g., an executive assistant who values brevity"
        />
      </div>

      {/* ── Custom instructions ─── second tier */}
      <div className="space-y-1.5">
        <SectionLabel>Custom instructions</SectionLabel>
        <textarea
          value={persona.customInstructions}
          onChange={(e) => setPersona({ ...persona, customInstructions: e.target.value })}
          onBlur={(e) => void save({ ...persona, customInstructions: e.currentTarget.value })}
          rows={3}
          className="w-full resize-none rounded-[10px] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[13px] text-[var(--text)] outline-none transition focus:border-white/20 placeholder:text-[var(--text-faint)]"
          placeholder="e.g., Always mention deadlines in bold. Use emoji sparingly."
        />
        <p className="text-[11px] text-[var(--text-faint)]">
          Applied on top of the selected preset. Supports markdown emphasis.
        </p>
      </div>

      {/* Save indicator */}
      {(saving || saved) && (
        <div className="flex items-center gap-2 text-[11px]">
          {saving && <><Loader2 size={12} className="animate-spin text-[var(--text-faint)]" /><span className="text-[var(--text-faint)]">Saving…</span></>}
          {saved && <><Check size={12} className="text-[var(--accent)]" /><span className="text-[var(--accent)]">Saved</span></>}
        </div>
      )}
    </div>
  );
}
