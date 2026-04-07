/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import AttentionPanel from '../AttentionPanel';

vi.mock('../../context/ChatContext', () => ({
  useChatContext: () => ({
    triggerAction: vi.fn(),
  }),
}));

describe('AttentionPanel', () => {
  it('fires ignore and not important actions for an item', () => {
    const onIgnore = vi.fn();
    const onImportant = vi.fn();
    const onNotImportant = vi.fn();

    render(
      <AttentionPanel
        items={[{
          type: 'email_reply',
          priority: 'high',
          title: 'Reply to Alice',
          description: 'Budget approval needs a response.',
          action_label: 'Draft reply',
          action_context: 'thread-1',
          feedback_target: {
            scope: 'attention_item',
            item_type: 'email_reply',
            entity_id: 'thread-1',
            title: 'Reply to Alice',
          },
        }]}
        onDraftReply={vi.fn()}
        onCreateDoc={vi.fn()}
        onIgnore={onIgnore}
        onImportant={onImportant}
        onNotImportant={onNotImportant}
        isFeedbackPending={() => false}
        getFeedbackError={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Ignore' }));
    fireEvent.click(screen.getByRole('button', { name: 'Important' }));
    fireEvent.click(screen.getByRole('button', { name: 'Not important' }));

    expect(onIgnore).toHaveBeenCalledWith(expect.objectContaining({ entity_id: 'thread-1' }));
    expect(onImportant).toHaveBeenCalledWith(expect.objectContaining({ entity_id: 'thread-1' }));
    expect(onNotImportant).toHaveBeenCalledWith(expect.objectContaining({ entity_id: 'thread-1' }));
  });

  it('builds a fallback feedback target when the item is missing one', () => {
    const onIgnore = vi.fn();

    render(
      <AttentionPanel
        items={[{
          type: 'email_reply',
          priority: 'high',
          title: 'Reply to Alice',
          description: 'Budget approval needs a response.',
          action_label: 'Draft reply',
          action_context: 'thread-1',
        }]}
        onDraftReply={vi.fn()}
        onCreateDoc={vi.fn()}
        onIgnore={onIgnore}
        onImportant={vi.fn()}
        onNotImportant={vi.fn()}
        isFeedbackPending={() => false}
        getFeedbackError={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Ignore' }));

    expect(onIgnore).toHaveBeenCalledWith(expect.objectContaining({
      scope: 'attention_item',
      item_type: 'email_reply',
      entity_id: 'thread-1',
    }));
  });
});
