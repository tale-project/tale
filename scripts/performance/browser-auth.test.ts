import { expect, test } from 'bun:test';
import { randomBytes } from 'node:crypto';

import type { Sql } from 'postgres';

import { createAuth } from '../../services/platform/backend/auth/auth';
import { browserOrigins } from './browser/origins.mjs';

// The real constructor creates a lazy pool; no database is opened or queried.
const base = {
  databaseUrl: 'postgresql://127.0.0.1:1/unused',
  secret: randomBytes(32).toString('hex'),
  sql: null as unknown as Sql,
};

test('both actual measurement origins satisfy the production auth startup contract', () => {
  for (const origin of browserOrigins) {
    const others = browserOrigins.filter((entry) => entry !== origin);
    const auth = createAuth({
      ...base,
      baseUrl: origin,
      additionalOrigins: others,
    });
    expect(auth.options.trustedOrigins).toEqual([origin, ...others]);
  }
});

test('the previous HTTP .2 origin remains forbidden for canonical and additional auth entry points', () => {
  expect(() =>
    createAuth({ ...base, baseUrl: 'http://127.0.0.2:43830' }),
  ).toThrow('SITE_URL must use HTTPS');
  expect(() =>
    createAuth({
      ...base,
      baseUrl: 'http://127.0.0.1:43830',
      additionalOrigins: ['http://127.0.0.2:43831'],
    }),
  ).toThrow('ADDITIONAL_SITE_URLS must use HTTPS');
});
