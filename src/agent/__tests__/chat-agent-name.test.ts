import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AGENT_NAME } from '../../lib/branding';

const completeMock = vi.fn();

vi.mock('../llm-client', () => ({
  createLLMClient: () => ({
    complete: completeMock,
  }),
}));

describe('handleChat system prompt', () => {
  beforeEach(() => {
    completeMock.mockReset();
    completeMock.mockResolvedValue({
      choices: [
        {
          message: { content: 'Done.' },
          finish_reason: 'stop',
        },
      ],
    });
  });

  it('uses AGENT_NAME in the system prompt', async () => {
    const { handleChat } = await import('../chat');
    await handleChat([{ role: 'user', content: 'hello' }]);

    const firstCallMessages = completeMock.mock.calls[0][0] as Array<{ role: string; content: string }>;
    expect(firstCallMessages[0].role).toBe('system');
    expect(firstCallMessages[0].content).toContain(AGENT_NAME);
  });

  it('injects the optional thread brief into the system prompt', async () => {
    const { handleChat } = await import('../chat');
    await handleChat([{ role: 'user', content: 'hello' }], { threadBrief: 'This thread is for personal travel planning.' });

    const firstCallMessages = completeMock.mock.calls[0][0] as Array<{ role: string; content: string }>;
    expect(firstCallMessages[0].content).toContain('Optional thread brief');
    expect(firstCallMessages[0].content).toContain('personal travel planning');
  });
});
