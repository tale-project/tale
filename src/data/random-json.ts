/**
 * Seeded random JSON values for the data core's property tests: the same
 * seed draws the same values on every machine, so a failing case reruns.
 * Lists of objects often carry a unique `id`, so key pairing is exercised.
 */

export type Random = () => number;

/** Mulberry32: a small, well-mixed 32-bit generator in [0, 1). */
export function seeded(seed: number): Random {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

const KEYS = [
  'id',
  'name',
  'status',
  'total',
  'items',
  'owner',
  'tags',
  'note',
];
const WORDS = ['open', 'done', 'Ada', 'Grace', 'Zürich', '', 'a/b', '~x', '😀'];

function pick<T>(random: Random, items: readonly T[]): T {
  const item = items[Math.floor(random() * items.length)];
  if (item === undefined) throw new Error('pick from an empty list');
  return item;
}

/** A random JSON value at most `depth` levels deep. */
export function randomJson(random: Random, depth = 3): unknown {
  const roll = random();
  if (depth <= 0 || roll < 0.45) {
    const leaf = random();
    if (leaf < 0.3) return pick(random, WORDS);
    if (leaf < 0.55) return Math.floor(random() * 100);
    if (leaf < 0.7) return Math.round(random() * 1000) / 10;
    if (leaf < 0.85) return random() < 0.5;
    return null;
  }
  if (roll < 0.7) {
    const length = Math.floor(random() * 5);
    if (random() < 0.4) {
      return Array.from({ length }, (_, index) => ({
        id: index + 1,
        name: pick(random, WORDS),
        total: Math.floor(random() * 10),
      }));
    }
    return Array.from({ length }, () => randomJson(random, depth - 1));
  }
  const value: Record<string, unknown> = {};
  const count = Math.floor(random() * 4);
  for (let index = 0; index < count; index += 1) {
    value[pick(random, KEYS)] = randomJson(random, depth - 1);
  }
  return value;
}

/** `value` with a few random edits: a leaf changed, a key added or dropped,
 *  a list item added, dropped or moved. */
export function mutate(random: Random, value: unknown, edits = 2): unknown {
  let current = structuredClone(value);
  for (let edit = 0; edit < edits; edit += 1) {
    current = mutateOnce(random, current, 3);
  }
  return current;
}

function mutateOnce(random: Random, value: unknown, depth: number): unknown {
  if (Array.isArray(value)) {
    const list: unknown[] = [...value];
    const roll = random();
    if (list.length > 0 && roll < 0.3 && depth > 0) {
      const index = Math.floor(random() * list.length);
      list[index] = mutateOnce(random, list[index], depth - 1);
    } else if (roll < 0.5) {
      list.push(randomJson(random, 1));
    } else if (roll < 0.7 && list.length > 0) {
      list.splice(Math.floor(random() * list.length), 1);
    } else if (list.length > 1) {
      const [first] = list.splice(0, 1);
      list.push(first);
    }
    return list;
  }
  if (typeof value === 'object' && value !== null) {
    const record: Record<string, unknown> = { ...value };
    const keys = Object.keys(record);
    const roll = random();
    const key = keys[Math.floor(random() * keys.length)];
    if (key !== undefined && roll < 0.5 && depth > 0) {
      record[key] = mutateOnce(random, record[key], depth - 1);
    } else if (roll < 0.75 || key === undefined) {
      record[pick(random, KEYS)] = randomJson(random, 1);
    } else {
      delete record[key];
    }
    return record;
  }
  return randomJson(random, 1);
}
