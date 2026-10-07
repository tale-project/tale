import { expect, test } from 'bun:test';

import {
  localServingArgs,
  localServingIdentity,
  servingIdentity,
} from './acceptance-health';
import { acceptanceHttpProbe } from './acceptance-test-helper';

const instance = '11111111-1111-4111-8111-111111111111';
const header = `v1;service=platform;instance=${instance}`;
for (const value of [
  null,
  '',
  header + '\n',
  header + ', ' + header,
  header.replace('v1;', 'v2;'),
  header.replace('platform', 'docs'),
  header.replace('4111', '1111'),
  header.replace('8111', '1111'),
  header.replace('instance=', 'secret='),
])
  test(`refuses missing, duplicate, wrong service or malformed process header ${JSON.stringify(value)}`, () => {
    expect(() => servingIdentity(value, 'platform')).toThrow('identity');
  });

test('local observation projects only status and a bounded identity from the exact captured container', () => {
  const id = 'a'.repeat(64);
  const args = localServingArgs(id, 'backend-api');
  expect(args.slice(-4, -1)).toEqual([id, 'bun', '--eval']);
  expect(args).toContain('HTTP_PROXY=');
  expect(args).toContain('no_proxy=*');
  expect(args.at(-1)).toContain('http://127.0.0.1:3005/api/health/ready');
  expect(args.at(-1)).toContain("redirect:'error'");
  expect(args.at(-1)).toContain('AbortSignal.timeout(10000)');
  expect(args.at(-1)).not.toContain('process.env');
  expect(
    localServingIdentity(
      JSON.stringify({ status: 200, identity: header }),
      'platform',
    ),
  ).toEqual({ service: 'platform', instance });
  for (const value of [
    'oops',
    '{}',
    JSON.stringify({ status: 503, identity: header }),
    JSON.stringify({ status: 200, identity: header, secret: 'not accepted' }),
  ])
    expect(() => localServingIdentity(value, 'platform')).toThrow(
      'local server',
    );
});

test('actual servers using the shared identity producer at the same version cannot substitute for the captured process', async () => {
  const result = await acceptanceHttpProbe('identity');
  expect(result.success, result.stderr).toBe(true);
  expect(result.stdout).toBe('accepted');
  expect(result.pid).not.toBe(process.pid);
}, 35_000);
