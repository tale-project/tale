// What the spawner refuses at boot, and what the restricted certificate can and
// cannot do, against the real node: the pinned server certificate (a wrong
// anchor and Incus's own unpinnable one), a client the node does not trust, a
// project or profile the certificate has no business with, a project limit the
// backend cannot live with, and the API's own refusals to a restricted client.

import { afterAll, describe, expect } from 'bun:test';
import { X509Certificate } from 'node:crypto';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  admin,
  expectStatus,
  lab,
  reportFor,
  spawnerOf,
  step,
} from '../harness.ts';
import type { Reply } from '../spawner-api.ts';
import { field } from '../spawner-api.ts';
import { newToken } from '../spawner.ts';
import { asText, describeError } from '../util.ts';

const report = reportFor('boot');
let port = 18010;

/** A spawner that must not come up: the exit code and what it said. */
async function refusedBoot(
  name: string,
  env: Record<string, string | undefined>,
): Promise<{ code: number | null; log: string }> {
  port += 1;
  const spawner = spawnerOf({ name, port, token: newToken(), env });
  spawner.start();
  const code = await spawner.exited(120_000);
  if (code === null) {
    await spawner.kill();
    throw new Error(
      `the spawner ${name} did not exit:\n${spawner.logTail(60)}`,
    );
  }
  return { code, log: spawner.logTail(200) };
}

function generateCertificate(dir: string, name: string, usage: string) {
  const cert = join(dir, `${name}.crt`);
  const key = join(dir, `${name}.key`);
  const result = Bun.spawnSync([
    'openssl',
    'req',
    '-x509',
    '-newkey',
    'ec',
    '-pkeyopt',
    'ec_paramgen_curve:secp384r1',
    '-nodes',
    '-days',
    '30',
    '-subj',
    `/CN=${name}`,
    '-addext',
    `extendedKeyUsage=${usage}`,
    '-keyout',
    key,
    '-out',
    cert,
  ]);
  if (result.exitCode !== 0) {
    throw new Error(`openssl: ${result.stderr.toString()}`);
  }
  return { cert, key };
}

/** A request to the Incus API with the spawner's own certificate, pinned. */
async function asSpawner(
  method: string,
  path: string,
  body?: unknown,
): Promise<Reply> {
  const response = await fetch(`${lab.endpoint}${path}`, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    tls: {
      ca: readFileSync(lab.serverCertFile, 'utf8'),
      cert: readFileSync(lab.clientCertFile, 'utf8'),
      key: readFileSync(lab.clientKeyFile, 'utf8'),
    },
    redirect: 'error',
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    console.warn(`not JSON (${describeError(error)}): ${text.slice(0, 120)}`);
  }
  return { status: response.status, headers: response.headers, text, json };
}

describe('boot refusals against the real node', () => {
  afterAll(() => {
    report.flush();
  });

  step(
    'the node serves the certificate the spawner pins, and Incus made another',
    async () => {
      const served = new X509Certificate(readFileSync(lab.serverCertFile));
      const unpinnable = new X509Certificate(
        readFileSync(lab.defaultServerCertFile),
      );
      // The premise of the pinning rule, measured on Incus's own certificate.
      expect(served.ca).toBe(true);
      expect(unpinnable.ca).toBe(false);
      report.fact(
        'Incus default server certificate',
        `CA:${String(unpinnable.ca).toUpperCase()}, ${unpinnable.subject.replaceAll('\n', ' ')}`,
      );
      report.fact(
        'served server certificate',
        `CA:${String(served.ca).toUpperCase()}, expires ${served.validTo}`,
      );
    },
  );

  step(
    "Incus's own server certificate is refused before a request is made",
    async () => {
      const { code, log } = await refusedBoot('default-cert', {
        SANDBOX_INCUS_SERVER_CERT_FILE: lab.defaultServerCertFile,
      });
      expect(code).toBe(1);
      expect(log).toContain('is not a certificate Bun can pin');
      expect(log).toContain('UNABLE_TO_VERIFY_LEAF_SIGNATURE');
    },
  );

  step("a pinnable certificate that is not the node's is refused", async () => {
    const { code, log } = await refusedBoot('wrong-anchor', {
      SANDBOX_INCUS_SERVER_CERT_FILE: lab.otherServerCertFile,
    });
    expect(code).toBe(1);
    expect(log).toContain('FATAL: backend init failed');
    expect(log).toContain(
      'check SANDBOX_INCUS_ENDPOINT, the pinned server certificate',
    );
    // It never reached the API as a trusted client.
    expect(log).not.toContain('[sandbox.incus] Incus ');
  });

  step(
    'a client certificate the node does not trust is refused, with the fix',
    async () => {
      const dir = mkdtempSync(join(tmpdir(), 'incus-e2e-untrusted-'));
      const stranger = generateCertificate(dir, 'stranger', 'clientAuth');
      const { code, log } = await refusedBoot('untrusted', {
        SANDBOX_INCUS_CLIENT_CERT_FILE: stranger.cert,
        SANDBOX_INCUS_CLIENT_KEY_FILE: stranger.key,
      });
      expect(code).toBe(1);
      expect(log).toContain('does not trust this client certificate');
      expect(log).toContain(`--restricted --projects ${lab.project}`);
    },
  );

  step("a key that is not the certificate's is refused", async () => {
    const dir = mkdtempSync(join(tmpdir(), 'incus-e2e-key-'));
    const other = generateCertificate(dir, 'other', 'clientAuth');
    const { code, log } = await refusedBoot('wrong-key', {
      SANDBOX_INCUS_CLIENT_KEY_FILE: other.key,
    });
    expect(code).toBe(1);
    expect(log).toContain('is not the (unencrypted PEM) private key');
  });

  step('an endpoint where no node answers is refused in words', async () => {
    const { code, log } = await refusedBoot('no-node', {
      SANDBOX_INCUS_ENDPOINT: 'https://127.0.0.1:8444',
    });
    expect(code).toBe(1);
    expect(log).toContain('check SANDBOX_INCUS_ENDPOINT');
  });

  step(
    'a project the certificate is not restricted to is refused',
    async () => {
      const { code, log } = await refusedBoot('other-project', {
        SANDBOX_INCUS_PROJECT: 'default',
      });
      expect(code).toBe(1);
      expect(log).toContain('FATAL: backend init failed');
      expect(log).toContain('SANDBOX_INCUS_PROJECT');
    },
  );

  step('a profile that does not exist is refused by name', async () => {
    const { code, log } = await refusedBoot('no-profile', {
      SANDBOX_INCUS_PROFILE: 'no-such-profile',
    });
    expect(code).toBe(1);
    expect(log).toContain('Incus profile no-such-profile');
  });

  step(
    'a project limit on CPUs, which refuses every instance, is refused by name',
    async () => {
      await admin.setProject('limits.cpu', '8');
      try {
        const { code, log } = await refusedBoot('limits-cpu', {});
        expect(code).toBe(1);
        expect(log).toContain('limits.cpu');
      } finally {
        await admin.unsetProject('limits.cpu');
      }
    },
  );

  step(
    'a bridge that offers its whole subnet to DHCP is warned about, and the operator block’s is not',
    async () => {
      // The block's network has a pool of its own: no warning at a normal boot.
      port += 1;
      // These boots are about the network, not the image: no pull is started.
      const noPull = { SANDBOX_INCUS_IMAGE_SOURCE: undefined };
      const quiet = spawnerOf({
        name: 'dhcp-range-set',
        port,
        token: newToken(),
        env: noPull,
      });
      quiet.start();
      await quiet.ready();
      expect(quiet.logTail(200)).not.toContain('whole subnet');
      await quiet.stop();

      const ranges = (
        await admin.run(['network', 'get', lab.network, 'ipv4.dhcp.ranges'])
      ).stdout.trim();
      expect(ranges).not.toBe('');
      await admin.run(['network', 'unset', lab.network, 'ipv4.dhcp.ranges']);
      try {
        port += 1;
        const loud = spawnerOf({
          name: 'dhcp-range-unset',
          port,
          token: newToken(),
          env: noPull,
        });
        loud.start();
        await loud.ready();
        const log = loud.logTail(200);
        expect(log).toContain('whole subnet');
        expect(log).toContain('ipv4.dhcp.ranges');
        await loud.stop();
      } finally {
        await admin.run([
          'network',
          'set',
          lab.network,
          `ipv4.dhcp.ranges=${ranges}`,
        ]);
      }
    },
  );

  step(
    'the restricted certificate is trusted, and sees only its project',
    async () => {
      const server = await asSpawner('GET', '/1.0');
      expectStatus(server, 200, 'GET /1.0');
      expect(field(server.json, 'metadata', 'auth')).toBe('trusted');
      const extensions = field(server.json, 'metadata', 'api_extensions');
      expect(Array.isArray(extensions)).toBe(true);
      for (const required of [
        'instance_oci',
        'instance_oci_entrypoint',
        'oci_network_config',
        'instance_create_start',
        'storage_shifted',
        'storage_initial_owner',
        'storage_volumes_created_at',
        'container_disk_tmpfs',
      ]) {
        expect(extensions).toContain(required);
      }
      report.fact(
        'Incus',
        String(field(server.json, 'metadata', 'environment', 'server_version')),
      );
      report.fact(
        'Incus API extensions',
        String(Array.isArray(extensions) ? extensions.length : 0),
      );
      report.fact(
        'kernel features (restricted view)',
        JSON.stringify(
          field(server.json, 'metadata', 'environment', 'kernel_features') ??
            null,
        ),
      );

      const projects = await asSpawner('GET', '/1.0/projects');
      expectStatus(projects, 200, 'GET /1.0/projects');
      const listed = Array.isArray(field(projects.json, 'metadata'))
        ? field(projects.json, 'metadata')
        : [];
      expect(listed).toEqual([`/1.0/projects/${lab.project}`]);
    },
  );

  step(
    'the restricted certificate cannot make a project, change a pool or reach another project',
    async () => {
      const created = await asSpawner('POST', '/1.0/projects', {
        name: 'intruder',
      });
      expect([403, 404]).toContain(created.status);
      const pool = await asSpawner('PATCH', `/1.0/storage-pools/${lab.pool}`, {
        config: { rsync_bwlimit: '1' },
      });
      expect([403, 404]).toContain(pool.status);
      const trust = await asSpawner('POST', '/1.0/certificates', {
        name: 'intruder',
        type: 'client',
        certificate: readFileSync(lab.clientCertFile, 'utf8'),
      });
      expect([403, 404]).toContain(trust.status);
      // Lists are filtered, not refused: the default project holds the egress
      // proxy, and the restricted certificate must not see it.
      const other = await asSpawner('GET', '/1.0/instances?project=default');
      if (other.status === 200) {
        expect(other.text).not.toContain(lab.egressInstance);
        expect(field(other.json, 'metadata')).toEqual([]);
      } else {
        expect([403, 404]).toContain(other.status);
      }
      const foreign = await asSpawner(
        'GET',
        `/1.0/instances/${lab.egressInstance}?project=default`,
      );
      expect([403, 404]).toContain(foreign.status);
      const network = await asSpawner('PATCH', `/1.0/networks/${lab.network}`, {
        config: { 'ipv4.nat': 'false' },
      });
      expect([403, 404]).toContain(network.status);
      const names = (await admin.run(['network', 'show', lab.network])).stdout;
      expect(names).toContain('ipv4.nat: "true"');
    },
  );

  step(
    'a restricted project refuses a privileged container, raw LXC, swap, a host path and a NIC of its own',
    async () => {
      const attempts: [string, Record<string, unknown>][] = [
        ['privileged', { config: { 'security.privileged': 'true' } }],
        ['raw.lxc', { config: { 'raw.lxc': 'lxc.cap.drop=' } }],
        ['swap', { config: { 'limits.memory.swap': 'true' } }],
        [
          'host path',
          {
            devices: { host: { type: 'disk', source: '/etc', path: '/host' } },
          },
        ],
        [
          'own NIC',
          {
            devices: {
              eth0: { type: 'nic', nictype: 'bridged', parent: lab.network },
            },
          },
        ],
      ];
      for (const [name, extra] of attempts) {
        const instance = `refused-${name.replaceAll(/[^a-z]/g, '')}`;
        const reply = await asSpawner(
          'POST',
          `/1.0/instances?project=${lab.project}`,
          {
            name: instance,
            source: { type: 'image', alias: lab.image },
            profiles: [lab.profile],
            ...extra,
          },
        );
        // The refusal may come at the request or in the operation it starts.
        let refused = reply.status >= 400;
        if (!refused) {
          const operation = asText(field(reply.json, 'operation'));
          const waited = await asSpawner('GET', `${operation}/wait?timeout=60`);
          refused =
            Number(field(waited.json, 'metadata', 'status_code')) >= 400;
        }
        const exists = await admin.instance(instance);
        if (exists !== undefined) {
          await admin.run(
            ['delete', instance, '--project', lab.project, '--force'],
            { allowFailure: true },
          );
        }
        expect({
          attempt: name,
          refused,
          exists: exists !== undefined,
        }).toEqual({
          attempt: name,
          refused: true,
          exists: false,
        });
      }
    },
  );
});
