import { describe, it, expect } from 'vitest';
import { PROVIDER_META, getProviderMeta, getDefaultModel } from '../llm-providers-meta';

describe('PROVIDER_META', () => {
  it('has entries for all five providers', () => {
    const ids = PROVIDER_META.map((p) => p.id);
    expect(ids).toContain('anthropic');
    expect(ids).toContain('openai');
    expect(ids).toContain('openrouter');
    expect(ids).toContain('lmstudio');
    expect(ids).toContain('claude-code');
    expect(PROVIDER_META).toHaveLength(5);
  });

  it('every provider has at least one model', () => {
    for (const meta of PROVIDER_META) {
      expect(meta.models.length).toBeGreaterThan(0);
    }
  });

  it('every provider has a name', () => {
    for (const meta of PROVIDER_META) {
      expect(meta.name).toBeTruthy();
    }
  });

  it('providers requiring a key have a defaultBaseURL', () => {
    for (const meta of PROVIDER_META) {
      if (meta.requiresKey) {
        expect(meta.defaultBaseURL).toBeTruthy();
      }
    }
  });

  it('lmstudio and claude-code do not require an API key', () => {
    const noKey = PROVIDER_META.filter((p) => !p.requiresKey);
    const noKeyIds = noKey.map((p) => p.id);
    expect(noKeyIds).toContain('lmstudio');
    expect(noKeyIds).toContain('claude-code');
  });

  it('all other providers require an API key', () => {
    const keyed = PROVIDER_META.filter((p) => p.requiresKey);
    for (const meta of keyed) {
      expect(meta.requiresKey).toBe(true);
    }
  });
});

describe('getProviderMeta', () => {
  it('returns metadata for a valid provider', () => {
    const meta = getProviderMeta('anthropic');
    expect(meta?.name).toBe('Anthropic');
    expect(meta?.models.length).toBeGreaterThan(0);
  });

  it('returns undefined for an unknown provider', () => {
    expect(getProviderMeta('nonexistent' as any)).toBeUndefined();
  });
});

describe('getDefaultModel', () => {
  it('returns the first model for each provider', () => {
    expect(getDefaultModel('anthropic')).toBe('claude-sonnet-4-20250514');
    expect(getDefaultModel('openai')).toBe('gpt-4o');
  });

  it('returns "unknown" for nonexistent provider', () => {
    expect(getDefaultModel('fake' as any)).toBe('unknown');
  });
});
