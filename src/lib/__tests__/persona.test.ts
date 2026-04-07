import { describe, it, expect } from 'vitest';
import { DEFAULT_PERSONA, PERSONA_PRESETS, buildPersonaPrompt, type Persona } from '../persona';

describe('DEFAULT_PERSONA', () => {
  it('has balanced tone and structured style', () => {
    expect(DEFAULT_PERSONA.tone).toBe('balanced');
    expect(DEFAULT_PERSONA.style).toBe('structured');
    expect(DEFAULT_PERSONA.name).toBeTruthy();
    expect(DEFAULT_PERSONA.role).toBeTruthy();
  });
});

describe('PERSONA_PRESETS', () => {
  it('has at least 3 presets', () => {
    expect(Object.keys(PERSONA_PRESETS).length).toBeGreaterThanOrEqual(3);
  });

  it('each preset has required fields', () => {
    for (const preset of Object.values(PERSONA_PRESETS)) {
      expect(preset.name).toBeTruthy();
      expect(preset.tone).toMatch(/^(concise|balanced|detailed)$/);
      expect(preset.style).toMatch(/^(bullets|prose|structured)$/);
      expect(preset.role).toBeTruthy();
    }
  });
});

describe('buildPersonaPrompt', () => {
  it('returns empty string for default persona with no custom instructions', () => {
    const result = buildPersonaPrompt(DEFAULT_PERSONA);
    // Default should still produce persona instructions
    expect(result).toBeTruthy();
  });

  it('includes role in prompt', () => {
    const persona: Persona = { ...DEFAULT_PERSONA, role: 'executive assistant for a busy CEO' };
    const result = buildPersonaPrompt(persona);
    expect(result).toContain('executive assistant for a busy CEO');
  });

  it('includes concise formatting rules for concise tone', () => {
    const persona: Persona = { ...DEFAULT_PERSONA, tone: 'concise' };
    const result = buildPersonaPrompt(persona);
    expect(result.toLowerCase()).toContain('concise');
    expect(result.toLowerCase()).toContain('brief');
  });

  it('includes detailed formatting rules for detailed tone', () => {
    const persona: Persona = { ...DEFAULT_PERSONA, tone: 'detailed' };
    const result = buildPersonaPrompt(persona);
    expect(result.toLowerCase()).toContain('detail');
    expect(result.toLowerCase()).toContain('context');
  });

  it('includes bullet point instructions for bullets style', () => {
    const persona: Persona = { ...DEFAULT_PERSONA, style: 'bullets' };
    const result = buildPersonaPrompt(persona);
    expect(result.toLowerCase()).toContain('bullet');
  });

  it('includes prose instructions for prose style', () => {
    const persona: Persona = { ...DEFAULT_PERSONA, style: 'prose' };
    const result = buildPersonaPrompt(persona);
    expect(result.toLowerCase()).toContain('paragraph');
  });

  it('includes structured instructions for structured style', () => {
    const persona: Persona = { ...DEFAULT_PERSONA, style: 'structured' };
    const result = buildPersonaPrompt(persona);
    expect(result.toLowerCase()).toContain('header');
  });

  it('appends custom instructions verbatim', () => {
    const persona: Persona = { ...DEFAULT_PERSONA, customInstructions: 'Always mention deadlines in bold.' };
    const result = buildPersonaPrompt(persona);
    expect(result).toContain('Always mention deadlines in bold.');
  });

  it('includes deadline emphasis token guidance when custom instructions ask for red deadlines', () => {
    const persona: Persona = { ...DEFAULT_PERSONA, customInstructions: 'Always mention deadline in bold red color.' };
    const result = buildPersonaPrompt(persona);
    expect(result).toContain('!!like this!!');
  });

  it('includes markdown-only output guidance', () => {
    const result = buildPersonaPrompt(DEFAULT_PERSONA);
    expect(result).toContain('Output markdown-only content.');
    expect(result).toContain('Do not use raw HTML tags');
  });

  it('includes fallback guidance for unsupported styling requests', () => {
    const result = buildPersonaPrompt(DEFAULT_PERSONA);
    expect(result).toContain('unsupported visual styling');
    expect(result).toContain('using markdown emphasis');
  });

  it('handles empty custom instructions gracefully', () => {
    const persona: Persona = { ...DEFAULT_PERSONA, customInstructions: '' };
    const result = buildPersonaPrompt(persona);
    expect(result).not.toContain('Additional instructions');
  });
});
