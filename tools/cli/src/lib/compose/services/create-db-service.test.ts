import { describe, expect, test } from 'bun:test';

import { setProjectId } from '../../project/project-context';
import type { ServiceConfig } from '../types';
import { askedDbProfile, createDbService } from './create-db-service';

// getProjectId() (used for container_name) throws unless the project context
// has been initialised, so seed it once for these unit tests.
setProjectId('test-project');

const config = {
  version: '0.2.17',
  registry: 'ghcr.io/tale-project',
} satisfies ServiceConfig;

describe('createDbService healthcheck', () => {
  // Regression tests for #1411: on a fresh volume the first `tale dev` could
  // abort with "dependency failed to start: container ...-db is unhealthy"
  // because the db healthcheck reported ready (pg_isready) before the
  // background init scripts had finished and within too short a window.

  test('gates on the init-completion marker, not just pg_isready', () => {
    const healthcheck = createDbService(config).healthcheck;
    const command =
      healthcheck !== undefined && 'test' in healthcheck
        ? healthcheck.test
        : undefined;
    if (!Array.isArray(command)) {
      throw new Error('db healthcheck test should be a CMD-SHELL array');
    }
    const shell = command.join(' ');
    expect(shell).toContain('pg_isready');
    // The tale-db image touches /tmp/.db_ready only after init completes, so
    // dependents can't race the bootstrap (matches the canonical compose.yml).
    expect(shell).toContain('/tmp/.db_ready');
  });

  test('allows a cold-boot-sized start_period', () => {
    // 60s was too short for first-boot initdb + extensions + migrations on a
    // slow disk; align with the canonical compose.yml window.
    const healthcheck = createDbService(config).healthcheck;
    expect(
      healthcheck !== undefined && 'start_period' in healthcheck
        ? healthcheck.start_period
        : undefined,
    ).toBe('120s');
  });
});

describe('createDbService knowledge-db alias', () => {
  // The single-node CLI stack has no separate `knowledge-db` service: the
  // in-process RAG/crawler code (getKnowledgeDatabaseUrl) defaults to host
  // `knowledge-db`, so this service must answer to that DNS name or knowledge
  // search/indexing can't reach its corpus in a `tale deploy`
  // deployment.
  test('exposes a knowledge-db network alias so the runtime default resolves', () => {
    const networks = createDbService(config).networks;
    if (Array.isArray(networks) || networks === undefined) {
      throw new Error('db networks should be the object form with aliases');
    }
    expect(networks.internal?.aliases).toContain('knowledge-db');
  });
});

describe('createDbService shutdown', () => {
  // A crash-mode stop left a never-initialised page in pg_search's BM25 index
  // (PANIC on every knowledge insert). Docker's default SIGTERM is Postgres'
  // *smart* shutdown, which waits for every client session and gets SIGKILLed
  // after the grace period whenever a client holds a connection; SIGINT is the
  // *fast* shutdown that disconnects clients, checkpoints, and exits cleanly.
  test('stops Postgres with SIGINT (fast shutdown), not the SIGTERM default', () => {
    expect(createDbService(config).stop_signal).toBe('SIGINT');
  });

  test('keeps the checkpoint window before SIGKILL', () => {
    expect(createDbService(config).stop_grace_period).toBe('60s');
  });
});

describe('createDbService profile', () => {
  // The image alone takes the standard profile; the deployment `tale deploy`
  // starts is the one that must fit a small host.
  test('asks the image for the small profile unless .env names another', () => {
    expect(createDbService(config).environment).toEqual({
      DB_PROFILE: '${DB_PROFILE:-small}',
    });
    // The DB_ sizes of .env reach the container with the rest of the file.
    expect(createDbService(config).env_file).toEqual(['.env']);
  });

  test('reads the profile a deployment asked for, small where it named none', () => {
    expect(askedDbProfile(() => undefined)).toBe('small');
    expect(askedDbProfile(() => '')).toBe('small');
    expect(askedDbProfile(() => '  ')).toBe('small');
    expect(askedDbProfile(() => 'small')).toBe('small');
    expect(askedDbProfile(() => 'standard')).toBe('standard');
    expect(askedDbProfile(() => ' standard ')).toBe('standard');
    expect(
      askedDbProfile((name) => (name === 'DB_PROFILE' ? 'standard' : 'x')),
    ).toBe('standard');
  });

  test.each(['tiny', 'Small', 'large', '1'])(
    'refuses a word that is no profile (%p)',
    (asked) => {
      expect(() => askedDbProfile(() => asked)).toThrow(
        `DB_PROFILE must be small, standard, or unset; got: ${JSON.stringify(asked)}`,
      );
    },
  );
});
