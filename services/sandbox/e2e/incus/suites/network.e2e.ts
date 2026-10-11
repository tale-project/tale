// Where a session can and cannot go, against the real node: out through Tale's
// own egress proxy and nowhere else. Sessions resolve names only through the
// proxy's resolver (the bridge's forwards nothing); they reach the gateway and
// backend stand-ins on the two ports the ACL names, and not the node's API,
// the spawner, the metadata address, another session or the internet directly.

import { afterAll, beforeAll, describe, expect } from 'bun:test';

import {
  admin,
  lab,
  reportFor,
  sessionId,
  sessionInstance,
  sh,
  spawnerOf,
  step,
} from '../harness.ts';
import { newToken } from '../spawner.ts';

const report = reportFor('network');
const spawner = spawnerOf({ name: 'network', port: 18005, token: newToken() });
const api = spawner.api;

const ORG = 'e2e-net';
const A = sessionId('neta');
const B = sessionId('netb');

const stubs: { stop(force?: boolean): Promise<void> }[] = [];
let addressOfB = '';

// A connection attempt from inside a session: what happened, in one word.
const CONNECT = `
import socket, sys
host, port = sys.argv[1], int(sys.argv[2])
s = socket.socket()
s.settimeout(float(sys.argv[3]) if len(sys.argv) > 3 else 5.0)
try:
    s.connect((host, port))
    print('connected')
except Exception as error:
    print('failed', type(error).__name__)
`;

// A connection that waits for the server to speak first: an SSH server does.
// Under transparent egress every outbound TCP connection is accepted locally by
// the redirect, so only a banner from the far end shows it was not stopped.
const BANNER = `
import socket, sys
host, port = sys.argv[1], int(sys.argv[2])
s = socket.socket()
s.settimeout(float(sys.argv[3]))
try:
    s.connect((host, port))
except Exception as error:
    print('refused', type(error).__name__)
    raise SystemExit
try:
    data = s.recv(32)
    print('banner', data[:16].decode('ascii', 'replace') if data else 'closed')
except Exception as error:
    print('silent', type(error).__name__)
`;

// One DNS query over UDP, answered or not.
const DNS = `
import socket, struct, sys
server, name = sys.argv[1], sys.argv[2]
query = struct.pack('>HHHHHH', 0x1234, 0x0100, 1, 0, 0, 0)
query += b''.join(bytes([len(part)]) + part.encode() for part in name.split('.'))
query += b'\\x00' + struct.pack('>HH', 1, 1)
s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
s.settimeout(4.0)
try:
    s.sendto(query, (server, 53))
    data, _ = s.recvfrom(512)
    print('rcode=%d answers=%d' % (data[3] & 15, struct.unpack('>H', data[6:8])[0]))
except Exception as error:
    print('no answer', type(error).__name__)
`;

async function connect(
  from: string,
  host: string,
  port: number,
): Promise<string> {
  const outcome = await api.exec(from, {
    command: ['python3', '-c', CONNECT, host, String(port), '6'],
    timeoutMs: 30_000,
  });
  return outcome.stdout.trim();
}

async function banner(
  from: string,
  host: string,
  port: number,
): Promise<string> {
  const outcome = await api.exec(from, {
    command: ['python3', '-c', BANNER, host, String(port), '8'],
    timeoutMs: 30_000,
  });
  return outcome.stdout.trim();
}

async function dns(
  from: string,
  server: string,
  name: string,
): Promise<string> {
  const outcome = await api.exec(from, {
    command: ['python3', '-c', DNS, server, name],
    timeoutMs: 30_000,
  });
  return outcome.stdout.trim();
}

async function http(
  from: string,
  args: string,
): Promise<{ code: number; stdout: string }> {
  const outcome = await api.exec(from, {
    shell: `curl -sS -o /dev/null -w '%{http_code}' --max-time 30 ${args}`,
    timeoutMs: 60_000,
  });
  return {
    code: outcome.result?.exitCode ?? -1,
    stdout: outcome.stdout.trim(),
  };
}

describe('a session on the sandbox bridge', () => {
  beforeAll(async () => {
    await admin.cleanSlate();
    spawner.start();
    await spawner.ready({ image: true });
    // The LLM gateway and the backend are the node's own addresses on the
    // bridge here; the ACL names one port on each.
    stubs.push(
      Bun.serve({
        hostname: lab.gatewayAddress,
        port: 8080,
        fetch: () => new Response('gateway'),
      }),
      Bun.serve({
        hostname: lab.backendAddress,
        port: 3005,
        fetch: () => new Response('backend'),
      }),
      Bun.serve({
        hostname: lab.gatewayAddress,
        port: 8081,
        fetch: () => new Response('not allowed'),
      }),
      Bun.serve({
        hostname: lab.backendAddress,
        port: 3006,
        fetch: () => new Response('not allowed'),
      }),
    );
    for (const id of [A, B]) {
      const created = await api.create({
        sessionId: id,
        organizationId: ORG,
        profile: 'agent',
      });
      if (created.session === undefined) {
        throw new Error(
          `create ${id}: ${created.reply.status} ${created.reply.text}`,
        );
      }
    }
    addressOfB = (await sessionInstance(B))?.addresses[0] ?? '';
  }, 40 * 60_000);

  afterAll(async () => {
    for (const stub of stubs) await stub.stop(true);
    await spawner.stop();
    await admin.cleanSlate();
    report.flush();
  });

  step('the session resolves through the proxy alone', async () => {
    const resolv = await sh(api, A, 'cat /etc/resolv.conf');
    const servers = resolv
      .split('\n')
      .filter((line) => line.startsWith('nameserver'))
      .map((line) => line.split(/\s+/)[1]);
    expect(servers).toEqual([lab.egressAddress]);

    // The proxy's resolver answers the internet's names; the bridge's own,
    // which forwards nothing, answers none.
    const viaProxy = await dns(A, lab.egressAddress, 'github.com');
    expect(viaProxy).toMatch(/^rcode=0 answers=[1-9]/);
    const viaBridge = await dns(A, lab.bridgeAddress, 'github.com');
    expect(viaBridge).not.toMatch(/answers=[1-9]/);
    report.fact('the bridge resolver, asked for github.com', viaBridge);
    expect(
      (await sh(api, A, 'getent hosts github.com | head -n 1')).trim(),
    ).toMatch(/^[0-9.]+\s+github\.com/);
  });

  step('HTTPS goes out through the proxy', async () => {
    const started = performance.now();
    const viaEnv = await http(A, 'https://github.com/robots.txt');
    report.add('HTTPS request through the proxy', performance.now() - started);
    expect(viaEnv).toEqual({ code: 0, stdout: '200' });
  });

  step('the proxy refuses what is private, as its firewall says', async () => {
    // The spawner answers /health on every address of the node: through a
    // proxy that let private destinations in, this would be a 200.
    const spawnerPort = spawner.settings.port;
    const viaProxy = await http(
      A,
      `--proxy ${lab.egressProxy} http://${lab.bridgeAddress}:${spawnerPort}/health`,
    );
    expect(viaProxy.stdout).not.toBe('200');
    const tunnel = await http(
      A,
      `--proxy ${lab.egressProxy} https://${lab.bridgeAddress}:8443/`,
    );
    expect(tunnel.code).not.toBe(0);
  });

  step('what the redirect does not carry is stopped by the ACL', async () => {
    // UDP is not redirected: a resolver on the internet is simply not there.
    for (const server of ['1.1.1.1', '8.8.8.8']) {
      expect(await dns(A, server, 'github.com')).toStartWith('no answer');
    }
    // TCP is redirected to the proxy, which tunnels to port 443 and no other:
    // an SSH server never gets to say its banner.
    for (const [host, port] of [
      ['github.com', 22],
      ['1.1.1.1', 53],
      ['8.8.8.8', 8443],
    ] as const) {
      const seen = await banner(A, host, port);
      expect({ host, port, seen: seen.startsWith('banner SSH-') }).toEqual({
        host,
        port,
        seen: false,
      });
    }
  });

  step('the metadata address of the cloud is out of reach', async () => {
    const reply = await http(
      A,
      '--noproxy "*" -H "Metadata: true" "http://169.254.169.254/metadata/instance?api-version=2021-02-01"',
    );
    expect(reply.stdout).not.toBe('200');
  });

  step('the node, its API and the spawner are out of reach', async () => {
    expect(await connect(A, lab.bridgeAddress, 8443)).toStartWith('failed');
    expect(await connect(A, lab.bridgeAddress, 18005)).toStartWith('failed');
    expect(await connect(A, lab.bridgeAddress, 22)).toStartWith('failed');
  });

  step("another session is out of reach, runnerd's port included", async () => {
    expect(addressOfB).toMatch(/^10\.20\.0\./);
    expect(await connect(A, addressOfB, 8200)).toStartWith('failed');
    expect(await connect(A, addressOfB, 22)).toStartWith('failed');
    // The proxy, on the other hand, answers.
    expect(await connect(A, lab.egressAddress, 3128)).toBe('connected');
  });

  step(
    'the gateway and the backend answer on the ports the ACL names, and on no other',
    async () => {
      const gateway = await api.exec(A, {
        shell: `curl -sS --noproxy '*' --max-time 10 http://${lab.gatewayAddress}:8080/`,
      });
      expect(gateway.stdout).toBe('gateway');
      const backend = await api.exec(A, {
        shell: `curl -sS --noproxy '*' --max-time 10 http://${lab.backendAddress}:3005/`,
      });
      expect(backend.stdout).toBe('backend');
      expect(await connect(A, lab.gatewayAddress, 8081)).toStartWith('failed');
      expect(await connect(A, lab.backendAddress, 3006)).toStartWith('failed');
    },
  );

  step('sessions have no IPv6', async () => {
    expect(
      (await sh(api, A, 'cat /proc/sys/net/ipv6/conf/all/disable_ipv6')).trim(),
    ).toBe('1');
  });
});
