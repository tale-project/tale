// The real config watcher (chokidar-backed, registry-driven
// event parsing) is retired. It
// depended on `CONFIG_DOMAINS_BY_NAME`/`NESTED_SINGLE_FILE_WATCHERS`, which no
// longer exist on the rewritten `lib/shared/config/registry.ts` (that module
// now exports `CONFIG_DOMAINS`/`getConfigDomain`/`getV8SyncSpec` instead). This
// stub keeps `server.ts` and `vite-plugins/watch-examples.ts` compiling and
// running by never watching anything and never invoking callbacks — config
// changes simply won't push a live SSE invalidation to open browser tabs until
// the rewrite restores this. Callers already treat the watcher as fire-and-
// forget display plumbing (a manual page refresh still picks up the change),
// so a silent no-op is safe here.

interface ConfigChangeEvent {
  type: string;
  orgSlug?: string;
  slug?: string;
}

interface ConfigWatcher {
  onChange: (callback: (event: ConfigChangeEvent) => void) => void;
  close: () => Promise<void>;
}

export function createConfigWatcher(_configDir: string): ConfigWatcher {
  console.debug(
    '[config-watcher] stubbed while the platform AI backend is rewritten; no file-change events will be emitted',
  );
  return {
    onChange() {
      // No-op: never invoked, since nothing is watched.
    },
    async close() {
      // No-op: nothing to tear down.
    },
  };
}
