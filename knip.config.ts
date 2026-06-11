export default {
  ignoreBinaries: ['uv', 'uvx'],
  ignore: ['examples/**', 'tools/plop/templates/**'],
  workspaces: {
    'services/platform': {
      vite: { config: ['vite.config.ts'] },
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
        // Listed in `optimizeDeps.include` in vite.config.ts as a string literal so vite prebundles it;
        // consumed transitively via @tale/ui components, never imported by name from platform code.
        '@radix-ui/react-slot',
        // Peer of @vitest/browser-playwright, required at runtime by vitest's browser test mode
        // but never imported directly.
        '@vitest/browser',
        // Imported only by the on-demand CLS proof harness (scripts/cls-harness.ts),
        // which is NOT part of CI. Available transitively via @vitest/browser's
        // playwright driver, so it never needs to be a declared dependency.
        'playwright',
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
      // Standalone Bun HTTP service. `src/server.ts` is the runtime entry,
      // auto-detected from `dev`/`start` scripts; tests anchor the dead-code
      // sweep for unit-only helpers.
      entry: [
        'src/**/*.test.ts',
        // In-Pod entry scripts for the Kubernetes backend — launched by
        // absolute path inside the Pod (STAGE_ENTRY / HARVEST_ENTRY in
        // k8s-pod-spec.ts), never imported, so knip can't trace them.
        'src/backend/kubernetes/k8s-stage.ts',
        'src/backend/kubernetes/k8s-harvest.ts',
      ],
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
      ignoreDependencies: [
        // Type-only import in src/{pwa,seo/runtime}/vite-plugin.ts. Declared
        // as an optional peer so consumers without a vite-driven service
        // don't have to install it; knip flags optional peers that are
        // referenced, which is exactly the pattern we want here.
        'vite',
      ],
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
