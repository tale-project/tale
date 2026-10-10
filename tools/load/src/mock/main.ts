/**
 * `mock` as a command: start the realistic mock AI provider, in one process
 * or as a `node:cluster` of workers sharing the port, and keep it up until
 * SIGINT/SIGTERM.
 */

import { Command, Option } from 'commander';

import { startMockCluster } from './cluster.ts';
import {
  MOCK_OPTION_DESCRIPTIONS,
  MOCK_OPTION_KEYS,
  type MockOptionKey,
  type MockOptionsInput,
  mockEnvName,
  parseMockOptions,
} from './config.ts';
import { createMockServer } from './server.ts';

/** `ttftP95Ms` → `--ttft-p95-ms`, `rate429` → `--rate-429`. */
function flagName(key: MockOptionKey): string {
  return key
    .replace(/([a-z])([A-Z0-9])/g, '$1-$2')
    .replace(/([0-9])([A-Z])/g, '$1-$2')
    .toLowerCase();
}

/** Wait for a termination signal, then run `close` once. */
function closeOnSignal(close: () => Promise<void>): Promise<void> {
  return new Promise((resolve) => {
    let closing = false;
    const stop = (signal: NodeJS.Signals): void => {
      if (closing) return;
      closing = true;
      console.log(`tale-load mock stopping (${signal})`);
      close().then(resolve, (error: unknown) => {
        console.error('tale-load mock failed to stop cleanly:', error);
        resolve();
      });
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  });
}

/**
 * Start the mock with resolved options and serve until a signal arrives.
 * Prints exactly one `tale-load mock listening on <url>` line once it
 * accepts requests, so a supervisor can wait for it.
 */
async function runMockCommand(input: MockOptionsInput): Promise<void> {
  const options = parseMockOptions(input);
  if (options.processes > 1) {
    const cluster = await startMockCluster(options);
    console.log(
      `tale-load mock listening on ${cluster.url} (${cluster.workers} workers, metrics ${cluster.metricsUrl}/metrics)`,
    );
    await closeOnSignal(() => cluster.close());
    return;
  }
  const server = await createMockServer(options);
  console.log(`tale-load mock listening on ${server.url}`);
  await closeOnSignal(() => server.close());
}

export function createMockCommand(): Command {
  const command = new Command('mock').description(
    'Serve a realistic OpenAI- and Anthropic-compatible mock model provider',
  );
  for (const key of MOCK_OPTION_KEYS) {
    command.addOption(
      new Option(
        `--${flagName(key)} <value>`,
        `${MOCK_OPTION_DESCRIPTIONS[key]} (env ${mockEnvName(key)})`,
      ),
    );
  }
  command.action(async (flags: Record<string, string | undefined>) => {
    const input: MockOptionsInput = {};
    for (const key of MOCK_OPTION_KEYS) {
      const value = flags[key];
      if (value !== undefined) input[key] = value;
    }
    await runMockCommand(input);
  });
  return command;
}
