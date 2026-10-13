// @vitest-environment node

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * Who ends a coding agent's connection without telling the person
 * [AGCONN-R20]. `endAgentConnectionsInTx` is the quiet ending: the stamp, the
 * sign-in the agent loses, the audit row and the hint, and no notice. The
 * ending the person is told of — a refresh token used twice, a changed
 * password, an admin's disconnect — is `endAgentConnectionsAndTellInTx`
 * (`end-and-tell.ts`), and it is the one to reach for.
 *
 * So only the two endings that must tell nobody may call the quiet one: the
 * membership cascade (a person who left can no longer read that
 * organization's bell) and the erasure pass (which removes every trace of
 * the person and writes none anew), and the telling ending that wraps it.
 * A new way to end an agent is therefore told to the person unless someone
 * decides here that it must not be.
 */

const BACKEND = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../backend',
);
const QUIET_ENDING = /\bendAgentConnectionsInTx\b/;
const ENDERS_THAT_TELL_NOBODY = new Set([
  'auth/membership.ts',
  'domains/agent_connections/end-and-tell.ts',
  'domains/agent_connections/end.ts',
  'domains/erasure/service.ts',
]);

function sources(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...sources(full));
    else if (
      entry.name.endsWith('.ts') &&
      !entry.name.includes('.test.') &&
      !entry.name.includes('integration')
    ) {
      found.push(full);
    }
  }
  return found;
}

describe('ending a coding agent’s connection without telling the person', () => {
  it('is done only by the membership cascade and the erasure pass', () => {
    const quiet = sources(BACKEND)
      .filter((file) => QUIET_ENDING.test(readFileSync(file, 'utf8')))
      .map((file) => path.relative(BACKEND, file).split(path.sep).join('/'))
      .sort();
    expect(quiet).toEqual([...ENDERS_THAT_TELL_NOBODY].sort());
  });
});
