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
      // Silently fail — persona is optional
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
    <div className="space-y-6">
      <div>
        <h3 className="text-[14px] font-semibold text-[var(--text)] mb-1">{AGENT_NAME} Persona</h3>
        <p className="text-[12px] text-[var(--text-faint)]">Customize how {AGENT_NAME} communicates with you.</p>
      </div>

      {/* Presets */}
      <div>
        <div className="text-[11px] font-medium text-[var(--text-dim)] uppercase tracking-wider mb-2">Quick Presets</div>
        <div className="flex flex-wrap gap-2">
          {Object.entries(PERSONA_PRESETS).map(([key, preset]) => (
            <button
              key={key}
              onClick={() => applyPreset(key)}
              className={`px-3 py-1.5 rounded-lg text-[12px] font-medium border transition-all cursor-pointer ${
                persona.name === preset.name
                  ? 'border-[var(--accent)] bg-[var(--accent-dim)] text-[var(--accent)]'
                  : 'border-[var(--border)] bg-[var(--surface)] text-[var(--text-dim)] hover:border-[var(--border2)]'
              }`}
            >
              {preset.name}
            </button>
          ))}
        </div>
      </div>

      {/* Tone */}
      <div>
        <div className="text-[11px] font-medium text-[var(--text-dim)] uppercase tracking-wider mb-2">Tone</div>
        <div className="flex gap-2">
          {TONE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => void save({ ...persona, tone: opt.value, name: 'Custom' })}
              className={`flex-1 px-3 py-2 rounded-lg text-center border transition-all cursor-pointer ${
                persona.tone === opt.value
                  ? 'border-[var(--accent)] bg-[var(--accent-dim)]'
                  : 'border-[var(--border)] bg-[var(--surface)] hover:border-[var(--border2)]'
              }`}
            >
              <div className={`text-[12px] font-medium ${persona.tone === opt.value ? 'text-[var(--accent)]' : 'text-[var(--text)]'}`}>
                {opt.label}
              </div>
              <div className="text-[10px] text-[var(--text-faint)] mt-0.5">{opt.desc}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Style */}
      <div>
        <div className="text-[11px] font-medium text-[var(--text-dim)] uppercase tracking-wider mb-2">Format Style</div>
        <div className="flex gap-2">
          {STYLE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => void save({ ...persona, style: opt.value, name: 'Custom' })}
              className={`flex-1 px-3 py-2 rounded-lg text-center border transition-all cursor-pointer ${
                persona.style === opt.value
                  ? 'border-[var(--accent)] bg-[var(--accent-dim)]'
                  : 'border-[var(--border)] bg-[var(--surface)] hover:border-[var(--border2)]'
              }`}
            >
              <div className={`text-[12px] font-medium ${persona.style === opt.value ? 'text-[var(--accent)]' : 'text-[var(--text)]'}`}>
                {opt.label}
              </div>
              <div className="text-[10px] text-[var(--text-faint)] mt-0.5">{opt.desc}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Role */}
      <div>
        <div className="text-[11px] font-medium text-[var(--text-dim)] uppercase tracking-wider mb-2">Role Description</div>
        <input
          value={persona.role}
          onChange={(e) => setPersona({ ...persona, role: e.target.value, name: 'Custom' })}
          onBlur={(e) => void save({ ...persona, role: e.currentTarget.value, name: 'Custom' })}
          className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[13px] text-[var(--text)] outline-none focus:border-[var(--accent)] transition-colors"
          placeholder="e.g., an executive assistant who values brevity"
        />
      </div>

      {/* Custom instructions */}
      <div>
        <div className="text-[11px] font-medium text-[var(--text-dim)] uppercase tracking-wider mb-2">Custom Instructions</div>
        <textarea
          value={persona.customInstructions}
          onChange={(e) => setPersona({ ...persona, customInstructions: e.target.value })}
          onBlur={(e) => void save({ ...persona, customInstructions: e.currentTarget.value })}
          rows={3}
          className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[13px] text-[var(--text)] outline-none focus:border-[var(--accent)] transition-colors resize-none"
          placeholder="e.g., Always mention deadlines in bold. Use emoji sparingly."
        />
        <p className="mt-1.5 text-[11px] text-[var(--text-faint)]">
          Rendering supports markdown emphasis, not HTML/CSS styling. For red deadline emphasis, the app uses `!!deadline date!!`.
        </p>
      </div>

      {/* Save indicator */}
      {(saving || saved) && (
        <div className="flex items-center gap-2 text-[11px]">
          {saving && <><Loader2 size={12} className="animate-spin text-[var(--text-faint)]" /> <span className="text-[var(--text-faint)]">Saving...</span></>}
          {saved && <><Check size={12} className="text-[var(--accent)]" /> <span className="text-[var(--accent)]">Saved</span></>}
        </div>
      )}
    </div>
  );
}
