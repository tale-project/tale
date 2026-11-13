import { afterAll, mock } from 'bun:test';

type ModuleFactory = () => Record<string, unknown>;

export interface ModuleMocks {
  /** Replaces the module `specifier` names (relative to the suite) until `restore`. */
  mockModule(specifier: string, factory: ModuleFactory): Promise<void>;
  /** Puts back every module this suite replaced. Runs on its own after the suite. */
  restore(): void;
}

/**
 * `mock.module` is process-global in Bun and outlives the file that calls it:
 * CI runs every test file of the CLI in one process, and a module replaced in
 * one suite stays replaced for each suite after it — a spy that `afterEach`
 * reset answers `undefined` there. A suite that replaces a module through
 * these mocks gets the real module back once it ends.
 *
 * `dir` is the suite's own directory (`import.meta.dir`): a specifier is
 * resolved against it, not against this file.
 */
export function createModuleMocks(dir: string): ModuleMocks {
  const restores: (() => void)[] = [];
  const restore = (): void => {
    for (const putBack of restores.splice(0).reverse()) putBack();
  };
  afterAll(restore);
  return {
    async mockModule(specifier, factory) {
      const path = Bun.resolveSync(specifier, dir);
      const real: Record<string, unknown> = { ...(await import(path)) };
      mock.module(path, factory);
      restores.push(() => mock.module(path, () => real));
    },
    restore,
  };
}
