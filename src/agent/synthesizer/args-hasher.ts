import crypto from 'node:crypto';

type Shape = string | { [k: string]: Shape } | readonly Shape[];

const MAX_DEPTH = 2;

function bucketArrayLength(n: number): string {
  if (n === 0) return 'arr:0';
  if (n === 1) return 'arr:1';
  if (n <= 5) return 'arr:2-5';
  return 'arr:6+';
}

function shapeOf(value: unknown, depth: number): Shape {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  const t = typeof value;
  if (t === 'string') return 'string';
  if (t === 'number') return 'number';
  if (t === 'boolean') return 'boolean';
  if (Array.isArray(value)) {
    return bucketArrayLength(value.length);
  }
  if (t === 'object') {
    if (depth >= MAX_DEPTH) return 'object';
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    const out: Record<string, Shape> = {};
    for (const k of keys) {
      out[k] = shapeOf(obj[k], depth + 1);
    }
    return out;
  }
  return t;
}

function canonicalize(shape: Shape): string {
  if (typeof shape === 'string') return shape;
  if (Array.isArray(shape)) {
    return '[' + shape.map(canonicalize).join(',') + ']';
  }
  const keys = Object.keys(shape).sort();
  return '{' + keys.map((k) => `${k}:${canonicalize(shape[k])}`).join(',') + '}';
}

export function hashArgsShape(args: Record<string, unknown>): string {
  let canonical: string;
  try {
    canonical = canonicalize(shapeOf(args ?? {}, 0));
  } catch {
    canonical = 'invalid';
  }
  return crypto.createHash('sha1').update(canonical).digest('hex').slice(0, 16);
}
