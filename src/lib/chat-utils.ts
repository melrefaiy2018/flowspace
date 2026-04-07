/**
 * Pure chat utility functions — extracted from ChatContext for testability.
 */

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  blocks?: any[];
  toolEvents?: any[];
  approval?: any;
  status?: 'streaming' | 'complete' | 'error';
}

export interface ChatMessageInput {
  role: 'user' | 'assistant';
  content: string;
}

export function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function normalizeMessages(raw: unknown): Message[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const candidate = entry as Partial<Message>;
    if (candidate.role !== 'user' && candidate.role !== 'assistant') return [];
    return [{
      id: typeof candidate.id === 'string' ? candidate.id : createId(candidate.role),
      role: candidate.role,
      content: typeof candidate.content === 'string' ? candidate.content : '',
      blocks: Array.isArray(candidate.blocks) ? candidate.blocks : [],
      toolEvents: Array.isArray(candidate.toolEvents) ? candidate.toolEvents : [],
      approval: candidate.approval,
      status: candidate.status === 'streaming' || candidate.status === 'error' ? candidate.status : 'complete',
    }];
  });
}

export function titleFromMessages(messages: Message[]): string {
  const first = messages.find((m) => m.role === 'user');
  if (!first) return 'New conversation';
  return first.content.slice(0, 50) + (first.content.length > 50 ? '...' : '');
}

export function toChatInput(messages: Message[]): ChatMessageInput[] {
  return messages
    .filter((m) => m.content.trim().length > 0)
    .map((message) => ({
      role: message.role,
      content: message.content,
    }));
}
