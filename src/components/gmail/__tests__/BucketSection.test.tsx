/**
 * Tests for BucketSection collapsible section component.
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import BucketSection from '../BucketSection';

expect.extend(toHaveNoViolations);

describe('BucketSection', () => {
  it('renders label and count badge', () => {
    render(
      <BucketSection id="needs-reply" label="Needs reply" count={3} defaultExpanded={true}>
        <div>child content</div>
      </BucketSection>,
    );
    expect(screen.getByText('Needs reply')).toBeTruthy();
    expect(screen.getByText('3')).toBeTruthy();
  });

  it('expands and collapses on click', () => {
    render(
      <BucketSection id="needs-reply" label="Needs reply" count={2} defaultExpanded={true}>
        <div data-testid="child">child content</div>
      </BucketSection>,
    );
    // Initially expanded
    expect(screen.getByTestId('child')).toBeTruthy();

    // Collapse by clicking header
    fireEvent.click(screen.getByRole('button'));
    expect(screen.queryByTestId('child')).toBeNull();

    // Expand again
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByTestId('child')).toBeTruthy();
  });

  it('toggles on Enter key press', () => {
    render(
      <BucketSection id="waiting" label="Waiting" count={1} defaultExpanded={true}>
        <div data-testid="child">child</div>
      </BucketSection>,
    );
    const button = screen.getByRole('button');
    expect(screen.getByTestId('child')).toBeTruthy();

    fireEvent.keyDown(button, { key: 'Enter' });
    expect(screen.queryByTestId('child')).toBeNull();

    fireEvent.keyDown(button, { key: 'Enter' });
    expect(screen.getByTestId('child')).toBeTruthy();
  });

  it('toggles on Space key press', () => {
    render(
      <BucketSection id="quick-wins" label="Quick wins" count={5} defaultExpanded={false}>
        <div data-testid="child">child</div>
      </BucketSection>,
    );
    const button = screen.getByRole('button');
    // Initially collapsed
    expect(screen.queryByTestId('child')).toBeNull();

    fireEvent.keyDown(button, { key: ' ' });
    expect(screen.getByTestId('child')).toBeTruthy();
  });

  it('updates aria-expanded attribute correctly', () => {
    render(
      <BucketSection id="reference-fyi" label="Reference/FYI" count={10} defaultExpanded={false}>
        <div>child</div>
      </BucketSection>,
    );
    const button = screen.getByRole('button');
    expect(button.getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(button);
    expect(button.getAttribute('aria-expanded')).toBe('true');

    fireEvent.click(button);
    expect(button.getAttribute('aria-expanded')).toBe('false');
  });

  it('passes jest-axe accessibility check', async () => {
    const { container } = render(
      <BucketSection id="needs-reply" label="Needs reply" count={2} defaultExpanded={true}>
        <div>child content</div>
      </BucketSection>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
