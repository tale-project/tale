// The page's content security policy has no `unsafe-eval`. Zod probes for it,
// with `new Function('')`, when the first object schema is built, and the
// browser reports the refused probe as a violation (Firefox also as an error in
// the console) on every page load. `lib/zod-config.ts` turns the probe off, but
// only for schemas built after it ran.
//
// A bundler orders modules by what they import, not by the order of the lines
// of the entry file: the chunk that holds the schemas runs before the entry
// chunk's own code, whatever the entry imports first (the development server
// keeps the source order, which hid this). So the setting has to be among the
// dependencies of every module that builds a schema when it loads. This loads
// each module that imports zod as the first of a fresh module graph, with the
// `Function` constructor watched, and fails on the probe.

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

const ROOT = resolve(import.meta.dirname, '../..');

/** The sources of the page and of the code it shares with the server (`.ts`: components build their schemas when they render). */
function sources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sources(path);
    const isSource =
      entry.name.endsWith('.ts') &&
      !/\.(test|spec)\.ts$/.test(entry.name) &&
      !entry.name.endsWith('.gen.ts');
    return isSource ? [path] : [];
  });
}

/** A value import of zod (`import { z } from 'zod'`), not a type-only one. */
const VALUE_IMPORT = /^import\s*\{[^}]*\}\s*from\s*'zod'/m;

const MODULES = ['lib', 'app']
  .flatMap((side) => sources(join(ROOT, side)))
  .filter((path) => VALUE_IMPORT.test(readFileSync(path, 'utf8')))
  .map((path) => relative(ROOT, path));

/**
 * Where zod keeps its settings: on the global object, so that two copies of it
 * share them. A fresh load of zod would find the last test's setting there.
 */
const ZOD_SETTINGS = '__zod_globalConfig';

/** Counts the `Function('')` calls made until `stop()`: zod's probe. */
function watchEvalProbe() {
  const original = globalThis.Function;
  let probes = 0;
  const isProbe = (args: readonly unknown[]) =>
    args.length === 1 && args[0] === '';
  globalThis.Function = new Proxy(original, {
    construct(target, args: unknown[], newTarget) {
      if (isProbe(args)) probes += 1;
      return Reflect.construct(target, args, newTarget);
    },
    apply(target, self, args: unknown[]) {
      if (isProbe(args)) probes += 1;
      return Reflect.apply(target, self, args);
    },
  });
  const settings = Reflect.get(globalThis, ZOD_SETTINGS);
  Reflect.deleteProperty(globalThis, ZOD_SETTINGS);
  return {
    probes: () => probes,
    stop: () => {
      globalThis.Function = original;
      Reflect.set(globalThis, ZOD_SETTINGS, settings);
    },
  };
}

afterEach(() => {
  vi.resetModules();
});

describe('the modules that build zod schemas', () => {
  it('are found', () => {
    expect(MODULES).toContain('lib/api/schemas.ts');
    expect(MODULES).toContain('lib/zod-config.ts');
    expect(MODULES.length).toBeGreaterThan(5);
  });

  it.each(MODULES)(
    '%s is loaded without the probe for eval, as the first module of the page',
    async (module) => {
      vi.resetModules();
      const watch = watchEvalProbe();
      try {
        await import(/* @vite-ignore */ join(ROOT, module));
      } finally {
        watch.stop();
      }
      expect(watch.probes()).toBe(0);
    },
  );
});
