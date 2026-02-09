export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'scope-enum': [
      2,
      'always',
      [
        'platform',
        'cli',
        'crawler',
        'rag',
        'graph-db',
        'operator',
        'db',
        'proxy',
        'deps',
        'convex',
        'workflow',
      ],
    ],
    'scope-empty': [0],
    'body-max-line-length': [0],
    'footer-max-line-length': [0],
  },
};
