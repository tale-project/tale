// Build the in-page instrument IIFE in memory, on demand, with Bun. The browser
// cannot run TypeScript or ESM imports from a string, so the instrument is the
// one piece that must become a self-contained classic script — but there is no
// committed `.js` and no build step: Bun transpiles + bundles it here at
// runtime, and the result is cached for the process.

let cached: string | null = null;

/**
 * Turn a Bun build result into the bundle string, or throw on a failed build or
 * empty output. Split out and structurally typed so both error paths are
 * reachable from a unit test without provoking a real build failure.
 */
export async function readBuildOutput(result: {
  success: boolean;
  logs: readonly object[];
  outputs: readonly { text(): Promise<string> }[];
}): Promise<string> {
  if (!result.success) {
    for (const log of result.logs) console.error(log);
    throw new Error('failed to build the instrument bundle');
  }
  const output = result.outputs[0];
  if (!output) throw new Error('instrument bundle produced no output');
  return output.text();
}

/** The instrument as a browser IIFE string, ready for `page.addInitScript`. */
export async function buildInstrumentBundle(): Promise<string> {
  if (cached !== null) return cached;
  const entry = new URL('./instrument-global.ts', import.meta.url).pathname;
  const result = await Bun.build({
    entrypoints: [entry],
    target: 'browser',
    format: 'iife',
    minify: false,
  });
  cached = await readBuildOutput(result);
  return cached;
}
