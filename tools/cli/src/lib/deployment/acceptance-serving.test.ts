import { expect, test } from 'bun:test';

import { createServingIdentity } from '../../../../../packages/ui/src/server/serving-identity';
import {
  acceptanceHealth,
  localServingArgs,
  localServingIdentity,
  servingIdentity,
} from './acceptance-health';

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
  const servers = [0, 1].map(() => {
    const identity = createServingIdentity('platform');
    return Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch: () =>
        Response.json(
          { status: 'ok', version: '1.2.3' },
          { headers: { 'Tale-Serving-Identity': identity } },
        ),
    });
  });
  try {
    const origin = (index: number) =>
      `http://127.0.0.1:${servers[index]!.port}`;
    const response = await fetch(`${origin(0)}/api/health`);
    const expected = servingIdentity(
      response.headers.get('Tale-Serving-Identity'),
      'platform',
    );
    await response.body?.cancel();
    expect(await acceptanceHealth(origin(0), '1.2.3', expected, 1000)).toEqual(
      expected,
    );
    await expect(
      acceptanceHealth(origin(1), '1.2.3', expected, 1000),
    ).rejects.toThrow('healthy serving version');
    // A canonical path that reaches a different service is not identity proof.
    await expect(
      acceptanceHealth(
        origin(0),
        '1.2.3',
        { ...expected, service: 'backend-api' },
        1000,
      ),
    ).rejects.toThrow('healthy serving version');
  } finally {
    await Promise.all(servers.map((server) => server.stop(true)));
  }
});
