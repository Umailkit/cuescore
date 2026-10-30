import { describe, it, expect } from 'vitest';
import { clone, serialize, deserialize, deepEqual } from '@core/util/serialization';

describe('serialization helpers', () => {
  it('clone produces a deep, independent copy', () => {
    const a = { x: { y: 1 }, list: [1, 2] };
    const b = clone(a);
    b.x.y = 99;
    b.list.push(3);
    expect(a.x.y).toBe(1);
    expect(a.list).toEqual([1, 2]);
  });

  it('serialize / deserialize round-trips', () => {
    const v = { a: 1, b: [1, 2, 3], c: { d: 'e' } };
    expect(deepEqual(deserialize(serialize(v)), v)).toBe(true);
  });
});
