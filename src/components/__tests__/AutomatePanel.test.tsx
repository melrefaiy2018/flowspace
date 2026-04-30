/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AutomatePanel } from '../AutomatePanel';
import { ThemeProvider } from '../../context/ThemeContext';

function renderWithTheme(ui: React.ReactElement) {
  return render(<ThemeProvider>{ui}</ThemeProvider>);
}

const mockGetStatus = vi.fn();
const mockUpdateTrigger = vi.fn();

vi.mock('../../services/api', () => ({
  api: {
    getWorkflowTriggerStatus: (...args: any[]) => mockGetStatus(...args),
    updateWorkflowTrigger: (...args: any[]) => mockUpdateTrigger(...args),
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockGetStatus.mockResolvedValue({
    enabled: false,
    lastPollAt: null,
    processedCount: 0,
    nextPollIn: null,
    failures: [],
  });
  mockUpdateTrigger.mockResolvedValue(undefined);
});

describe('AutomatePanel', () => {
  it('renders nothing when workflowSaved is false', () => {
    const { container } = renderWithTheme(
      <AutomatePanel workflowName="wf1" workflowSaved={false} />,
    );
    expect(container.innerHTML).toBe('');
  });

  it('renders Automate header when saved', async () => {
    renderWithTheme(<AutomatePanel workflowName="wf1" workflowSaved={true} />);

    await waitFor(() => {
      expect(screen.getByText('Automate')).toBeTruthy();
    });
  });

  it('shows toggle and Save when expanded', async () => {
    renderWithTheme(<AutomatePanel workflowName="wf1" workflowSaved={true} />);

    await waitFor(() => {
      expect(screen.getByText('Automate')).toBeTruthy();
    });

    fireEvent.click(screen.getByText('Automate'));

    await waitFor(() => {
      expect(screen.getByRole('checkbox')).toBeTruthy();
      expect(screen.getByText('Save automation')).toBeTruthy();
    });
  });

  it('calls updateWorkflowTrigger on Save with correct data', async () => {
    renderWithTheme(<AutomatePanel workflowName="wf1" workflowSaved={true} />);

    await waitFor(() => {
      expect(screen.getByText('Automate')).toBeTruthy();
    });

    fireEvent.click(screen.getByText('Automate'));

    await waitFor(() => {
      expect(screen.getByRole('checkbox')).toBeTruthy();
    });

    const checkbox = screen.getByRole('checkbox');
    fireEvent.click(checkbox);

    const input = screen.getByPlaceholderText('e.g. subject:credit card');
    fireEvent.change(input, { target: { value: 'subject:test' } });

    fireEvent.click(screen.getByText('Save automation'));

    await waitFor(() => {
      expect(mockUpdateTrigger).toHaveBeenCalledWith('wf1', {
        enabled: true,
        filter: 'subject:test',
        intervalMinutes: 2,
      });
    });
  });

  it('shows failure badge when failures exist', async () => {
    mockGetStatus.mockResolvedValue({
      enabled: true,
      lastPollAt: Date.now(),
      processedCount: 5,
      nextPollIn: null,
      failures: [{ messageId: 'm1', failedAt: Date.now() - 60_000, error: 'Boom' }],
    });

    renderWithTheme(<AutomatePanel workflowName="wf1" workflowSaved={true} />);

    await waitFor(() => {
      expect(screen.getByText(/1 failure/)).toBeTruthy();
    });
  });
});
