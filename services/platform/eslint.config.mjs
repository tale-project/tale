import unicorn from 'eslint-plugin-unicorn';
import tseslint from 'typescript-eslint';
import convexPlugin from '@convex-dev/eslint-plugin';

const eslintConfig = [
  {
    ignores: [
      '.output/**',
      '.vinxi/**',
      'node_modules/**',
      'out/**',
      'build/**',
      '**/_generated/**',
    ],
  },
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx,js,jsx,mjs}'],
    plugins: {
      '@convex-dev/eslint-plugin': convexPlugin,
    },
    rules: {
      // Prefer TS rule and allow underscore-prefixed unused identifiers
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrors: 'all',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  {
    files: [
      'app/**/*.{ts,tsx,js,jsx}',
      'lib/**/*.{ts,tsx,js,jsx}',
      'collections/**/*.{ts,tsx,js,jsx}',
      'components/**/*.{ts,tsx,js,jsx}',
      'constants/**/*.{ts,tsx,js,jsx}',
      'flags/**/*.{ts,tsx,js,jsx}',
      'hooks/**/*.{ts,tsx,js,jsx}',
      'utils/**/*.{ts,tsx,js,jsx}',
      'types/**/*.{ts,tsx,js,jsx}',
      'tools/**/*.{ts,tsx,js,jsx}',
      'examples/**/*.{ts,tsx,js,jsx}',
      'features/**/*.{ts,tsx,js,jsx}',
    ],
    plugins: { unicorn },
    rules: {
      'unicorn/filename-case': ['error', { case: 'kebabCase' }],
    },
  },
];

export default eslintConfig;
