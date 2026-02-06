import unicorn from 'eslint-plugin-unicorn';
import tseslint from 'typescript-eslint';
import convexPlugin from '@convex-dev/eslint-plugin';
import reactHooks from 'eslint-plugin-react-hooks';

const eslintConfig = [
  {
    ignores: [
      '.output/**',
      '.vinxi/**',
      'node_modules/**',
      'out/**',
      'build/**',
      'dist/**',
      '**/_generated/**',
      '**/integrations/**/_generated/**',
      'lib/shared/**',
    ],
  },
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx,js,jsx,mjs}'],
    plugins: {
      '@convex-dev/eslint-plugin': convexPlugin,
      'react-hooks': reactHooks,
    },
    rules: {
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
      'react-hooks/rules-of-hooks': 'warn',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'CallExpression[callee.property.name="toLocaleDateString"]',
          message:
            'Use useDateFormat() hook (React) or formatDate() from lib/utils/date/format instead of toLocaleDateString().',
        },
        {
          selector: 'CallExpression[callee.property.name="toLocaleTimeString"]',
          message:
            'Use useDateFormat() hook (React) or formatDate() from lib/utils/date/format instead of toLocaleTimeString().',
        },
        {
          selector: 'CallExpression[callee.property.name="toLocaleString"]',
          message:
            'Use useDateFormat() hook (React) or formatDate() from lib/utils/date/format instead of toLocaleString() for dates.',
        },
      ],
    },
  },
  {
    files: ['convex/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'CallExpression[callee.property.name="collect"]',
          message:
            'Avoid .collect() — it loads all documents into memory. Use for-await iteration, .take(n), or paginated queries instead.',
        },
      ],
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
      'unicorn/filename-case': ['warn', { case: 'kebabCase' }],
    },
  },
];

export default eslintConfig;
