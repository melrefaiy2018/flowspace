const SUGGEST_REGEX = /\[SUGGEST:\s*(.+?)\s*\]/gi;
const MAX_SUGGESTIONS = 4;

export interface ParsedSuggestions {
  cleanContent: string;
  suggestions: string[];
}

/** Extract [SUGGEST: ...] markers from assistant text and return clean content + suggestion list. */
export function parseSuggestions(text: string): ParsedSuggestions {
  const suggestions: string[] = [];

  // Extract all matches
  let match: RegExpExecArray | null;
  while ((match = SUGGEST_REGEX.exec(text)) !== null) {
    const value = match[1].trim();
    if (value && suggestions.length < MAX_SUGGESTIONS) {
      suggestions.push(value);
    }
  }

  // Remove markers from content and clean up trailing whitespace
  const cleanContent = text
    .replace(SUGGEST_REGEX, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return { cleanContent, suggestions };
}
