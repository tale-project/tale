import { acquireLock } from '../../src/lib/state/acquire-lock';
import { releaseLock } from '../../src/lib/state/release-lock';
import {
  configureOutput,
  resolveOutputMode,
} from '../../src/utils/output-mode';

configureOutput(resolveOutputMode({ json: true }));
const directory = process.argv[2];
if (!directory) throw new Error('Missing fixture directory');
const acquired = await acquireLock(directory, 'lock fixture');
process.stdout.write(`${JSON.stringify({ acquired, pid: process.pid })}\n`);
if (acquired) {
  for await (const _chunk of process.stdin) break;
  await releaseLock(directory);
}
