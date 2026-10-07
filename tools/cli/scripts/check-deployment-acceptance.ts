/** Real-Postgres proof inside the existing backend integration fixture. The
 * caller owns startup/migrations/cleanup; this reader never changes its state. */
import { fileURLToPath } from 'node:url';

import { git } from '../src/lib/config/releases/git';
import {
  acceptedMigrations,
  acceptanceMigrationScript,
} from '../src/lib/deployment/acceptance-migrations';
import { runtimeProcessEnvironment } from '../src/lib/deployment/runtime-command';
import { sourceMigrationInventory } from '../src/lib/deployment/source-migrations';
import { exec } from '../src/lib/docker/exec';

const container = process.argv[2];
if (!container || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(container))
  throw new Error('Provide the owned backend integration container name.');
const root = fileURLToPath(new URL('../../../', import.meta.url));
const revision = git(root, 'rev-parse', 'HEAD').toString().trim();
const inventory = sourceMigrationInventory(root, revision);
const read = async (service: 'db' | 'knowledge-db') => {
  const result = await exec('docker', ['exec', '-i', container, 'sh', '-s'], {
    stdin: acceptanceMigrationScript(service),
    silent: true,
    timeout: 15,
    maxOutputBytes: 1_048_576,
    env: runtimeProcessEnvironment(),
  });
  if (!result.success)
    throw new Error('The native acceptance ledger reader failed.');
  return result.stdout;
};
const app = await read('db');
const knowledge = await read('knowledge-db');
const receipt = acceptedMigrations(inventory, app, knowledge);
if (app !== (await read('db')) || knowledge !== (await read('knowledge-db')))
  throw new Error('The native acceptance ledgers changed between reads.');
console.log(
  JSON.stringify({
    check: 'deployment-acceptance-ledgers',
    revision,
    ledgers: receipt.map((ledger) => ({
      service: ledger.service,
      schema: ledger.schema,
      count: ledger.ids.length,
      inventorySha256: ledger.inventorySha256,
    })),
  }),
);
