import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

import { createAnthropicProvider } from './anthropic';
import { createOpenAiProvider } from './openai';

const run = promisify(execFile);
const TOKEN = "access'$(printf expanded);$SHOULD_NOT_EXPAND";
const ACCOUNT = "account'$(printf expanded);$SHOULD_NOT_EXPAND";

/** Run the copied shell command against a local CLI recorder, never a vendor. */
async function capture(command: string): Promise<unknown> {
  const directory = await mkdtemp(join(tmpdir(), 'tale-gateway-command-'));
  try {
    const inspector = join(directory, 'inspect.cjs');
    await writeFile(
      inspector,
      `console.log(JSON.stringify({
      oauth: process.env.CLAUDE_CODE_OAUTH_TOKEN,
      bearer: process.env.ANTHROPIC_AUTH_TOKEN,
      anthropicKey: process.env.ANTHROPIC_API_KEY,
      token: process.env.TALE_SUBSCRIPTION_TOKEN,
      account: process.env.TALE_SUBSCRIPTION_ACCOUNT_ID,
      codexIdentity: process.env.CODEX_ACCESS_TOKEN,
      codexKey: process.env.CODEX_API_KEY,
      openaiKey: process.env.OPENAI_API_KEY,
      args: process.argv.slice(2),
    }));`,
    );
    for (const name of ['claude', 'codex']) {
      await writeFile(
        join(directory, name),
        '#!/bin/sh\nexec "$TALE_TEST_NODE" "$TALE_TEST_INSPECT" "$@"\n',
        { mode: 0o700 },
      );
    }
    const { stdout } = await run('sh', ['-c', command], {
      env: {
        PATH: `${directory}${delimiter}${process.env['PATH'] ?? ''}`,
        TALE_TEST_NODE: process.execPath,
        TALE_TEST_INSPECT: inspector,
        SHOULD_NOT_EXPAND: 'expanded',
        ANTHROPIC_AUTH_TOKEN: 'managed-bearer',
        ANTHROPIC_API_KEY: 'managed-api-key',
        CODEX_ACCESS_TOKEN: 'managed-identity',
        CODEX_API_KEY: 'managed-codex-key',
        OPENAI_API_KEY: 'managed-openai-key',
      },
    });
    return JSON.parse(stdout);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

describe('copied subscription commands', () => {
  it('passes the Claude OAuth token literally and removes competing credentials', async () => {
    const result = await capture(createAnthropicProvider().cliCommand(TOKEN));
    expect(result).toMatchObject({ oauth: TOKEN, args: [] });
    expect(result).not.toHaveProperty('bearer');
    expect(result).not.toHaveProperty('anthropicKey');
  });

  it('passes the ChatGPT token and account literally through environment variables', async () => {
    const result = await capture(
      createOpenAiProvider().cliCommand(TOKEN, ACCOUNT),
    );
    expect(result).toMatchObject({
      token: TOKEN,
      account: ACCOUNT,
      args: expect.arrayContaining([
        'model_provider="tale-subscription"',
        'model_providers.tale-subscription.env_http_headers={"ChatGPT-Account-ID"="TALE_SUBSCRIPTION_ACCOUNT_ID"}',
      ]),
    });
    expect(result).not.toHaveProperty('codexIdentity');
    expect(result).not.toHaveProperty('codexKey');
    expect(result).not.toHaveProperty('openaiKey');
  });
});
