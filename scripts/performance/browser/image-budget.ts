import assert from 'node:assert/strict';

import { json, phaseTimeout } from './common.ts';

try {
  assert.equal(
    phaseTimeout(7 * 60_000),
    7 * 60_000,
    'Not enough setup time remains for the bounded image steps',
  );
} catch (error) {
  await json('image-budget-failure.json', { error: String(error) });
  throw error;
}
