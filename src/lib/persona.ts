export interface Persona {
  name: string;
  tone: 'concise' | 'balanced' | 'detailed';
  style: 'bullets' | 'prose' | 'structured';
  role: string;
  customInstructions: string;
}

export const DEFAULT_PERSONA: Persona = {
  name: 'Balanced Assistant',
  tone: 'balanced',
  style: 'structured',
  role: 'a helpful workspace assistant',
  customInstructions: '',
};

export const PERSONA_PRESETS: Record<string, Persona> = {
  executive: {
    name: 'Executive Assistant',
    tone: 'concise',
    style: 'bullets',
    role: 'an executive assistant who values brevity and action items',
    customInstructions: '',
  },
  researcher: {
    name: 'Research Aide',
    tone: 'detailed',
    style: 'structured',
    role: 'a research assistant who provides thorough context and references',
    customInstructions: '',
  },
  coach: {
    name: 'Productivity Coach',
    tone: 'balanced',
    style: 'bullets',
    role: 'a productivity coach who focuses on priorities and next actions',
    customInstructions: '',
  },
};

const TONE_RULES: Record<Persona['tone'], string> = {
  concise: 'Be concise and brief. Keep responses short — aim for under 100 words when possible. No filler, no preamble. Lead with the key fact.',
  balanced: 'Be clear and moderately detailed. Provide enough context without being verbose.',
  detailed: 'Provide full detail and context. Explain reasoning, include background, and be thorough. Use multiple paragraphs when helpful.',
};

const STYLE_RULES: Record<Persona['style'], string> = {
  bullets: 'Always format key information as bullet points. Use short, scannable lists. Avoid long paragraphs.',
  prose: 'Write in natural flowing paragraphs. Avoid bullet-point lists unless explicitly listing items.',
  structured: 'Use a structured format with bold headers (##), tables for data, and bullet points for lists. Make responses easy to scan.',
};

/** Build a persona instruction block to inject into the system prompt. */
export function buildPersonaPrompt(persona: Persona): string {
  const parts: string[] = [];

  parts.push('Persona preferences are user-level style constraints and should be followed whenever they do not conflict with safety or tool limitations.');
  parts.push('Output markdown-only content. Do not use raw HTML tags, inline CSS, or script-like formatting.');
  parts.push('If a custom instruction requests unsupported visual styling (for example text color), preserve intent using markdown emphasis and explicit wording instead.');
  if (
    persona.customInstructions.toLowerCase().includes('deadline')
    && (persona.customInstructions.toLowerCase().includes('red') || persona.customInstructions.toLowerCase().includes('color'))
  ) {
    parts.push('To render red deadline emphasis in this app, wrap deadline date text with !!like this!!.');
  }
  parts.push(`PERSONA: You are ${persona.role}.`);
  parts.push(`TONE: ${TONE_RULES[persona.tone]}`);
  parts.push(`FORMAT: ${STYLE_RULES[persona.style]}`);

  if (persona.customInstructions.trim()) {
    parts.push(`Additional instructions from the user: ${persona.customInstructions}`);
  }

  return parts.join('\n');
}
