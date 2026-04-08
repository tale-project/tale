export default {
  ignoreBinaries: ['uv'],
  ignore: ['examples/**'],
  workspaces: {
    'services/platform': {
      vite: {
        config: [],
        entry: ['vite.config.ts', 'vite-plugins/**/*.ts'],
      },
      entry: [
        'app/routes/**/*.tsx',
        'app/hooks/**/*.{ts,tsx}',
        'app/features/**/*.{ts,tsx}',
        'app/components/**/*.{ts,tsx}',
        'lib/utils/client-utils.ts',
        'convex/http.ts',
        'convex/auth.ts',
        'convex/**/*.ts',
        '!convex/_generated/**',
        '!convex/betterAuth/_generated/**',
        'scripts/**/*.ts',
        'server.ts',
      ],
      project: ['**/*.{ts,tsx}'],
      ignoreDependencies: [
        'convex-test',
        'mermaid',
        '@modelcontextprotocol/sdk',
      ],
    },
    'tools/cli': {
      project: ['**/*.ts'],
    },
  },
  exclude: ['duplicates'],
};
