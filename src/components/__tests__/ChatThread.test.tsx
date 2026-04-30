/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import ChatThread from '../ChatThread';
import { AGENT_NAME } from '../../lib/branding';

const sendMessageMock = vi.fn();
const undoInboxActionFromAuditMock = vi.fn();
const chatContextState: any = {
  activeView: 'dashboard' as const,
  messages: [
    {
      id: 'assistant-1',
      role: 'assistant' as const,
      content: 'Try one of these next steps.',
      suggestions: ['Archive the low priority emails'],
      status: 'complete' as const,
    },
  ],
  isLoading: false,
  newChat: vi.fn(),
  closeChat: vi.fn(),
  sendMessage: sendMessageMock,
  approveAction: vi.fn(),
  undoInboxActionFromAudit: undoInboxActionFromAuditMock,
  dismissApproval: vi.fn(),
  editAssistantMessage: vi.fn(),
};

beforeAll(() => {
  Element.prototype.scrollTo = vi.fn();
});

vi.mock('../../context/ChatContext', () => ({
  useChatContext: () => chatContextState,
}));

describe('ChatThread', () => {
  beforeEach(() => {
    sendMessageMock.mockReset();
    undoInboxActionFromAuditMock.mockReset();
    chatContextState.messages = [
      {
        id: 'assistant-1',
        role: 'assistant',
        content: 'Try one of these next steps.',
        suggestions: ['Archive the low priority emails'],
        status: 'complete',
      },
    ];
  });

  it('shows FlowSpace Concierge title and does not render History action', () => {
    render(<ChatThread />);

    expect(screen.getByText(AGENT_NAME)).toBeTruthy();
    expect(screen.queryByText('History')).toBeNull();
    expect(screen.getByText('New Chat')).toBeTruthy();
  });

  it('clicks suggestion chips and sends a message', () => {
    render(<ChatThread />);

    fireEvent.click(screen.getByRole('button', { name: 'Archive the low priority emails' }));

    expect(sendMessageMock).toHaveBeenCalledWith('Archive the low priority emails', undefined);
  });

  it('renders an Undo button for undoable bulk actions and triggers undo', () => {
    chatContextState.messages = [
      {
        id: 'assistant-1',
        role: 'assistant',
        content: 'Done.',
        blocks: [
          {
            type: 'bulk_action_preview',
            title: 'Affected threads',
            actionType: 'trash_threads',
            effect: 'Moved thread to Gmail Trash.',
            items: [{ thread_id: 'thread-1', subject: 'Hello', sender: 'Alice', status: 'completed' }],
            auditId: 'audit-1',
            undoAvailable: true,
          },
        ],
        status: 'complete',
      },
    ];

    render(<ChatThread />);

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));

    expect(undoInboxActionFromAuditMock).toHaveBeenCalledWith('audit-1');
  });
});
