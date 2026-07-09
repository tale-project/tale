import { describe, expect, it } from 'vitest';

import { QUICKSTART_COMMANDS } from './quickstart-terminal';

describe('QUICKSTART_COMMANDS', () => {
  it('matches the docs quickstart sequence including cd', () => {
    expect([...QUICKSTART_COMMANDS]).toEqual([
      'curl -fsSL https://raw.githubusercontent.com/tale-project/tale/main/scripts/install-cli.sh | bash',
      'tale init my-project',
      'cd my-project',
      'tale dev',
    ]);
  });
});
