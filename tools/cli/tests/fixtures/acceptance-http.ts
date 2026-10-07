import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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

async function tls() {
  const directory = mkdtempSync(join(tmpdir(), 'tale-acceptance-tls-'));
  let server: ReturnType<typeof Bun.serve> | undefined;
  let proxy: ReturnType<typeof Bun.serve> | undefined;
  try {
    const generated = await exec(
      'openssl',
      [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-keyout',
        join(directory, 'key.pem'),
        '-out',
        join(directory, 'cert.pem'),
        '-days',
        '1',
        '-subj',
        '/CN=localhost',
        '-addext',
        'subjectAltName=IP:127.0.0.1,DNS:localhost',
      ],
      { silent: true, timeout: 10, maxOutputBytes: 65536 },
    );
    assert.equal(generated.success, true);
    server = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      tls: {
        key: readFileSync(join(directory, 'key.pem')),
        cert: readFileSync(join(directory, 'cert.pem')),
      },
      fetch: () =>
        Response.json(
          { status: 'ok', version: '1.2.3' },
          { headers: { 'Tale-Serving-Identity': identity } },
        ),
    });
    let proxyCalls = 0;
    proxy = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch: () => {
        proxyCalls++;
        return new Response('wrong process');
      },
    });
    const script = `import {acceptanceRequest} from ${JSON.stringify(join(import.meta.dir, '../../src/lib/deployment/acceptance-request.ts'))};try{const response=await acceptanceRequest(${JSON.stringify(`https://127.0.0.1:${server.port}/api/health`)},AbortSignal.timeout(1000));console.log(await response.text());}catch{console.log('refused');process.exitCode=1;}`;
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
    assert.equal(proxyCalls, 0);
  } finally {
    await server?.stop(true);
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

// A fresh process isolates Bun's cached proxy state and suite-global exec mocks.
if (process.argv[2] === 'tls') await tls();
else if (process.argv[2] === 'proxy') await proxyFixture();
else throw new Error('Unknown acceptance HTTP fixture');
console.log('accepted');
