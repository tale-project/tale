import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createServingIdentity } from '../../../../packages/ui/src/server/serving-identity';
import {
  acceptanceHealth,
  servingIdentity,
} from '../../src/lib/deployment/acceptance-health';
import { acceptanceRequest } from '../../src/lib/deployment/acceptance-request';

const identity =
  'v1;service=platform;instance=11111111-1111-4111-8111-111111111111';

// execFile children inherit the owned outer group (its API has no detached
// option), so the outer deadline also reaps them. Each invocation has its own maintained Node timeout/output limits.
function exec(
  command: string,
  args: string[],
  options: {
    timeout: number;
    maxOutputBytes: number;
    silent: true;
    env?: NodeJS.ProcessEnv;
  },
): Promise<{ success: boolean; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(
      command,
      args,
      {
        encoding: 'utf8',
        timeout: options.timeout * 1000,
        maxBuffer: options.maxOutputBytes,
        killSignal: 'SIGKILL',
        env: options.env,
      },
      (error, stdout, stderr) => resolve({ success: !error, stdout, stderr }),
    );
  });
}

async function tls(capturedOrigin = false) {
  const directory = mkdtempSync(join(tmpdir(), 'tale-acceptance-tls-'));
  const passphrase = randomBytes(32).toString('hex');
  let server: Server | undefined;
  let port = 0;
  const serverNames: (string | false | null)[] = [];
  let proxy: ReturnType<typeof Bun.serve> | undefined;
  try {
    const generated = await exec(
      'openssl',
      [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-passout',
        'env:TALE_ACCEPTANCE_TEST_PASSPHRASE',
        '-keyout',
        join(directory, 'key.pem'),
        '-out',
        join(directory, 'cert.pem'),
        '-days',
        '1',
        '-subj',
        '/CN=localhost',
        '-addext',
        'subjectAltName=IP:127.0.0.1,DNS:localhost,DNS:origin.example.test',
      ],
      {
        silent: true,
        timeout: 10,
        maxOutputBytes: 65536,
        env: {
          PATH: process.env.PATH ?? '',
          TALE_ACCEPTANCE_TEST_PASSPHRASE: passphrase,
        },
      },
    );
    assert.equal(generated.success, true);
    server = createServer(
      {
        key: readFileSync(join(directory, 'key.pem')),
        passphrase,
        cert: readFileSync(join(directory, 'cert.pem')),
      },
      (request, response) => {
        assert.equal(
          request.headers.host,
          `${capturedOrigin ? 'origin.example.test' : '127.0.0.1'}:${port}`,
        );
        response.writeHead(200, {
          'Content-Type': 'application/json',
          'Tale-Serving-Identity': identity,
        });
        response.end(JSON.stringify({ status: 'ok', version: '1.2.3' }));
      },
    );
    server.on('secureConnection', (socket) =>
      serverNames.push(socket.servername),
    );
    await new Promise<void>((resolve) =>
      server!.listen(0, '127.0.0.1', resolve),
    );
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    port = address.port;
    let proxyCalls = 0;
    proxy = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch: () => {
        proxyCalls++;
        return new Response('wrong process');
      },
    });
    const script = `import {acceptanceRequest} from ${JSON.stringify(join(import.meta.dir, '../../src/lib/deployment/acceptance-request.ts'))};try{const response=await acceptanceRequest(${JSON.stringify(`https://${capturedOrigin ? 'origin.example.test' : '127.0.0.1'}:${port}/api/health`)},AbortSignal.timeout(1000),${capturedOrigin ? JSON.stringify('127.0.0.1') : 'undefined'});console.log(await response.text());}catch{console.log('refused');process.exitCode=1;}`;
    const environment = {
      PATH: process.env.PATH ?? '',
      HTTPS_PROXY: `http://127.0.0.1:${proxy.port}`,
      https_proxy: `http://127.0.0.1:${proxy.port}`,
      NO_PROXY: '',
      no_proxy: '',
    };
    const refused = await exec(process.execPath, ['--eval', script], {
      env: environment,
      silent: true,
      timeout: 5,
      maxOutputBytes: 65536,
    });
    assert.equal(refused.success, false);
    assert.equal(refused.stdout.trim(), 'refused');
    const trustDisabled = await exec(process.execPath, ['--eval', script], {
      env: { ...environment, NODE_TLS_REJECT_UNAUTHORIZED: '0' },
      silent: true,
      timeout: 5,
      maxOutputBytes: 65536,
    });
    assert.equal(trustDisabled.success, false);
    assert.equal(trustDisabled.stdout.trim(), 'refused');
    const trusted = await exec(process.execPath, ['--eval', script], {
      env: {
        ...environment,
        NODE_EXTRA_CA_CERTS: join(directory, 'cert.pem'),
      },
      silent: true,
      timeout: 5,
      maxOutputBytes: 65536,
    });
    assert.equal(trusted.success, true, trusted.stderr);
    assert.deepEqual(JSON.parse(trusted.stdout), {
      status: 'ok',
      version: '1.2.3',
    });
    if (capturedOrigin) {
      const wrongName = await exec(
        process.execPath,
        ['--eval', script.replace('origin.example.test', 'wrong.example.test')],
        {
          env: {
            ...environment,
            NODE_EXTRA_CA_CERTS: join(directory, 'cert.pem'),
          },
          silent: true,
          timeout: 5,
          maxOutputBytes: 65536,
        },
      );
      assert.equal(wrongName.success, false);
      assert.equal(wrongName.stdout.trim(), 'refused');
      const normalDns = await exec(
        process.execPath,
        ['--eval', script.replace(',"127.0.0.1")', ',undefined)')],
        {
          env: {
            ...environment,
            NODE_EXTRA_CA_CERTS: join(directory, 'cert.pem'),
          },
          silent: true,
          timeout: 5,
          maxOutputBytes: 65536,
        },
      );
      assert.equal(normalDns.success, false);
      assert.equal(normalDns.stdout.trim(), 'refused');
    }
    if (capturedOrigin) assert.ok(serverNames.includes('origin.example.test'));
    assert.equal(proxyCalls, 0);
  } finally {
    server?.closeAllConnections();
    if (server)
      await new Promise<void>((resolve) => server!.close(() => resolve()));
    await proxy?.stop(true);
    rmSync(directory, { recursive: true, force: true });
  }
}
async function proxyFixture() {
  let calls = 0;
  const proxy = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: () => {
      calls++;
      return new Response('wrong process');
    },
  });
  const direct = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: (request) => {
      assert.equal(request.headers.get('authorization'), null);
      assert.equal(request.headers.get('cookie'), null);
      return Response.json(
        { status: 'ok', version: '1.2.3' },
        { headers: { 'Tale-Serving-Identity': identity } },
      );
    },
  });
  const names = [
    'HTTP_PROXY',
    'HTTPS_PROXY',
    'ALL_PROXY',
    'http_proxy',
    'https_proxy',
    'all_proxy',
    'NO_PROXY',
    'no_proxy',
  ];
  const previous = names.map((name) => process.env[name]);
  try {
    for (const name of names)
      process.env[name] =
        name.toLowerCase() === 'no_proxy'
          ? ''
          : `http://127.0.0.1:${proxy.port}`;
    const response = await acceptanceRequest(
      `http://127.0.0.1:${direct.port}/api/health`,
      AbortSignal.timeout(1000),
    );
    assert.equal(response.headers.get('Tale-Serving-Identity'), identity);
    assert.deepEqual(await response.json(), { status: 'ok', version: '1.2.3' });
    assert.equal(calls, 0);
  } finally {
    names.forEach((name, index) => {
      if (previous[index] === undefined) delete process.env[name];
      else process.env[name] = previous[index];
    });
    await direct.stop(true);
    await proxy.stop(true);
  }
}

async function refusal(mode: string) {
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: () => {
      const headers = new Headers({ 'Tale-Serving-Identity': identity });
      if (mode === 'redirect')
        return new Response(null, {
          status: 302,
          headers: { location: 'https://example.invalid' },
        });
      if (mode === 'missing') headers.delete('Tale-Serving-Identity');
      if (mode === 'duplicate')
        headers.append('Tale-Serving-Identity', identity);
      if (mode === 'stalled')
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('{'));
            },
          }),
          { headers },
        );
      return new Response(mode === 'oversized' ? 'x'.repeat(65537) : '{}', {
        headers,
      });
    },
  });
  try {
    await assert.rejects(
      acceptanceRequest(
        `http://127.0.0.1:${server.port}/api/health`,
        AbortSignal.timeout(100),
      ),
    );
  } finally {
    await server.stop(true);
  }
}

async function identityFixture() {
  const servers = [0, 1].map(() => {
    const value = createServingIdentity('platform');
    return Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch: () =>
        Response.json(
          { status: 'ok', version: '1.2.3' },
          { headers: { 'Tale-Serving-Identity': value } },
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
    assert.deepEqual(
      await acceptanceHealth(origin(0), '1.2.3', expected, 1000),
      expected,
    );
    await assert.rejects(
      acceptanceHealth(origin(1), '1.2.3', expected, 1000),
      /healthy serving version/,
    );
    // A canonical path that reaches a different service is not identity proof.
    await assert.rejects(
      acceptanceHealth(
        origin(0),
        '1.2.3',
        { ...expected, service: 'backend-api' },
        1000,
      ),
      /healthy serving version/,
    );
  } finally {
    await Promise.all(servers.map((server) => server.stop(true)));
  }
}

// Fresh processes also separate aborted native sockets and server teardown from
// later cases, alongside Bun's cached proxy state and suite-global exec mocks.
if (process.argv[2] === 'tls') await tls();
else if (process.argv[2] === 'tls-origin') await tls(true);
else if (process.argv[2] === 'proxy') await proxyFixture();
else if (process.argv[2] === 'identity') await identityFixture();
else if (
  ['redirect', 'missing', 'oversized', 'stalled', 'duplicate'].includes(
    process.argv[2] ?? '',
  )
)
  await refusal(process.argv[2]!);
else throw new Error('Unknown acceptance HTTP fixture');
console.log('accepted');
