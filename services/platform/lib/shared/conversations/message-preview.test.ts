import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { expect, it } from 'vitest';

it('loads the shared preview cleaner in the unbundled Node backend', () => {
  const result = spawnSync(
    'node',
    [
      '--experimental-transform-types',
      '--disable-warning=ExperimentalWarning',
      '--import',
      './backend/node-loader.mjs',
      '--input-type=module',
      '--eval',
      `import { cleanMessagePreview } from './lib/shared/conversations/message-preview.ts';
       process.stdout.write(cleanMessagePreview('<style>hidden</style><p>Hello &amp; &lt;123456&gt;</p>'));`,
    ],
    {
      cwd: fileURLToPath(new URL('../../../', import.meta.url)),
      encoding: 'utf8',
      timeout: 10_000,
    },
  );
  expect(result.error).toBeUndefined();
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toBe('Hello & <123456>');
});
