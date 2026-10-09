import { describe, expect, test } from 'bun:test';

import { parseEnvFile, roleEnv } from '../../src/stack/stack.ts';

test('reads KEY=value lines, skips comments, unquotes, keeps = inside values', () => {
  const env = parseEnvFile(
    [
      '# a comment',
      '',
      'DATABASE_URL=postgres://u:p@h:5432/db?sslmode=disable',
      'export SITE_URL=http://127.0.0.1:4105',
      'QUOTED="two words"',
      "SINGLE='x=y'",
      '  INDENTED=yes',
      'not a line',
    ].join('\n'),
  );
  expect(env).toEqual({
    DATABASE_URL: 'postgres://u:p@h:5432/db?sslmode=disable',
    SITE_URL: 'http://127.0.0.1:4105',
    QUOTED: 'two words',
    SINGLE: 'x=y',
    INDENTED: 'yes',
  });
});

describe('roleEnv', () => {
  test('names the role in the variable the backend reads', () => {
    expect(roleEnv('api')).toEqual({ ROLE: 'api', TALE_ROLE: 'api' });
    expect(roleEnv('worker').ROLE).toBe('worker');
  });
});
