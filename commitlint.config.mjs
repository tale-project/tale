export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'scope-enum': [
      2,
      'always',
      [
        'platform',
        'web',
        'cli',
        'crawler',
        'rag',
        'db',
        'proxy',
        'deps',
        'convex',
        'workflow',
        'ui',
        'storybook',
        'design',
        'plop',
      ],
    ],
    'scope-empty': [0],
    'body-max-line-length': [0],
    'footer-max-line-length': [0],
  },
};
