import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { expect, it } from 'vitest';

// The backend runs unbundled under Node, whose loader never resolves a UI
// module (`.tsx`). The mention grammar and scanner it saves every comment
// with come from `@tale/ui`, so they must load there, not only under Bun.
it('loads the mention scanner and grammar in the unbundled Node backend', () => {
  const result = spawnSync(
    'node',
    [
      '--experimental-transform-types',
      '--disable-warning=ExperimentalWarning',
      '--import',
      './backend/node-loader.mjs',
      '--input-type=module',
      '--eval',
      `import { normalizeMentionText } from './backend/core/tasks/mentions.ts';
       import { buildMentionHandleIndex, memberMentionEntry } from './lib/shared/mention-handles.ts';
       const index = buildMentionHandleIndex([memberMentionEntry({ id: 'u-ada', name: 'Ada Lovelace', email: 'ada@example.com' })]);
       const result = normalizeMentionText({ body: '**@ada** check, \`@ada\` is code, $5 and $10', index, cap: 1000, mode: 'full' });
       process.stdout.write(result.text);`,
    ],
    {
      cwd: fileURLToPath(new URL('../../../', import.meta.url)),
      encoding: 'utf8',
      timeout: 20_000,
    },
  );
  expect(result.error).toBeUndefined();
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toBe(
    '**[@Ada Lovelace](mention:user/u-ada)** check, `@ada` is code, $5 and $10',
  );
});
