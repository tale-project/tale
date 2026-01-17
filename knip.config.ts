export default {
  workspaces: {
    'services/platform': {
      entry: [
        'app/main.tsx',
        'app/routes/**/*.tsx',
        'convex/http.ts',
        'convex/auth.ts',
      ],
      project: ['**/*.{ts,tsx,js,jsx}'],
      ignore: [
        '**/*.test.{ts,tsx}',
        '**/*.spec.{ts,tsx}',
        'convex/_generated/**',
        'convex/betterAuth/**',
        'node_modules/**',
        'dist/**',
        'eslint.config.mjs',
        'src/**',
        '**/*.stories.tsx',
      ],
      eslint: false,
    },
  },
};
