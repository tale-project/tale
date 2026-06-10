// In-Pod `stage` initContainer entry mode (runs the SPAWNER image).
//
// initContainers run to completion before the runner/harvest app containers
// start, so by the time user code runs the shared /workspace emptyDir is fully
// staged — no sentinel handshake needed. This reads the per-exec Secret, runs
// the SAME `stageWorkspace` the docker path uses (downloads code/inputs from
// presigned URLs, writes packages.json/options.json + the multi-step wrapper),
// and persists the prior-stage attestation + stage timing for the harvest
// container to forward back to the spawner.
//
// Fail-fast: a required `files[]` download failure makes `stageWorkspace`
// throw → this process exits non-zero → the initContainer fails → the Pod
// never starts the runner → the spawner surfaces PRE_STAGE_FAILED. Prior-output
// / user-upload fetch failures are non-fatal (recorded in priorStage.skipped).

import { readFile } from 'node:fs/promises';
import { mkdir, writeFile } from 'node:fs/promises';

import { stageWorkspace } from '../../exec-common.ts';
import { EXEC_SPEC_PATH, parseExecSpec } from './exec-spec.ts';
import { PRESTAGE_PATH, TALE_DIR, type PrestageFile } from './k8s-protocol.ts';

async function main(): Promise<void> {
  const raw = await readFile(EXEC_SPEC_PATH, 'utf8');
  const spec = parseExecSpec(raw);

  const startedAt = Date.now();
  const { priorStage } = await stageWorkspace('/workspace', spec.req);
  const stageMs = Date.now() - startedAt;

  // Persist for the harvest container (it forwards priorStage + stageMs into
  // the result line the spawner reads).
  await mkdir(TALE_DIR, { recursive: true });
  const prestage: PrestageFile = {
    stageMs,
    ...(priorStage !== undefined && { priorStage }),
  };
  await writeFile(PRESTAGE_PATH, JSON.stringify(prestage));

  console.log(
    `[sandbox.stage] staged execution ${spec.req.executionId} in ${stageMs}ms` +
      (priorStage
        ? ` (prior: ${priorStage.staged.length} staged, ${priorStage.skipped.length} skipped)`
        : ''),
  );
}

main().catch((err: unknown) => {
  console.error(
    '[sandbox.stage] fatal:',
    err instanceof Error ? (err.stack ?? err.message) : err,
  );
  process.exit(1);
});
