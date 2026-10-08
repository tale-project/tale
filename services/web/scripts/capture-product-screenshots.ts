import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  PRODUCT_SCREENSHOTS,
  PRODUCT_SCREENSHOT_LOCALES,
} from '../app/content/product-screenshots';

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../..',
);

/** Forward capture options as argv, keeping each state/config path intact. */
export function productCaptureArgs(argv: readonly string[]): string[] {
  const forwarded = argv.filter((arg) => arg !== '--');
  const defaults: string[] = [];
  if (!forwarded.includes('--locales')) {
    defaults.push('--locales', PRODUCT_SCREENSHOT_LOCALES.join(','));
  }
  if (!forwarded.includes('--only')) {
    defaults.push(
      '--only',
      [
        ...new Set(
          Object.values(PRODUCT_SCREENSHOTS).map(({ source }) => source),
        ),
      ].join(','),
    );
  }
  return [...defaults, ...forwarded];
}

type RunCommand = (command: readonly string[]) => Promise<number>;

function runCommand(command: readonly string[]): Promise<number> {
  const [executable, ...args] = command;
  if (!executable) throw new Error('Missing screenshot command executable');
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd: REPO_ROOT, stdio: 'inherit' });
    child.once('error', reject);
    child.once('close', (code) => resolve(code ?? 1));
  });
}

/** Use the docs runner first; only optimize real captures after it succeeds. */
export async function captureProductScreenshots(
  argv: readonly string[],
  run: RunCommand = runCommand,
): Promise<number> {
  const status = await run([
    process.execPath,
    path.join(REPO_ROOT, 'services/platform/tests/docs-screenshots/capture.ts'),
    ...productCaptureArgs(argv),
  ]);
  if (status !== 0 || argv.includes('--list')) return status;
  return run([
    process.execPath,
    'run',
    '--filter',
    '@tale/web',
    'optimize-images',
    '--product-screens',
  ]);
}

if (import.meta.main) {
  captureProductScreenshots(process.argv.slice(2))
    .then((status) => {
      process.exitCode = status;
    })
    .catch((error: unknown) => {
      console.error('web:screenshots failed:', error);
      process.exitCode = 1;
    });
}
