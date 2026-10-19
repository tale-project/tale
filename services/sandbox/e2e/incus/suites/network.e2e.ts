// Where a session can and cannot go, against the real node: out through Tale's
// own egress proxy and nowhere else. Sessions resolve names only through the
// proxy's resolver (the bridge's forwards nothing); they reach the gateway and
// backend stand-ins on the two ports the ACL names, and not the node's API,
// the spawner, the metadata address, another session or the internet directly.
// Then, the other way an infrastructure can give them the platform's names: the
// bridge's resolver told the names, and the spawner pointing sessions at it.
// Last, the node's package registry caches (stand-ins on the gateway's
// address): a session told them installs a locked npm project and a pip
// project through them, and the proxy refuses the public registries' hosts.

import { afterAll, beforeAll, describe, expect } from 'bun:test';

import { REGISTRY_HOSTS } from '../../../src/backend/incus/incus-registry-caches.ts';
import {
  admin,
  expectStatus,
  lab,
  reportFor,
  sessionId,
  sessionInstance,
  sh,
  spawnerOf,
  step,
  until,
} from '../harness.ts';
import {
  npmProject,
  pipRequirements,
  PROBE_NAME,
  probePackages,
  serveStandInCaches,
} from '../registry-stand-ins.ts';
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

  step(
    'the session user cannot take the redirect or the firewall away',
    async () => {
      // The redirect is installed by the entrypoint as root; the user the agent
      // runs as has no capability to change it.
      const flush = await api.exec(A, {
        shell:
          '/usr/sbin/iptables -t nat -F 2>&1; echo "rc=$?"; /usr/sbin/iptables -t nat -S 2>&1 | head -n 3',
      });
      expect(flush.stdout).not.toContain('rc=0');
      // And the request that follows still goes out through the proxy.
      expect(await http(A, 'https://github.com/robots.txt')).toEqual({
        code: 0,
        stdout: '200',
      });
    },
  );

  step('sessions have no IPv6', async () => {
    expect(
      (await sh(api, A, 'cat /proc/sys/net/ipv6/conf/all/disable_ipv6')).trim(),
    ).toBe('1');
  });

  step(
    "a bridge resolver that is given the platform's names answers them for a session pointed at it, with no ACL rule for DNS",
    async () => {
      // How an infrastructure that keeps the bridge's resolver closed (it
      // forwards nothing) can give a session the names of the LLM gateway and
      // the backend: `address=` lines on the bridge, and the spawner told to
      // hand sessions the bridge as their resolver (SANDBOX_INCUS_DNS). The
      // ACL has no rule for DNS to the bridge: Incus lets it through.
      const closed = 'no-resolv';
      const names = [
        `address=/sandbox-llm-gateway/${lab.gatewayAddress}`,
        `address=/backend-api/${lab.backendAddress}`,
        `address=/backend-relay/${lab.backendAddress}`,
      ];
      await admin.run([
        'network',
        'set',
        lab.network,
        `raw.dnsmasq=${[closed, ...names].join('\n')}`,
      ]);
      try {
        expect(await spawner.stop()).not.toBeNull();
        spawner.start({ SANDBOX_INCUS_DNS: lab.bridgeAddress });
        await spawner.ready();
        const C = sessionId('netc');
        const created = await api.create({
          sessionId: C,
          organizationId: ORG,
          profile: 'agent',
        });
        if (created.session === undefined) {
          throw new Error(
            `create ${C}: ${created.reply.status} ${created.reply.text}`,
          );
        }
        const resolv = await sh(api, C, 'cat /etc/resolv.conf');
        expect(
          resolv
            .split('\n')
            .filter((line) => line.startsWith('nameserver'))
            .map((line) => line.split(/\s+/)[1]),
        ).toEqual([lab.bridgeAddress]);
        expect(
          (await sh(api, C, 'getent hosts sandbox-llm-gateway')).trim(),
        ).toStartWith(lab.gatewayAddress);
        expect(
          (await sh(api, C, 'getent hosts backend-api')).trim(),
        ).toStartWith(lab.backendAddress);
        // By name, on the ACL's ports, reached directly (NO_PROXY names them).
        const gateway = await api.exec(C, {
          shell: 'curl -sS --max-time 10 http://sandbox-llm-gateway:8080/',
        });
        expect(gateway.stdout).toBe('gateway');
        const backend = await api.exec(C, {
          shell: 'curl -sS --max-time 10 http://backend-api:3005/',
        });
        expect(backend.stdout).toBe('backend');
        // The bridge resolves nothing else, as designed: what goes out goes
        // through the proxy, which resolves for the session.
        const outside = await api.exec(C, {
          shell: 'getent hosts github.com',
        });
        expect(outside.result?.exitCode ?? 0).toBeGreaterThan(0);
        report.fact(
          'a name the bridge was not given, looked up by a session pointed at it',
          `getent exit ${outside.result?.exitCode}`,
        );
        expect(await http(C, 'https://github.com/robots.txt')).toEqual({
          code: 0,
          stdout: '200',
        });
        expectStatus(await api.destroy(C), 200, `destroy ${C}`);
      } finally {
        const restored = await admin.run(
          ['network', 'set', lab.network, `raw.dnsmasq=${closed}`],
          { allowFailure: true },
        );
        if (restored.code !== 0) {
          console.warn(
            `could not close the bridge resolver again: ${restored.stderr.trim()}`,
          );
        }
      }
    },
  );

  step(
    'a session told the registry caches installs through them, and no registry host is reached',
    async () => {
      // What an operator does to give sessions the node's caches: the cache
      // addresses in the spawner's two settings, an ACL rule for each cache's
      // port, and the registries' hosts refused by the egress proxy. The
      // caches are stand-ins on the gateway's address (a link of the node's
      // own), serving one npm package and one wheel that exist nowhere else.
      const packages = probePackages();
      const rules = [4873, 3141].map((port) => [
        'network',
        'acl',
        'rule',
        'add',
        lab.acl,
        'egress',
        'action=allow',
        `destination=${lab.gatewayAddress}/32`,
        'protocol=tcp',
        `destination_port=${port}`,
      ]);
      const denied = [...REGISTRY_HOSTS.npm, ...REGISTRY_HOSTS.pypi];
      const caches = serveStandInCaches({
        hostname: lab.gatewayAddress,
        npmPort: 4873,
        pypiPort: 3141,
      });
      const D = sessionId('netd');
      let aclRules = 0;
      let proxyRestricted = false;
      const proxyAnswers = async () =>
        (
          await admin.host(
            [
              'curl',
              '-sS',
              '-o',
              '/dev/null',
              '-w',
              '%{http_code}',
              '--max-time',
              '10',
              '--proxy',
              lab.egressProxy,
              'https://github.com/robots.txt',
            ],
            { allowFailure: true },
          )
        ).stdout.trim() === '200';
      try {
        for (const rule of rules) {
          await admin.run(rule);
          aclRules += 1;
        }
        await admin.run([
          'config',
          'set',
          lab.egressInstance,
          `environment.SANDBOX_EGRESS_DENIED_HOSTS=${denied.join(',')}`,
        ]);
        proxyRestricted = true;
        await admin.run(['restart', lab.egressInstance]);
        await until('the egress proxy to answer again', proxyAnswers, {
          timeoutMs: 120_000,
          intervalMs: 2_000,
        });

        expect(await spawner.stop()).not.toBeNull();
        spawner.start({
          SANDBOX_INCUS_NPM_REGISTRY: caches.npmUrl,
          SANDBOX_INCUS_PYPI_INDEX: caches.pypiUrl,
        });
        await spawner.ready();
        const created = await api.create({
          sessionId: D,
          organizationId: ORG,
          profile: 'agent',
        });
        if (created.session === undefined) {
          throw new Error(
            `create ${D}: ${created.reply.status} ${created.reply.text}`,
          );
        }

        // What the session was given.
        expect(
          (await sh(api, D, 'cat "$HOME/.npmrc" "$HOME/.bunfig.toml"')).trim(),
        ).toContain(`registry=${caches.npmUrl}`);
        const pipConf = await sh(api, D, 'cat "$HOME/.config/pip/pip.conf"');
        expect(pipConf).toContain(`index-url = ${caches.pypiUrl}`);
        expect(pipConf).toContain(`trusted-host = ${lab.gatewayAddress}:3141`);
        expect(await sh(api, D, 'cat "$HOME/.config/uv/uv.toml"')).toContain(
          `allow-insecure-host = ["${lab.gatewayAddress}:3141"]`,
        );
        expect(await sh(api, D, 'echo "$NO_PROXY"')).toContain(
          lab.gatewayAddress,
        );

        // A locked npm project, a pip project locked by hash and the same
        // requirements through uv.
        const files = [
          ...Object.entries(npmProject(packages)).map(([name, content]) => ({
            path: `workspace/npm-probe/${name}`,
            content,
          })),
          {
            path: 'workspace/pip-probe/requirements.txt',
            content: pipRequirements(packages),
          },
        ];
        expectStatus(await api.stage(D, files), 200, `stage into ${D}`);
        expect(
          (
            await sh(
              api,
              D,
              'cd /agent/workspace/npm-probe && npm ci --no-fund && node -p "require(\'tale-e2e-probe\')"',
            )
          ).trim(),
        ).toEndWith(PROBE_NAME);
        const pip = await sh(
          api,
          D,
          'cd /agent/workspace/pip-probe && pip install --require-hashes -r requirements.txt && python3 -c "import tale_e2e_probe; print(tale_e2e_probe.NAME)"',
        );
        expect(pip.trim()).toEndWith(PROBE_NAME);
        const uv = await sh(
          api,
          D,
          'cd /agent/workspace/pip-probe && uv pip install --target /agent/workspace/uv-target --require-hashes -r requirements.txt && PYTHONPATH=/agent/workspace/uv-target python3 -c "import tale_e2e_probe; print(tale_e2e_probe.NAME)"',
        );
        expect(uv.trim()).toEndWith(PROBE_NAME);

        // Every package came from the stand-ins.
        const served = caches.requests.join('\n');
        expect(served).toContain(
          `4873 GET /${PROBE_NAME}/-/${PROBE_NAME}-1.0.0.tgz`,
        );
        expect(served).toMatch(
          /3141 GET \/root\/pypi\/(\+|%2B)f\/tale_e2e_probe-1\.0\.0-py3-none-any\.whl/,
        );

        // No registry host is reached: the proxy refuses a tunnel to each, and
        // the names it resolves for the session are not there. Everything
        // else stays open.
        for (const host of denied) {
          const tunnel = await api.exec(D, {
            shell: `curl -sS -o /dev/null --max-time 30 --proxy ${lab.egressProxy} https://${host}/`,
            timeoutMs: 60_000,
          });
          expect({ host, exit: tunnel.result?.exitCode }).not.toEqual({
            host,
            exit: 0,
          });
          expect(tunnel.stderr).toContain('403');
          // The fully qualified form of the name is the same host.
          const dotted = await api.exec(D, {
            shell: `curl -sS -o /dev/null --max-time 30 --proxy ${lab.egressProxy} https://${host}./`,
            timeoutMs: 60_000,
          });
          expect({ host, stderr: dotted.stderr }).toEqual({
            host,
            stderr: expect.stringContaining('403'),
          });
          const lookup = await api.exec(D, { shell: `getent hosts ${host}` });
          expect({ host, found: lookup.result?.exitCode === 0 }).toEqual({
            host,
            found: false,
          });
        }
        expect(await http(D, 'https://github.com/robots.txt')).toEqual({
          code: 0,
          stdout: '200',
        });
        // A package manager that ignores its configuration fails, visibly.
        const around = await api.exec(D, {
          shell:
            'npm view left-pad version --registry https://registry.npmjs.org/ --fetch-retries=0 --fetch-timeout=30000',
          timeoutMs: 90_000,
        });
        expect(around.result?.exitCode ?? 0).not.toBe(0);
        report.fact(
          'npm told to use the public registry, with the proxy refusing it',
          `exit ${around.result?.exitCode}`,
        );
        expectStatus(await api.destroy(D), 200, `destroy ${D}`);
      } finally {
        await caches.stop();
        for (let index = 0; index < aclRules; index += 1) {
          const rule = rules[index];
          const removal = rule?.map((part) =>
            part === 'add' ? 'remove' : part,
          );
          const result =
            removal === undefined
              ? undefined
              : await admin.run(removal, { allowFailure: true });
          if (result !== undefined && result.code !== 0) {
            console.warn(
              `could not remove an ACL rule again: ${result.stderr.trim()}`,
            );
          }
        }
        if (proxyRestricted) {
          const opened = await admin.run(
            [
              'config',
              'unset',
              lab.egressInstance,
              'environment.SANDBOX_EGRESS_DENIED_HOSTS',
            ],
            { allowFailure: true },
          );
          await admin.run(['restart', lab.egressInstance], {
            allowFailure: true,
          });
          if (opened.code !== 0) {
            console.warn(
              `could not open the egress proxy again: ${opened.stderr.trim()}`,
            );
          }
          await until('the egress proxy to answer again', proxyAnswers, {
            timeoutMs: 120_000,
            intervalMs: 2_000,
          });
        }
      }
    },
  );
});
