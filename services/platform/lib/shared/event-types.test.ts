// @vitest-environment node

import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  EMITTED_EVENT_TYPES,
  isEmittedEventType,
  RESERVED_EVENT_TYPES,
} from './event-types.ts';

/**
 * The emitted vocabulary cannot drift from the producers: every name in
 * `EMITTED_EVENT_TYPES` is raised by some `eventType: '…'` literal under
 * `backend/domains` (a name nobody raises is a trigger that never fires),
 * and every literal a producer names is in the emitted list (a producer of
 * a reserved name moves it over in the same change). Names are never built
 * dynamically, so a literal search is exact.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DOMAINS = path.resolve(HERE, '..', '..', 'backend', 'domains');

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry !== 'node_modules') out.push(...sourceFiles(full));
    } else if (full.endsWith('.ts') && !full.includes('.test.')) {
      out.push(full);
    }
  }
  return out;
}

function producedNames(): Map<string, string[]> {
  const produced = new Map<string, string[]>();
  for (const file of sourceFiles(DOMAINS)) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(
      /eventType:\s*'([a-z_]+(?:\.[a-z_]+)+)'/g,
    )) {
      const name = match[1] ?? '';
      produced.set(name, [
        ...(produced.get(name) ?? []),
        path.relative(DOMAINS, file),
      ]);
    }
  }
  return produced;
}

describe('the platform event vocabulary', () => {
  const produced = producedNames();

  it('emits exactly the names a producer under backend/domains raises', () => {
    expect([...produced.keys()].sort()).toEqual(
      [...EMITTED_EVENT_TYPES].sort(),
    );
  });

  it('keeps the reserved names apart from the emitted ones', () => {
    const emitted = new Set<string>(EMITTED_EVENT_TYPES);
    for (const name of RESERVED_EVENT_TYPES) {
      expect(emitted.has(name), `${name} is both emitted and reserved`).toBe(
        false,
      );
      expect(
        produced.has(name),
        `${name} is reserved but ${produced.get(name)?.join(', ')} raises it — move it into EMITTED_EVENT_TYPES`,
      ).toBe(false);
    }
    expect(new Set(EMITTED_EVENT_TYPES).size).toBe(EMITTED_EVENT_TYPES.length);
    expect(new Set(RESERVED_EVENT_TYPES).size).toBe(
      RESERVED_EVENT_TYPES.length,
    );
  });

  it('the literal search sees a producer that exists', () => {
    // The guard above would pass vacuously if the scan matched nothing.
    expect(produced.get('contact.created')?.length ?? 0).toBeGreaterThan(0);
  });

  it('isEmittedEventType answers the emitted list and nothing else', () => {
    for (const name of EMITTED_EVENT_TYPES) {
      expect(isEmittedEventType(name)).toBe(true);
    }
    for (const name of RESERVED_EVENT_TYPES) {
      expect(isEmittedEventType(name)).toBe(false);
    }
    expect(isEmittedEventType('contact.created ')).toBe(false);
    expect(isEmittedEventType('')).toBe(false);
  });
});
