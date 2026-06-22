// Unit tests for blue-green cancel routing — `spawnerUrlForColor` picks the
// colour-suffixed spawner host so a cancel reaches the SAME colour an execution
// started on, even after a deploy flip moved the bare `sandbox` alias.

import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { spawnerUrlForColor } from './spawner_client';

describe('spawnerUrlForColor', () => {
  let saved: string | undefined;
  beforeEach(() => {
    saved = process.env.SANDBOX_URL;
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.SANDBOX_URL;
    else process.env.SANDBOX_URL = saved;
  });

  test('rewrites the docker `sandbox` host to the colour-suffixed host', () => {
    process.env.SANDBOX_URL = 'http://sandbox:8003';
    expect(spawnerUrlForColor('blue')).toBe('http://sandbox-blue:8003');
    expect(spawnerUrlForColor('green')).toBe('http://sandbox-green:8003');
  });

  test('null/undefined colour falls back to the base alias (single-colour)', () => {
    process.env.SANDBOX_URL = 'http://sandbox:8003';
    expect(spawnerUrlForColor(null)).toBe('http://sandbox:8003');
    expect(spawnerUrlForColor(undefined)).toBe('http://sandbox:8003');
  });

  test('leaves a non-`sandbox` host (dev loopback) untouched', () => {
    process.env.SANDBOX_URL = 'http://localhost:8003';
    // Dev is single-colour; a colour value must not invent a localhost-X host.
    expect(spawnerUrlForColor('blue')).toBe('http://localhost:8003');
  });
});
