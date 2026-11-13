// sandbox: a session the stack's own spawner makes, through its signed API as
// the platform calls it, reaches the backend API and the LLM gateway by name
// and nothing else of the stack: no other name resolves, and the database,
// the platform, the proxy and the Incus API stay closed by address (design
// 5.4, 15.5, D-31). The spawner answers its own stack alone, so the suite's
// signed requests travel from the backend instance, as the backend's do.

import { afterAll, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { SpawnerApi } from '../../../../../services/sandbox/e2e/incus/spawner-api';
import {
  deployed,
  incus,
  instancesOf,
  loadLab,
  paths,
  record,
  until,
} from '../harness';

setDefaultTimeout(45 * 60_000);
const lab = loadLab();
const SESSION = `e2e-${randomUUID().slice(0, 8)}`;
const ORGANIZATION = 'e2e-organization';

/** A value of the deployment's generated secrets. */
function secret(name: string): string {
  const text = readFileSync(join(paths(lab).state, 'secrets.env'), 'utf8');
  const line = text.split('\n').find((entry) => entry.startsWith(`${name}=`));
  if (line === undefined) throw new Error(`The deployment has no ${name}.`);
  return line.slice(name.length + 1).replace(/^'(.*)'$/, '$1');
}

function addressOf(name: string): string {
  const address = instancesOf(lab).find(
    (instance) => instance.name === name,
  )?.address;
  if (address == null) throw new Error(`${name} has no address.`);
  return address;
}

/** `fetch` for the spawner's URL, sent with curl from inside the backend
 * instance: the same method, headers and body, the answer read whole. */
const relayed: typeof fetch = (async (
  input: string | URL | Request,
  init: RequestInit = {},
) => {
  const url = String(input instanceof Request ? input.url : input);
  const headers = new Headers(init.headers);
  const body = typeof init.body === 'string' ? init.body : undefined;
  const args = [
    'exec',
    'backend-api-1',
    '--project',
    lab.name,
    '--',
    'curl',
    '-sS',
    '--max-time',
    '600',
    '-X',
    init.method ?? 'GET',
    '-w',
    '\n%{http_code}',
    ...[...headers].flatMap(([key, value]) => ['-H', `${key}: ${value}`]),
    ...(body === undefined ? [] : ['--data-binary', '@-']),
    url,
  ];
  const out = incus(lab, args, { allowFailure: true, input: body ?? '' });
  const split = out.stdout.lastIndexOf('\n');
  const status = Number(out.stdout.slice(split + 1));
  return new Response(out.stdout.slice(0, Math.max(split, 0)), {
    status: status >= 200 && status <= 599 ? status : 502,
  });
}) as typeof fetch;

let api: SpawnerApi | undefined;
const direct = globalThis.fetch;
afterAll(async () => {
  await api?.destroy(SESSION).catch(() => undefined);
  globalThis.fetch = direct;
});

/** What a probe printed inside the session, line by line. */
function verdicts(stdout: string): Record<string, string> {
  return Object.fromEntries(
    stdout
      .split('\n')
      .map((line) => line.trim().split(' '))
      .flatMap((words) =>
        words.length === 2 ? [[words[0] ?? '', words[1] ?? '']] : [],
      ),
  );
}

describe('sandbox', () => {
  test('a session reaches the backend API and the gateway by name, and nothing else', async () => {
    deployed(lab);
    globalThis.fetch = relayed;
    const spawner = new SpawnerApi(
      'http://sandbox:8003',
      secret('SANDBOX_TOKEN'),
    );
    api = spawner;
    await until(
      'the spawner to answer',
      async () => (await spawner.health()).status === 200,
      {
        timeoutMs: 5 * 60_000,
        intervalMs: 3_000,
      },
    );
    const created = await spawner.create({
      sessionId: SESSION,
      organizationId: ORGANIZATION,
    });
    record(lab, 'sandbox', {
      createMs: Math.round(created.elapsedMs),
      imageWaits: created.imageWaits,
    });
    expect(created.reply.status).toBe(201);

    const closed = {
      db: `${addressOf('db')}:5432`,
      platform: `${addressOf('platform-1')}:3000`,
      proxy: `${addressOf('proxy')}:80`,
      incus: `${new URL(lab.endpoint).hostname}:${new URL(lab.endpoint).port}`,
    };
    const script = [
      'for name in backend-api sandbox-llm-gateway db platform proxy object-store; do',
      '  if getent hosts "$name" >/dev/null; then echo "resolve-$name yes"; else echo "resolve-$name no"; fi',
      'done',
      'probe() { if timeout 5 bash -c "</dev/tcp/$2/$3" 2>/dev/null; then echo "$1 open"; else echo "$1 closed"; fi; }',
      'probe reach-backend-api backend-api 3005',
      'probe reach-sandbox-llm-gateway sandbox-llm-gateway 8080',
      ...Object.entries(closed).map(([what, target]) => {
        const [host, port] = target.split(':');
        return `probe reach-${what} ${host} ${port}`;
      }),
    ].join('\n');
    const outcome = await spawner.exec(SESSION, {
      command: ['bash', '-c', script],
      timeoutMs: 120_000,
      collectOutput: true,
    });
    const seen = verdicts(outcome.stdout);
    record(lab, 'sandbox', { probes: seen });
    expect(seen).toEqual({
      'resolve-backend-api': 'yes',
      'resolve-sandbox-llm-gateway': 'yes',
      'resolve-db': 'no',
      'resolve-platform': 'no',
      'resolve-proxy': 'no',
      'resolve-object-store': 'no',
      'reach-backend-api': 'open',
      'reach-sandbox-llm-gateway': 'open',
      'reach-db': 'closed',
      'reach-platform': 'closed',
      'reach-proxy': 'closed',
      'reach-incus': 'closed',
    });
  });
});
