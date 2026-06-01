import { describe, expect, test } from 'bun:test';

import { setProjectId } from '../../project/project-context';
import type { ServiceConfig } from '../types';
import { createDbService } from './create-db-service';

// getProjectId() (used for container_name) throws unless the project context
// has been initialised, so seed it once for these unit tests.
setProjectId('test-project');

const config = {
  version: '0.2.17',
  registry: 'ghcr.io/tale-project',
} satisfies ServiceConfig;

describe('createDbService healthcheck', () => {
  // Regression tests for #1411: on a fresh volume the first `tale start` could
  // abort with "dependency failed to start: container ...-db is unhealthy"
  // because the db healthcheck reported ready (pg_isready) before the
  // background init scripts had finished and within too short a window.

  test('gates on the init-completion marker, not just pg_isready', () => {
    const command = createDbService(config).healthcheck?.test;
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
    expect(createDbService(config).healthcheck?.start_period).toBe('120s');
  });
});
