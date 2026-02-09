export default {
  workspaces: {
    'services/platform': {
      entry: [
        'app/main.tsx',
        'app/routes/**/*.tsx',
        'convex/http.ts',
        'convex/auth.ts',
        'convex/**/*.ts',
        '!convex/_generated/**',
        '!convex/betterAuth/_generated/**',
        'scripts/**/*.{ts,mjs}',
      ],
      project: ['**/*.{ts,tsx,js,jsx,mjs}'],
      ignore: [
        '**/*.test.{ts,tsx}',
        '**/*.spec.{ts,tsx}',
        'convex/_generated/**',
        'convex/betterAuth/**',
        'node_modules/**',
        'dist/**',
        '.output/**',
        '.vinxi/**',
        'storybook-static/**',
        'coverage/**',
        'src/**',
        '*.gen.ts',
        '*.gen.tsx',
      ],
      ignoreDependencies: ['workbox-*', 'convex-test'],
    },
    'tools/cli': {
      project: ['**/*.ts'],
      ignore: ['node_modules/**', 'dist/**'],
    },
  },
};
