/**
 * AI-powered email triage — builds prompts for the LLM and parses structured categories.
 */
import type { GmailThreadSummary } from '../services/api';

export interface AITriageCategory {
  label: string;
  threadIds: string[];
}

export interface AITriageResult {
  categories: AITriageCategory[];
}

export function buildTriageSystemPrompt(): string {
  return `You are an email triage assistant. Your job is to categorize a user's email threads into meaningful topic groups.

Rules:
- Create 3-8 categories based on the actual content of the emails.
- Use short, descriptive labels (e.g., "Job Search", "Finance", "School", "Promotions", "Security Alerts").
- Every thread should appear in exactly one category.
- Return ONLY valid JSON in this exact format — no extra text:

{"categories": [{"label": "Category Name", "threadIds": ["id1", "id2"]}, ...]}

- Use the exact thread IDs provided.
- Group similar threads together. Prefer fewer, broader categories over many tiny ones.`;
}

export function buildTriageUserMessage(threads: readonly GmailThreadSummary[]): string {
  if (threads.length === 0) {
    return 'I have 0 threads in my inbox. Nothing to categorize.';
  }

  const lines = threads.map((t) =>
    `- ID: "${t.id}" | Subject: "${t.subject}" | From: ${t.from} | ${t.unread ? 'unread' : 'read'} | Snippet: "${t.snippet}"`,
  );

  return `Please categorize these ${threads.length} threads into topic groups:\n\n${lines.join('\n')}`;
}

export function parseTriageResponse(raw: string, validThreadIds: Set<string>): AITriageResult {
  // Try to extract JSON from the response
  let jsonStr: string | null = null;

  // Try markdown code block first
  const codeBlockMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    jsonStr = codeBlockMatch[1].trim();
  }

  // Try to find a JSON object in the text
  if (!jsonStr) {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      jsonStr = jsonMatch[0];
    }
  }

  if (!jsonStr) {
    throw new Error('Could not find JSON in AI response');
  }

  const parsed = JSON.parse(jsonStr);

  if (!parsed.categories || !Array.isArray(parsed.categories)) {
    throw new Error('Response missing "categories" array');
  }

  const categories: AITriageCategory[] = parsed.categories
    .filter((c: unknown): c is { label: string; threadIds: string[] } =>
      typeof c === 'object' && c !== null &&
      typeof (c as Record<string, unknown>).label === 'string' &&
      Array.isArray((c as Record<string, unknown>).threadIds),
    )
    .map((c: { label: string; threadIds: string[] }) => ({
      label: c.label,
      threadIds: c.threadIds.filter((id: string) => validThreadIds.has(id)),
    }))
    .filter((c: AITriageCategory) => c.threadIds.length > 0);

  return { categories };
}
