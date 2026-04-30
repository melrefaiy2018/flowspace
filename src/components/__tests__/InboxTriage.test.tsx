/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import InboxTriage from '../InboxTriage';

describe('InboxTriage', () => {
  it('fires ignore and not important actions for triage items', () => {
    const onIgnore = vi.fn();
    const onImportant = vi.fn();
    const onNotImportant = vi.fn();

    render(
      <InboxTriage
        needsReply={[{
          subject: 'Review budget',
          sender: 'Alice <alice@example.com>',
          thread_id: 'thread-1',
          actions: [],
          feedback_target: {
            scope: 'triage_item',
            item_type: 'email',
            entity_id: 'thread-1',
            sender: 'Alice <alice@example.com>',
            sender_email: 'alice@example.com',
            sender_domain: 'example.com',
            subject: 'Review budget',
            bucket: 'needs_reply',
          },
        }]}
        needsInput={[]}
        fyiOnly={[]}
        canIgnore={[]}
        onDraftReply={vi.fn()}
        onIgnore={onIgnore}
        onImportant={onImportant}
        onNotImportant={onNotImportant}
        isFeedbackPending={() => false}
        getFeedbackError={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /^Ignore:/i }));
    fireEvent.click(screen.getByRole('button', { name: /^Mark important:/i }));
    fireEvent.click(screen.getByRole('button', { name: /^Mark not important:/i }));

    expect(onIgnore).toHaveBeenCalledWith(expect.objectContaining({ entity_id: 'thread-1' }));
    expect(onImportant).toHaveBeenCalledWith(expect.objectContaining({ entity_id: 'thread-1' }));
    expect(onNotImportant).toHaveBeenCalledWith(expect.objectContaining({ entity_id: 'thread-1' }));
  });

  it('builds a fallback feedback target when the row is missing one', () => {
    const onIgnore = vi.fn();

    render(
      <InboxTriage
        needsReply={[{
          subject: 'Review budget',
          sender: 'Alice <alice@example.com>',
          thread_id: 'thread-1',
          actions: [],
        }]}
        needsInput={[]}
        fyiOnly={[]}
        canIgnore={[]}
        onDraftReply={vi.fn()}
        onIgnore={onIgnore}
        onImportant={vi.fn()}
        onNotImportant={vi.fn()}
        isFeedbackPending={() => false}
        getFeedbackError={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /^Ignore:/i }));

    expect(onIgnore).toHaveBeenCalledWith(expect.objectContaining({
      scope: 'triage_item',
      item_type: 'email',
      entity_id: 'thread-1',
      sender_email: 'alice@example.com',
    }));
  });
});
