/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import EnrichmentProgressBanner from '../EnrichmentProgressBanner';

expect.extend(toHaveNoViolations);

describe('EnrichmentProgressBanner', () => {
  it('renders generic copy when visible with no progress', () => {
    render(<EnrichmentProgressBanner visible={true} />);
    expect(screen.getByRole('status')).toBeTruthy();
    expect(screen.getByText(/Analyzing your inbox for the first time/i)).toBeTruthy();
    expect(screen.getByText(/Subsequent visits will be instant/i)).toBeTruthy();
  });

  it('renders progress count when progress prop is set', () => {
    render(<EnrichmentProgressBanner visible={true} progress={{ completed: 6, total: 25 }} />);
    expect(screen.getByText(/6 of 25 threads done/i)).toBeTruthy();
  });

  it('falls back to generic copy when progress total is zero', () => {
    render(<EnrichmentProgressBanner visible={true} progress={{ completed: 0, total: 0 }} />);
    expect(screen.getByText(/Analyzing your inbox for the first time/i)).toBeTruthy();
  });

  it('renders nothing when not visible', () => {
    const { container } = render(<EnrichmentProgressBanner visible={false} />);
    expect(container.firstChild).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('uses aria-live=polite so it does not interrupt screen readers', () => {
    render(<EnrichmentProgressBanner visible={true} />);
    const banner = screen.getByRole('status');
    expect(banner.getAttribute('aria-live')).toBe('polite');
  });

  it('has no accessibility violations', async () => {
    const { container } = render(<EnrichmentProgressBanner visible={true} />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
