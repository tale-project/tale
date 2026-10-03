import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

export function geminiPayload(
  prefix: string,
  options: {
    managed?: boolean;
    browser?: boolean;
    bridgeUrl?: string;
    prompt?: string;
    instructions?: string | null;
  } = {},
): string {
  const dir = join(prefix, 'share/tale/gemini-settings');
  for (const name of readdirSync(dir)) {
    const settings = JSON.parse(readFileSync(join(dir, name), 'utf8'));
    if (
      Boolean(settings.security) !== (options.managed ?? false) ||
      Boolean(settings.mcpServers?.playwright) !== (options.browser ?? false) ||
      Boolean(settings.mcpServers?.connectors) !== Boolean(options.bridgeUrl)
    )
      continue;
    delete settings.context;
    if (options.bridgeUrl)
      settings.mcpServers.connectors.env.TALE_CONNECTORS_URL =
        options.bridgeUrl;
    return JSON.stringify({
      prompt: options.prompt ?? 'p',
      system_prompt:
        options.instructions === undefined ? 'be brief' : options.instructions,
      settings,
    });
  }
  throw new Error('Missing generated Gemini policy');
}

/** Install the wrapper and run the real image policy generator into a test
 * prefix. The image test owns root ownership/CLI precedence. A subprocess
 * also keeps the platform's types out of the daemon's stricter type project. */
export function installGeminiWrapper(prefix: string): string {
  const bin = join(prefix, 'bin');
  const policies = join(prefix, 'share/tale/gemini-settings');
  mkdirSync(bin, { recursive: true });
  const wrapper = join(bin, 'tale-gemini-run');
  copyFileSync(resolve(import.meta.dir, '../../tale-gemini-run'), wrapper);
  const built = spawnSync(
    process.execPath,
    [resolve(import.meta.dir, '../../build-gemini-settings.ts'), policies],
    { encoding: 'utf8' },
  );
  if (built.status !== 0)
    throw new Error(`Gemini policy build failed: ${built.stderr}`);
  return wrapper;
}
