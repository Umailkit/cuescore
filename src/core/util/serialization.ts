/**
 * Serialization helpers used across persistence, snapshots and event replay.
 * `clone` must produce a deep, independent copy so that History stacks and
 * engine state are never accidentally shared by reference.
 */
export function clone<T>(value: T): T {
  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value)) as T;
}

export function serialize(value: unknown): string {
  return JSON.stringify(value);
}

export function deserialize<T>(json: string): T {
  return JSON.parse(json) as T;
}

export function deepEqual(a: unknown, b: unknown): boolean {
  return serialize(a) === serialize(b);
}
