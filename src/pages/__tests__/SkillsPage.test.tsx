/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import SkillsPage from '../SkillsPage';
import { api } from '../../services/api';

vi.mock('../../services/api', () => ({
  api: {
    getDynamicTools: vi.fn(),
    getDynamicToolActions: vi.fn(),
    createDynamicTool: vi.fn(),
    updateDynamicTool: vi.fn(),
    deleteDynamicTool: vi.fn(),
  },
}));

const mockedApi = vi.mocked(api);

const sampleTools = [
  {
    name: 'expense_tracker',
    description: 'Create an expense tracking spreadsheet',
    parameters: { type: 'object', properties: { title: { type: 'string' } } },
    steps: [
      { action: 'sheets_create', args: { title: '{{input.title}}' } },
    ],
    isWriteTool: true,
    createdAt: '2026-03-17T10:00:00Z',
    label: 'Expense Tracker',
  },
  {
    name: 'daily_summary',
    description: 'Generate a daily summary from calendar and tasks',
    parameters: { type: 'object', properties: {} },
    steps: [
      { action: 'calendar_agenda', args: {} },
      { action: 'list_tasks', args: {} },
    ],
    isWriteTool: false,
    createdAt: '2026-03-16T08:00:00Z',
  },
];

const sampleActions = ['calendar_agenda', 'list_tasks', 'sheets_create'];

beforeEach(() => {
  vi.clearAllMocks();
  mockedApi.getDynamicToolActions.mockResolvedValue({ actions: sampleActions });
});

describe('SkillsPage', () => {
  it('should render loading state initially', () => {
    mockedApi.getDynamicTools.mockReturnValue(new Promise(() => {})); // never resolves
    render(<SkillsPage />);
    expect(screen.getByText(/loading/i)).toBeTruthy();
  });

  it('should display tools after loading', async () => {
    mockedApi.getDynamicTools.mockResolvedValue({ tools: sampleTools });
    render(<SkillsPage />);

    await waitFor(() => {
      expect(screen.getByText('Expense Tracker')).toBeTruthy();
    });
    // daily_summary has no label, so SkillCard formats it as "Daily Summary"
    expect(screen.getByText('Daily Summary')).toBeTruthy();
  });

  it('should show empty state when no tools exist', async () => {
    mockedApi.getDynamicTools.mockResolvedValue({ tools: [] });
    render(<SkillsPage />);

    await waitFor(() => {
      expect(screen.getByText(/no custom skills/i)).toBeTruthy();
    });
  });

  it('should show step count for each tool', async () => {
    mockedApi.getDynamicTools.mockResolvedValue({ tools: sampleTools });
    render(<SkillsPage />);

    await waitFor(() => {
      expect(screen.getByText(/1 step/)).toBeTruthy();
      expect(screen.getByText(/2 steps/)).toBeTruthy();
    });
  });

  it('should show write badge for write tools', async () => {
    mockedApi.getDynamicTools.mockResolvedValue({ tools: sampleTools });
    render(<SkillsPage />);

    await waitFor(() => {
      expect(screen.getByText(/write/i)).toBeTruthy();
    });
  });

  it('should call deleteDynamicTool when delete is confirmed', async () => {
    mockedApi.getDynamicTools.mockResolvedValue({ tools: sampleTools });
    mockedApi.deleteDynamicTool.mockResolvedValue({ removed: true, name: 'expense_tracker' });
    window.confirm = vi.fn(() => true);

    render(<SkillsPage />);

    await waitFor(() => {
      expect(screen.getByText('Expense Tracker')).toBeTruthy();
    });

    const deleteButtons = screen.getAllByTitle(/delete/i);
    fireEvent.click(deleteButtons[0]);

    expect(window.confirm).toHaveBeenCalled();
    expect(mockedApi.deleteDynamicTool).toHaveBeenCalledWith('expense_tracker');
  });

  it('should not delete when confirm is canceled', async () => {
    mockedApi.getDynamicTools.mockResolvedValue({ tools: sampleTools });
    window.confirm = vi.fn(() => false);

    render(<SkillsPage />);

    await waitFor(() => {
      expect(screen.getByText('Expense Tracker')).toBeTruthy();
    });

    const deleteButtons = screen.getAllByTitle(/delete/i);
    fireEvent.click(deleteButtons[0]);

    expect(mockedApi.deleteDynamicTool).not.toHaveBeenCalled();
  });

  it('should show error state on fetch failure', async () => {
    mockedApi.getDynamicTools.mockRejectedValue(new Error('Network error'));
    render(<SkillsPage />);

    await waitFor(() => {
      expect(screen.getByText(/failed/i)).toBeTruthy();
    });
  });
});
