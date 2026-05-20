export default {
  ignoreBinaries: ['uv', 'uvx'],
  ignore: ['examples/**', 'tools/plop/templates/**'],
  workspaces: {
    'services/platform': {
      vite: { config: ['vite.config.ts'] },
      ignore: ['convex/_generated/**'],
      entry: [
        'app/routes/**/*.tsx',
        'scripts/**/*.ts',
        // Bun production server — invoked by docker-entrypoint.sh, not from
        // package.json scripts, so knip can't auto-detect it via the npm plugin.
        'server.ts',
        // Platform-only: Convex backend (separate runtime, not reachable via the
        // SPA's import graph) and platform-specific app subtrees.
        'convex/**/*.ts',
        '!convex/_generated/**',
        '!convex/betterAuth/_generated/**',
        'app/features/**/*.{ts,tsx}',
        'app/hooks/**/*.{ts,tsx}',
        'app/components/**/*.{ts,tsx}',
        'lib/utils/client-utils.ts',
        'reset-owner.ts',
      ],
      project: ['**/*.{ts,tsx}'],
      ignoreDependencies: [
        // Inlined by vitest as a string in `server.deps.inline` (vitest.config.ts) — not a direct import.
        'convex-test',
        // Listed in `optimizeDeps.include` in vite.config.ts as a string literal so vite prebundles it;
        // consumed transitively via @tale/ui components, never imported by name from platform code.
        '@radix-ui/react-slot',
        // Referenced as a glob path in tailwind.config.ts (`./node_modules/@tale/webui/src/**`) so
        // tailwind scans its source files; no JS/TS import from platform.
        '@tale/webui',
        // Peer of @vitest/browser-playwright, required at runtime by vitest's browser test mode
        // but never imported directly.
        '@vitest/browser',
      ],
    },
    'services/web': {
      vite: { config: ['vite.config.ts'] },
      entry: [
        'app/routes/**/*.tsx',
        'scripts/**/*.ts',
        // SSR build target — passed to `vite build --ssr` in package.json scripts;
        // vite's plugin only sees the client-side index.html input.
        'app/entry-server.tsx',
        'vitest.ui.config.ts',
      ],
      project: ['**/*.{ts,tsx}'],
    },
    'services/sandbox': {
      // Standalone Bun HTTP service. `src/server.ts` is the runtime entry
      // (invoked from the Dockerfile CMD, not from package.json scripts that
      // knip auto-detects); tests anchor the dead-code sweep for unit-only
      // helpers.
      entry: ['src/server.ts', 'src/**/*.test.ts'],
      project: ['src/**/*.ts'],
    },
    'services/docs': {
      vite: { config: ['vite.config.ts'] },
      entry: [
        'app/routes/**/*.tsx',
        'scripts/**/*.ts',
        // SSR build target — passed to `vite build --ssr` in package.json scripts;
        // vite's plugin only sees the client-side index.html input.
        'app/entry-server.tsx',
      ],
      project: ['**/*.{ts,tsx}'],
    },
    'packages/seo': {
      entry: ['src/**/*.ts'],
      project: ['**/*.ts'],
      // Vite is an optional peer dep for the `vite-plugin-artifacts`
      // subpath; consumers bring their own vite. Knip flags it as a
      // referenced optional peer otherwise.
      ignoreDependencies: ['vite'],
    },
    'packages/webui': {
      storybook: {
        config: ['.storybook/main.ts'],
        entry: [
          '.storybook/{main,manager,preview}.{ts,tsx}',
          '**/*.stories.{ts,tsx}',
        ],
      },
      entry: ['src/**/*.{ts,tsx}', 'src/**/*.stories.{ts,tsx}'],
      project: ['**/*.{ts,tsx}'],
    },
    'packages/ui': {
      storybook: {
        config: ['.storybook/main.ts'],
        entry: [
          '.storybook/{main,manager,preview}.{ts,tsx}',
          '**/*.stories.{ts,tsx}',
        ],
      },
      entry: ['src/components/**/*.{ts,tsx}', 'src/**/*.stories.{ts,tsx}'],
      project: ['**/*.{ts,tsx}'],
    },
    'tools/cli': {
      project: ['**/*.ts'],
    },
    'tools/plop': {
      entry: ['generators/**/*.ts', 'helpers/**/*.ts'],
      project: ['**/*.ts', '!templates/**'],
    },
  },
  exclude: ['duplicates'],
};
