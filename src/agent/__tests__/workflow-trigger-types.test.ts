import { describe, it, expect } from 'vitest';
import type { WorkflowTrigger, EmailReceivedTrigger, TriggerEventType } from '../dynamic-tool-types.js';

describe('WorkflowTrigger types', () => {
  it('accepts a valid EmailReceivedTrigger value', () => {
    const t: WorkflowTrigger = { type: 'email_received', enabled: true, filter: 'subject:test' };
    expect(t.type).toBe('email_received');
    expect(t.enabled).toBe(true);
    expect(t.filter).toBe('subject:test');
  });

  it('allows TypeScript narrowing on type field', () => {
    const t: WorkflowTrigger = { type: 'email_received', enabled: true, filter: 'subject:test' };
    if (t.type === 'email_received') {
      expect(t.filter).toBe('subject:test');
    }
  });

  it('makes intervalMinutes optional', () => {
    const t: WorkflowTrigger = { type: 'email_received', enabled: false, filter: '' };
    expect(t.intervalMinutes).toBeUndefined();
  });

  it('accepts intervalMinutes when provided', () => {
    const t: WorkflowTrigger = { type: 'email_received', enabled: true, filter: 'x', intervalMinutes: 5 };
    expect(t.intervalMinutes).toBe(5);
  });

  it('TriggerEventType includes email_received', () => {
    const eventType: TriggerEventType = 'email_received';
    expect(eventType).toBe('email_received');
  });

  it('EmailReceivedTrigger is assignable to WorkflowTrigger', () => {
    const email: EmailReceivedTrigger = { type: 'email_received', enabled: true, filter: 'subject:bill' };
    const trigger: WorkflowTrigger = email;
    expect(trigger.type).toBe('email_received');
  });
});
