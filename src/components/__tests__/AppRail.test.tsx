/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import AppRail from '../AppRail';
import { DEFAULT_THREAD_GROUP_ID, type Conversation, type ThreadGroup } from '../../context/ChatContext';
import { ThemeProvider } from '../../context/ThemeContext';

function renderWithTheme(ui: React.ReactElement) {
  return render(<ThemeProvider>{ui}</ThemeProvider>);
}

vi.mock('../FlowSpaceLogo', () => ({
  default: () => <div data-testid="logo" />,
}));

vi.mock('../UpdateBadge', () => ({
  default: () => <div data-testid="update-badge" />,
}));

vi.mock('../../hooks/useUpdateCheck', () => ({
  useUpdateCheck: () => ({ versionInfo: null }),
}));

function makeConversation(id: string, title: string, updatedAt: number): Conversation {
  return {
    id,
    title,
    updatedAt,
    groupId: DEFAULT_THREAD_GROUP_ID,
    messages: [
      { id: `${id}-u`, role: 'user', content: 'hello' },
      { id: `${id}-a`, role: 'assistant', content: 'world' },
    ],
  };
}

const threadGroups: ThreadGroup[] = [
  { id: DEFAULT_THREAD_GROUP_ID, name: 'General', createdAt: 0 },
];

describe('AppRail', () => {
  beforeAll(() => {
    Object.defineProperty(window, 'localStorage', {
      value: {
        getItem: vi.fn(() => 'false'),
        setItem: vi.fn(),
        removeItem: vi.fn(),
      },
      configurable: true,
    });
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders recent conversations and switches conversation on click', () => {
    const onSwitchConversation = vi.fn();
    const onDeleteConversation = vi.fn();

    renderWithTheme(
      <AppRail
        user={{ name: 'Test User', email: 'test@example.com' }}
        onAction={vi.fn()}
        activeSection="chats"
        onNavigate={vi.fn()}
        threadGroups={threadGroups}
        conversations={[
          makeConversation('older', 'Older chat', Date.now() - 100_000),
          makeConversation('newer', 'Newer chat', Date.now() - 10_000),
        ]}
        currentConversationId="newer"
        onSwitchConversation={onSwitchConversation}
        onDeleteConversation={onDeleteConversation}
        onNewChat={vi.fn()}
        onCreateThreadGroup={vi.fn()}
        onRenameThreadGroup={vi.fn()}
        onDeleteThreadGroup={vi.fn()}
      />,
    );

    expect(screen.getByText('Today')).toBeTruthy();
    fireEvent.click(screen.getByText('Older chat'));
    expect(onSwitchConversation).toHaveBeenCalledWith('older');

    const deleteButtons = screen.getAllByRole('button', { name: /Delete:/i });
    fireEvent.click(deleteButtons[0]);
    expect(onDeleteConversation).toHaveBeenCalled();
  });

  it('renders main nav items (Home, Mail, Calendar, Tasks, Workflows)', () => {
    const onNavigate = vi.fn();

    renderWithTheme(
      <AppRail
        user={{ name: 'Test User', email: 'test@example.com' }}
        onAction={vi.fn()}
        activeSection="home"
        onNavigate={onNavigate}
        threadGroups={threadGroups}
        conversations={[]}
        currentConversationId={null}
        onSwitchConversation={vi.fn()}
        onDeleteConversation={vi.fn()}
        onNewChat={vi.fn()}
        onCreateThreadGroup={vi.fn()}
        onRenameThreadGroup={vi.fn()}
        onDeleteThreadGroup={vi.fn()}
      />,
    );

    // Mail nav item should be visible
    expect(screen.getByText('Mail')).toBeTruthy();
    expect(screen.getByText('Calendar')).toBeTruthy();
    expect(screen.getByText('Workflows')).toBeTruthy();
  });
});
