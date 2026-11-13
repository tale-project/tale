import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse } from 'yaml';

import { buildDevCompose } from '../../../compose/generators/generate-dev-compose';
import { setProjectId } from '../../../project/project-context';
import { SINGLETON_OFFSETS, SLOT_ROLES } from './address-plan';
import {
  colourDocument,
  HOST,
  PROJECT_ID,
  SERVICE_CONFIG,
  statefulDocument,
} from './compile-fixture';
import { PLACEMENT, servicePlacementNames, STOP_GROUPS } from './placement';

/**
 * The guard of the placement table: its service rows are exactly the services
 * of every compose document the stack runs from (the generated stateful,
 * colour and dev documents, and the repository's compose.yml, from which a
 * managed bundle is prepared). A new service without a row, or a row left
 * behind by a removed service, fails here.
 */

const REPOSITORY_COMPOSE = fileURLToPath(
  new URL('../../../../../../../compose.yml', import.meta.url),
);

function composeServices(): Record<string, string[]> {
  const directory = mkdtempSync(join(tmpdir(), 'tale-placement-'));
  try {
    setProjectId(PROJECT_ID);
    const dev = buildDevCompose(SERVICE_CONFIG, HOST, 3000, {
      projectDir: directory,
    });
    const repository = parse(readFileSync(REPOSITORY_COMPOSE, 'utf8')) as {
      services: Record<string, unknown>;
    };
    return {
      stateful: Object.keys(statefulDocument().services),
      blue: Object.keys(colourDocument('blue').services),
      green: Object.keys(colourDocument('green').services),
      dev: Object.keys(dev.services),
      'compose.yml': Object.keys(repository.services),
    };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

describe('the placement table and the compose documents agree', () => {
  test('every service of every document has a row', () => {
    const rows = new Set(servicePlacementNames());
    for (const [document, services] of Object.entries(composeServices()))
      for (const service of services)
        expect(rows.has(service), `${document}: ${service} has no row`).toBe(
          true,
        );
  });

  test('every service row has a service in some document', () => {
    const services = new Set(Object.values(composeServices()).flat());
    for (const row of servicePlacementNames())
      expect(services.has(row), `${row} is in no compose document`).toBe(true);
  });

  test("the repository's compose.yml holds every row", () => {
    expect(composeServices()['compose.yml']?.sort()).toEqual(
      servicePlacementNames(),
    );
  });

  test('every row has an address of the plan, and the colour roles have slots', () => {
    const singletons = new Set(Object.keys(SINGLETON_OFFSETS));
    for (const [name, row] of Object.entries(PLACEMENT)) {
      if ('slot' in row.address)
        expect(SLOT_ROLES, name).toContain(row.address.slot);
      else expect(singletons.has(row.address.singleton), name).toBe(true);
    }
    const singletonHolders = Object.values(PLACEMENT).flatMap((row) =>
      'singleton' in row.address ? [row.address.singleton] : [],
    );
    expect(new Set(singletonHolders).size).toBe(singletonHolders.length);
  });

  test('stop priorities use the three groups alone (R3-05)', () => {
    for (const [name, row] of Object.entries(PLACEMENT))
      expect(Object.values(STOP_GROUPS), name).toContain(row.stop);
  });
});
