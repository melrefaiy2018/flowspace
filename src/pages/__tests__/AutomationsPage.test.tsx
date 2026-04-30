/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import AutomationsPage from '../AutomationsPage';

const mockGetAllTriggers = vi.fn();
const mockRetrigger = vi.fn();
const mockSetActiveView = vi.fn();
const mockSetPendingWorkflowEdit = vi.fn();

vi.mock('../../services/api', () => ({
  api: {
    getAllTriggers: (...args: any[]) => mockGetAllTriggers(...args),
    retriggerWorkflow: (...args: any[]) => mockRetrigger(...args),
  },
}));

vi.mock('../../context/ChatContext', () => ({
  useChatContext: () => ({
    setActiveView: mockSetActiveView,
    setPendingWorkflowEdit: mockSetPendingWorkflowEdit,
  }),
}));

vi.mock('../../context/ThemeContext', () => ({
  ThemeProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useTheme: () => ({ theme: 'dark', toggleTheme: vi.fn() }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAllTriggers.mockResolvedValue([]);
  mockRetrigger.mockResolvedValue({ ok: true, success: true });
});

describe('AutomationsPage', () => {
  it('renders empty state when no automations configured', async () => {
    mockGetAllTriggers.mockResolvedValue([]);
    render(<AutomationsPage />);

    await waitFor(() => {
      expect(screen.getByText('No automations configured.')).toBeTruthy();
    });
  });

  it('renders all triggered workflows', async () => {
    mockGetAllTriggers.mockResolvedValue([
      {
        workflowName: 'wf1',
        workflowLabel: 'Active Workflow',
        trigger: { type: 'email_received', enabled: true, filter: 'subject:bill', intervalMinutes: 2 },
        status: { enabled: true, lastPollAt: Date.now(), processedCount: 10, nextPollIn: null, failures: [] },
      },
      {
        workflowName: 'wf2',
        workflowLabel: 'Paused Workflow',
        trigger: { type: 'email_received', enabled: false, filter: 'is:unread', intervalMinutes: 5 },
        status: { enabled: false, lastPollAt: null, processedCount: 0, nextPollIn: null, failures: [] },
      },
    ]);

    render(<AutomationsPage />);

    await waitFor(() => {
      expect(screen.getByText('Active Workflow')).toBeTruthy();
      expect(screen.getByText('Paused Workflow')).toBeTruthy();
    });
  });

  it('clicks Edit navigates to workflows', async () => {
    mockGetAllTriggers.mockResolvedValue([
      {
        workflowName: 'wf1',
        workflowLabel: 'Test WF',
        trigger: { type: 'email_received', enabled: true, filter: 'subject:x', intervalMinutes: 2 },
        status: { enabled: true, lastPollAt: null, processedCount: 0, nextPollIn: null, failures: [] },
      },
    ]);

    render(<AutomationsPage />);

    await waitFor(() => {
      expect(screen.getByText('Test WF')).toBeTruthy();
    });

    fireEvent.click(screen.getByText('Edit'));
    expect(mockSetPendingWorkflowEdit).toHaveBeenCalledWith('wf1');
    expect(mockSetActiveView).toHaveBeenCalledWith('workflows');
  });
});
