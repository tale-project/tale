#!/usr/bin/env bun
/**
 * Build-time CLI: precompile the SEO + LLM artifact set for a Tale
 * service.
 *
 *   tale-seo-compile <config-module> --out <dir>
 *
 * The config module default-exports an async factory returning the
 * `CompileToDiskParams` (minus `outDir`). The CLI calls the factory,
 * invokes `compileToDisk` to materialise every artifact + a
 * `manifest.json` index, and reports the emitted files. Exits non-zero
 * if the resulting set is empty — that signals a silently broken route
 * walk and would otherwise ship a 404'ing site.
 *
 * Wire into a service Dockerfile after `vite build` (for docs/platform)
 * or after `vite build --ssr` (for web, where bodies need SSR). The
 * runtime container then COPYs `<out>/` into its image and serves it
 * via `createPrecompiledServer({ dir })`.
 */

import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  compileToDisk,
  type CompileToDiskParams,
  type CompileToDiskResult,
} from '../src/runtime/compile';

interface CliArgs {
  configPath: string;
  outDir: string;
}

function parseArgs(argv: readonly string[]): CliArgs {
  if (argv.length === 0) usage('No config module provided.');
  let configPath = '';
  let outDir = '';
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--out' || arg === '-o') {
      outDir = argv[++i] ?? '';
    } else if (arg === '--help' || arg === '-h') {
      usage();
    } else if (!arg.startsWith('-')) {
      configPath = arg;
    } else {
      usage(`Unknown flag: ${arg}`);
    }
  }
  if (!configPath) usage('Missing config module path.');
  if (!outDir) usage('Missing --out <dir>.');
  return { configPath, outDir };
}

function usage(error?: string): never {
  if (error) console.error(`error: ${error}\n`);
  console.error(
    'usage: tale-seo-compile <config-module> --out <dir>\n\n' +
      '  <config-module>   Path to a TypeScript/JS module whose default export\n' +
      '                    is an async factory returning CompileToDiskParams\n' +
      '                    (minus `outDir`).\n' +
      '  --out, -o <dir>   Output directory for emitted files + manifest.json\n',
  );
  process.exit(error ? 1 : 0);
}

type ConfigFactory = () =>
  | Promise<Omit<CompileToDiskParams, 'outDir'>>
  | Omit<CompileToDiskParams, 'outDir'>;

interface ConfigModule {
  default?: ConfigFactory | Omit<CompileToDiskParams, 'outDir'>;
}

async function loadConfig(
  configPath: string,
): Promise<Omit<CompileToDiskParams, 'outDir'>> {
  const absolute = resolve(process.cwd(), configPath);
  const module: ConfigModule = await import(pathToFileURL(absolute).href);
  const exported = module.default;
  if (!exported) {
    throw new Error(
      `[seo] Config module ${configPath} must default-export a config object or async factory.`,
    );
  }
  return typeof exported === 'function' ? await exported() : exported;
}

async function main(): Promise<void> {
  const { configPath, outDir } = parseArgs(process.argv.slice(2));
  const absoluteOutDir = resolve(process.cwd(), outDir);

  const config = await loadConfig(configPath);
  const startedAt = Date.now();
  const result: CompileToDiskResult = await compileToDisk({
    ...config,
    outDir: absoluteOutDir,
  });

  const elapsed = Date.now() - startedAt;
  console.log(
    `[seo] compiled ${result.emittedFiles.length} files to ${absoluteOutDir} in ${elapsed}ms`,
  );
  for (const file of result.emittedFiles) console.log(`  ${file}`);
}

main().catch((error: unknown) => {
  console.error(`[seo] compile failed:`, error);
  process.exit(1);
});
