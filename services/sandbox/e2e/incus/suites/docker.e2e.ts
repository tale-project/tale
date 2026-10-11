// Docker inside a session (SANDBOX_DOCKER_IN_CONTAINER=true), against the real
// node: opt-in on this backend, because an OCI application container is not
// the system container Docker is usually run in. The project allows nesting and
// syscall interception for it (and for nothing else); the session starts as
// root, the inner engine comes up, and a nested container runs and is no freer
// than the session. If any of this cannot work on a real node, this suite is
// where that is found out.

import { afterAll, beforeAll, describe, expect } from 'bun:test';

import { LABEL, label } from '../../../src/backend/incus/incus-naming.ts';
import {
  admin,
  expectStatus,
  reportFor,
  sessionId,
  sessionInstance,
  sh,
  spawnerOf,
  step,
  until,
} from '../harness.ts';
import { newToken } from '../spawner.ts';

const report = reportFor('docker');
const spawner = spawnerOf({
  name: 'docker',
  port: 18030,
  token: newToken(),
  env: { SANDBOX_DOCKER_IN_CONTAINER: 'true', SANDBOX_MAX_SESSIONS: '2' },
});
const api = spawner.api;
const ORG = 'e2e-docker';
const ID = sessionId('dind');

// Docker Hub's anonymous pull limit is per address, and a hosted runner shares
// its address with the world: the mirror the rest of CI pulls from.
const HELLO = 'mirror.gcr.io/library/hello-world';
const ALPINE = 'mirror.gcr.io/library/alpine:3.20';

describe('Docker inside a session on a real node', () => {
  beforeAll(async () => {
    await admin.cleanSlate();
    await admin.setProject('restricted.containers.nesting', 'allow');
    await admin.setProject('restricted.containers.interception', 'allow');
    spawner.start();
    await spawner.ready({ image: true });
  }, 40 * 60_000);

  afterAll(async () => {
    await spawner.stop();
    await admin.cleanSlate();
    for (const key of [
      'restricted.containers.nesting',
      'restricted.containers.interception',
    ]) {
      await admin.unsetProject(key).catch((error: unknown) => {
        console.warn(`${key} was not set:`, error);
      });
    }
    report.flush();
  });

  step(
    'the session starts as root with nesting and the interceptions Docker needs',
    async () => {
      const created = await api.create({
        sessionId: ID,
        organizationId: 'e2e-docker',
        profile: 'agent',
        docker: true,
      });
      expectStatus(created.reply, 201, 'create with Docker inside');
      report.add('cold create with Docker inside', created.elapsedMs);
      const instance = await sessionInstance(ID);
      if (instance === undefined) throw new Error('no instance');
      const config = instance.config;
      expect(label(config, LABEL.docker)).toBe('true');
      expect(config['security.nesting']).toBe('true');
      expect(config['security.syscalls.intercept.mknod']).toBe('true');
      expect(config['security.syscalls.intercept.setxattr']).toBe('true');
      expect(config['oci.uid']).toBe('0');
      // Docker's runtime needs to grow privileges: no no_new_privs wrapper.
      expect(config['oci.entrypoint']).toBe('/docker-entrypoint.sh daemon');
      expect(config['environment.TALE_DIND']).toBe('1');
      // The agent's own commands still run as the session user.
      expect((await sh(api, ID, 'id -u')).trim()).toBe('10001');
    },
  );

  step('the inner engine comes up', async () => {
    const started = performance.now();
    const version = await until(
      'the inner dockerd to answer',
      async () => {
        const outcome = await api.exec(ID, {
          shell: 'docker version --format "{{.Server.Version}}"',
          timeoutMs: 60_000,
        });
        return outcome.result?.status === 'completed'
          ? outcome.stdout.trim()
          : undefined;
      },
      { timeoutMs: 5 * 60_000, intervalMs: 3_000 },
    );
    report.add(
      'inner dockerd answers (after the session is ready)',
      performance.now() - started,
      `Docker ${version}`,
    );
    expect(version).toMatch(/^[0-9]+\.[0-9]+/);
  });

  step(
    'docker run works: pulled through the proxy, run in a nested container',
    async () => {
      const started = performance.now();
      const hello = await api.exec(ID, {
        shell: `docker run --rm ${HELLO}`,
        timeoutMs: 300_000,
        clientTimeoutMs: 320_000,
      });
      report.add(
        'docker run hello-world (pull and run)',
        performance.now() - started,
      );
      expect(hello.stdout + hello.stderr).toContain('Hello from Docker!');
      expect(hello.result?.exitCode).toBe(0);
    },
  );

  step('docker build works', async () => {
    const started = performance.now();
    const built = await api.exec(ID, {
      shell: `mkdir -p /agent/build && cd /agent/build && printf 'FROM ${ALPINE}\\nRUN echo built-in-a-session > /proof\\nCMD ["cat", "/proof"]\\n' > Dockerfile && docker build -q -t e2e-build . && docker run --rm e2e-build`,
      timeoutMs: 400_000,
      clientTimeoutMs: 420_000,
    });
    report.add('docker build and run', performance.now() - started);
    expect(built.result?.exitCode).toBe(0);
    expect(built.stdout).toContain('built-in-a-session');
  });

  step('a nested container is no freer than the session', async () => {
    const reachable = await api.exec(ID, {
      shell: `docker run --rm ${ALPINE} sh -c 'nc -z -w 4 1.1.1.1 53 && echo reachable || echo blocked'`,
      timeoutMs: 120_000,
    });
    expect(reachable.stdout.trim()).toBe('blocked');
    const proxied = await api.exec(ID, {
      shell: `docker run --rm ${ALPINE} sh -c 'nc -z -w 4 10.20.0.1 8443 && echo reachable || echo blocked'`,
      timeoutMs: 120_000,
    });
    expect(proxied.stdout.trim()).toBe('blocked');
  });

  step(
    'stop removes the inner engine with the instance; destroy removes the workspace',
    async () => {
      expectStatus(await api.stop(ID), 200, 'stop');
      expect(await sessionInstance(ID)).toBeUndefined();
      expectStatus(await api.destroy(ID), 200, 'destroy');
    },
  );
});
