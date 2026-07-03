import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * Guard: the `run_code` tool must advertise the sandbox's REAL container
 * layout, never a non-existent `/workspace/*` path.
 *
 * The sandbox host dir is bind-mounted at `/user` (docker) / the shared
 * `/user` emptyDir (k8s, `WORKSPACE_MOUNT = '/user'`). Inside the container
 * the run_code model uses `/user/code` (cwd), `/user/uploads`, and
 * `/user/output` — and the spawner harvests ONLY `/user/output`
 * (`services/sandbox/src/exec-common.ts`). There is no bare `/workspace`.
 *
 * The tool description and the "no output files were harvested" hint the
 * model reads previously said `/workspace/output/`, so a model that followed
 * them wrote deliverables to a path that does not exist and were silently
 * discarded. This test locks every model-facing string in the tool to the
 * real dirs so the prompt cannot drift back.
 */
const runCodeToolSource = readFileSync(
  fileURLToPath(
    new URL('../convex/agent_tools/run_code_tool.ts', import.meta.url),
  ),
  'utf8',
);

describe('run_code tool — container path contract', () => {
  it.each(['/workspace/code', '/workspace/output', '/workspace/uploads'])(
    'never advertises the non-existent container path %s',
    (badPath) => {
      expect(runCodeToolSource).not.toContain(badPath);
    },
  );

  it('points deliverables at the real harvest dir /user/output', () => {
    expect(runCodeToolSource).toContain('/user/output');
  });
});
