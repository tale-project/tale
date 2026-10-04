import assert from 'node:assert/strict';

import { json, outputPath } from './common.ts';
import {
  cleanupLinuxResources,
  createResourcePlan,
} from './linux-resources.ts';
import { nativeIO } from './resource-io.ts';

const token = await nativeIO.readFile(outputPath('resource-token'));
if (token !== undefined) {
  const plan = createResourcePlan(process.env.BENCH_OUTPUT!, token.trim());
  const result = await cleanupLinuxResources(nativeIO, plan);
  await json('cleanup-final.json', result);
  assert(
    result.ok,
    'Owned diagnostic cleanup failed; inspect cleanup-final.json',
  );
}
