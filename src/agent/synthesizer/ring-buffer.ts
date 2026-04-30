interface DispatchRecord {
  readonly name: string;
  readonly args: Readonly<Record<string, unknown>>;
}

const CAPACITY = 100;

let ring: DispatchRecord[] = [];

export function _resetRingForTests(): void {
  ring = [];
}

export function getRingSize(): number {
  return ring.length;
}

export function recordDispatch(entry: { name: string; args: Record<string, unknown> }): void {
  const safeArgs = entry.args ?? {};
  ring = [...ring, { name: entry.name, args: safeArgs }];
  if (ring.length > CAPACITY) {
    ring = ring.slice(ring.length - CAPACITY);
  }
}

export function findRecentSequence(
  toolNames: readonly string[],
): readonly { action: string; args: Record<string, unknown> }[] | null {
  const k = toolNames.length;
  if (k === 0 || ring.length < k) return null;
  for (let i = ring.length - k; i >= 0; i--) {
    let match = true;
    for (let j = 0; j < k; j++) {
      if (ring[i + j].name !== toolNames[j]) {
        match = false;
        break;
      }
    }
    if (match) {
      return ring.slice(i, i + k).map((d) => ({
        action: d.name,
        args: { ...d.args },
      }));
    }
  }
  return null;
}
