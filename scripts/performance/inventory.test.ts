import { expect, test } from 'bun:test';

import { workspaceInventory } from './inventory';
import { optionalWorkloads, workloadRuntimes } from './workloads';

test('every current workspace has an explicit performance lane', async () => {
  const inventory = await workspaceInventory(
    new Set(Object.keys(workloadRuntimes)),
    new Set(),
  );
  expect(inventory.length).toBeGreaterThan(0);
  expect(inventory.find((entry) => entry.name === '@tale/web')?.status).toBe(
    'shared-library-only',
  );
  expect(inventory.find((entry) => entry.name === '@tale/db')?.status).toBe(
    'not-measured',
  );
  expect(inventory.every((entry) => entry.remaining.length > 0)).toBe(true);
});

test('a filtered run never marks unexecuted workloads as measured', async () => {
  const inventory = await workspaceInventory(
    new Set(['shared.lines']),
    new Set(),
  );
  expect(inventory.find((entry) => entry.name === '@tale/shared')?.status).toBe(
    'measured-hot-path',
  );
  expect(
    inventory.find((entry) => entry.name === '@tale/platform')?.status,
  ).toBe('not-measured');
});

test('shared HTTP serving does not count as a gateway workload', async () => {
  const inventory = await workspaceInventory(
    new Set(['ui.static-http']),
    new Set(),
  );
  expect(inventory.find((entry) => entry.name === '@tale/ui')?.status).toBe(
    'measured-hot-path',
  );
  expect(
    inventory.find((entry) => entry.name === '@tale/ai-gateway'),
  ).toMatchObject({
    status: 'not-measured',
    workloads: [],
  });
});

test('default tooling coverage excludes the opt-in scanner', async () => {
  const measured = new Set(
    Object.keys(workloadRuntimes).filter((id) => !optionalWorkloads.has(id)),
  );
  const inventory = await workspaceInventory(measured, new Set());
  expect(inventory.find((entry) => entry.name === '@tale/plop')).toMatchObject({
    status: 'measured-hot-path',
    workloads: ['tools.plop-scaffold'],
  });
  expect(
    inventory.find((entry) => entry.name === '@tale/opengrep'),
  ).toMatchObject({
    status: 'not-measured',
    workloads: [],
  });
  const optedIn = await workspaceInventory(
    new Set(['tools.opengrep']),
    new Set(),
  );
  expect(
    optedIn.find((entry) => entry.name === '@tale/opengrep'),
  ).toMatchObject({
    status: 'measured-hot-path',
    workloads: ['tools.opengrep'],
  });
});

test('only known workspaces can be assigned real HTTP measurements', async () => {
  await expect(
    workspaceInventory(new Set(), new Set(['@tale/unknown'])),
  ).rejects.toThrow('Unknown HTTP target workspace');
  const inventory = await workspaceInventory(new Set(), new Set(['@tale/web']));
  expect(inventory.find((entry) => entry.name === '@tale/web')?.status).toBe(
    'measured-http',
  );
});
