import { describe, it, expect } from 'vitest';
import { hashArgsShape } from '../args-hasher.js';

describe('args-hasher', () => {
  it('produces a 16-char lowercase hex string', () => {
    const h = hashArgsShape({ query: 'hello', threadId: 'abc' });
    expect(h).toMatch(/^[0-9a-f]{16}$/);
  });

  it('hashes identical shapes identically regardless of value', () => {
    const a = hashArgsShape({ query: 'foo', label: 'Inbox' });
    const b = hashArgsShape({ query: 'completely different value', label: 'Spam' });
    expect(a).toBe(b);
  });

  it('distinguishes different key sets', () => {
    const a = hashArgsShape({ query: 'x' });
    const b = hashArgsShape({ threadId: 'x' });
    expect(a).not.toBe(b);
  });

  it('distinguishes different value types under the same key', () => {
    const a = hashArgsShape({ count: 1 });
    const b = hashArgsShape({ count: 'one' });
    expect(a).not.toBe(b);
  });

  it('is order-independent across keys', () => {
    const a = hashArgsShape({ a: 1, b: 'x' });
    const b = hashArgsShape({ b: 'y', a: 99 });
    expect(a).toBe(b);
  });

  it('collapses arrays into length buckets', () => {
    const empty = hashArgsShape({ ids: [] });
    const one = hashArgsShape({ ids: [1] });
    const small = hashArgsShape({ ids: [1, 2, 3, 4, 5] });
    const stillSmall = hashArgsShape({ ids: [1, 2] });
    const big = hashArgsShape({ ids: new Array(50).fill(0) });

    expect(empty).not.toBe(one);
    expect(one).not.toBe(small);
    expect(small).toBe(stillSmall);
    expect(small).not.toBe(big);
  });

  it('recurses into nested objects up to depth 2 then collapses', () => {
    const a = hashArgsShape({ outer: { inner: { deep: { x: 1 } } } });
    const b = hashArgsShape({ outer: { inner: { deep: { y: 'different' } } } });
    expect(a).toBe(b);
  });

  it('does not embed any string value in the hash output', () => {
    const sentinel = '__SENTINEL_EMAIL_BODY__';
    const h = hashArgsShape({ body: sentinel, to: 'foo@example.com' });
    expect(h).not.toContain(sentinel);
    expect(h).not.toContain('foo');
    expect(h).not.toContain('@');
  });

  it('handles null and undefined args without throwing', () => {
    expect(() => hashArgsShape({})).not.toThrow();
    expect(() => hashArgsShape({ a: null })).not.toThrow();
    expect(() => hashArgsShape({ a: undefined })).not.toThrow();
  });
});
