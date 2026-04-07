/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import TriageAgentBar, {
  buildTriageAgentPrompt,
  TRIAGE_SUGGESTIONS,
  type TriageAgentBarProps,
} from '../TriageAgentBar';
import type { GmailThreadSummary } from '../../../services/api';
import type { ThreadTriageResult } from '../../../lib/triage';

function makeThreads(count: number): GmailThreadSummary[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `thread-${i}`,
    subject: `Subject ${i}`,
    from: `sender${i}@example.com`,
    date: '2026-03-26T10:00:00Z',
    snippet: `Snippet ${i}`,
    unread: i < 2,
    labelIds: ['INBOX'],
    messageCount: 1,
    hasAttachments: false,
  }));
}

function makeTriage(threads: GmailThreadSummary[]): ThreadTriageResult {
  return {
    urgent: threads.slice(0, 1),
    needs_attention: threads.slice(1, 2),
    informational: threads.slice(2, 3),
    low_priority: threads.slice(3),
  };
}

function renderBar(overrides: Partial<TriageAgentBarProps> = {}) {
  const threads = makeThreads(5);
  const triage = makeTriage(threads);
  const props: TriageAgentBarProps = {
    triage,
    threads,
    onSendToAgent: vi.fn(),
    ...overrides,
  };
  return { ...render(<TriageAgentBar {...props} />), props };
}

describe('TriageAgentBar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders an input field with placeholder', () => {
    renderBar();
    expect(screen.getByPlaceholderText(/ask the agent about your inbox/i)).toBeTruthy();
  });

  it('renders suggestion buttons', () => {
    renderBar();
    for (const suggestion of TRIAGE_SUGGESTIONS) {
      expect(screen.getByRole('button', { name: suggestion.label })).toBeTruthy();
    }
  });

  it('calls onSendToAgent when submitting freeform input', () => {
    const onSendToAgent = vi.fn();
    renderBar({ onSendToAgent });

    const input = screen.getByPlaceholderText(/ask the agent about your inbox/i);
    fireEvent.change(input, { target: { value: 'Show me emails about the project deadline' } });
    fireEvent.submit(input.closest('form')!);

    expect(onSendToAgent).toHaveBeenCalledTimes(1);
    const [prompt, displayContent] = onSendToAgent.mock.calls[0];
    expect(prompt).toContain('Show me emails about the project deadline');
    expect(displayContent).toBe('Show me emails about the project deadline');
  });

  it('clears input after submit', () => {
    renderBar();
    const input = screen.getByPlaceholderText(/ask the agent about your inbox/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'test query' } });
    fireEvent.submit(input.closest('form')!);
    expect(input.value).toBe('');
  });

  it('does not call onSendToAgent for empty input', () => {
    const onSendToAgent = vi.fn();
    renderBar({ onSendToAgent });
    const input = screen.getByPlaceholderText(/ask the agent about your inbox/i);
    fireEvent.submit(input.closest('form')!);
    expect(onSendToAgent).not.toHaveBeenCalled();
  });

  it('calls onSendToAgent when clicking a suggestion button', () => {
    const onSendToAgent = vi.fn();
    renderBar({ onSendToAgent });

    fireEvent.click(screen.getByRole('button', { name: 'Summarize inbox' }));

    expect(onSendToAgent).toHaveBeenCalledTimes(1);
    const [prompt, displayContent] = onSendToAgent.mock.calls[0];
    expect(prompt).toContain('summarize');
    expect(displayContent).toBe('Summarize inbox');
  });

  it('submits via Enter keypress', () => {
    const onSendToAgent = vi.fn();
    renderBar({ onSendToAgent });
    const input = screen.getByPlaceholderText(/ask the agent about your inbox/i);
    fireEvent.change(input, { target: { value: 'Find urgent emails' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSendToAgent).toHaveBeenCalledTimes(1);
  });
});

describe('buildTriageAgentPrompt', () => {
  const threads = makeThreads(5);
  const triage = makeTriage(threads);

  it('includes inbox summary context for freeform prompts', () => {
    const result = buildTriageAgentPrompt('help me with my inbox', threads, triage);
    expect(result).toContain('5 threads');
    expect(result).toContain('1 urgent');
    expect(result).toContain('help me with my inbox');
  });

  it('builds categorize_by_project prompt with thread subjects', () => {
    const result = buildTriageAgentPrompt('categorize_by_project', threads, triage);
    expect(result).toContain('categorize');
    expect(result).toContain('Subject 0');
    expect(result).toContain('Subject 4');
  });

  it('builds find_action_items prompt', () => {
    const result = buildTriageAgentPrompt('find_action_items', threads, triage);
    expect(result).toContain('action item');
  });

  it('builds summarize_inbox prompt with triage counts', () => {
    const result = buildTriageAgentPrompt('summarize_inbox', threads, triage);
    expect(result).toContain('summarize');
    expect(result).toContain('1 urgent');
    expect(result).toContain('1 needs attention');
  });
});
