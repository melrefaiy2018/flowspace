import { describe, expect, it } from 'vitest';
import {
  applyPreferenceExamplesToBriefing,
  applyPreferenceExamplesToTriage,
  buildTriageFeedbackTarget,
  createPreferenceExample,
  extractPreferenceFeatures,
  scorePreferenceTarget,
} from '../importance-feedback';

describe('importance-feedback', () => {
  it('extracts structured email features from a triage target', () => {
    const target = buildTriageFeedbackTarget({
      subject: 'Substack weekly roundup',
      sender: 'Substack <digest@substack.com>',
      summary: 'Weekly roundup on agent handoffs and AI ops',
      label_ids: ['CATEGORY_UPDATES'],
      thread_id: 'thread-1',
      urgency: 'fyi',
    }, 'fyi_only');

    const features = extractPreferenceFeatures(target);

    expect(features.sender_email).toBe('digest@substack.com');
    expect(features.sender_domain).toBe('substack.com');
    expect(features.sender_class).toBe('newsletter');
    expect(features.intent_class).toBe('newsletter');
    expect(features.subject_tokens).toContain('handoffs');
  });

  it('same sender but different topic yields only a partial negative score', () => {
    const example = createPreferenceExample(buildTriageFeedbackTarget({
      subject: 'Weekly AI ops roundup',
      sender: 'Substack <digest@substack.com>',
      summary: 'News on agent ops and handoffs',
      label_ids: ['CATEGORY_UPDATES'],
      thread_id: 'thread-1',
      urgency: 'fyi',
    }, 'fyi_only'), 'not_important', () => 'pref-1');

    const score = scorePreferenceTarget(buildTriageFeedbackTarget({
      subject: 'Billing notice for your Substack subscription',
      sender: 'Substack <digest@substack.com>',
      summary: 'Your invoice is ready',
      label_ids: ['INBOX'],
      thread_id: 'thread-2',
      urgency: 'urgent_action',
    }, 'needs_reply'), example ? [example] : []);

    expect(score.score).toBeLessThan(0);
    expect(score.score).toBeGreaterThan(-0.4);
    expect(score.reasons.join(' ')).toContain('same sender');
  });

  it('different sender but same topic is weaker than exact sender match', () => {
    const example = createPreferenceExample(buildTriageFeedbackTarget({
      subject: 'Weekly AI ops roundup',
      sender: 'Substack <digest@substack.com>',
      summary: 'News on agent ops and handoffs',
      label_ids: ['CATEGORY_UPDATES'],
      thread_id: 'thread-1',
      urgency: 'fyi',
    }, 'fyi_only'), 'not_important', () => 'pref-1');

    const sameSender = scorePreferenceTarget(buildTriageFeedbackTarget({
      subject: 'AI ops roundup this week',
      sender: 'Substack <digest@substack.com>',
      summary: 'Agent ops commentary',
      label_ids: ['CATEGORY_UPDATES'],
      thread_id: 'thread-2',
      urgency: 'fyi',
    }, 'fyi_only'), example ? [example] : []);

    const sameTopicDifferentSender = scorePreferenceTarget(buildTriageFeedbackTarget({
      subject: 'AI ops roundup this week',
      sender: 'Newsletter <news@example.com>',
      summary: 'Agent ops commentary',
      label_ids: ['CATEGORY_UPDATES'],
      thread_id: 'thread-3',
      urgency: 'fyi',
    }, 'fyi_only'), example ? [example] : []);

    expect(Math.abs(sameSender.score)).toBeGreaterThan(Math.abs(sameTopicDifferentSender.score));
  });

  it('positive important examples preserve related emails from low-priority senders', () => {
    const negative = createPreferenceExample(buildTriageFeedbackTarget({
      subject: 'AI ops roundup',
      sender: 'Substack <digest@substack.com>',
      summary: 'Industry commentary',
      label_ids: ['CATEGORY_UPDATES'],
      thread_id: 'thread-1',
      urgency: 'fyi',
    }, 'fyi_only'), 'not_important', () => 'neg');

    const positive = createPreferenceExample(buildTriageFeedbackTarget({
      subject: 'Payment issue with your subscription',
      sender: 'Substack <digest@substack.com>',
      summary: 'Your card was declined',
      label_ids: ['INBOX'],
      thread_id: 'thread-2',
      urgency: 'urgent_action',
    }, 'needs_reply'), 'important', () => 'pos');

    const score = scorePreferenceTarget(buildTriageFeedbackTarget({
      subject: 'Payment issue with your subscription',
      sender: 'Substack <digest@substack.com>',
      summary: 'Please update your card',
      label_ids: ['INBOX'],
      thread_id: 'thread-3',
      urgency: 'urgent_action',
    }, 'needs_reply'), [negative!, positive!]);

    expect(score.score).toBeGreaterThan(0);
  });

  it('downgrades instead of suppressing by default in triage', () => {
    const negative = createPreferenceExample(buildTriageFeedbackTarget({
      subject: 'Weekly AI ops roundup',
      sender: 'Substack <digest@substack.com>',
      summary: 'Industry commentary',
      label_ids: ['CATEGORY_UPDATES'],
      thread_id: 'thread-1',
      urgency: 'fyi',
    }, 'fyi_only'), 'not_important', () => 'neg');

    const result = applyPreferenceExamplesToTriage({
      needs_reply: [{
        subject: 'Weekly AI ops roundup',
        sender: 'Substack <digest@substack.com>',
        summary: 'Industry commentary',
        label_ids: ['CATEGORY_UPDATES'],
        thread_id: 'thread-2',
        urgency: 'review',
        actions: [],
      }],
      needs_input: [],
      fyi_only: [],
      can_ignore: [],
    }, negative ? [negative] : []);

    expect(result.needs_reply).toHaveLength(0);
    expect(result.fyi_only.length + result.can_ignore.length).toBe(1);
  });

  it('re-ranks attention items without hiding them by default', () => {
    const positive = createPreferenceExample({
      scope: 'attention_item',
      item_type: 'meeting_prep',
      entity_id: 'event-2',
      title: 'Board review',
      summary: 'Quarterly board prep',
    }, 'important', () => 'pos');

    const negative = createPreferenceExample({
      scope: 'attention_item',
      item_type: 'email_reply',
      entity_id: 'thread-1',
      title: 'Newsletter reply',
      summary: 'Industry newsletter',
    }, 'not_important', () => 'neg');

    const result = applyPreferenceExamplesToBriefing({
      attention_items: [
        {
          type: 'email_reply',
          priority: 'high',
          title: 'Newsletter reply',
          description: 'Industry newsletter',
          action_label: 'Review',
          action_context: 'thread-1',
        },
        {
          type: 'meeting_prep',
          priority: 'medium',
          title: 'Board review',
          description: 'Quarterly board prep',
          action_label: 'Review',
          action_context: 'event-2',
        },
      ],
      inbox_triage: {
        needs_reply: [],
        needs_input: [],
        fyi_only: [],
        can_ignore: [],
      },
    }, [negative!, positive!]);

    expect(result.attention_items).toHaveLength(2);
    expect(result.attention_items[0].title).toBe('Board review');
    expect(result.attention_items[0].priority).toBe('high');
    expect(result.attention_items[1].priority).toBe('medium');
  });
});
